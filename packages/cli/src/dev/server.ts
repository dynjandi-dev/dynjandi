import { createServer } from "node:http";
import { createApiHandler, pathOf } from "./api.js";
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
  const handle = createApiHandler({
    store,
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
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}
