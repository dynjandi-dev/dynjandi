import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// The server binds loopback only: it and the renderer are unauthenticated, so there is no --host (D7).
const LOOPBACK = "127.0.0.1";

export interface StartServerOptions {
  /** 0 takes a free port. */
  port: number;
  /** Receives one line per request (method, path, status), without a newline. */
  log?: (line: string) => void;
}

export interface RunningServer {
  /** The bound origin, `http://127.0.0.1:<port>`. */
  url: string;
  close: () => Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

// The path as sent, without the query. Not parsed as a URL: "//x" would read as a host.
function pathOf(request: IncomingMessage): string {
  return (request.url ?? "/").split("?", 1)[0] ?? "/";
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  // GET is the one method answered so far; POST /upload joins it when uploads land (D8).
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  if (pathOf(request) === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { error: "Not found" });
}

export function startServer(options: StartServerOptions): Promise<RunningServer> {
  const server = createServer((request, response) => {
    response.on("finish", () => {
      options.log?.(`${request.method} ${pathOf(request)} ${response.statusCode}`);
    });
    handleRequest(request, response);
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
