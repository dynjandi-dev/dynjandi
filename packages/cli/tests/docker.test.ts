import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { type StubRenderer, startStubRenderer } from "./support/stub-renderer.js";

// Child processes are real, but `docker` is tests/support/fake-docker.mjs, first on PATH, so nothing here
// reaches a daemon or a network. `spawn` is wrapped only to see how it was called.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

// Expected values and what decided them (plan section 4.5 and 6.2 Phase 5, "Done when"):
// - the run holds --rm, --read-only, --tmpfs /tmp, a 127.0.0.1 binding of the container's 8080 and the
//   `tag@sha256:` reference; the reference is written out by hand from section 9 Q1 (index digest 0231fbce...).
// - the container is named dynjandi-renderer-<pid>-<random>, and `docker stop` is given that name.
// - each failure exits 1, stdout stays empty, and stderr holds one line naming the fix and offering both
//   --renderer-url and --no-renderer: docker not on PATH; daemon down and pull denied, each with Docker's
//   first stderr line; never healthy, with the last log lines.
// - the container is stopped on SIGINT, SIGTERM (exit 0, D12), on a start-up failure and on a signal that
//   arrives while the health wait is running.
// - --renderer-url and --no-renderer never call docker.
const PINNED =
  "ghcr.io/dynjandi-dev/renderer:0.2.0@sha256:0231fbce1d35499bfeafb1b238951b164aafd6d3c61a491f0b27ee7d10e5b7d6";
const FAKE_DOCKER = fileURLToPath(new URL("./support/fake-docker.mjs", import.meta.url));
const SHORT = { dockerHealthTimeoutMs: 500, dockerPollIntervalMs: 20 };
const LONG = { dockerHealthTimeoutMs: 30_000, dockerPollIntervalMs: 20 };

const savedEnv = { ...process.env };
const savedPath = Object.entries(savedEnv).find(([name]) => name === "PATH")?.[1] ?? "";
let work: string;
let dockerLog: string;
let stub: StubRenderer;

function dockerCalls(): string[][] {
  if (!existsSync(dockerLog)) return [];
  return readFileSync(dockerLog, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as string[]);
}

function callsTo(command: string): string[][] {
  return dockerCalls().filter((call) => call[0] === command);
}

// A variable key: the compiler wants bracket access for env names, and the linter wants dots for literals.
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

function playing(scenario: string, hostPort: number): void {
  setEnv("FAKE_DOCKER_SCENARIO", scenario);
  setEnv("FAKE_DOCKER_PORT", String(hostPort));
}

function stubPort(): number {
  return Number(new URL(stub.url).port);
}

async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  await new Promise((done) => probe.close(done));
  if (address === null || typeof address === "string") throw new Error("no address");
  return address.port;
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (text: string) => void out.push(text),
      stderr: (text: string) => void err.push(text),
    },
  };
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(`never happened: ${what}`);
}

function dev(extra: string[], settings = SHORT) {
  const captured = capture();
  const exit = main(
    ["dev", "--port", "0", "--data-dir", join(work, "data"), ...extra],
    captured.io,
    settings,
  );
  return { ...captured, exit };
}

beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), "dynjandi-docker-"));
  const bin = join(work, "bin");
  mkdirSync(bin);
  // The wrapper runs the fake with this Node, so the test does not rely on a file mode or a shebang.
  const wrapper = join(bin, "docker");
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_DOCKER}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  dockerLog = join(work, "docker.log");
  setEnv("PATH", `${bin}${delimiter}${savedPath}`);
  setEnv("FAKE_DOCKER_LOG", dockerLog);
  stub = await startStubRenderer();
  playing("ok", stubPort());
  vi.mocked(spawn).mockClear();
});

afterEach(async () => {
  process.env = { ...savedEnv };
  await stub.close();
});

describe("dynjandi dev with the default renderer", () => {
  it("starts the pinned image locked down, prints only the ready line, and renders through it", async () => {
    const { out, err, exit } = dev([]);
    await waitFor(() => out.length > 0, "the ready line");

    const run = callsTo("run")[0];
    expect(run).toBeDefined();
    expect(run).toContain("--rm");
    expect(run).toContain("--read-only");
    expect(run?.[run.indexOf("--tmpfs") + 1]).toBe("/tmp");
    expect(run?.[run.indexOf("-p") + 1]).toBe("127.0.0.1::8080");
    expect(run?.at(-1)).toBe(PINNED);
    expect(callsTo("pull")).toEqual([["pull", PINNED]]);
    const name = run?.[run.indexOf("--name") + 1] ?? "";
    expect(name).toMatch(/^dynjandi-renderer-\d+-[0-9a-f]+$/);
    expect(callsTo("port")).toEqual([["port", name, "8080/tcp"]]);

    // Stdout is the one ready line: nothing `docker` printed (its version, pull progress, container logs).
    const ready = out.join("");
    expect(ready.trimEnd().split("\n")).toHaveLength(1);
    expect(ready).toContain("renderer: docker (ghcr.io/dynjandi-dev/renderer:0.2.0)");
    expect(ready).not.toContain("99.88.77");
    expect(ready).not.toContain("renderer log");
    expect(ready).not.toContain("Digest");

    // The server renders through the container's published port.
    const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(ready)?.[0] ?? "";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "a.png");
    const uploaded = await fetch(`${origin}/upload`, {
      method: "POST",
      headers: { "X-Project-Key": "dynjandi-local" },
      body: form,
    });
    const { id } = (await uploaded.json()) as { id: string };
    const variant = await fetch(`${origin}/${id}/-/resize/10x10`);
    expect(variant.status).toBe(200);
    expect(stub.requests.some((request) => request.path === "/transform")).toBe(true);

    process.emit("SIGTERM", "SIGTERM");
    expect(await exit).toBe(0);
    expect(callsTo("stop")).toEqual([["stop", name]]);
    expect(out.join("")).toBe(ready);
    expect(err.join("")).not.toContain("99.88.77");
  });

  it("runs docker without a shell", async () => {
    const { out, exit } = dev([]);
    await waitFor(() => out.length > 0, "the ready line");
    process.emit("SIGTERM", "SIGTERM");
    await exit;

    const calls = vi.mocked(spawn).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const [file, args, options] of calls) {
      expect(file).toBe("docker");
      expect(Array.isArray(args)).toBe(true);
      expect(options).toBeTypeOf("object");
      expect((options as { shell?: unknown }).shell ?? false).toBe(false);
    }
  });

  it.each(["SIGINT", "SIGTERM"] as const)("stops the container on %s", async (signal) => {
    const { out, exit } = dev([]);
    await waitFor(() => out.length > 0, "the ready line");
    expect(callsTo("stop")).toEqual([]);

    process.emit(signal, signal);
    expect(await exit).toBe(0);
    const run = callsTo("run")[0] ?? [];
    expect(callsTo("stop")).toEqual([["stop", run[run.indexOf("--name") + 1]]]);
  });

  it("stops the container when the server then fails to start", async () => {
    const blocker = createServer();
    await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      const captured = capture();
      const exit = await main(
        ["dev", "--port", String(port), "--data-dir", join(work, "data")],
        captured.io,
        SHORT,
      );
      expect(exit).toBe(1);
      expect(captured.out).toEqual([]);
      expect(captured.err.join("")).toContain(String(port));
      expect(callsTo("run")).toHaveLength(1);
      expect(callsTo("stop")).toHaveLength(1);
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });
});

describe("dynjandi dev when the renderer cannot start", () => {
  function expectFailure(
    result: { out: string[]; err: string[] },
    exitCode: number,
    ...messages: string[]
  ) {
    expect(exitCode).toBe(1);
    expect(result.out).toEqual([]);
    const stderr = result.err.join("");
    for (const message of messages) expect(stderr).toContain(message);
    expect(stderr).toContain("--renderer-url");
    expect(stderr).toContain("--no-renderer");
    // One line for the failure itself.
    expect(
      stderr
        .trimEnd()
        .split("\n")
        .filter((line) => line.includes("dynjandi dev:")),
    ).toHaveLength(1);
  }

  it("exits 1 when docker is not on PATH", async () => {
    const empty = join(work, "empty");
    mkdirSync(empty);
    setEnv("PATH", empty);
    const result = dev([]);
    expectFailure(result, await result.exit, "docker was not found on PATH");
    expect(dockerCalls()).toEqual([]);
  });

  it("exits 1 naming Docker's first stderr line when the daemon is down", async () => {
    playing("no-daemon", stubPort());
    const result = dev([]);
    expectFailure(
      result,
      await result.exit,
      "Docker is not running",
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
    );
    expect(callsTo("run")).toEqual([]);
  });

  it("exits 1 quoting only Docker's first stderr line when the pull is denied", async () => {
    playing("pull-denied", stubPort());
    const result = dev([]);
    expectFailure(
      result,
      await result.exit,
      "could not pull ghcr.io/dynjandi-dev/renderer:0.2.0",
      "Error response from daemon: error from registry: denied",
      "docker login ghcr.io",
    );
    expect(result.err.join("")).not.toContain("a second line");
    expect(callsTo("run")).toEqual([]);
  });

  it("exits 1 with the last log lines, and stops the container, when it never becomes healthy", async () => {
    playing("never-healthy", await unusedPort());
    const result = dev([]);
    expectFailure(
      result,
      await result.exit,
      "did not become healthy",
      "renderer log one | renderer log two",
    );
    expect(callsTo("stop")).toHaveLength(1);
  });

  it("exits 1 with the last log lines when the container exits before it is healthy", async () => {
    playing("crashes", await unusedPort());
    const result = dev([], LONG);
    expectFailure(result, await result.exit, "exited (code 1)", "boom");
  });

  // §4.5: the health budget is "for 60 s after the container starts (the first pull ... is not counted)".
  // The pull takes 1500 ms, three times the 500 ms budget, and the ready line still arrives.
  it("does not count the pull against the health budget", async () => {
    playing("slow-pull", stubPort());
    const { out, exit } = dev([], SHORT);
    await waitFor(() => out.length > 0, "the ready line");
    process.emit("SIGTERM", "SIGTERM");
    expect(await exit).toBe(0);
  });

  it("starts no container, prints no ready line and exits 0 on a signal during the pull", async () => {
    playing("slow-pull", stubPort());
    const { out, exit } = dev([], LONG);
    await waitFor(() => callsTo("pull").length > 0, "the pull to begin");
    process.emit("SIGINT", "SIGINT");
    expect(await exit).toBe(0);
    expect(out).toEqual([]);
    expect(callsTo("run")).toEqual([]);
  });

  // §4.5: "GET /health until 2xx", so a 503 is not healthy.
  it("exits 1 when /health answers 503", async () => {
    const unhealthy = createServer((_request, response) => {
      response.writeHead(503).end();
    });
    await new Promise<void>((done) => unhealthy.listen(0, "127.0.0.1", done));
    const address = unhealthy.address();
    try {
      playing("never-healthy", typeof address === "object" && address !== null ? address.port : 0);
      const result = dev([]);
      expect(await result.exit).toBe(1);
      expect(result.out).toEqual([]);
      expect(result.err.join("")).toContain("did not become healthy");
    } finally {
      unhealthy.closeAllConnections();
      await new Promise((done) => unhealthy.close(done));
    }
  });

  it("stops the container, prints no ready line and exits 0 on a signal during the health wait", async () => {
    playing("never-healthy", await unusedPort());
    const { out, exit } = dev([], LONG);
    await waitFor(() => callsTo("port").length > 0, "the health wait to begin");
    process.emit("SIGINT", "SIGINT");

    expect(await exit).toBe(0);
    expect(out).toEqual([]);
    expect(callsTo("stop")).toHaveLength(1);
  });
});

describe("dynjandi dev with a renderer flag", () => {
  it("never calls docker with --renderer-url", async () => {
    const { out, exit } = dev(["--renderer-url", stub.url]);
    await waitFor(() => out.length > 0, "the ready line");
    process.emit("SIGTERM", "SIGTERM");
    expect(await exit).toBe(0);
    expect(dockerCalls()).toEqual([]);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it("never calls docker with --no-renderer", async () => {
    const { out, exit } = dev(["--no-renderer"]);
    await waitFor(() => out.length > 0, "the ready line");
    process.emit("SIGTERM", "SIGTERM");
    expect(await exit).toBe(0);
    expect(dockerCalls()).toEqual([]);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });
});
