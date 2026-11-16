import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createEmptyGitConfig, removeEmptyGitConfig } from "../support/git-config.js";

// End-to-end test of the built `dynjandi setup` (`dist/cli.js`) as a child process, for what only the built
// binary can show: that Node does not take an option before `setup` does (#66), and the exit codes a shell sees.
// NOT part of `pnpm test` (see `test:e2e` in package.json); `pnpm build` must have run first. It needs no Docker.
//
// No case reaches the network, by three things together (D2: the origin is fixed, so there is no URL to point
// elsewhere, and a case that got as far as a request would reach app.dynjandi.dev):
// 1. no case has a credential: `DYNJANDI_API_KEY` is removed from the environment each child gets, even when
//    the developer's shell has one, and no case passes one, so `setup` stops before it can make a request;
// 2. every case ends at a step before the first request (D10): usage (2), the Git guard (step 2), the credential
//    (step 3);
// 3. each child preloads a module that replaces `fetch` with a function that exits 99, so a case that did send
//    a request would fail on that exit code instead of silently reaching the service.
//
// Expected values come from the plan and the README: exit codes from D3/D13 (0 done, 1 failure, 2 usage, 3 no
// usable credential), the order from D10 (the Git guard is step 2, the credential step 3), D6 (`--file`, and
// `--env-file` refused naming `--file`), #66 (Node exits 9 for a missing `--env-file`).

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const NO_FETCH = `data:text/javascript,${encodeURIComponent(
  'globalThis.fetch = () => { process.stderr.write("setup.e2e: a request was made\\n"); process.exit(99); };',
)}`;
const NODE_ENV_FILE_EXIT = 9; // Node's exit code for a missing --env-file (#66).

let dir: string;
let gitConfig: string;

beforeAll(async () => {
  gitConfig = await createEmptyGitConfig();
});

afterAll(async () => {
  await removeEmptyGitConfig(gitConfig);
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dynjandi-setup-e2e-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

function environment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("DYNJANDI_") || name === "CI") delete env[name];
  }
  return {
    ...env,
    // The machine's own Git configuration (a global ignore file) would change which files count as ignored.
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    ...extra,
  };
}

function run(args: string[], extraEnv: Record<string, string> = {}): Result {
  const child = spawnSync(process.execPath, ["--import", NO_FETCH, CLI, ...args], {
    cwd: dir,
    env: environment(extraEnv),
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

describe("the built dynjandi setup", () => {
  test("--help prints the commands and exits 0", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: dynjandi <command>");
    expect(result.stdout).toMatch(/^ {2}setup /m);
    expect(result.stderr).toBe("");
  });

  test("setup --help prints the options and exits 0", () => {
    const result = run(["setup", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: dynjandi setup");
    expect(result.stdout).toContain("--file <path>");
    expect(result.stdout).toContain("DYNJANDI_API_KEY");
  });

  test("with CI=1 and no key it exits 3, names the variable on stderr and prints nothing on stdout", () => {
    const result = run(["setup"], { CI: "1" });
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DYNJANDI_API_KEY");
  });

  test("--api-key is a usage error: exit 2, pointing at the variable", () => {
    const result = run(["setup", "--api-key", "x"], { CI: "1" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DYNJANDI_API_KEY");
  });

  test("--file <a new path> with CI=1 and no key exits 3, not Node's 9, and writes nothing (D6, #66)", async () => {
    const result = run(["setup", "--file", "fresh.env"], { CI: "1" });
    expect(result.status).not.toBe(NODE_ENV_FILE_EXIT);
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(await readdir(dir)).toEqual([]);
  });

  test("--env-file <an existing file> is a usage error naming --file (D6)", async () => {
    await writeFile(join(dir, "existing.env"), "EXISTING=1\n");
    const result = run(["setup", "--env-file", "existing.env"], { CI: "1" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--file");
    expect(await readFile(join(dir, "existing.env"), "utf8")).toBe("EXISTING=1\n");
  });

  test("a tracked env file exits 1 with the Git message before the credential is asked for (D10)", async () => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: environment() });
    git("init", "-q");
    await writeFile(join(dir, ".env.local"), "TRACKED=1\n");
    git("add", ".env.local");

    // No key and CI=1: had the credential come first, this would exit 3. Exit 1 shows the guard ran before it.
    const result = run(["setup"], { CI: "1" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(".env.local is tracked by Git");
    expect(result.stderr).toContain("git rm --cached .env.local");
    expect(await readFile(join(dir, ".env.local"), "utf8")).toBe("TRACKED=1\n");
    expect((await readdir(dir)).sort()).toEqual([".env.local", ".git"]);
  });
});
