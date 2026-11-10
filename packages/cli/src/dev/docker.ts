import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { RENDERER_CONTAINER_PORT, RENDERER_IMAGE, RENDERER_IMAGE_TAG } from "./renderer-image.js";

/** The health budget starts once the container has started; the first image pull is not counted (4.5). */
const DEFAULT_HEALTH_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const HEALTH_REQUEST_TIMEOUT_MS = 2000;
const LOG_LINES_KEPT = 20;

// Every failure names the way round it (4.5): a running renderer, or none.
const WAYS_ROUND =
  "or pass --renderer-url <url> to use a running renderer, or --no-renderer to run without one";

export interface DockerRendererSettings {
  /** Receives lines for stderr, without a newline. */
  log: (line: string) => void;
  /** Aborting stops the container and rejects with `RendererStartAborted`. */
  signal?: AbortSignal | undefined;
  /** Tests shorten these; they are not command line options. */
  healthTimeoutMs?: number | undefined;
  pollIntervalMs?: number | undefined;
}

export interface DockerRenderer {
  /** `http://127.0.0.1:<host port>`. */
  url: string;
  /** Stops the container. Safe to call more than once. */
  stop: () => Promise<void>;
}

/** The start was cancelled by SIGINT or SIGTERM, not by a failure. */
export class RendererStartAborted extends Error {
  constructor() {
    super("starting the renderer was cancelled");
    this.name = "RendererStartAborted";
  }
}

interface DockerResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// `spawn` with an argument array and no shell, so nothing here is ever parsed by one. Standard output and
// error are piped into the result, never inherited: whatever `docker` prints must not reach the CLI's stdout (D12).
function runDocker(args: string[], signal?: AbortSignal): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal === undefined ? {} : { signal }),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (signal?.aborted) {
        reject(new RendererStartAborted());
      } else if (error.code === "ENOENT") {
        reject(
          new Error(`docker was not found on PATH; install Docker and start it, ${WAYS_ROUND}`, {
            cause: error,
          }),
        );
      } else {
        reject(
          new Error(`could not run docker (${error.message}); ${WAYS_ROUND}`, { cause: error }),
        );
      }
    });
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "no output"
  );
}

// A failure message is one line, so the container's last log lines are joined.
function joinLines(lines: string[]): string {
  return lines.length === 0 ? "none" : lines.join(" | ");
}

/** The last lines of the container's output, kept in memory while `docker run` is attached. */
function keepLastLines(child: ReturnType<typeof spawn>): () => string[] {
  const lines: string[] = [];
  const partial = { stdout: "", stderr: "" };
  const collect = (stream: "stdout" | "stderr", chunk: string, final = false) => {
    const pieces = (partial[stream] + chunk).split("\n");
    partial[stream] = final ? "" : (pieces.pop() ?? "");
    if (final && pieces.at(-1) === "") pieces.pop();
    for (const piece of pieces) {
      if (piece.trim() !== "") lines.push(piece.trim());
    }
    lines.splice(0, Math.max(0, lines.length - LOG_LINES_KEPT));
  };
  for (const stream of ["stdout", "stderr"] as const) {
    child[stream]?.setEncoding("utf8");
    child[stream]?.on("data", (chunk: string) => collect(stream, chunk));
    child[stream]?.once("close", () => collect(stream, "", true));
  }
  return () => [...lines];
}

// `docker port` prints one `<address>:<port>` line per binding.
function parseHostPort(output: string): number | undefined {
  const match = /:(\d+)\s*$/m.exec(output);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

async function isHealthy(url: string, signal: AbortSignal | undefined): Promise<boolean> {
  const timeout = AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/health`, {
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    // Not up yet; the wait asks again until its budget is spent. An abort is noticed by the wait itself.
    return false;
  }
}

async function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  try {
    await delay(ms, undefined, signal === undefined ? {} : { signal });
  } catch {
    throw new RendererStartAborted();
  }
}

/**
 * Pulls the pinned image, starts it, and resolves once its `GET /health` answers 2xx. The container is
 * published on 127.0.0.1 only, read-only with a tmpfs for /tmp, removed when it stops, and stopped again by
 * `stop()` and by any failure or abort on the way here (plan section 4.5).
 */
export async function startDockerRenderer(
  settings: DockerRendererSettings,
): Promise<DockerRenderer> {
  const { log, signal } = settings;
  const healthTimeoutMs = settings.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const pollIntervalMs = settings.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const daemon = await runDocker(["version", "--format", "{{.Server.Version}}"], signal);
  if (daemon.code !== 0) {
    throw new Error(
      `Docker is not running (${firstLine(daemon.stderr)}); start Docker, ${WAYS_ROUND}`,
    );
  }

  log(`pulling ${RENDERER_IMAGE_TAG} if it is not here yet (about 100 MB the first time)`);
  const pull = await runDocker(["pull", RENDERER_IMAGE], signal);
  if (pull.code !== 0) {
    throw new Error(
      `Docker could not pull ${RENDERER_IMAGE_TAG} (${firstLine(pull.stderr)}); sign in with "docker login ghcr.io" as an account that can read it, ${WAYS_ROUND}`,
    );
  }

  const name = `dynjandi-renderer-${process.pid}-${randomBytes(4).toString("hex")}`;
  // Attached, not `-d`: --rm deletes a container that crashes, and its logs with it, so this process keeps them.
  const container = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      name,
      "-p",
      `127.0.0.1::${RENDERER_CONTAINER_PORT}`,
      "--read-only",
      "--tmpfs",
      "/tmp",
      RENDERER_IMAGE,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const lastLines = keepLastLines(container);
  // Set by the events below; an object, so the loop's reads are not narrowed to the initial `undefined`.
  const state: { exit?: { code: number | null } } = {};
  const exited = new Promise<void>((done) => {
    container.once("close", (code) => {
      state.exit = { code };
      done();
    });
    container.once("error", (error) => {
      log(`could not run docker: ${error.message}`);
      state.exit = { code: null };
      done();
    });
  });

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      const result = await runDocker(["stop", name]).catch((error: unknown) => ({
        code: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }));
      // A container that already exited under --rm is gone, which is the state `stop` is after.
      if (result.code !== 0 && state.exit === undefined) {
        log(`could not stop container ${name}: ${firstLine(result.stderr)}`);
        container.kill("SIGTERM");
      }
      await exited;
    })();
    return stopping;
  };

  try {
    const budgetEnds = performance.now() + healthTimeoutMs;
    let url: string | undefined;
    while (performance.now() < budgetEnds) {
      if (signal?.aborted) throw new RendererStartAborted();
      if (state.exit !== undefined) {
        throw new Error(
          `the renderer container exited (code ${state.exit.code ?? "none"}) before it was healthy; last log lines: ${joinLines(lastLines())}; check Docker, ${WAYS_ROUND}`,
        );
      }
      if (url === undefined) {
        const port = await runDocker(["port", name, `${RENDERER_CONTAINER_PORT}/tcp`], signal);
        const hostPort = port.code === 0 ? parseHostPort(port.stdout) : undefined;
        if (hostPort !== undefined) url = `http://127.0.0.1:${hostPort}`;
      }
      if (url !== undefined && (await isHealthy(url, signal))) return { url, stop };
      await pause(pollIntervalMs, signal);
    }
    throw new Error(
      `the renderer did not become healthy within ${Math.round(healthTimeoutMs / 1000)} s; last log lines: ${joinLines(lastLines())}; check Docker, ${WAYS_ROUND}`,
    );
  } catch (error) {
    await stop();
    throw error;
  }
}
