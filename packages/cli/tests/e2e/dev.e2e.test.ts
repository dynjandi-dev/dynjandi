import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type Client, createClient, type UploadResult } from "@dynjandi/sdk";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { renderCases, type Target, type Uploaded } from "../contract/cases.js";
import { buildPng, isWebp, readPngSize } from "../support/images.js";

// End-to-end test: the built `dynjandi dev` as a child process, the real renderer image started by Docker,
// and the real SDK. NOT part of `pnpm test` (see `test` and `test:e2e` in package.json). Preconditions are in
// context/verify.md, "Not run by Gate 1": Docker running, the pinned image readable and pulled or pullable,
// and `pnpm build` run first, since this starts `dist/cli.js`.

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const PROJECT_KEY = "dynjandi-local"; // D1: the default key, which the ready line prints.
const READY = /^Dynjandi dev server ready at (http:\/\/127\.0\.0\.1:\d+) \(/m;
// Container start-up and the first render are slow; a pull is not counted by `dev` but is by this timeout.
const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 60_000;

let dataDir: string;
let child: ChildProcess;
let exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
let stderr = "";
let origin: string;
let client: Client;

function startDev(): Promise<string> {
  child = spawn(process.execPath, [CLI, "dev", "--port", "0", "--data-dir", dataDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  exit = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  child.stderr?.setEncoding("utf8").on("data", (text: string) => {
    stderr += text;
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout?.setEncoding("utf8").on("data", (text: string) => {
      stdout += text;
      const origin = READY.exec(stdout)?.[1];
      if (origin !== undefined) resolve(origin);
    });
    void exit.then(({ code }) =>
      reject(new Error(`dynjandi dev exited ${code} before it was ready:\n${stderr}`)),
    );
  });
}

async function renderers(): Promise<string> {
  const { stdout } = await execFileAsync("docker", [
    "ps",
    "-a",
    "--filter",
    "name=dynjandi-renderer-",
    "--format",
    "{{.Names}}",
  ]);
  return stdout.trim();
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "dynjandi-e2e-"));
  origin = await startDev();
  client = createClient({ projectKey: PROJECT_KEY, origin });
}, START_TIMEOUT_MS);

afterAll(async () => {
  // A failed run must not leave the child, or its container, behind.
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await exit;
  await rm(dataDir, { recursive: true, force: true });
}, STOP_TIMEOUT_MS);

const FIXTURE_WIDTH = 40;
const FIXTURE_HEIGHT = 20;
const FOCAL = { x: 0.25, y: 0.75 };
const png = buildPng(FIXTURE_WIDTH, FIXTURE_HEIGHT);
let uploaded: UploadResult;

describe("dynjandi dev with the real renderer", () => {
  test(
    "the SDK uploads with a focal point",
    async () => {
      uploaded = await client.upload(new File([png], "e2e.png", { type: "image/png" }), {
        focal: FOCAL,
      });
      expect(uploaded.url).toBe(`${origin}/${uploaded.id}`);
      expect({ x: uploaded.focalX, y: uploaded.focalY }).toEqual(FOCAL);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "getFile returns the record",
    async () => {
      const file = await client.getFile(uploaded.id);
      expect(file).toMatchObject({
        id: uploaded.id,
        contentType: "image/png",
        bytes: png.length,
        originalFilename: "e2e.png",
        source: "upload",
        focalX: FOCAL.x,
        focalY: FOCAL.y,
      });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the original is served unchanged",
    async () => {
      const response = await fetch(uploaded.url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    },
    TEST_TIMEOUT_MS,
  );

  // Dimensions: openapi.yaml *Variant URL grammar* on the 40x20 fixture, as in the shared render cases
  // (resize keeps the ratio, cover then centre-crop to a box, enlarges, crop is exactly the box), here built
  // by client.url() and read from the PNG header (W3C PNG specification, IHDR).
  test.each([
    ["width 20", { width: 20 }, { width: 20, height: 10 }],
    ["width 10 and height 10", { width: 10, height: 10 }, { width: 10, height: 10 }],
    ["width 80", { width: 80 }, { width: 80, height: 40 }],
    [
      "a 16x16 centre crop",
      { crop: { width: 16, height: 16, position: "center" as const } },
      { width: 16, height: 16 },
    ],
  ])(
    "client.url() with %s renders a PNG of the expected size",
    async (_name, options, size) => {
      const response = await fetch(client.url(uploaded.id, { ...options, format: "png" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(readPngSize(new Uint8Array(await response.arrayBuffer()))).toEqual(size);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "client.url() with format webp renders image/webp",
    async () => {
      const response = await fetch(client.url(uploaded.id, { width: 20, format: "webp" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(isWebp(new Uint8Array(await response.arrayBuffer()))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  // The shared render cases (the same ones the live suite runs against cdn.dynjandi.dev) on this upload.
  describe("the shared render cases", () => {
    const fixture = async (): Promise<Uploaded> => ({
      id: uploaded.id,
      bytes: png,
      status: 201,
      cacheControl: null,
      body: uploaded,
    });
    // The case list is built again when a case runs, once `origin` exists; the names do not depend on it.
    const casesFor = (target: Target) => renderCases(target, fixture);
    for (const { name } of casesFor({ origin: "", projectKey: PROJECT_KEY, fetch })) {
      test(
        name,
        async () => {
          const found = casesFor({ origin, projectKey: PROJECT_KEY, fetch }).find(
            (c) => c.name === name,
          );
          expect(found).toBeDefined();
          await found?.run();
        },
        TEST_TIMEOUT_MS,
      );
    }
  });

  test(
    "SIGTERM exits 0 and leaves no renderer container",
    async () => {
      expect(await renderers()).not.toBe("");
      child.kill("SIGTERM");
      const { code } = await exit;
      expect(code, stderr).toBe(0);
      expect(await renderers()).toBe("");
    },
    STOP_TIMEOUT_MS,
  );
});

// D18, the quick start's third command: `dev -- node <script>` with the real renderer. The script is the only
// code that knows the server's address: it reads DYNJANDI_ORIGIN and DYNJANDI_PROJECT_KEY, drives the real SDK
// (upload, then a variant built by client.url and fetched), and prints what it saw. It exits 3 on purpose, so
// the test can tell the script's own code from dev's (0 on success, 1 on a failure): 3 can only have come
// through dev from the script. A failed check throws, which exits 1.
const SCRIPT = `
const { createClient } = await import(process.env.SDK_MODULE);
const client = createClient({
  projectKey: process.env.DYNJANDI_PROJECT_KEY,
  origin: process.env.DYNJANDI_ORIGIN,
});
const png = Buffer.from(process.env.PNG_BASE64, "base64");
const uploaded = await client.upload(new File([png], "script.png", { type: "image/png" }));
const variant = client.url(uploaded.id, { width: 20, format: "png" });
const response = await fetch(variant);
const bytes = new Uint8Array(await response.arrayBuffer());
const width = new DataView(bytes.buffer).getUint32(16);
console.log(JSON.stringify({ origin: process.env.DYNJANDI_ORIGIN, url: uploaded.url, variant, status: response.status, width }));
process.exit(3);
`;

describe("dynjandi dev -- node <script> with the real renderer", () => {
  test(
    "the script reaches the server through the two variables and dev exits with its code",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "dynjandi-e2e-run-"));
      try {
        const run = spawn(
          process.execPath,
          [
            CLI,
            "dev",
            "--data-dir",
            dir,
            "--",
            process.execPath,
            "--input-type=module",
            "-e",
            SCRIPT,
          ],
          {
            env: {
              ...process.env,
              SDK_MODULE: import.meta.resolve("@dynjandi/sdk"),
              PNG_BASE64: Buffer.from(png).toString("base64"),
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let out = "";
        let err = "";
        run.stdout.setEncoding("utf8").on("data", (text: string) => (out += text));
        run.stderr.setEncoding("utf8").on("data", (text: string) => (err += text));
        const code = await new Promise<number | null>((resolve) => run.once("close", resolve));
        expect(code, err).toBe(3);
        // Under `--` standard output is the command's alone (D18); the ready line went to standard error.
        const seen = JSON.parse(out) as {
          origin: string;
          url: string;
          status: number;
          width: number;
        };
        expect(seen.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(seen.url.startsWith(`${seen.origin}/`)).toBe(true);
        expect(seen.status).toBe(200);
        // openapi.yaml *Variant URL grammar*: a width of 20 on the 40x20 fixture gives 20 wide (PNG IHDR, offset 16).
        expect(seen.width).toBe(20);
        expect(err).toMatch(/Dynjandi dev server ready at /);
        expect(await renderers()).toBe("");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    START_TIMEOUT_MS,
  );
});
