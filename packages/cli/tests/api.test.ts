import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { startServer } from "../src/dev/server.js";
import { FileStore } from "../src/dev/store.js";

// Expected values come from packages/spec/openapi.yaml and the plan, never from the code under test:
// - messages and statuses: the spec's `POST /upload` 400/401/413/500 and `GET /files/{id}` 401/404 descriptions,
//   and its "Errors" section (every error is `{ "error" }` with `Cache-Control: no-store`);
// - keys: D1 (`X-Project-Key`, the deprecated alias `X-Public-Key`, empty is absent, differing values are 400);
// - 201 body `{ file, id, url: "/<id>", focalX, focalY }` and the FileRecord shape: the spec's UploadResponse and
//   FileRecord, with `source: "upload"` (its example) and `createdAt` an ISO 8601 UTC date-time;
// - originals: D9's three headers, `GET /<id>` takes no key (section 4.2);
// - the 413 (D7): a body over the cap is refused before `formData()` runs; the cap on the body adds 64 KiB of
//   multipart framing to the file cap, so a file of exactly the cap can be uploaded (this phase's reading of D7);
// - the 404 for a malformed id has no filesystem call (D6): the FileStore spies below prove it;
// - 405 for everything but POST /upload and GET (D8); an unexpected failure is `500 Internal server error`
//   with detail on stderr only (section 4.2).
const KEY = "dynjandi-local";
const CAP = 1000;
const FRAMING = 65_536;
const NO_STORE = "no-store";
const IMMUTABLE = "public, max-age=31536000, immutable";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN_ID = "123e4567-e89b-42d3-a456-426614174000";

let dataDir: string;
let logs: string[];
let running: Awaited<ReturnType<typeof startServer>>;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "dynjandi-api-"));
  logs = [];
  running = await startServer({
    port: 0,
    dataDir,
    projectKey: KEY,
    maxFileSize: CAP,
    log: (line) => void logs.push(line),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await running.close();
  await rm(dataDir, { recursive: true, force: true });
});

function form(parts: Record<string, string | Blob>, filename?: string): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(parts)) {
    if (typeof value === "string") data.append(name, value);
    else if (filename === undefined) data.append(name, value);
    else data.append(name, value, filename);
  }
  return data;
}

function post(body: BodyInit, headers: Record<string, string> = { "X-Project-Key": KEY }) {
  return fetch(`${running.url}/upload`, { method: "POST", body, headers });
}

function png(size = 10, type = "image/png"): Blob {
  return new Blob([new Uint8Array(size).fill(7)], { type });
}

async function uploadOk(extra: Record<string, string> = {}, file: Blob = png()) {
  const response = await post(form({ file, ...extra }, "photo.png"));
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

function expectError(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(response.headers.get("cache-control")).toBe(NO_STORE);
}

// fetch normalizes `..` and `%2e%2e`, so a hostile path needs a raw request.
function rawGet(
  path: string,
): Promise<{ status: number; body: string; cacheControl: string | undefined }> {
  return new Promise((resolve, reject) => {
    const { port } = new URL(running.url);
    const req = request(
      { host: "127.0.0.1", port, path, method: "GET", headers: { "X-Project-Key": KEY } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => void chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            cacheControl: res.headers["cache-control"],
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("project key (D1)", () => {
  describe.each(["POST /upload", "GET /files/{id}"])("%s", (route) => {
    const send = (headers: Record<string, string>) =>
      route === "POST /upload"
        ? post(form({ file: png() }, "a.png"), headers)
        : fetch(`${running.url}/files/${UNKNOWN_ID}`, { headers });

    it("is 401 Missing X-Project-Key without a key", async () => {
      const response = await send({});
      expectError(response, 401);
      expect(await response.json()).toEqual({ error: "Missing X-Project-Key" });
    });

    it("is 401 Missing X-Project-Key for an empty key", async () => {
      const response = await send({ "X-Project-Key": "" });
      expectError(response, 401);
      expect(await response.json()).toEqual({ error: "Missing X-Project-Key" });
    });

    it.each(["X-Project-Key", "X-Public-Key"])(
      "is 401 Invalid project key for a wrong %s",
      async (header) => {
        const response = await send({ [header]: "nope" });
        expectError(response, 401);
        expect(await response.json()).toEqual({ error: "Invalid project key" });
      },
    );

    it("is 400 when the two headers differ", async () => {
      const response = await send({ "X-Project-Key": KEY, "X-Public-Key": "other" });
      expectError(response, 400);
      expect(await response.json()).toEqual({ error: "X-Project-Key and X-Public-Key differ" });
    });

    it("does not read a key of the wrong case as the key", async () => {
      const response = await send({ "X-Project-Key": KEY.toUpperCase() });
      expect((await response.json()) as unknown).toEqual({ error: "Invalid project key" });
    });

    it("accepts the deprecated X-Public-Key alone, and both when equal", async () => {
      expect((await send({ "X-Public-Key": KEY })).status).not.toBe(401);
      expect((await send({ "X-Project-Key": KEY, "X-Public-Key": KEY })).status).not.toBe(401);
    });

    it("reads an empty header as absent beside a real one", async () => {
      expect((await send({ "X-Project-Key": "", "X-Public-Key": KEY })).status).not.toBe(401);
    });
  });

  it("checks the key before the body", async () => {
    const response = await post("not multipart", {});
    expectError(response, 401);
  });
});

describe("POST /upload", () => {
  it("is 400 Expected multipart/form-data for another content type", async () => {
    const response = await post(JSON.stringify({ file: "x" }), {
      "X-Project-Key": KEY,
      "Content-Type": "application/json",
    });
    expectError(response, 400);
    expect(await response.json()).toEqual({ error: "Expected multipart/form-data" });
  });

  it("is 400 Invalid multipart body when the body cannot be parsed", async () => {
    const response = await post("this is not multipart", {
      "X-Project-Key": KEY,
      "Content-Type": "multipart/form-data; boundary=xyz",
    });
    expectError(response, 400);
    expect(await response.json()).toEqual({ error: "Invalid multipart body" });
  });

  it("is 400 Invalid multipart body when the content type has no boundary", async () => {
    const response = await post("anything", {
      "X-Project-Key": KEY,
      "Content-Type": "multipart/form-data",
    });
    expectError(response, 400);
    expect(await response.json()).toEqual({ error: "Invalid multipart body" });
  });

  it.each([
    ["file is missing", () => form({ focalX: "0.5", focalY: "0.5" })],
    ["file is a text field", () => form({ file: "text" })],
    ["file is empty", () => form({ file: new Blob([]) }, "empty.png")],
  ])("is 400 No file provided when %s", async (_name, body) => {
    const response = await post(body());
    expectError(response, 400);
    expect(await response.json()).toEqual({ error: "No file provided" });
  });

  it.each([
    ["only focalX", { focalX: "0.5" }],
    ["only focalY", { focalY: "0.5" }],
    ["an empty focalX", { focalX: "", focalY: "0.5" }],
    ["an empty focalY", { focalX: "0.5", focalY: "" }],
    ["both empty", { focalX: "", focalY: "" }],
    ["a blank focalY", { focalX: "0.5", focalY: "  " }],
  ])("is 400 Both focalX and focalY are required for %s", async (_name, extra) => {
    const response = await post(form({ file: png(), ...extra }, "a.png"));
    expectError(response, 400);
    expect(await response.json()).toEqual({ error: "Both focalX and focalY are required" });
  });

  it.each([
    ["not a number", "abc", "0.5"],
    ["hexadecimal", "0x1", "0.5"],
    ["above 1", "1.01", "0.5"],
    ["below 0", "0.5", "-0.01"],
    ["infinite", "Infinity", "0.5"],
  ])("is 400 Invalid focal coordinates when %s", async (_name, focalX, focalY) => {
    const response = await post(form({ file: png(), focalX, focalY }, "a.png"));
    expectError(response, 400);
    expect(await response.json()).toEqual({ error: "Invalid focal coordinates" });
  });

  it("stores a file and answers 201 with the point it was given", async () => {
    const response = await post(form({ file: png(), focalX: "0.42", focalY: "0.18" }, "photo.png"));
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(UUID);
    expect(body).toEqual({
      file: body.id,
      id: body.id,
      url: `/${body.id}`,
      focalX: 0.42,
      focalY: 0.18,
    });
  });

  it("answers null for the point when none is sent (D11: no automatic point)", async () => {
    const response = await post(form({ file: png() }, "photo.png"));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body).toEqual({
      file: body.id,
      id: body.id,
      url: `/${body.id}`,
      focalX: null,
      focalY: null,
    });
  });

  it("accepts the edges 0 and 1 of the focal range", async () => {
    const response = await post(form({ file: png(), focalX: "0", focalY: "1" }, "a.png"));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ focalX: 0, focalY: 1 });
  });

  it("is 405 for POST anywhere else", async () => {
    for (const path of ["/", "/files", `/files/${UNKNOWN_ID}`, `/${UNKNOWN_ID}`, "/health"]) {
      const response = await fetch(`${running.url}${path}`, { method: "POST" });
      expectError(response, 405);
      expect(await response.json()).toEqual({ error: "Method not allowed" });
    }
  });
});

describe("the size cap (D7)", () => {
  it("is 413 File exceeds maximum allowed size for a Content-Length over the cap, before formData() runs", async () => {
    const formData = vi.spyOn(Request.prototype, "formData");
    const response = await post(form({ file: png(CAP + FRAMING + 100) }, "big.png"));
    expectError(response, 413);
    expect(await response.json()).toEqual({ error: "File exceeds maximum allowed size" });
    expect(formData).not.toHaveBeenCalled();
  });

  it("is 413 for a chunked body over the cap, before formData() runs", async () => {
    const formData = vi.spyOn(Request.prototype, "formData");
    const { port } = new URL(running.url);
    const result = await new Promise<{ status: number; body: string; cache: string | undefined }>(
      (resolve, reject) => {
        const req = request(
          {
            host: "127.0.0.1",
            port,
            path: "/upload",
            method: "POST",
            headers: {
              "X-Project-Key": KEY,
              "Content-Type": "multipart/form-data; boundary=xyz",
              "Transfer-Encoding": "chunked",
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => void chunks.push(chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString(),
                cache: res.headers["cache-control"],
              }),
            );
          },
        );
        req.on("error", reject);
        req.write(Buffer.alloc(CAP + FRAMING + 100, "a"));
        req.end();
      },
    );
    expect(result).toEqual({
      status: 413,
      body: JSON.stringify({ error: "File exceeds maximum allowed size" }),
      cache: NO_STORE,
    });
    expect(formData).not.toHaveBeenCalled();
  });

  it("is 413 for a file over the cap that fits the multipart allowance", async () => {
    const response = await post(form({ file: png(CAP + 1) }, "big.png"));
    expectError(response, 413);
    expect(await response.json()).toEqual({ error: "File exceeds maximum allowed size" });
  });

  it("stores a file of exactly the cap", async () => {
    const response = await post(form({ file: png(CAP) }, "edge.png"));
    expect(response.status).toBe(201);
  });
});

describe("an over-cap upload far larger than the socket buffers", () => {
  // Source: the spec's 413 and D7. The client must read the 413, not a reset connection. A body this size only
  // exposes an unread-body close from a separate process, which is how a real client sends it.
  const client = `
    const [origin, size, key] = process.argv.slice(1);
    const data = new FormData();
    data.append("file", new Blob([new Uint8Array(Number(size))], { type: "image/png" }), "x.png");
    try {
      const r = await fetch(origin + "/upload", { method: "POST", body: data, headers: { "X-Project-Key": key } });
      console.log(JSON.stringify([r.status, await r.json()]));
    } catch (e) { console.log(JSON.stringify(["threw", String(e.cause?.code ?? e)])); }
  `;

  it("is read as 413 with the JSON body, every time", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { stdout } = await promisify(execFile)(process.execPath, [
        "--input-type=module",
        "-e",
        client,
        running.url,
        String(40_000_000),
        KEY,
      ]);
      expect(JSON.parse(stdout)).toEqual([413, { error: "File exceeds maximum allowed size" }]);
    }
  }, 60_000);
});

describe("GET /files/{id}", () => {
  it("answers the FileRecord of an upload", async () => {
    const { id } = await uploadOk({ focalX: "0.42", focalY: "0.18" });
    const response = await fetch(`${running.url}/files/${id}`, {
      headers: { "X-Project-Key": KEY },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
    expect(await response.json()).toEqual({
      id,
      contentType: "image/png",
      bytes: 10,
      originalFilename: "photo.png",
      source: "upload",
      focalX: 0.42,
      focalY: 0.18,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
    });
  });

  it("answers application/octet-stream and null point for an upload without a type", async () => {
    const { id } = await uploadOk({}, png(10, ""));
    const response = await fetch(`${running.url}/files/${id}`, {
      headers: { "X-Project-Key": KEY },
    });
    expect(await response.json()).toMatchObject({
      contentType: "application/octet-stream",
      focalX: null,
      focalY: null,
    });
  });

  it("works with the deprecated X-Public-Key", async () => {
    const { id } = await uploadOk();
    const response = await fetch(`${running.url}/files/${id}`, {
      headers: { "X-Public-Key": KEY },
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ["an unknown id", UNKNOWN_ID],
    ["an id that is not a UUID", "not-a-uuid"],
    ["an uppercase UUID", UNKNOWN_ID.toUpperCase()],
  ])("is 404 File not found for %s", async (_name, id) => {
    const response = await fetch(`${running.url}/files/${id}`, {
      headers: { "X-Project-Key": KEY },
    });
    expectError(response, 404);
    expect(await response.json()).toEqual({ error: "File not found" });
  });

  it("is 404 for the uppercase form of a stored id", async () => {
    const { id } = await uploadOk();
    const response = await fetch(`${running.url}/files/${id.toUpperCase()}`, {
      headers: { "X-Project-Key": KEY },
    });
    expectError(response, 404);
  });

  it.each(["PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])("is 405 for %s", async (method) => {
    const response = await fetch(`${running.url}/files/${UNKNOWN_ID}`, {
      method,
      headers: { "X-Project-Key": KEY },
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
    if (method !== "HEAD") expect(await response.json()).toEqual({ error: "Method not allowed" });
  });
});

describe("GET /<id>", () => {
  it("serves the bytes under the stored type with the original's headers (D9) and no key", async () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
    const upload = await post(form({ file: new Blob([bytes], { type: "image/png" }) }, "a.png"));
    const { id } = (await upload.json()) as { id: string };
    const response = await fetch(`${running.url}/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("serves an uploaded SVG under its declared type, locked down by the D9 headers", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const { id } = await uploadOk({}, new Blob([svg], { type: "image/svg+xml" }));
    const response = await fetch(`${running.url}/${id}`);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(await response.text()).toBe(svg);
  });

  it.each([
    ["an unknown id", `/${UNKNOWN_ID}`],
    ["a name that is not a UUID", "/favicon.ico"],
    ["an uppercase UUID", `/${UNKNOWN_ID.toUpperCase()}`],
  ])("is 404 File not found for %s", async (_name, path) => {
    const response = await fetch(`${running.url}${path}`);
    expectError(response, 404);
    expect(await response.json()).toEqual({ error: "File not found" });
  });

  it("is 404 for the uppercase form of a stored id", async () => {
    const { id } = await uploadOk();
    expect((await fetch(`${running.url}/${id.toUpperCase()}`)).status).toBe(404);
  });

  it("is 404 Not found for a path with more segments", async () => {
    const response = await fetch(`${running.url}/${UNKNOWN_ID}/extra/segments`);
    expectError(response, 404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("is 500 Internal server error, with the detail on stderr only, when record.json is unparseable", async () => {
    const { id } = await uploadOk();
    const path = join(dataDir, "files", id, "record.json");
    await writeFile(path, "{broken");
    const response = await fetch(`${running.url}/${id}`);
    expectError(response, 500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(logs.join("\n")).toContain(path);
  });

  it("is 500 for GET /files/{id} too", async () => {
    const { id } = await uploadOk();
    await writeFile(join(dataDir, "files", id, "record.json"), "{broken");
    const response = await fetch(`${running.url}/files/${id}`, {
      headers: { "X-Project-Key": KEY },
    });
    expectError(response, 500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });
});

describe("a malformed id never reaches the filesystem (D6)", () => {
  const hostile = [
    "/files/..%2f..%2fetc%2fpasswd",
    "/files/%2e%2e",
    "/files/%2E%2E%2F",
    "/files/../x",
    "/..%2f..%2fetc%2fpasswd",
    "/%2e%2e",
    "/%2e%2e%2fsecret",
    "/../x",
    `/files/${UNKNOWN_ID.toUpperCase()}`,
    `/${UNKNOWN_ID.toUpperCase()}`,
    `/files/${UNKNOWN_ID}%2f..`,
    `/${UNKNOWN_ID}%0a`,
    "/files/%00",
  ];

  it.each(hostile)("is 404 for %s with no store call", async (path) => {
    const create = vi.spyOn(FileStore.prototype, "create");
    const readRecord = vi.spyOn(FileStore.prototype, "readRecord");
    const read = vi.spyOn(FileStore.prototype, "read");
    const response = await rawGet(path);
    expect(response.status).toBe(404);
    expect(response.cacheControl).toBe(NO_STORE);
    expect(JSON.parse(response.body)).toHaveProperty("error");
    expect(create).not.toHaveBeenCalled();
    expect(readRecord).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("does reach the store for a well-formed id (so the spy is live)", async () => {
    const readRecord = vi.spyOn(FileStore.prototype, "readRecord");
    await rawGet(`/files/${UNKNOWN_ID}`);
    expect(readRecord).toHaveBeenCalledWith(UNKNOWN_ID);
  });
});

describe("concurrent uploads", () => {
  it("both read back whole", async () => {
    const a = new Uint8Array(CAP).fill(1);
    const b = new Uint8Array(CAP).fill(2);
    const [first, second] = await Promise.all(
      [a, b].map(async (bytes) => {
        const response = await post(
          form({ file: new Blob([bytes], { type: "image/png" }) }, "x.png"),
        );
        return (await response.json()) as { id: string };
      }),
    );
    expect(first?.id).not.toBe(second?.id);
    for (const [upload, bytes] of [
      [first, a],
      [second, b],
    ] as const) {
      const original = await fetch(`${running.url}/${upload?.id}`);
      expect(new Uint8Array(await original.arrayBuffer())).toEqual(bytes);
      const record = await fetch(`${running.url}/files/${upload?.id}`, {
        headers: { "X-Project-Key": KEY },
      });
      expect(await record.json()).toMatchObject({ id: upload?.id, bytes: CAP });
    }
  });
});

describe("persistence", () => {
  it("keeps files across a restart on the same data directory", async () => {
    const { id } = await uploadOk();
    await running.close();
    running = await startServer({ port: 0, dataDir, projectKey: KEY, maxFileSize: CAP });
    const response = await fetch(`${running.url}/${id}`);
    expect(response.status).toBe(200);
    expect(await readFile(join(dataDir, "files", id, "original"))).toHaveLength(10);
  });
});

describe("a --project-key value (D1, D12)", () => {
  it("accepts the overridden key and never prints it, on a good or a bad request", async () => {
    const secret = "very-secret-key-123";
    const out: string[] = [];
    const err: string[] = [];
    const exit = main(
      ["dev", "--port", "0", "--no-renderer", "--data-dir", dataDir, "--project-key", secret],
      { stdout: (text) => void out.push(text), stderr: (text) => void err.push(text) },
    );
    for (let attempt = 0; attempt < 200 && out.length === 0; attempt += 1) {
      await new Promise((done) => setTimeout(done, 10));
    }
    const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(out.join(""))?.[0] ?? "";
    expect(origin).not.toBe("");

    const good = await fetch(`${origin}/upload`, {
      method: "POST",
      body: form({ file: png() }, "a.png"),
      headers: { "X-Project-Key": secret },
    });
    expect(good.status).toBe(201);
    const bad = await fetch(`${origin}/upload`, {
      method: "POST",
      body: form({ file: png() }, "a.png"),
      headers: { "X-Project-Key": KEY },
    });
    expect(bad.status).toBe(401);
    await fetch(`${origin}/files/${UNKNOWN_ID}`, {
      headers: { "X-Project-Key": secret, "X-Public-Key": "different" },
    });

    process.emit("SIGTERM", "SIGTERM");
    expect(await exit).toBe(0);
    expect(out.join("") + err.join("")).not.toContain(secret);
    expect(out.join("") + err.join("")).toContain("POST /upload 201");
  });

  it("does not log a key from the default either", async () => {
    await post(form({ file: png() }, "a.png"), { "X-Project-Key": "leaky-value" });
    expect(logs.join("\n")).not.toContain("leaky-value");
  });
});
