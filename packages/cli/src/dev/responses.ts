import type { ServerResponse } from "node:http";

// The cache header of production's originals and variants (D9); the spec's API answers are no-store.
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const NO_STORE = "no-store";

/** A JSON answer. `extraHeaders` is for the few that need one, such as `Connection: close`. */
export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": NO_STORE,
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

/** Every error has the same body, `{ "error" }`, and is never cached (openapi.yaml, *Errors*). */
export function sendError(
  response: ServerResponse,
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {},
): void {
  sendJson(response, status, { error: message }, extraHeaders);
}

/**
 * An original: the stored type, cached for good, and locked down so an uploaded SVG or HTML cannot run
 * script on this origin (D9).
 */
export function sendOriginal(response: ServerResponse, contentType: string, bytes: Buffer): void {
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": bytes.byteLength,
    "Cache-Control": IMMUTABLE_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  response.end(bytes);
}
