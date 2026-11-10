import { createServer, type IncomingHttpHeaders } from "node:http";

/** What the stub was sent. */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** How the stub answers `POST /transform`. */
export type TransformBehaviour =
  | { kind: "image"; contentType: string; bytes: Uint8Array }
  | { kind: "error"; status: number; message: string }
  /** Answers `307` to `/elsewhere`, which itself answers `200 image/gif`: a client that follows gets an image. */
  | { kind: "redirect" }
  /** Reads the request and never answers, as a renderer that hangs. */
  | { kind: "silent" };

export interface StubRenderer {
  /** `http://127.0.0.1:<port>`. */
  url: string;
  requests: RecordedRequest[];
  respondWith: (behaviour: TransformBehaviour) => void;
  close: () => Promise<void>;
}

/**
 * A stand-in for the renderer's published routes (core#364 D8): `POST /transform`, `POST /focal-suggestion`
 * and `GET /health`. Errors are the renderer's flat `{ "error" }`. It decodes nothing: it records what it
 * received and answers as told.
 */
export async function startStubRenderer(): Promise<StubRenderer> {
  const requests: RecordedRequest[] = [];
  let behaviour: TransformBehaviour = {
    kind: "image",
    contentType: "image/png",
    bytes: new Uint8Array([1, 2, 3]),
  };

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => void chunks.push(chunk));
    request.on("end", () => {
      const path = (request.url ?? "/").split("?", 1)[0] ?? "/";
      requests.push({
        method: request.method ?? "",
        path,
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      const json = (status: number, body: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.method === "GET" && path === "/health") {
        json(200, { ok: true });
      } else if (request.method === "POST" && path === "/transform") {
        if (behaviour.kind === "silent") return;
        if (behaviour.kind === "redirect") {
          response.writeHead(307, { Location: "/elsewhere" });
          response.end();
          return;
        }
        if (behaviour.kind === "error") {
          json(behaviour.status, { error: behaviour.message });
          return;
        }
        response.writeHead(200, { "Content-Type": behaviour.contentType });
        response.end(behaviour.bytes);
      } else if (path === "/elsewhere") {
        response.writeHead(200, { "Content-Type": "image/gif" });
        response.end(new Uint8Array([71, 73, 70]));
      } else if (request.method === "POST" && path === "/focal-suggestion") {
        json(200, { focalX: 0.5, focalY: 0.5, source: "attention" });
      } else {
        json(404, { error: "Not found" });
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the stub has no address");

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    respondWith: (next) => {
      behaviour = next;
    },
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => (error ? fail(error) : done()));
        server.closeAllConnections();
      }),
  };
}
