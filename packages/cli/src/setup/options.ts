import { parseArgs } from "node:util";
import { UsageError } from "../errors.js";
import { isValidProjectId, isValidProjectName } from "./api.js";

export interface SetupOptions {
  /** `--project <id>`: that project (D5 step 1). */
  project: string | undefined;
  /** `--name <name>`, trimmed (D5 step 2). */
  name: string | undefined;
  /** `--env-file <path>`, as given: relative to the working directory (D6). */
  envFile: string | undefined;
  force: boolean;
  dryRun: boolean;
  json: boolean;
}

export type SetupCommand = { kind: "help" } | { kind: "run"; options: SetupOptions };

export const SETUP_HELP = `Usage: dynjandi setup [options]

Set up a Dynjandi project for this directory: find the project (or create it) and write its
DYNJANDI_PROJECT_KEY and DYNJANDI_PROJECT_ID to an env file that Git ignores. The key is never printed.

The credential is DYNJANDI_API_KEY, a workspace API key from the API keys page of the dashboard. There is no
option for it, because an option lands in the process list and the shell history. Nothing is saved.

The project is, in order: --project, --name, the DYNJANDI_PROJECT_ID already in the env file, the "name" in
package.json, the directory's name. A project that already has the name is used, never duplicated.

The env file is --env-file, else an existing .env.local, else an existing .env, else a new .env.local. In a
Git repository, a file that is tracked is refused, and one that is not ignored gets an entry in the .gitignore
beside it.

Options:
  --project <id>      use this project
  --name <name>       use the project with this name, or create it
  --env-file <path>   the file to write (relative to the working directory)
  --force             replace a different key or project id already in the env file
  --dry-run           check everything and say what would happen, changing nothing
  --json              print the result as one JSON object
  --help              print this help

Exit codes: 0 done, 1 failure, 2 usage error, 3 no usable credential.

Examples:
  dynjandi setup --json                 for an agent or a script: the result as one JSON object
  dynjandi setup                        set up the project for this directory
  dynjandi setup --project <id>         use a project you already have
  dynjandi setup --dry-run              see what it would do, and change nothing
`;

function readArgs(args: string[]) {
  // A flag that would put a credential in the process list is named, not just rejected as unknown (D3).
  if (args.some((arg) => arg === "--api-key" || arg.startsWith("--api-key="))) {
    throw new UsageError(
      "there is no --api-key option: set the DYNJANDI_API_KEY environment variable instead",
    );
  }
  try {
    return parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        project: { type: "string" },
        name: { type: "string" },
        "env-file": { type: "string" },
        force: { type: "boolean" },
        "dry-run": { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
    }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/** Throws `UsageError` for anything `dynjandi setup` does not accept. */
export function parseSetupOptions(args: string[]): SetupCommand {
  const values = readArgs(args);
  if (values.help === true) return { kind: "help" };

  if (values.project !== undefined && values.name !== undefined) {
    throw new UsageError("--project and --name both pick the project: give only one");
  }
  if (values.project !== undefined && !isValidProjectId(values.project)) {
    throw new UsageError(
      "--project must be a project id: lowercase letters, digits and hyphens, 1 to 63 characters",
    );
  }
  const name = values.name?.trim();
  if (name !== undefined && !isValidProjectName(name)) {
    throw new UsageError("--name must be 1 to 200 characters");
  }
  if (values["env-file"] === "") throw new UsageError("--env-file must not be empty");

  return {
    kind: "run",
    options: {
      project: values.project,
      name,
      envFile: values["env-file"],
      force: values.force === true,
      dryRun: values["dry-run"] === true,
      json: values.json === true,
    },
  };
}
