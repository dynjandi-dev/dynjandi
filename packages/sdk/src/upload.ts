import { DynjandiError } from "./errors";
import type { components } from "./generated/api";

type UploadRequest = components["schemas"]["UploadRequest"];
type UploadResponse = components["schemas"]["UploadResponse"];

/** The stored file, as the service describes it, with `url` resolved to an absolute URL. */
export type UploadResult = UploadResponse;

export interface UploadOptions {
  /**
   * Focal point, each coordinate from 0 to 1 inclusive. Both coordinates travel together, so giving
   * only one is not representable. Out-of-range or non-finite values are refused before any request.
   */
  focal?: { x: NonNullable<UploadRequest["focalX"]>; y: NonNullable<UploadRequest["focalY"]> };
}

/** What `upload` needs from the client, already validated by `createClient`. */
export interface UploadConfig {
  publicKey: string;
  origin: string;
  fetch: typeof fetch;
}

function isFraction(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNullableFraction(value: unknown): boolean {
  return value === null || (typeof value === "number" && isFraction(value));
}

function isUploadResponse(body: unknown): body is UploadResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    "file" in body &&
    typeof body.file === "string" &&
    "id" in body &&
    typeof body.id === "string" &&
    "url" in body &&
    typeof body.url === "string" &&
    body.url.startsWith("/") &&
    "focalX" in body &&
    isNullableFraction(body.focalX) &&
    "focalY" in body &&
    isNullableFraction(body.focalY)
  );
}

function errorMessageFrom(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return undefined;
}

/** The absolute URL of `path` on `origin`, or `undefined` if it does not parse or leaves the origin. */
function resolveOnOrigin(path: string, origin: string): string | undefined {
  try {
    const resolved = new URL(path, origin);
    return resolved.origin === origin ? resolved.href : undefined;
  } catch {
    return undefined;
  }
}

async function readJson(response: Response): Promise<{ body: unknown } | { failure: unknown }> {
  try {
    return { body: await response.json() };
  } catch (failure) {
    return { failure };
  }
}

/**
 * Uploads `file` to the project that owns the client's public key.
 *
 * Server-side only: the CDN sends no CORS headers, so a cross-origin browser `POST /upload` is
 * blocked. Call this from Node, a server or another non-browser runtime.
 *
 * Every failure is a `DynjandiError`: the service's non-2xx answers, a network failure, a malformed
 * response body, and a focal point outside 0 to 1.
 */
export async function upload(
  config: UploadConfig,
  file: Blob,
  options: UploadOptions = {},
): Promise<UploadResult> {
  // The key is sent in a header only, and scrubbed from every message so it cannot leak into logs.
  const fail = (message: string, status: number, cause?: unknown): DynjandiError =>
    new DynjandiError(message.replaceAll(config.publicKey, "[redacted]"), status, {
      cause,
    });

  const form = new FormData();
  form.append("file", file);
  if (options.focal !== undefined) {
    const { x, y } = options.focal;
    if (!isFraction(x) || !isFraction(y)) {
      throw fail("Focal point coordinates must be numbers from 0 to 1 inclusive.", 0);
    }
    form.append("focalX", String(x));
    form.append("focalY", String(y));
  }

  let response: Response;
  try {
    const { fetch } = config;
    response = await fetch(new URL("/upload", config.origin).href, {
      method: "POST",
      headers: { "X-Public-Key": config.publicKey },
      body: form,
    });
  } catch (cause) {
    const reason = cause instanceof Error ? `: ${cause.message}` : "";
    throw fail(`Upload request failed${reason}`, 0, cause);
  }

  const parsed = await readJson(response);

  if (!response.ok) {
    const message =
      ("body" in parsed ? errorMessageFrom(parsed.body) : undefined) ??
      `Upload failed with status ${response.status}.`;
    throw fail(message, response.status, "failure" in parsed ? parsed.failure : undefined);
  }

  // `url` must stay on the client's origin: "//host/x" and "/\\host/x" also start with "/" but resolve
  // to another host, and "//[" does not parse at all, so resolve once and compare origins.
  const body = "body" in parsed && isUploadResponse(parsed.body) ? parsed.body : undefined;
  const resolved = body === undefined ? undefined : resolveOnOrigin(body.url, config.origin);
  if (body === undefined || resolved === undefined) {
    throw fail(
      `Upload succeeded with status ${response.status} but the response body is not the documented shape.`,
      response.status,
      "failure" in parsed ? parsed.failure : undefined,
    );
  }

  return { ...body, url: resolved };
}
