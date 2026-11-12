import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export type ProjectKeyCheck = { ok: true } | { ok: false; status: 400 | 401; error: string };

// An empty header is read as absent, as the service does (D1).
function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return value === undefined || value === "" ? undefined : String(value);
}

// Compared as digests so the comparison takes the same time for any input.
function sameKey(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * The project-key rules of openapi.yaml, *Authentication* (D1): `X-Project-Key`, or its deprecated alias
 * `X-Public-Key`; two different values are 400; none is 401 `Missing X-Project-Key`; a wrong one is 401
 * `Invalid project key`.
 */
export function checkProjectKey(headers: IncomingHttpHeaders, expected: string): ProjectKeyCheck {
  const projectKey = headerValue(headers, "x-project-key");
  const publicKey = headerValue(headers, "x-public-key");
  if (projectKey !== undefined && publicKey !== undefined && projectKey !== publicKey) {
    return { ok: false, status: 400, error: "X-Project-Key and X-Public-Key differ" };
  }
  const given = projectKey ?? publicKey;
  if (given === undefined) return { ok: false, status: 401, error: "Missing X-Project-Key" };
  if (!sameKey(given, expected)) return { ok: false, status: 401, error: "Invalid project key" };
  return { ok: true };
}
