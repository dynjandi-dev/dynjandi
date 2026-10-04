import type { components } from "./generated/api.js";
import { createFail, errorMessageFrom, readJson } from "./http.js";
import type { UploadConfig } from "./upload.js";

/** A stored file as the service describes it. */
export type FileRecord = components["schemas"]["FileRecord"];

function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** A stored point is both coordinates or neither, never one. */
function hasWholeOrNoPoint(body: { focalX?: unknown; focalY?: unknown }): boolean {
  return (
    (body.focalX === null && body.focalY === null) ||
    (isFraction(body.focalX) && isFraction(body.focalY))
  );
}

function isFileRecord(body: unknown): body is FileRecord {
  return (
    typeof body === "object" &&
    body !== null &&
    "id" in body &&
    typeof body.id === "string" &&
    "contentType" in body &&
    typeof body.contentType === "string" &&
    "bytes" in body &&
    typeof body.bytes === "number" &&
    "originalFilename" in body &&
    (body.originalFilename === null || typeof body.originalFilename === "string") &&
    "source" in body &&
    typeof body.source === "string" &&
    "createdAt" in body &&
    typeof body.createdAt === "string" &&
    "focalX" in body &&
    "focalY" in body &&
    hasWholeOrNoPoint(body)
  );
}

/**
 * Reads the stored record of `fileId` from the project that owns the client's public key.
 *
 * Server-side only: the CDN sends no CORS headers, so a cross-origin browser `GET` is blocked. The
 * response is `Cache-Control: no-store` and the SDK does not cache it, so keep the record rather than
 * calling this once per rendered image.
 *
 * Every failure is a `DynjandiError`: the service's non-2xx answers (an unknown id, or one outside the
 * key's project, is 404), a network failure, a malformed response body, and an empty or dot-segment
 * `fileId` (status 0, before any request).
 */
export async function getFile(config: UploadConfig, fileId: string): Promise<FileRecord> {
  const fail = createFail(config.publicKey);

  if (fileId === "") {
    throw fail("getFile needs a non-empty file id.", 0);
  }
  // Percent-encoding keeps "/" and "?" inside the segment, but URL parsing still collapses "." and ".."
  // segments (also as "%2e"), which would leave /files/.
  if (fileId === "." || fileId === "..") {
    throw fail("getFile needs a file id, not a path segment.", 0);
  }

  let response: Response;
  try {
    const { fetch } = config;
    response = await fetch(new URL(`/files/${encodeURIComponent(fileId)}`, config.origin).href, {
      method: "GET",
      headers: { "X-Public-Key": config.publicKey },
    });
  } catch (cause) {
    const reason = cause instanceof Error ? `: ${cause.message}` : "";
    throw fail(`File request failed${reason}`, 0, cause);
  }

  const parsed = await readJson(response);
  const failure = "failure" in parsed ? parsed.failure : undefined;

  if (!response.ok) {
    const message =
      ("body" in parsed ? errorMessageFrom(parsed.body) : undefined) ??
      `File request failed with status ${response.status}.`;
    throw fail(message, response.status, failure);
  }

  if (!("body" in parsed) || !isFileRecord(parsed.body)) {
    throw fail(
      `File request succeeded with status ${response.status} but the response body is not the documented shape.`,
      response.status,
      failure,
    );
  }

  return parsed.body;
}
