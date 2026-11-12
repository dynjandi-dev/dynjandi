import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildPng, readPngSize } from "../support/images.js";

// End-to-end test for plan #43, Phase 4: an app in a real container against the built `dynjandi dev
// --containers` with the real renderer. The app is tests/support/container-app.mjs, run by the pinned Node
// image; it uses the built SDK with `origin` and `apiOrigin`. Then this test, as the browser on the host,
// fetches what the container got back. NOT part of `pnpm test`. Preconditions are in context/verify.md,
// "End-to-end run with the real renderer": Docker running, both images pulled or pullable, `pnpm build` run.

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const APP = fileURLToPath(new URL("../support/container-app.mjs", import.meta.url));
// The repository root. It is mounted into the container at the same path, so the SDK's `node_modules`
// symlinks (pnpm links `@dynjandi/transform-grammar` into the store under the root) still resolve there.
const REPO = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
const SDK_MODULE = join(REPO, "packages/sdk/dist/index.js");
// Version-specific tag and the digest of its multi-arch index, from `docker buildx imagetools inspect`.
const NODE_IMAGE =
  "node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5";
const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;

interface Ready {
  origin: string;
  containerOrigin: string;
  projectKey: string;
}

let dataDir: string;
let child: ChildProcess;
let exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
let stderr = "";
let ready: Ready;

function startDev(): Promise<Ready> {
  child = spawn(
    process.execPath,
    [CLI, "dev", "--containers", "--json", "--port", "0", "--data-dir", dataDir],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  exit = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  child.stderr?.setEncoding("utf8").on("data", (text: string) => {
    stderr += text;
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout?.setEncoding("utf8").on("data", (text: string) => {
      stdout += text;
      if (stdout.includes("\n")) resolve(JSON.parse(stdout) as Ready);
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

const FIXTURE_WIDTH = 40;
const FIXTURE_HEIGHT = 20;
const png = buildPng(FIXTURE_WIDTH, FIXTURE_HEIGHT);

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "dynjandi-e2e-containers-"));
  ready = await startDev();
}, START_TIMEOUT_MS);

afterAll(async () => {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await exit;
  await rm(dataDir, { recursive: true, force: true });
}, STOP_TIMEOUT_MS);

describe("an app in a container against dynjandi dev --containers", () => {
  test("the container's origin is the one --json reports, and not the host's", () => {
    expect(ready.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // Docker Desktop: no interface holds the bridge gateway, so the name; Linux Engine: the gateway (D2, D3).
    expect(ready.containerOrigin).toMatch(
      /^http:\/\/(host\.docker\.internal|\d+\.\d+\.\d+\.\d+):\d+$/,
    );
    expect(ready.containerOrigin).not.toBe(ready.origin);
  });

  test(
    "the SDK in the container uploads and reads through apiOrigin, and hands out URLs on origin",
    async () => {
      const { stdout } = await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--read-only",
          "-v",
          `${REPO}:${REPO}:ro`,
          "-e",
          `SDK_MODULE=${SDK_MODULE}`,
          "-e",
          `DYNJANDI_PROJECT_KEY=${ready.projectKey}`,
          "-e",
          `DYNJANDI_ORIGIN=${ready.origin}`,
          "-e",
          `DYNJANDI_API_ORIGIN=${ready.containerOrigin}`,
          "-e",
          `PNG_BASE64=${Buffer.from(png).toString("base64")}`,
          NODE_IMAGE,
          "node",
          APP,
        ],
        { timeout: TEST_TIMEOUT_MS },
      );
      const seen = JSON.parse(stdout) as {
        service: string;
        id: string;
        url: string;
        variant: string;
        focalX: number;
        focalY: number;
        bytes: number;
      };
      // #37 D20: /health names the service.
      expect(seen.service).toBe("dynjandi-dev");
      // D6: every URL the SDK hands out is on `origin`, the one a browser on the host can load.
      expect(seen.url).toBe(`${ready.origin}/${seen.id}`);
      expect(seen.variant.startsWith(`${ready.origin}/${seen.id}/`)).toBe(true);
      expect(seen.variant).not.toContain("host.docker.internal");
      expect({ x: seen.focalX, y: seen.focalY }).toEqual({ x: 0.25, y: 0.75 });
      expect(seen.bytes).toBe(png.length);

      // The browser's half: the host fetches what the container got back.
      const original = await fetch(seen.url);
      expect(original.status).toBe(200);
      expect(new Uint8Array(await original.arrayBuffer())).toEqual(png);

      const variant = await fetch(seen.variant);
      expect(variant.status).toBe(200);
      expect(variant.headers.get("content-type")).toBe("image/png");
      // openapi.yaml *Variant URL grammar*: width 20 on the 40x20 fixture gives 20x10 (PNG IHDR, W3C PNG spec).
      expect(readPngSize(new Uint8Array(await variant.arrayBuffer()))).toEqual({
        width: 20,
        height: 10,
      });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a request with an unknown Host is refused with 421",
    async () => {
      // `fetch` forbids setting Host, so this goes through node:http.
      const { request } = await import("node:http");
      const url = new URL(`${ready.origin}/health`);
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: url.hostname,
            port: url.port,
            path: url.pathname,
            headers: { Host: "evil.example" },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(421);
    },
    TEST_TIMEOUT_MS,
  );

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
