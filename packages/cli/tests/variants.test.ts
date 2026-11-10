import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOperationChain } from "@dynjandi/transform-grammar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RendererChoice } from "../src/dev/options.js";
import { startServer } from "../src/dev/server.js";
import { type StubRenderer, startStubRenderer } from "./support/stub-renderer.js";

// Expected values and what decided them:
// - X-Dynjandi-Ops is RFC 4648 section 5 base64url (no padding) of the UTF-8 JSON of the chain the grammar
//   parses (grammar README, *The Worker and container contract*; plan section 8). The literal chain for
//   `resize/100x100/format/webp` is written out by hand from openapi.yaml's grammar prose (resize WxH, format).
// - a bad chain is 400 with the grammar's AppError text (`Unknown operation: bogus`, `Missing operations`
//   for `/<id>/-/`), and parsing precedes the file lookup (plan section 4.3, step 1).
// - an unknown id is 404 `File not found` (openapi.yaml, GET /files/{id}).
// - variant headers are D9's three; D10: no server-side cache, so each request reaches the renderer again.
// - the renderer's 4xx and 504 pass through, an unreachable renderer or any other status is 502
//   `Renderer unavailable`, no answer in the timeout is 504 `Render request timed out` (plan section 4.3,
//   step 5; core#364 D8). `--no-renderer` is 502 naming the flag (the Phase 3 scope). The Docker default is
//   not tested here: it starts a container, which docker.test.ts plays against a fake `docker`.
const KEY = "dynjandi-local";
const IMMUTABLE = "public, max-age=31536000, immutable";
const UNKNOWN_ID = "123e4567-e89b-42d3-a456-426614174000";
const ORIGINAL = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 7, 7, 7]);
const RENDERED = new Uint8Array([82, 73, 70, 70, 9, 9, 9, 9]);
const SHORT_TIMEOUT_MS = 150;

let dataDir: string;
let logs: string[];
let stub: StubRenderer;
let running: Awaited<ReturnType<typeof startServer>> | undefined;

async function start(renderer: Exclude<RendererChoice, { kind: "docker" }>) {
  running = await startServer({
    port: 0,
    dataDir,
    projectKey: KEY,
    maxFileSize: 1000,
    renderer,
    renderTimeoutMs: SHORT_TIMEOUT_MS,
    log: (line) => void logs.push(line),
  });
  return running;
}

async function upload(server: { url: string }): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([ORIGINAL], { type: "image/png" }), "photo.png");
  const response = await fetch(`${server.url}/upload`, {
    method: "POST",
    body: form,
    headers: { "X-Project-Key": KEY },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "dynjandi-variants-"));
  logs = [];
  stub = await startStubRenderer();
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  await stub.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("a variant URL with a renderer at a URL", () => {
  it("posts the original's exact bytes to /transform with the chain in X-Dynjandi-Ops", async () => {
    const server = await start({ kind: "url", url: stub.url });
    const id = await upload(server);
    stub.requests.length = 0;

    const response = await fetch(`${server.url}/${id}/-/resize/100x100/format/webp`);
    expect(response.status).toBe(200);

    expect(stub.requests).toHaveLength(1);
    const [received] = stub.requests;
    expect(received?.method).toBe("POST");
    expect(received?.path).toBe("/transform");
    expect(new Uint8Array(received?.body ?? [])).toEqual(ORIGINAL);

    const header = String(received?.headers["x-dynjandi-ops"]);
    expect(header).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded: unknown = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    expect(decoded).toEqual(parseOperationChain("resize/100x100/format/webp"));
    expect(decoded).toEqual([
      { op: "resize", width: 100, height: 100 },
      { op: "format", format: "webp" },
    ]);
  });

  it("answers with the renderer's type and bytes under D9's headers", async () => {
    stub.respondWith({ kind: "image", contentType: "image/webp", bytes: RENDERED });
    const server = await start({ kind: "url", url: stub.url });
    const id = await upload(server);

    const response = await fetch(`${server.url}/${id}/-/resize/10x10`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(RENDERED);
  });

  it("renders every request again and ignores Accept (D10)", async () => {
    const server = await start({ kind: "url", url: stub.url });
    const id = await upload(server);
    stub.requests.length = 0;

    await fetch(`${server.url}/${id}/-/resize/10x10`);
    await fetch(`${server.url}/${id}/-/resize/10x10`, { headers: { Accept: "image/avif" } });
    const transforms = stub.requests.filter((r) => r.path === "/transform");
    expect(transforms).toHaveLength(2);
    expect(transforms[1]?.headers["x-dynjandi-ops"]).toBe(transforms[0]?.headers["x-dynjandi-ops"]);
  });

  it.each([
    ["an unknown operation", "bogus/1", "Unknown operation: bogus"],
    ["an empty chain", "", "Missing operations"],
  ])("answers %s with 400 and never calls the renderer", async (_name, ops, message) => {
    const server = await start({ kind: "url", url: stub.url });
    const id = await upload(server);
    stub.requests.length = 0;

    const response = await fetch(`${server.url}/${id}/-/${ops}`);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: message });
    expect(stub.requests).toEqual([]);
  });

  it("parses the chain before it looks for the file", async () => {
    const server = await start({ kind: "url", url: stub.url });
    stub.requests.length = 0;

    const badChain = await fetch(`${server.url}/${UNKNOWN_ID}/-/bogus/1`);
    expect(badChain.status).toBe(400);
    expect(await badChain.json()).toEqual({ error: "Unknown operation: bogus" });

    const unknownFile = await fetch(`${server.url}/${UNKNOWN_ID}/-/resize/10x10`);
    expect(unknownFile.status).toBe(404);
    expect(await unknownFile.json()).toEqual({ error: "File not found" });

    const notAnId = await fetch(`${server.url}/not-an-id/-/resize/10x10`);
    expect(notAnId.status).toBe(404);
    expect(stub.requests).toEqual([]);
  });

  it("passes a renderer 400 through with its message", async () => {
    stub.respondWith({ kind: "error", status: 400, message: "Unsupported input format" });
    const server = await start({ kind: "url", url: stub.url });
    const id = await upload(server);

    const response = await fetch(`${server.url}/${id}/-/resize/10x10`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported input format" });
  });

  it("passes a renderer 504 through", async () => {
    stub.respondWith({ kind: "error", status: 504, message: "Render timed out" });
    const server = await start({ kind: "url", url: stub.url });
    const id = await upload(server);

    const response = await fetch(`${server.url}/${id}/-/resize/10x10`);
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "Render timed out" });
  });

  it("answers 502 Renderer unavailable for any other renderer status, and names the URL on stderr", async () => {
    stub.respondWith({ kind: "error", status: 500, message: "boom" });
    const server = await start({ kind: "url", url: stub.url });
    const id = await upload(server);

    const response = await fetch(`${server.url}/${id}/-/resize/10x10`);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Renderer unavailable" });
    expect(logs.some((line) => line.includes(stub.url) && line.includes("--renderer-url"))).toBe(
      true,
    );
  });

  it("answers 502 for a renderer redirect instead of following it (api-security.md, SSRF)", async () => {
    stub.respondWith({ kind: "redirect" });
    const server = await start({ kind: "url", url: stub.url });
    const id = await upload(server);

    const response = await fetch(`${server.url}/${id}/-/resize/10x10`);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Renderer unavailable" });
    expect(stub.requests.some((r) => r.path === "/elsewhere")).toBe(false);
  });

  it("answers 502 when nothing listens at the renderer URL, and names the URL on stderr", async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const address = closed.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    await new Promise((done) => closed.close(done));
    const url = `http://127.0.0.1:${port}`;

    const server = await start({ kind: "url", url });
    const id = await upload(server);
    // The start-up probe has already warned with the URL and the flag; only the render's own line counts.
    logs.length = 0;
    const response = await fetch(`${server.url}/${id}/-/resize/10x10`);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Renderer unavailable" });
    expect(logs.some((line) => line.includes(url) && line.includes("--renderer-url"))).toBe(true);
  });

  it("answers 504 Render request timed out when the renderer stays silent", async () => {
    stub.respondWith({ kind: "silent" });
    const server = await start({ kind: "url", url: stub.url });
    const id = await upload(server);

    const response = await fetch(`${server.url}/${id}/-/resize/10x10`);
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "Render request timed out" });
  });
});

describe("the start-up probe", () => {
  it("asks the renderer's /health once and says nothing when it is up", async () => {
    await start({ kind: "url", url: stub.url });
    expect(stub.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /health"]);
    expect(logs.filter((line) => line.startsWith("warning"))).toEqual([]);
  });

  it("warns on stderr, naming the URL, when the renderer is down", async () => {
    const url = stub.url;
    await stub.close();
    stub = await startStubRenderer();
    await start({ kind: "url", url });
    const warnings = logs.filter((line) => line.startsWith("warning"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(url);
  });

  it("is not made without --renderer-url", async () => {
    await start({ kind: "none" });
    expect(stub.requests).toEqual([]);
  });
});

describe("a variant URL without a renderer", () => {
  it("answers 502 naming --no-renderer", async () => {
    const server = await start({ kind: "none" });
    const id = await upload(server);
    const response = await fetch(`${server.url}/${id}/-/resize/10x10`);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("--no-renderer");
  });
});

describe("packages/cli/package.json", () => {
  it("pins the transform grammar at exactly 0.3.0 (D3)", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["@dynjandi/transform-grammar"]).toBe("0.3.0");
  });
});
