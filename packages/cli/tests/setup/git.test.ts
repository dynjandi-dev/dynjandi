import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyGit, type GitRunner, planGit } from "../../src/setup/git.js";

// Expected values come from the plan (D7) and from git itself, which the tests run for real:
// - tracked: refuse, the fix is `git rm --cached <path>`;
// - not ignored: a `/<file name>` entry goes in the `.gitignore` beside the file, keeping its line endings,
//   and git is asked again;
// - outside a work tree: nothing to commit to, so write it;
// - a symbolic link: refuse.
let root: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

async function isIgnored(path: string): Promise<boolean> {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", path], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  // realpath-free: the temp dir is only ever named through `join`, as the code under test does.
  root = await mkdtemp(join(tmpdir(), "dynjandi-git-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function initRepository(): void {
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
}

describe("planGit and applyGit (D7)", () => {
  it("plans nothing for a file that is already ignored", async () => {
    initRepository();
    await writeFile(join(root, ".gitignore"), ".env.local\n");
    expect(await planGit(join(root, ".env.local"), root)).toEqual({ kind: "none" });
  });

  it("plans an entry for a file that is not ignored, then writes it and checks again", async () => {
    initRepository();
    const path = join(root, ".env.local");
    const plan = await planGit(path, root);
    expect(plan.kind).toBe("add");
    expect(await isIgnored(".env.local")).toBe(false);

    const result = await applyGit(plan, path, root);
    expect(result).toEqual({ kind: "ok" });
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("/.env.local\n");
    expect(await isIgnored(".env.local")).toBe(true);
  });

  it("adds the entry after a last line that has no newline", async () => {
    initRepository();
    await writeFile(join(root, ".gitignore"), "node_modules");
    const path = join(root, ".env");
    await applyGit(await planGit(path, root), path, root);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe("node_modules\n/.env\n");
  });

  it("keeps the line endings of a CRLF .gitignore", async () => {
    initRepository();
    await writeFile(join(root, ".gitignore"), "dist\r\nlogs\r\n");
    const path = join(root, ".env.local");
    await applyGit(await planGit(path, root), path, root);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
      "dist\r\nlogs\r\n/.env.local\r\n",
    );
    expect(await isIgnored(".env.local")).toBe(true);
  });

  it("puts the entry in the .gitignore beside the file, and git agrees", async () => {
    initRepository();
    await mkdir(join(root, "app"));
    const path = join(root, "app", ".env.local");
    await applyGit(await planGit(path, root), path, root);
    expect(await readFile(join(root, "app", ".gitignore"), "utf8")).toBe("/.env.local\n");
    expect(await isIgnored(join("app", ".env.local"))).toBe(true);
  });

  it("adds an entry that wins over an earlier negation rule", async () => {
    initRepository();
    await writeFile(join(root, ".gitignore"), ".env.local\n!.env.local\n");
    const path = join(root, ".env.local");
    const plan = await planGit(path, root);
    expect(plan.kind).toBe("add");
    expect(await applyGit(plan, path, root)).toEqual({ kind: "ok" });
    expect(await isIgnored(".env.local")).toBe(true);
  });

  it("refuses with the rule named when git still does not ignore the file after the entry", async () => {
    initRepository();
    const path = join(root, ".env.local");
    // A runner that answers like git would for a rule no appended entry can beat.
    const stubborn: GitRunner = async (args) => {
      if (args[0] === "check-ignore" && args.includes("-v")) {
        return { code: 0, stdout: ".gitignore:3:!.env.local\t.env.local\n", stderr: "" };
      }
      if (args[0] === "check-ignore") return { code: 1, stdout: "", stderr: "" };
      return { code: 0, stdout: "true\n", stderr: "" };
    };
    const result = await applyGit(
      { kind: "add", gitignorePath: join(root, ".gitignore"), entry: "/.env.local" },
      path,
      root,
      {
        run: stubborn,
      },
    );
    expect(result.kind).toBe("refuse");
    if (result.kind === "refuse") expect(result.reason).toContain("!.env.local");
  });

  it("refuses a tracked file with `git rm --cached` as the fix", async () => {
    initRepository();
    const path = join(root, ".env.local");
    await writeFile(path, "A=1\n");
    git("add", ".env.local");
    git("commit", "-q", "-m", "oops");
    const plan = await planGit(path, root);
    expect(plan.kind).toBe("refuse");
    if (plan.kind === "refuse") expect(plan.fix).toBe("git rm --cached .env.local");
  });

  it("refuses a tracked file even when it is also ignored", async () => {
    initRepository();
    const path = join(root, ".env.local");
    await writeFile(path, "A=1\n");
    git("add", ".env.local");
    git("commit", "-q", "-m", "oops");
    await writeFile(join(root, ".gitignore"), ".env.local\n");
    expect((await planGit(path, root)).kind).toBe("refuse");
  });

  it("says no-repo outside a work tree", async () => {
    expect(await planGit(join(root, ".env.local"), root)).toEqual({ kind: "no-repo" });
  });

  it("says no-repo when git is not installed", async () => {
    const missing: GitRunner = async () => ({ code: null, stdout: "", stderr: "" });
    expect(await planGit(join(root, ".env.local"), root, { run: missing })).toEqual({
      kind: "no-repo",
    });
  });

  it("refuses a symbolic link", async () => {
    initRepository();
    const target = join(root, "real.env");
    await writeFile(target, "A=1\n");
    const link = join(root, ".env.local");
    try {
      await symlink(target, link);
    } catch {
      return; // symbolic links need a privilege on some Windows setups
    }
    const plan = await planGit(link, root);
    expect(plan.kind).toBe("refuse");
    if (plan.kind === "refuse") expect(plan.fix).toContain("--env-file");
  });

  it("passes the path to git as one argument, never through a shell", async () => {
    initRepository();
    const odd = join(root, "a b; touch pwned $(x).env");
    await planGit(odd, root);
    await expect(readFile(join(root, "pwned"))).rejects.toThrow();
  });
});
