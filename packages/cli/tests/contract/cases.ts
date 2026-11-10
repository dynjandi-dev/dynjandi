import { expect } from "vitest";
import { buildPng, isWebp, readPngSize } from "../support/images.js";

// The contract cases: one list, run against the local server (tests/contract/local.test.ts) and the live
// service (tests/live/contract.test.ts). Drift is one target failing a case the other passes.
//
// Every expected value below is decided by something that is not the code under test; the comment on each
// names its row in the plan's section 8 ("What decides each value") or the spec text. Where the two servers
// legitimately differ, a case asserts only what packages/spec/openapi.yaml guarantees:
// - plan 9 Q5: the service's 405 has no body, so the OPTIONS case asserts the status and the absent CORS
//   header only;
// - plan 9 Q7: `createdAt` is checked for the spec's `format: date-time` (UTC), not for its precision.
// No message here holds the project key, so a failed assertion never prints it.

export interface Target {
  /** `http://127.0.0.1:<port>` or `https://cdn.dynjandi.dev`, no trailing slash. */
  origin: string;
  projectKey: string;
  fetch: typeof fetch;
}

export interface ContractCase {
  name: string;
  run: () => Promise<unknown>;
}

interface UploadBody {
  id: unknown;
  file: unknown;
  url: unknown;
  focalX: unknown;
  focalY: unknown;
}

interface FileRecordBody {
  id: unknown;
  contentType: unknown;
  bytes: unknown;
  originalFilename: unknown;
  source: unknown;
  focalX: unknown;
  focalY: unknown;
  createdAt: unknown;
}

export interface Uploaded {
  id: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** The upload's own answer, so the upload case asserts on it instead of uploading again. */
  status: number;
  cacheControl: string | null;
  body: UploadBody;
}

const FIXTURE_WIDTH = 40;
const FIXTURE_HEIGHT = 20;
const FIXTURE_FILENAME = "contract.png";
const FOCAL_X = 0.25;
const FOCAL_Y = 0.75;

// openapi.yaml `format: uuid` (section 8, "id a UUID").
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// openapi.yaml `FileRecord.createdAt`: "an ISO 8601 UTC timestamp", `format: date-time`. Fractional seconds
// are optional because the two servers differ (plan 9 Q7).
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/;
// Section 8, "public, max-age=31536000, immutable on images": the live CDN's header, asserted on both targets.
const IMMUTABLE = "public, max-age=31536000, immutable";
// openapi.yaml `CacheControlNoStore`.
const NO_STORE = "no-store";

// A variant is rendered on first request, so a fresh upload can answer 404 or 5xx for a moment (as in the SDK
// smoke test). Retry only those; any other status is a real failure.
const VARIANT_ATTEMPTS = 4;
const VARIANT_RETRY_DELAY_MS = 1000;

/**
 * Uploads the 40x20 fixture once, on first use, and hands every case the same file: a run, live or
 * local, is one upload; the upload case asserts on this answer. Reaching this does not need the key to be right, only the target to answer.
 */
export function createFixture(target: Target): () => Promise<Uploaded> {
  let uploaded: Promise<Uploaded> | undefined;
  return () => {
    uploaded ??= (async () => {
      const bytes = buildPng(FIXTURE_WIDTH, FIXTURE_HEIGHT);
      const response = await post(
        target,
        form(bytes, { focalX: String(FOCAL_X), focalY: String(FOCAL_Y) }),
      );
      const body = (await response.json()) as UploadBody;
      return {
        id: String(body.id),
        bytes,
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        body,
      };
    })();
    return uploaded;
  };
}

function form(
  bytes: Uint8Array<ArrayBuffer> | undefined,
  fields: Record<string, string> = {},
): FormData {
  const data = new FormData();
  if (bytes !== undefined) {
    data.append("file", new File([bytes], FIXTURE_FILENAME, { type: "image/png" }));
  }
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function keyed(target: Target, extra: Record<string, string> = {}): Record<string, string> {
  return { "X-Project-Key": target.projectKey, ...extra };
}

function post(target: Target, body: BodyInit, headers = keyed(target)): Promise<Response> {
  return target.fetch(`${target.origin}/upload`, { method: "POST", body, headers });
}

function getFile(target: Target, id: string, headers = keyed(target)): Promise<Response> {
  return target.fetch(`${target.origin}/files/${id}`, { headers });
}

/** An error answer: the status, `Cache-Control: no-store` and `{ error }` (openapi.yaml, *Errors*). */
async function expectError(
  response: Response,
  status: number,
  message?: string,
): Promise<{ error: string }> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe(NO_STORE);
  const body = (await response.json()) as { error?: unknown };
  expect(typeof body.error).toBe("string");
  if (message !== undefined) expect(body.error).toBe(message);
  return body as { error: string };
}

async function fetchVariant(target: Target, url: string): Promise<Response> {
  let response = await target.fetch(url);
  for (let attempt = 1; attempt < VARIANT_ATTEMPTS; attempt++) {
    if (response.status !== 404 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, VARIANT_RETRY_DELAY_MS));
    response = await target.fetch(url);
  }
  return response;
}

/** The cases that need no renderer: the project-key API and the error paths of the variant URL. */
export function apiCases(target: Target, fixture: () => Promise<Uploaded>): ContractCase[] {
  const png = buildPng(FIXTURE_WIDTH, FIXTURE_HEIGHT);
  const unknownId = "123e4567-e89b-42d3-a456-426614174000";

  return [
    {
      // Section 8: "upload 201 body, file === id, url /<id>, point or null" (UploadResponse and its example);
      // "id a UUID" (format: uuid); "no-store on API answers" (CacheControlNoStore).
      name: "POST /upload stores the file: 201, file === id, relative url, the focal point, no-store",
      run: async () => {
        const { status, cacheControl, body } = await fixture();
        expect(status).toBe(201);
        expect(cacheControl).toBe(NO_STORE);
        expect(body.id).toMatch(UUID);
        expect(body.file).toBe(body.id);
        expect(body.url).toBe(`/${String(body.id)}`);
        expect(body.focalX).toBe(FOCAL_X);
        expect(body.focalY).toBe(FOCAL_Y);
      },
    },
    {
      // Section 8: "400/401/404/413 messages" (POST /upload 401 description and *Authentication*).
      name: "POST /upload without a key is 401 Missing X-Project-Key",
      run: async () => expectError(await post(target, form(png), {}), 401, "Missing X-Project-Key"),
    },
    {
      name: "POST /upload with an empty key is 401 Missing X-Project-Key",
      run: async () =>
        expectError(
          await post(target, form(png), { "X-Project-Key": "" }),
          401,
          "Missing X-Project-Key",
        ),
    },
    {
      name: "POST /upload with a wrong key is 401 Invalid project key",
      run: async () =>
        expectError(
          await post(target, form(png), { "X-Project-Key": "not-the-key" }),
          401,
          "Invalid project key",
        ),
    },
    {
      // Section 8 (D1): *Authentication*, "Sending both headers with different values is 400".
      name: "POST /upload with two different keys is 400 X-Project-Key and X-Public-Key differ",
      run: async () =>
        expectError(
          await post(target, form(png), keyed(target, { "X-Public-Key": "something-else" })),
          400,
          "X-Project-Key and X-Public-Key differ",
        ),
    },
    {
      // POST /upload 400 description, one case per message.
      name: "POST /upload with another content type is 400 Expected multipart/form-data",
      run: async () =>
        expectError(
          await post(target, "{}", keyed(target, { "Content-Type": "application/json" })),
          400,
          "Expected multipart/form-data",
        ),
    },
    {
      // POST /upload 400: "`Invalid multipart body` (the body cannot be parsed)".
      name: "POST /upload with a body that is not multipart is 400 Invalid multipart body",
      run: async () =>
        expectError(
          await post(
            target,
            "this is not multipart",
            keyed(target, { "Content-Type": "multipart/form-data; boundary=xyz" }),
          ),
          400,
          "Invalid multipart body",
        ),
    },
    {
      name: "POST /upload with no file is 400 No file provided",
      run: async () =>
        expectError(
          await post(target, form(undefined, { focalX: "0.5", focalY: "0.5" })),
          400,
          "No file provided",
        ),
    },
    {
      name: "POST /upload with only one focal coordinate is 400 Both focalX and focalY are required",
      run: async () =>
        expectError(
          await post(target, form(png, { focalX: "0.5" })),
          400,
          "Both focalX and focalY are required",
        ),
    },
    {
      name: "POST /upload with a focal coordinate outside 0 to 1 is 400 Invalid focal coordinates",
      run: async () =>
        expectError(
          await post(target, form(png, { focalX: "2", focalY: "0.5" })),
          400,
          "Invalid focal coordinates",
        ),
    },
    {
      name: "GET /files/{id} without a key is 401 Missing X-Project-Key",
      run: async () =>
        expectError(await getFile(target, unknownId, {}), 401, "Missing X-Project-Key"),
    },
    {
      name: "GET /files/{id} with a wrong key is 401 Invalid project key",
      run: async () =>
        expectError(
          await getFile(target, unknownId, { "X-Project-Key": "not-the-key" }),
          401,
          "Invalid project key",
        ),
    },
    {
      name: "GET /files/{id} with two different keys is 400 X-Project-Key and X-Public-Key differ",
      run: async () =>
        expectError(
          await getFile(target, unknownId, keyed(target, { "X-Public-Key": "something-else" })),
          400,
          "X-Project-Key and X-Public-Key differ",
        ),
    },
    {
      // Section 8: "FileRecord fields" (openapi.yaml FileRecord; "blob"/filename per the upload; the live
      // CDN's record for the same upload). `source` is only "a string, set not documented"; `createdAt` is
      // checked for its format, not its precision (plan 9 Q7).
      name: "GET /files/{id} returns the record: every field, the point, no-store",
      run: async () => {
        const { id, bytes } = await fixture();
        const response = await getFile(target, id);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe(NO_STORE);
        const record = (await response.json()) as FileRecordBody;
        expect(Object.keys(record).sort()).toEqual(
          [
            "bytes",
            "contentType",
            "createdAt",
            "focalX",
            "focalY",
            "id",
            "originalFilename",
            "source",
          ].sort(),
        );
        expect(record.id).toBe(id);
        expect(record.contentType).toBe("image/png");
        expect(record.bytes).toBe(bytes.length);
        expect(record.originalFilename).toBe(FIXTURE_FILENAME);
        expect(typeof record.source).toBe("string");
        expect(record.focalX).toBe(FOCAL_X);
        expect(record.focalY).toBe(FOCAL_Y);
        expect(record.createdAt).toMatch(UTC_DATE_TIME);
      },
    },
    {
      // GET /files/{id} 404: "no such id, an id that is not a UUID".
      name: "GET /files/{id} of an unknown UUID is 404 File not found",
      run: async () => expectError(await getFile(target, unknownId), 404, "File not found"),
    },
    {
      name: "GET /files/{id} of an id that is not a UUID is 404 File not found",
      run: async () => expectError(await getFile(target, "not-a-uuid"), 404, "File not found"),
    },
    {
      // Section 8: "original bytes and type at /<id>": the fixture, and openapi.yaml "served at /<id>".
      name: "GET /<id> serves the uploaded bytes with the uploaded type",
      run: async () => {
        const { id, bytes } = await fixture();
        const response = await target.fetch(`${target.origin}/${id}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      },
    },
    {
      // Section 8: "/<id>/-/ and unknown operation 400": the grammar prose, "`/<id>/-/` with nothing after
      // it is answered with 400"; the message is the spec's own example for an operation that is not known.
      name: "GET /<id>/-/ with no operation is 400",
      run: async () => {
        const { id } = await fixture();
        await expectError(await target.fetch(`${target.origin}/${id}/-/`), 400);
      },
    },
    {
      name: "GET a variant with an unknown operation is 400 Unknown operation",
      run: async () => {
        const { id } = await fixture();
        const response = await target.fetch(`${target.origin}/${id}/-/sharpen/3/`);
        const body = await expectError(response, 400);
        expect(body.error).toMatch(/^Unknown operation/);
      },
    },
    {
      // Section 8: "OPTIONS 405, no CORS header" (openapi.yaml, the CORS paragraph). Status and absent header
      // only: the service's 405 has no body (plan 9 Q5).
      name: "OPTIONS /upload is 405 with no Access-Control-Allow-Origin",
      run: async () => {
        const response = await target.fetch(`${target.origin}/upload`, {
          method: "OPTIONS",
          headers: {
            Origin: "https://example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-project-key",
          },
        });
        expect(response.status).toBe(405);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      },
    },
  ];
}

interface DimensionCase {
  operations: string;
  width: number;
  height: number;
}

// Section 8, "the four render dimensions": openapi.yaml *Variant URL grammar* on the 40x20 fixture.
// resize/20x: one dimension keeps the ratio (20x10). resize/10x10: cover then centre-crop to exactly the box.
// resize/80x: enlarges (80x40). crop/16x16/center/: exactly the box. Each ends in format/png/ so the size can
// be read from the PNG header.
const DIMENSION_CASES: DimensionCase[] = [
  { operations: "resize/20x/", width: 20, height: 10 },
  { operations: "resize/10x10/", width: 10, height: 10 },
  { operations: "resize/80x/", width: 80, height: 40 },
  { operations: "crop/16x16/center/", width: 16, height: 16 },
];

/** The cases that need a renderer: five variants of the one upload, plus the original's cache header. */
export function renderCases(target: Target, fixture: () => Promise<Uploaded>): ContractCase[] {
  const dimensionCases = DIMENSION_CASES.map(
    ({ operations, width, height }): ContractCase => ({
      name: `GET /<id>/-/${operations}-/format/png/ is a ${width}x${height} PNG with the immutable cache header`,
      run: async () => {
        const { id } = await fixture();
        const url = `${target.origin}/${id}/-/${operations}-/format/png/`;
        const response = await fetchVariant(target, url);
        expect(response.status, `GET ${url}`).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        // Section 8, "public, max-age=31536000, immutable on images" (D9), on a variant.
        expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
        // Section 8, "PNG width and height at bytes 16-23" (W3C PNG specification, IHDR).
        expect(readPngSize(new Uint8Array(await response.arrayBuffer()))).toEqual({
          width,
          height,
        });
      },
    }),
  );

  return [
    {
      // Section 8, the same row, on the original.
      name: "GET /<id> carries the immutable cache header",
      run: async () => {
        const { id } = await fixture();
        const response = await target.fetch(`${target.origin}/${id}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
      },
    },
    ...dimensionCases,
    {
      // Section 8: "format/webp/ -> image/webp, RIFF...WEBP" (openapi.yaml `format`; Google's WebP container
      // specification).
      name: "GET /<id>/-/resize/20x/-/format/webp/ is image/webp with a RIFF...WEBP body",
      run: async () => {
        const { id } = await fixture();
        const url = `${target.origin}/${id}/-/resize/20x/-/format/webp/`;
        const response = await fetchVariant(target, url);
        expect(response.status, `GET ${url}`).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/webp");
        expect(isWebp(new Uint8Array(await response.arrayBuffer()))).toBe(true);
      },
    },
  ];
}
