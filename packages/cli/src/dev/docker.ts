import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
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

/** D17: names the `dev` process that started a container, as `<hostname>:<pid>`. */
const OWNER_LABEL = "dev.dynjandi.cli.owner";

// D16: the section a reader who cannot pull the image is sent to. A full URL, so an agent can follow it.
const PULL_HELP_URL =
  "https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#if-the-image-cannot-be-pulled";

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
// `onLine` receives each complete line of either stream as it arrives, for output a reader should see live.
function runDocker(
  args: string[],
  signal?: AbortSignal,
  onLine?: (line: string) => void,
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal === undefined ? {} : { signal }),
    });
    let stdout = "";
    let stderr = "";
    const partial = { stdout: "", stderr: "" };
    const forward = (stream: "stdout" | "stderr", chunk: string, final = false) => {
      if (onLine === undefined) return;
      const pieces = (partial[stream] + chunk).split("\n");
      partial[stream] = final ? "" : (pieces.pop() ?? "");
      for (const piece of pieces) {
        if (piece.trim() !== "") onLine(piece.trim());
      }
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      forward("stdout", chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      forward("stderr", chunk);
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
    child.once("close", (code) => {
      forward("stdout", "", true);
      forward("stderr", "", true);
      resolve({ code, stdout, stderr });
    });
  });
}

// `process.kill(pid, 0)` sends nothing; ESRCH says the pid is gone. Any other outcome (EPERM: it exists but
// is not ours) counts as alive, because stopping a renderer that may be in use is the worse mistake.
function isGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * D17: stops each labelled container this host started whose `dev` is gone. A live pid or another host's
 * container is left alone. Nothing here may stop start-up, so a failure is logged and the start goes on.
 */
async function stopOrphans(log: (line: string) => void, signal: AbortSignal | undefined) {
  const listed = await runDocker(
    [
      "ps",
      "--filter",
      `label=${OWNER_LABEL}`,
      "--format",
      `{{.Names}}\t{{.Label "${OWNER_LABEL}"}}`,
    ],
    signal,
  );
  if (listed.code !== 0) {
    log(`could not list earlier renderers: ${firstLine(listed.stderr)}`);
    return;
  }
  const host = hostname();
  for (const row of listed.stdout.split("\n")) {
    const [containerName, owner] = row.trim().split("\t");
    if (containerName === undefined || containerName === "" || owner === undefined) continue;
    const colon = owner.lastIndexOf(":");
    const pid = Number(owner.slice(colon + 1));
    if (colon < 0 || owner.slice(0, colon) !== host || !Number.isInteger(pid) || pid <= 0) continue;
    if (!isGone(pid)) continue;
    const stopped = await runDocker(["stop", containerName], signal);
    log(
      stopped.code === 0
        ? `stopped renderer ${containerName} left by a dev that is gone (pid ${pid})`
        : `could not stop renderer ${containerName}: ${firstLine(stopped.stderr)}`,
    );
  }
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
 * Pulls the pinned image if it is missing, starts it, and resolves once its `GET /health` answers 2xx. The container is
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

  try {
    await stopOrphans(log, signal);
  } catch (error) {
    if (error instanceof RendererStartAborted) throw error;
    log(`could not clean up earlier renderers: ${error instanceof Error ? error.message : error}`);
  }

  // D15: a present image means no pull and no registry request, so later starts work offline. Any other
  // outcome of the inspect falls back to a pull.
  const inspected = await runDocker(["image", "inspect", RENDERER_IMAGE], signal);
  if (inspected.code !== 0) {
    log(`pulling ${RENDERER_IMAGE_TAG} (about 100 MB the first time)`);
    const pull = await runDocker(["pull", RENDERER_IMAGE], signal, log);
    if (pull.code !== 0) {
      throw new Error(
        `Docker could not pull ${RENDERER_IMAGE_TAG} (${firstLine(pull.stderr)}); ${WAYS_ROUND}, or see ${PULL_HELP_URL}`,
      );
    }
  }

  const name = `dynjandi-renderer-${process.pid}-${randomBytes(4).toString("hex")}`;
  // Attached, not `-d`: --rm deletes a container that crashes, and its logs with it, so this process keeps them.
  // `--sig-proxy=false`: `docker run` shares this process's terminal, so a Ctrl-C reaches it too, and by default it
  // would pass that on to the container and stop the renderer while a command under `--` is still using it.
  // Only `stop()` ends the container.
  const container = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--sig-proxy=false",
      "--name",
      name,
      "--label",
      `${OWNER_LABEL}=${hostname()}:${process.pid}`,
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
