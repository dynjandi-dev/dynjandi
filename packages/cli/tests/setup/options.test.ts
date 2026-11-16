import { describe, expect, it } from "vitest";
import { UsageError } from "../../src/errors.js";
import { parseSetupOptions, SETUP_HELP } from "../../src/setup/options.js";

// Expected values come from the plan, not from the code under test:
// - D3: `--api-key` is a usage error that names the variable DYNJANDI_API_KEY, and never echoes the value;
// - D5: a project id matches ^[a-z0-9][a-z0-9-]{0,62}$ and a name is 1 to 200 characters (the document's limits);
//   `--project` and `--name` are two ways to pick the project, so both together are ambiguous;
// - D4/D5 Phase 3 scope: the options are --project, --name, --file, --force, --dry-run, --json, --help;
// - D6 (owner, 2026-11-16, #66): the file option is --file, and --env-file is a usage error that names it.
function parse(...args: string[]) {
  return parseSetupOptions(args);
}

function usageMessage(...args: string[]): string {
  try {
    parse(...args);
  } catch (error) {
    if (error instanceof UsageError) return error.message;
    throw error;
  }
  throw new Error("expected a UsageError");
}

describe("parseSetupOptions", () => {
  it("runs with no options and every flag off", () => {
    expect(parse()).toEqual({
      kind: "run",
      options: {
        project: undefined,
        name: undefined,
        envFile: undefined,
        force: false,
        dryRun: false,
        json: false,
      },
    });
  });

  it("reads every option", () => {
    expect(
      parse("--project", "my-app", "--file", "config/.env", "--force", "--dry-run", "--json"),
    ).toEqual({
      kind: "run",
      options: {
        project: "my-app",
        name: undefined,
        envFile: "config/.env",
        force: true,
        dryRun: true,
        json: true,
      },
    });
  });

  it("reads --name, trimmed", () => {
    const command = parse("--name", "  My App  ");
    expect(command.kind === "run" && command.options.name).toBe("My App");
  });

  it("answers --help, even beside other options", () => {
    expect(parse("--help")).toEqual({ kind: "help" });
    expect(parse("--dry-run", "--help")).toEqual({ kind: "help" });
  });

  it("refuses --project and --name together", () => {
    expect(usageMessage("--project", "a", "--name", "b")).toMatch(/--project.*--name/);
  });

  it("refuses --api-key and names DYNJANDI_API_KEY, without echoing the value", () => {
    for (const args of [["--api-key", "dyn_secret_value"], ["--api-key=dyn_secret_value"]]) {
      const message = usageMessage(...args);
      expect(message).toContain("DYNJANDI_API_KEY");
      expect(message).not.toContain("dyn_secret_value");
    }
  });

  it("refuses an unknown option and a positional argument", () => {
    expect(usageMessage("--wrangler")).toContain("--wrangler");
    expect(usageMessage("extra")).toContain("extra");
  });

  it("refuses a project id outside the document's pattern", () => {
    for (const id of ["My-App", "-app", "has space", "a".repeat(64), ""]) {
      expect(usageMessage("--project", id)).toContain("--project");
    }
    const longest = parse("--project", "a".repeat(63));
    expect(longest.kind).toBe("run");
  });

  it("refuses an empty name and one over 200 characters", () => {
    expect(usageMessage("--name", "   ")).toContain("--name");
    expect(usageMessage("--name", "x".repeat(201))).toContain("--name");
    expect(parse("--name", "x".repeat(200)).kind).toBe("run");
  });

  it("refuses an empty --file", () => {
    expect(usageMessage("--file", "")).toContain("--file");
  });

  it("refuses --env-file and names --file instead (D6)", () => {
    for (const args of [["--env-file", "config/app.env"], ["--env-file=config/app.env"]]) {
      expect(usageMessage(...args)).toContain("--file <path>");
    }
  });
});

describe("SETUP_HELP", () => {
  it("leads its examples with --json, shows the plain run, --project and --dry-run, and says nothing of Wrangler (D14)", () => {
    const examples = SETUP_HELP.slice(SETUP_HELP.indexOf("Examples:"));
    const lines = examples.split("\n").filter((line) => line.trim().startsWith("dynjandi setup"));
    expect(lines[0]).toContain("--json");
    expect(examples).toMatch(/dynjandi setup\s{2,}/);
    expect(examples).toContain("--project <id>");
    expect(examples).toContain("--dry-run");
    expect(SETUP_HELP.toLowerCase()).not.toContain("wrangler");
    expect(SETUP_HELP).toContain("DYNJANDI_API_KEY");
  });

  it("lists --file as the file option (D6)", () => {
    expect(SETUP_HELP).toMatch(/^ {2}--file <path> /m);
    expect(SETUP_HELP).not.toMatch(/^ {2}--env-file/m);
  });
});
