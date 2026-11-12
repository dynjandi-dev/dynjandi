import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseAllowHost } from "./host-check.js";

export const DEFAULT_PORT = 4600;
export const DEFAULT_PROJECT_KEY = "dynjandi-local";
// The renderer's MAX_INPUT_BYTES default, so every stored file can be rendered.
export const DEFAULT_MAX_FILE_SIZE = 26_214_400;
const DEFAULT_DATA_DIR = ".dynjandi";
const MAX_TCP_PORT = 65_535;

export type RendererChoice = { kind: "docker" } | { kind: "url"; url: string } | { kind: "none" };

export interface DevOptions {
  port: number;
  /** Absolute. */
  dataDir: string;
  projectKey: string;
  /** True when `--project-key` was not given; only the default key is ever printed. */
  isDefaultProjectKey: boolean;
  renderer: RendererChoice;
  maxFileSize: number;
  /** `--allow-host` names, lower-cased; absent when none was given (D5). */
  allowHosts?: string[];
  /** `--json`: the ready line is one JSON object (D19). */
  json: boolean;
  /** What follows `--`: the command and its arguments, run against the ready server (D18). */
  command: string[] | undefined;
}

export type DevCommand = { kind: "help" } | { kind: "run"; options: DevOptions };

/** A mistake in how the command was called: exit 2, message on stderr. */
export class UsageError extends Error {}

export const DEV_HELP = `Usage: dynjandi dev [options]
       dynjandi dev [options] -- <command> [args...]

Run a local Dynjandi server on 127.0.0.1. It answers only to IP addresses, localhost, *.localhost and
host.docker.internal as the Host; any other name gets 421 unless --allow-host adds it. With "-- <command>", run the command against it
(DYNJANDI_ORIGIN and DYNJANDI_PROJECT_KEY are set), stop the server when it exits, and exit
with its code. In that form --port defaults to 0, the ready line goes to standard error and
requests are not logged.

Options:
  --port <n>              port to listen on, 0 for a free one (default ${DEFAULT_PORT}, 0 after "--")
  --data-dir <path>       where files are kept (default ${DEFAULT_DATA_DIR} in the working directory)
  --project-key <key>     the key the server accepts (default ${DEFAULT_PROJECT_KEY})
  --renderer-url <url>    use a renderer that is already running (http or https), not Docker
  --no-renderer           run without a renderer; variant URLs answer 502
  --max-file-size <bytes> largest upload accepted (default ${DEFAULT_MAX_FILE_SIZE})
  --allow-host <name>     also answer to this host name (repeatable; an exact DNS name, no port or wildcard)
  --json                  print the ready line as one JSON object
  --help                  print this help

Examples:
  dynjandi dev                          start the server
  dynjandi dev -- pnpm test             run your tests against it; the server stops when they end
  createClient({ projectKey: process.env.DYNJANDI_PROJECT_KEY, origin: process.env.DYNJANDI_ORIGIN })
                                        point the SDK at it, inside the command
`;

function parseIntegerInRange(name: string, text: string, min: number, max: number): number {
  if (!/^\d+$/.test(text)) {
    throw new UsageError(`${name} must be a whole number, got "${text}"`);
  }
  const value = Number(text);
  if (value < min || value > max) {
    throw new UsageError(`${name} must be between ${min} and ${max}, got ${text}`);
  }
  return value;
}

function parseRendererUrl(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UsageError(`--renderer-url must be an absolute http or https URL, got "${text}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`--renderer-url must be an absolute http or https URL, got "${text}"`);
  }
  return text;
}

function parseAllowHosts(values: string[]): string[] {
  return values.map((text) => {
    const parsed = parseAllowHost(text);
    if ("problem" in parsed) {
      throw new UsageError(`--allow-host ${parsed.problem}, got ${JSON.stringify(text)}`);
    }
    return parsed.name;
  });
}

function parseRenderer(url: string | undefined, noRenderer: boolean): RendererChoice {
  if (url !== undefined && noRenderer) {
    throw new UsageError("--no-renderer cannot be used together with --renderer-url");
  }
  if (url !== undefined) return { kind: "url", url: parseRendererUrl(url) };
  if (noRenderer) return { kind: "none" };
  return { kind: "docker" };
}

function readArgs(args: string[]) {
  try {
    return parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        port: { type: "string" },
        "data-dir": { type: "string" },
        "project-key": { type: "string" },
        "renderer-url": { type: "string" },
        "no-renderer": { type: "boolean" },
        "max-file-size": { type: "string" },
        "allow-host": { type: "string", multiple: true },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
    }).values;
  } catch (error) {
    // parseArgs names the offending option or argument in its message.
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/** Throws `UsageError` for anything `dynjandi dev` does not accept. `cwd` anchors `--data-dir`. */
export function parseDevOptions(args: string[], cwd: string): DevCommand {
  // The first `--` ends the options; everything after it is the command, untouched (D18).
  const separator = args.indexOf("--");
  const command = separator === -1 ? undefined : args.slice(separator + 1);
  const values = readArgs(separator === -1 ? args : args.slice(0, separator));
  if (command?.[0] === undefined && command !== undefined && values.help !== true) {
    throw new UsageError("-- must be followed by the command to run");
  }

  if (values.help === true) return { kind: "help" };

  const dataDir = values["data-dir"] ?? DEFAULT_DATA_DIR;
  if (dataDir === "") throw new UsageError("--data-dir must not be empty");
  const projectKey = values["project-key"] ?? DEFAULT_PROJECT_KEY;
  if (projectKey === "") throw new UsageError("--project-key must not be empty");

  return {
    kind: "run",
    options: {
      port:
        values.port === undefined
          ? command === undefined
            ? DEFAULT_PORT
            : 0
          : parseIntegerInRange("--port", values.port, 0, MAX_TCP_PORT),
      dataDir: resolve(cwd, dataDir),
      projectKey,
      isDefaultProjectKey: values["project-key"] === undefined,
      renderer: parseRenderer(values["renderer-url"], values["no-renderer"] === true),
      maxFileSize:
        values["max-file-size"] === undefined
          ? DEFAULT_MAX_FILE_SIZE
          : parseIntegerInRange(
              "--max-file-size",
              values["max-file-size"],
              1,
              Number.MAX_SAFE_INTEGER,
            ),
      ...(values["allow-host"] === undefined
        ? {}
        : { allowHosts: parseAllowHosts(values["allow-host"]) }),
      json: values.json === true,
      command,
    },
  };
}
