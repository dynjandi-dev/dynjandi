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
import { hostname, tmpdir } from "node:os";
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
// Amendment (plan D15-D17 and 6.2 Phase 5 amendment, "Done when"):
// - D15: `image inspect <PINNED>` comes first; exit 0 means no `pull` at all; any other outcome pulls, and the
//   pull's lines reach stderr while it is still running (the fake's marker file is absent when the first line
//   arrives) and never stdout.
// - D16: the pull-denied line holds Docker's first line, --renderer-url, --no-renderer and the full GitHub URL
//   of the README section "If the image cannot be pulled", and does not say "docker login"; the README has
//   that heading. The URL is written out by hand from D16's section name and the repository's path.
// - D17: the recorded run holds `--label dev.dynjandi.cli.owner=<hostname>:<pid>` (this host, this process);
//   `ps` is asked for that label key; a container owned by this host whose pid is gone is stopped before the
//   new `run`; a live pid (this test process) and another host's container (even with a dead pid) are not.
//   A pid known to be gone is that of a child that has already exited.
const PINNED =
  "ghcr.io/dynjandi-dev/renderer:0.2.0@sha256:0231fbce1d35499bfeafb1b238951b164aafd6d3c61a491f0b27ee7d10e5b7d6";
const README = fileURLToPath(new URL("../README.md", import.meta.url));
const README_URL =
  "https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#if-the-image-cannot-be-pulled";
const OWNER_LABEL = "dev.dynjandi.cli.owner";
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
    expect(callsTo("image")).toEqual([["image", "inspect", PINNED]]);
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
      README_URL,
    );
    // The pull's own lines are streamed (D15); the failure line quotes only the first.
    const failure =
      result.err
        .join("")
        .split("\n")
        .find((line) => line.includes("dynjandi dev:")) ?? "";
    expect(failure).not.toContain("a second line");
    // The streamed pull output holds these strings too, so only the failure line itself can show the quote.
    expect(failure).toContain("Error response from daemon: error from registry: denied");
    expect(failure).toContain(README_URL);
    expect(failure).toContain("--renderer-url");
    expect(failure).toContain("--no-renderer");
    expect(result.err.join("")).not.toContain("docker login");
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

async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid ?? 0;
  await new Promise((done) => child.once("close", done));
  return pid;
}

function psHolds(entries: { name: string; owner: string }[]): void {
  setEnv("FAKE_DOCKER_PS", JSON.stringify(entries));
}

describe("dynjandi dev and the image", () => {
  it("runs no pull when the image is already here", async () => {
    setEnv("FAKE_DOCKER_IMAGE", "present");
    const { out, exit } = dev([]);
    await waitFor(() => out.length > 0, "the ready line");
    process.emit("SIGTERM", "SIGTERM");
    expect(await exit).toBe(0);
    expect(callsTo("image")).toEqual([["image", "inspect", PINNED]]);
    expect(callsTo("pull")).toEqual([]);
    expect(callsTo("run")).toHaveLength(1);
  });

  it("shows the pull's lines on stderr while it runs, and none on stdout", async () => {
    playing("slow-pull", stubPort());
    const { out, err, exit } = dev([], LONG);
    await waitFor(() => err.join("").includes("Pulling from dynjandi-dev/renderer"), "a pull line");
    // The fake leaves its marker only when the pull ends, 1500 ms after that first line.
    expect(existsSync(`${dockerLog}.pulled`)).toBe(false);
    await waitFor(() => out.length > 0, "the ready line");
    expect(existsSync(`${dockerLog}.pulled`)).toBe(true);
    expect(err.join("")).toContain("Digest: sha256:fake");
    expect(out.join("")).not.toContain("Pulling from");
    expect(out.join("")).not.toContain("Digest");
    process.emit("SIGTERM", "SIGTERM");
    expect(await exit).toBe(0);
  });

  it("has the README section the pull-denied line points to", () => {
    expect(readFileSync(README, "utf8")).toMatch(/^#{2,4} If the image cannot be pulled$/m);
  });
});

describe("dynjandi dev and a renderer whose dev died", () => {
  it("labels its container with this host and this process", async () => {
    const { out, exit } = dev([]);
    await waitFor(() => out.length > 0, "the ready line");
    const run = callsTo("run")[0] ?? [];
    expect(run[run.indexOf("--label") + 1]).toBe(`${OWNER_LABEL}=${hostname()}:${process.pid}`);
    process.emit("SIGTERM", "SIGTERM");
    await exit;
  });

  it("stops a dead same-host container before it starts its own, and leaves the others", async () => {
    const dead = await exitedPid();
    psHolds([
      { name: "stale-dead", owner: `${hostname()}:${dead}` },
      { name: "alive-here", owner: `${hostname()}:${process.pid}` },
      { name: "other-host", owner: `not-${hostname()}:${dead}` },
    ]);
    const { out, exit } = dev([]);
    await waitFor(() => out.length > 0, "the ready line");

    const ps = callsTo("ps")[0] ?? [];
    expect(ps[ps.indexOf("--filter") + 1]).toBe(`label=${OWNER_LABEL}`);
    const calls = dockerCalls();
    const stops = calls.filter((call) => call[0] === "stop");
    expect(stops).toEqual([["stop", "stale-dead"]]);
    expect(calls.findIndex((call) => call[0] === "stop")).toBeLessThan(
      calls.findIndex((call) => call[0] === "run"),
    );
    process.emit("SIGTERM", "SIGTERM");
    await exit;
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
