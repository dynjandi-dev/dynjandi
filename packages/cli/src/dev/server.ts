import { createServer, type Server } from "node:http";
import { createApiHandler, pathOf } from "./api.js";
import { type ContainerPlan, containerOrigin, readContainerPlan } from "./containers.js";
import { type DockerRenderer, startDockerRenderer } from "./docker.js";
import type { RendererChoice } from "./options.js";
import { createRenderer, probeRenderer } from "./renderer.js";
import { openStore } from "./store.js";

// Without --containers the server binds loopback only: it and the renderer are unauthenticated, so there is no
// --host (D7, D1). --containers adds the one address ContainerPlan names, never a wildcard (D2).
const LOOPBACK = "127.0.0.1";

export interface StartServerOptions {
  /** 0 takes a free port. */
  port: number;
  /** Where files are kept (D5, D6). */
  dataDir: string;
  /** The key `POST /upload` and `GET /files/{id}` accept (D1). */
  projectKey: string;
  /** Bytes (D7). */
  maxFileSize: number;
  /** Where variants are rendered (D2). */
  renderer: RendererChoice;
  /** How long a render may take; 30 s unless a test shortens it. */
  renderTimeoutMs?: number;
  /** Aborting while the Docker renderer starts stops its container and rejects `RendererStartAborted`. */
  signal?: AbortSignal | undefined;
  /** How long the Docker renderer has to become healthy (60 s) and how often it is asked; tests shorten them. */
  dockerHealthTimeoutMs?: number | undefined;
  dockerPollIntervalMs?: number | undefined;
  /** Host names to answer to besides the always-allowed ones (D5). */
  allowHosts?: readonly string[] | undefined;
  /** Also listen where containers reach this host, and report the origin they use (D1, D2, D3). */
  containers?: boolean | undefined;
  /** Receives lines for stderr, without a newline. */
  log?: (line: string) => void;
  /** False drops the one line per request (method, path, status); failures and warnings still reach `log` (D18). */
  logRequests?: boolean;
}

export interface RunningServer {
  /** The bound origin, `http://127.0.0.1:<port>`. */
  url: string;
  /** Under `containers`: the origin a container uses, on the same port as `url` (D3). */
  containerOrigin?: string;
  close: () => Promise<void>;
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const log = options.log ?? (() => {});
  // Before anything is started, so a failure leaves no renderer container behind.
  const plan = options.containers === true ? await readContainerPlan(options.signal) : undefined;
  const store = await openStore(options.dataDir, log);
  // Healthy before the listener opens, so the ready line only ever follows a renderer that answers (D12).
  let container: DockerRenderer | undefined;
  let choice: Exclude<RendererChoice, { kind: "docker" }>;
  if (options.renderer.kind === "docker") {
    container = await startDockerRenderer({
      log,
      signal: options.signal,
      healthTimeoutMs: options.dockerHealthTimeoutMs,
      pollIntervalMs: options.dockerPollIntervalMs,
    });
    choice = { kind: "url", url: container.url };
  } else {
    choice = options.renderer;
    if (choice.kind === "url") await probeRenderer(choice.url, log);
  }
  try {
    return await listen(options, store, choice, container, plan, log);
  } catch (error) {
    await container?.stop();
    throw error;
  }
}

async function listen(
  options: StartServerOptions,
  store: Awaited<ReturnType<typeof openStore>>,
  choice: Exclude<RendererChoice, { kind: "docker" }>,
  container: DockerRenderer | undefined,
  plan: ContainerPlan | undefined,
  log: (line: string) => void,
): Promise<RunningServer> {
  const handle = createApiHandler({
    store,
    renderer: createRenderer(choice, {
      log,
      ...(options.renderTimeoutMs === undefined ? {} : { timeoutMs: options.renderTimeoutMs }),
    }),
    projectKey: options.projectKey,
    maxFileSize: options.maxFileSize,
    rendererKind: options.renderer.kind,
    ...(options.allowHosts === undefined ? {} : { allowHosts: options.allowHosts }),
    log,
  });
  // One handler for every listener, so the Host check and the key rules are the same on each (D4, D5).
  const newServer = () =>
    createServer((request, response) => {
      if (options.logRequests !== false) {
        response.on("finish", () => {
          log(`${request.method} ${pathOf(request)} ${response.statusCode}`);
        });
      }
      void handle(request, response);
    });

  // Loopback first, so `--port 0` takes its port there; the others then take the same one (D2).
  const servers: Server[] = [];
  const closeAll = async () => {
    try {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((done, fail) => {
              server.close((error) => (error ? fail(error) : done()));
              server.closeAllConnections();
            }),
        ),
      );
    } finally {
      await container?.stop();
    }
  };
  try {
    let port = options.port;
    for (const address of plan?.addresses ?? [LOOPBACK]) {
      const server = newServer();
      await listenOn(server, port, address);
      servers.push(server);
      port = boundPort(server);
    }
    return {
      url: `http://${LOOPBACK}:${port}`,
      ...(plan === undefined ? {} : { containerOrigin: containerOrigin(plan, port) }),
      close: closeAll,
    };
  } catch (error) {
    // A listener that could not open must not leave the ones before it serving.
    await Promise.allSettled(
      servers.map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
    throw error;
  }
}

function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the server has no TCP address");
  }
  return address.port;
}

function listenOn(server: Server, port: number, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `port ${port} is already in use on ${address}; choose another with --port <n>, or --port 0 for a free one`,
            )
          : error,
      );
    });
    server.listen(port, address, resolve);
  });
}
