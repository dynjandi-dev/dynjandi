import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  HOST_NOT_ALLOWED_MESSAGE,
  HOST_NOT_ALLOWED_STATUS,
  isAllowedHost,
  refusalLine,
} from "./host-check.js";
import { checkProjectKey } from "./project-key.js";
import type { Renderer } from "./renderer.js";
import { sendError, sendImage, sendJson } from "./responses.js";
import { type FileStore, isFileId } from "./store.js";
import { serveVariant } from "./variants.js";

// What a multipart body adds to the file: boundaries and part headers. The body cap is the file cap plus this,
// so a file of exactly `maxFileSize` can be uploaded; the file's own size is checked again after parsing (D7).
const MULTIPART_FRAMING_BYTES = 65_536;
const FILE_TOO_LARGE = "File exceeds maximum allowed size";
const MULTIPART = /^multipart\/form-data\s*(?:;|$)/i;
// A decimal as a form sends it, such as `0.42`: no hexadecimal, no `Infinity`.
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

// The CLI's own version for GET /health (D20). `src/dev/` and `dist/dev/` are both two levels below the
// package root, so one relative path finds package.json from the sources (tests) and from the tarball.
const CLI_VERSION = readCliVersion();

function readCliVersion(): string {
  const pkg: unknown = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  if (
    typeof pkg === "object" &&
    pkg !== null &&
    "version" in pkg &&
    typeof pkg.version === "string"
  ) {
    return pkg.version;
  }
  throw new Error("the CLI's package.json has no version");
}

export interface ApiOptions {
  store: FileStore;
  renderer: Renderer;
  projectKey: string;
  /** Bytes. */
  maxFileSize: number;
  /** What `GET /health` reports as `renderer` (D20). */
  rendererKind: "docker" | "url" | "none";
  /** Names `--allow-host` added to the ones `Host` is always allowed to be (D5). */
  allowHosts?: readonly string[];
  /** Receives lines for stderr, without a newline. */
  log: (line: string) => void;
}

/** The path as sent, without the query. Not parsed as a URL: "//x" would read as a host. */
export function pathOf(request: IncomingMessage): string {
  return (request.url ?? "/").split("?", 1)[0] ?? "/";
}

// Reads the body, or returns `null` as soon as it passes `limit`, leaving the rest unread. Rejects when the
// client goes away before the body ends.
function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("close", onClose);
    };
    const done = (result: Uint8Array<ArrayBuffer> | null) => {
      cleanup();
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.pause();
        done(null);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => done(new Uint8Array(Buffer.concat(chunks)));
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () =>
      onError(new Error("the client closed the connection before the body ended"));
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("close", onClose);
  });
}

type Focal =
  | { ok: true; focalX: number | null; focalY: number | null }
  | { ok: false; error: string };

// Both or neither (openapi.yaml, UploadRequest); an empty value counts as missing.
function parseFocal(x: FormDataEntryValue | null, y: FormDataEntryValue | null): Focal {
  const blank = (value: FormDataEntryValue | null) =>
    value === null || (typeof value === "string" && value.trim() === "");
  if (x === null && y === null) return { ok: true, focalX: null, focalY: null };
  if (blank(x) || blank(y)) return { ok: false, error: "Both focalX and focalY are required" };
  const numbers = [x, y].map((value) =>
    typeof value === "string" && DECIMAL.test(value.trim()) ? Number(value.trim()) : Number.NaN,
  );
  const [focalX, focalY] = numbers;
  if (
    focalX === undefined ||
    focalY === undefined ||
    ![focalX, focalY].every((n) => n >= 0 && n <= 1)
  ) {
    return { ok: false, error: "Invalid focal coordinates" };
  }
  return { ok: true, focalX, focalY };
}

async function upload(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiOptions,
): Promise<void> {
  const contentType = request.headers["content-type"] ?? "";
  if (!MULTIPART.test(contentType)) {
    sendError(response, 400, "Expected multipart/form-data");
    return;
  }

  const bodyLimit = options.maxFileSize + MULTIPART_FRAMING_BYTES;
  const declared = Number(request.headers["content-length"]);
  if (declared > bodyLimit) {
    // Node discards the unread body; closing the socket instead resets the client before it reads the 413.
    request.resume();
    sendError(response, 413, FILE_TOO_LARGE);
    return;
  }
  let body: Uint8Array<ArrayBuffer> | null;
  try {
    body = await readBody(request, bodyLimit);
  } catch (error) {
    // The client went away mid-body, so there is nobody to answer: say so on stderr and drop the socket,
    // rather than log a status that was never received.
    options.log(
      `POST /upload abandoned: ${error instanceof Error ? error.message : String(error)}`,
    );
    response.destroy();
    return;
  }
  if (body === null) {
    request.resume();
    sendError(response, 413, FILE_TOO_LARGE);
    return;
  }

  let form: FormData;
  try {
    form = await new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }).formData();
  } catch {
    sendError(response, 400, "Invalid multipart body");
    return;
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    sendError(response, 400, "No file provided");
    return;
  }
  if (file.size > options.maxFileSize) {
    sendError(response, 413, FILE_TOO_LARGE);
    return;
  }
  const focal = parseFocal(form.get("focalX"), form.get("focalY"));
  if (!focal.ok) {
    sendError(response, 400, focal.error);
    return;
  }

  const record = await options.store.create({
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type === "" ? "application/octet-stream" : file.type,
    originalFilename: file.name === "" ? null : file.name,
    focalX: focal.focalX,
    focalY: focal.focalY,
  });
  sendJson(response, 201, {
    file: record.id,
    id: record.id,
    url: `/${record.id}`,
    focalX: record.focalX,
    focalY: record.focalY,
  });
}

async function getFile(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiOptions,
  id: string,
): Promise<void> {
  // The key is checked before the id, as the service does; the id before any filesystem call (D6).
  const key = checkProjectKey(request.headers, options.projectKey);
  if (!key.ok) {
    sendError(response, key.status, key.error);
    return;
  }
  const record = isFileId(id) ? await options.store.readRecord(id) : null;
  if (record === null) {
    sendError(response, 404, "File not found");
    return;
  }
  sendJson(response, 200, record);
}

async function getOriginal(
  response: ServerResponse,
  options: ApiOptions,
  id: string,
): Promise<void> {
  const stored = isFileId(id) ? await options.store.read(id) : null;
  if (stored === null) {
    sendError(response, 404, "File not found");
    return;
  }
  sendImage(response, stored.record.contentType, stored.bytes);
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiOptions,
): Promise<void> {
  const path = pathOf(request);

  if (request.method === "POST" && path === "/upload") {
    const key = checkProjectKey(request.headers, options.projectKey);
    if (!key.ok) {
      sendError(response, key.status, key.error);
      return;
    }
    await upload(request, response, options);
    return;
  }
  // POST /upload and GET are the only methods answered; there is no CORS and no OPTIONS (D8).
  if (request.method !== "GET") {
    sendError(response, 405, "Method not allowed");
    return;
  }
  if (path === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "dynjandi-dev",
      version: CLI_VERSION,
      renderer: options.rendererKind,
    });
    return;
  }

  const rest = path.slice(1);
  // `/<id>/-/<ops>`: everything after `/-/` is the chain, slashes included; `/<id>/-/` alone has an empty one.
  const variant = /^([^/]+)\/-\/(.*)$/.exec(rest);
  if (variant !== null) {
    await serveVariant(response, options, variant[1] ?? "", variant[2] ?? "");
  } else if (rest.startsWith("files/") && !rest.slice("files/".length).includes("/")) {
    await getFile(request, response, options, rest.slice("files/".length));
  } else if (rest !== "" && !rest.includes("/")) {
    await getOriginal(response, options, rest);
  } else {
    sendError(response, 404, "Not found");
  }
}

/** The request handler for the routes of section 4.2. It never rejects: an unexpected failure is a 500. */
export function createApiHandler(
  options: ApiOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    try {
      // Before any route, `/health` included (D5).
      if (!isAllowedHost(request.headers.host, options.allowHosts)) {
        options.log(refusalLine(request.headers.host));
        sendError(response, HOST_NOT_ALLOWED_STATUS, HOST_NOT_ALLOWED_MESSAGE);
        return;
      }
      await route(request, response, options);
    } catch (error) {
      // The detail goes to stderr only; the caller gets the spec's fixed message (security/api-security.md).
      const detail = error instanceof Error ? error.message : String(error);
      options.log(`${request.method} ${pathOf(request)} failed: ${detail}`);
      if (response.headersSent) response.destroy();
      else sendError(response, 500, "Internal server error");
    }
  };
}
