#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DEV_HELP, type DevOptions, parseDevOptions, UsageError } from "./dev/options.js";
import { startServer } from "./dev/server.js";

/** Where output goes. Each call is one complete chunk, newline included. */
export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const HELP = `Usage: dynjandi <command> [options]

Commands:
  dev    run a local Dynjandi server (unfinished)

Run "dynjandi <command> --help" for a command's options.
`;

function describeRenderer(options: DevOptions): string {
  switch (options.renderer.kind) {
    case "docker":
      return "docker";
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

function waitForStopSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

async function runDev(args: string[], io: Io): Promise<number> {
  const command = parseDevOptions(args, process.cwd());
  if (command.kind === "help") {
    io.stdout(DEV_HELP);
    return 0;
  }
  const { options } = command;

  // Registered before the listener opens, so a signal during start-up is not lost.
  const stopped = waitForStopSignal();
  const server = await startServer({
    port: options.port,
    dataDir: options.dataDir,
    projectKey: options.projectKey,
    maxFileSize: options.maxFileSize,
    log: (line) => io.stderr(`${line}\n`),
  });
  io.stdout(readyLine(server.url, options));
  await stopped;
  await server.close();
  return 0;
}

/** Runs the command line and returns the exit code: 0 done, 1 runtime failure, 2 usage error (D12). */
export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === "--help" || command === "-h") {
      io.stdout(HELP);
      return 0;
    }
    if (command === "dev") return await runDev(rest, io);
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
