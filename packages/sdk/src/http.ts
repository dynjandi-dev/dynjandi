import { DynjandiError } from "./errors.js";

/** Reads a response body as JSON, keeping the parse failure instead of throwing it. */
export async function readJson(
  response: Response,
): Promise<{ body: unknown } | { failure: unknown }> {
  try {
    return { body: await response.json() };
  } catch (failure) {
    return { failure };
  }
}

/** The service's flat `{ error: string }` message, if the body has one. */
export function errorMessageFrom(body: unknown): string | undefined {
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

/**
 * Builds the `DynjandiError` factory for one client. The key is sent in a header only, and scrubbed from
 * every message so it cannot leak into logs.
 */
export function createFail(publicKey: string) {
  return (message: string, status: number, cause?: unknown): DynjandiError =>
    new DynjandiError(message.replaceAll(publicKey, "[redacted]"), status, { cause });
}
