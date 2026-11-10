import { createServer } from "node:http";
import { createApiHandler, pathOf } from "./api.js";
import { type DockerRenderer, startDockerRenderer } from "./docker.js";
import type { RendererChoice } from "./options.js";
import { createRenderer, probeRenderer } from "./renderer.js";
import { openStore } from "./store.js";

// The server binds loopback only: it and the renderer are unauthenticated, so there is no --host (D7).
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
  /** Receives one line per request (method, path, status), without a newline. */
  log?: (line: string) => void;
}

export interface RunningServer {
  /** The bound origin, `http://127.0.0.1:<port>`. */
  url: string;
  close: () => Promise<void>;
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const log = options.log ?? (() => {});
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
    return await listen(options, store, choice, container, log);
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
    log,
  });
  const server = createServer((request, response) => {
    response.on("finish", () => {
      log(`${request.method} ${pathOf(request)} ${response.statusCode}`);
    });
    void handle(request, response);
  });

  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `port ${options.port} is already in use on ${LOOPBACK}; choose another with --port <n>, or --port 0 for a free one`,
            )
          : error,
      );
    });
    server.listen(options.port, LOOPBACK, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the server has no TCP address"));
        return;
      }
      resolve({
        url: `http://${address.address}:${address.port}`,
        close: async () => {
          try {
            await new Promise<void>((done, fail) => {
              server.close((error) => (error ? fail(error) : done()));
              server.closeAllConnections();
            });
          } finally {
            await container?.stop();
          }
        },
      });
    });
  });
}
