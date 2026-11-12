#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DEV_HELP, type DevOptions, parseDevOptions, UsageError } from "./dev/options.js";
import { RENDERER_IMAGE_TAG } from "./dev/renderer-image.js";
import { runCommand } from "./dev/run-command.js";
import { startServer } from "./dev/server.js";

/**
 * Not options: values tests change, so the Docker health wait does not take its 60 s and the signal tests do
 * not depend on whether they run in a terminal (`runCommand`'s `terminal`).
 */
export interface MainSettings {
  dockerHealthTimeoutMs?: number | undefined;
  dockerPollIntervalMs?: number | undefined;
  terminal?: boolean | undefined;
}

/** Where output goes. Each call is one complete chunk, newline included. */
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const HELP = `Usage: dynjandi <command> [options]

Commands:
  dev    run a local Dynjandi server

Run "dynjandi <command> --help" for a command's options.
`;

function describeRenderer(options: DevOptions): string {
  switch (options.renderer.kind) {
    case "docker":
      return `docker (${RENDERER_IMAGE_TAG})`;
    case "url":
      return options.renderer.url;
    case "none":
      return "none";
  }
}

// One line: the origin, the key only when it is the default (a --project-key value is never printed),
// the data directory and the renderer (D12).
function readyLine(url: string, options: DevOptions): string {
  const parts = [
    ...(options.isDefaultProjectKey ? [`project key: ${options.projectKey}`] : []),
    `data: ${options.dataDir}`,
    `renderer: ${describeRenderer(options)}`,
  ];
  return `Dynjandi dev server ready at ${url} (${parts.join(", ")})\n`;
}

// D19: the ready line as one JSON object. `projectKey` only when it is the default; a --project-key value
// is never printed. The image is the pinned tag, as in the sentence.
function readyJson(url: string, options: DevOptions): string {
  const renderer =
    options.renderer.kind === "docker"
      ? { kind: "docker", image: RENDERER_IMAGE_TAG }
      : options.renderer;
  return `${JSON.stringify({
    origin: url,
    ...(options.isDefaultProjectKey ? { projectKey: options.projectKey } : {}),
    dataDir: options.dataDir,
    renderer,
  })}\n`;
}

// Also aborts `cancel`, so a signal that arrives while the renderer is still starting stops that too.
// `dispose` removes the listeners, for a run that hands the signals to a command instead.
function waitForStopSignal(cancel: AbortController): {
  stopped: Promise<void>;
  dispose: () => void;
} {
  let onSignal = () => {};
  const dispose = () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const stopped = new Promise<void>((resolve) => {
    onSignal = () => {
      dispose();
      cancel.abort();
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
  return { stopped, dispose };
}

async function runDev(args: string[], io: Io, settings: MainSettings): Promise<number> {
  const command = parseDevOptions(args, process.cwd());
  if (command.kind === "help") {
    io.stdout(DEV_HELP);
    return 0;
  }
  const { options } = command;

  // Registered before the listener opens, so a signal during start-up is not lost.
  const cancel = new AbortController();
  const { stopped, dispose } = waitForStopSignal(cancel);
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({
      port: options.port,
      dataDir: options.dataDir,
      projectKey: options.projectKey,
      maxFileSize: options.maxFileSize,
      renderer: options.renderer,
      signal: cancel.signal,
      dockerHealthTimeoutMs: settings.dockerHealthTimeoutMs,
      dockerPollIntervalMs: settings.dockerPollIntervalMs,
      // Under `--` the command's output is the point: no per-request lines (D18).
      logRequests: options.command === undefined,
      log: (line) => io.stderr(`${line}\n`),
    });
  } catch (error) {
    // A stop signal during start-up is a stop (exit 0), not a failure; the container is already stopped.
    if (cancel.signal.aborted) return 0;
    throw error;
  }
  const toRun = options.command;
  if (cancel.signal.aborted) {
    await server.close();
    return 0;
  }
  const ready = options.json ? readyJson(server.url, options) : readyLine(server.url, options);
  // Under `--` stdout belongs to the command (D18).
  if (toRun === undefined) io.stdout(ready);
  else io.stderr(ready);

  if (toRun === undefined) {
    await stopped;
    await server.close();
    return 0;
  }
  // From here the command gets SIGINT and SIGTERM first (D18): from the terminal, or forwarded by runCommand.
  dispose();
  try {
    return await runCommand(
      toRun,
      { DYNJANDI_ORIGIN: server.url, DYNJANDI_PROJECT_KEY: options.projectKey },
      { terminal: settings.terminal },
    );
  } finally {
    await server.close();
  }
}

/**
 * Runs the command line and returns the exit code: 0 done, 1 runtime failure, 2 usage error (D12); under
 * `dev -- <command>` the command's own code, or 128 + n for signal n (D18).
 */
export async function main(argv: string[], io: Io, settings: MainSettings = {}): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === "--help" || command === "-h") {
      io.stdout(HELP);
      return 0;
    }
    if (command === "dev") return await runDev(rest, io, settings);
    io.stderr(
      command === undefined
        ? `dynjandi: no command given\n\n${HELP}`
        : `dynjandi: unknown command "${command}"\n\n${HELP}`,
    );
    return 2;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(
        `dynjandi ${command}: ${error.message}\nRun "dynjandi dev --help" for the options.\n`,
      );
      return 2;
    }
    io.stderr(`dynjandi ${command}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

// Run only as the entry point, not when a test imports `main`. The bin is a symlink, so compare real paths.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
  });
}
