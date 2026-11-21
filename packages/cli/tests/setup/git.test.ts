import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { temporaryName } from "../../src/setup/env-file.js";
import { applyGit, type GitRunner, planGit } from "../../src/setup/git.js";
import { createEmptyGitConfig, removeEmptyGitConfig } from "../support/git-config.js";

// Expected values come from the plan (D7) and from git itself, which the tests run for real:
// - tracked: refuse, the fix is `git rm --cached <path>`;
// - not ignored: a `/<file name>` entry goes in the `.gitignore` beside the file, keeping its line endings, and
//   so does `/<file name>.*.tmp` for the temporary file that holds the key until the rename; git is asked again;
// - outside a work tree: nothing to commit to, so write it;
// - a symbolic link: refuse.
// - a file name in an entry is escaped the way gitignore(5) reads a backslash, so `a*b.env` names that file only.
let root: string;
let gitConfig: string;

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

beforeAll(async () => {
  gitConfig = await createEmptyGitConfig();
});

afterAll(async () => {
  await removeEmptyGitConfig(gitConfig);
});

beforeEach(async () => {
  // The machine's own Git configuration (a global ignore file listing `*.tmp`, say) would change what is ignored.
  vi.stubEnv("GIT_CONFIG_GLOBAL", gitConfig);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  // realpath-free: the temp dir is only ever named through `join`, as the code under test does.
  root = await mkdtemp(join(tmpdir(), "dynjandi-git-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function commitIgnore(): Promise<void> {
  git("add", ".gitignore");
  git("commit", "-q", "-m", "ignore");
}

function initRepository(): void {
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
}

describe("planGit and applyGit (D7)", () => {
  it("reads a relative path against cwd, not the process's directory", async () => {
    initRepository();
    // The process's own directory is a different repository, or none; either way it is not `root`, the one asked about.
    const plan = await planGit(".env.local", root);
    expect(plan).toEqual({
      kind: "add",
      gitignorePath: join(root, ".gitignore"),
      entries: ["/.env.local", "/.env.local.*.tmp"],
    });
    expect(await applyGit(plan, ".env.local", root)).toEqual({ kind: "ok" });
    expect(await isIgnored(".env.local")).toBe(true);
  });

  it("checks a relative path again in cwd's repository, so an entry that misses the temporary file is refused", async () => {
    initRepository();
    // D7: the temporary file must be ignored too, and nothing in `root` ignores it once only `/.env.local` is written.
    // The process's own repository may ignore it, which is why asking there instead would answer `ok`.
    const result = await applyGit(
      { kind: "add", gitignorePath: join(root, ".gitignore"), entries: ["/.env.local"] },
      ".env.local",
      root,
    );
    expect(result.kind).toBe("refuse");
    if (result.kind === "refuse") expect(result.reason).toContain("the temporary file");
  });

  it("plans nothing for a file that is already ignored", async () => {
    initRepository();
    await writeFile(join(root, ".gitignore"), ".env.local*\n");
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
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
      "/.env.local\n/.env.local.*.tmp\n",
    );
    expect(await isIgnored(".env.local")).toBe(true);
  });

  it("adds the entry after a last line that has no newline", async () => {
    initRepository();
    await writeFile(join(root, ".gitignore"), "node_modules");
    const path = join(root, ".env");
    await applyGit(await planGit(path, root), path, root);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
      "node_modules\n/.env\n/.env.*.tmp\n",
    );
  });

  it("keeps the line endings of a CRLF .gitignore", async () => {
    initRepository();
    await writeFile(join(root, ".gitignore"), "dist\r\nlogs\r\n");
    const path = join(root, ".env.local");
    await applyGit(await planGit(path, root), path, root);
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
      "dist\r\nlogs\r\n/.env.local\r\n/.env.local.*.tmp\r\n",
    );
    expect(await isIgnored(".env.local")).toBe(true);
  });

  it("puts the entry in the .gitignore beside the file, and git agrees", async () => {
    initRepository();
    await mkdir(join(root, "app"));
    const path = join(root, "app", ".env.local");
    await applyGit(await planGit(path, root), path, root);
    expect(await readFile(join(root, "app", ".gitignore"), "utf8")).toBe(
      "/.env.local\n/.env.local.*.tmp\n",
    );
    expect(await isIgnored(join("app", ".env.local"))).toBe(true);
  });

  it("asks git from the nearest existing directory when the env file's directory is missing", async () => {
    initRepository();
    // Spawning git in a directory that does not exist fails with ENOENT, which reads as no-repo: a key would be
    // written inside a repository with no ignore entry.
    const path = join(root, "new", "deep", ".env");
    const plan = await planGit(path, root);
    expect(plan).toEqual({
      kind: "add",
      gitignorePath: join(root, "new", "deep", ".gitignore"),
      entries: ["/.env", "/.env.*.tmp"],
    });
    expect(await applyGit(plan, path, root)).toEqual({ kind: "ok" });
    expect(await isIgnored(join("new", "deep", ".env"))).toBe(true);
  });

  it("asks git from the nearest existing directory, not cwd, when cwd is outside the repository", async () => {
    initRepository();
    const outside = await mkdtemp(join(tmpdir(), "dynjandi-git-outside-"));
    try {
      const path = join(root, "new", "deep", ".env");
      const plan = await planGit(path, outside);
      expect(plan).toEqual({
        kind: "add",
        gitignorePath: join(root, "new", "deep", ".gitignore"),
        entries: ["/.env", "/.env.*.tmp"],
      });
      expect(await applyGit(plan, path, outside)).toEqual({ kind: "ok" });
      expect(await isIgnored(join("new", "deep", ".env"))).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("escapes glob characters in the entry, so only the named file is ignored", async () => {
    initRepository();
    const path = join(root, "a*b.env");
    const plan = await planGit(path, root);
    expect(plan).toEqual({
      kind: "add",
      gitignorePath: join(root, ".gitignore"),
      entries: ["/a\\*b.env", "/a\\*b.env.*.tmp"],
    });
    expect(await applyGit(plan, path, root)).toEqual({ kind: "ok" });
    expect(await isIgnored("a*b.env")).toBe(true);
    expect(await isIgnored("aXb.env")).toBe(false);
  });

  // gitignore(5) decides these: a backslash makes the next character literal, so an unescaped `?`, `[` or `\`
  // would match the near miss, and trailing spaces are dropped unless escaped, so an unescaped entry would name
  // the near miss instead. A backslash is a path separator on Windows, so that row runs everywhere else.
  it.each(
    [
      { label: "?", name: "a?b.env", entry: "/a\\?b.env", nearMiss: "aXb.env" },
      { label: "[", name: "a[1].env", entry: "/a\\[1\\].env", nearMiss: "a1.env" },
      {
        label: "a backslash",
        name: "a\\b.env",
        entry: "/a\\\\b.env",
        nearMiss: "ab.env",
        posixOnly: true,
      },
      { label: "trailing spaces", name: "x.env  ", entry: "/x.env\\ \\ ", nearMiss: "x.env" },
    ].filter((row) => !(row.posixOnly && process.platform === "win32")),
  )(
    "escapes $label in the entry, so the named file and its temporary file are ignored and a near miss is not",
    async ({ name, entry, nearMiss }) => {
      initRepository();
      const path = join(root, name);
      const plan = await planGit(path, root);
      expect(plan).toEqual({
        kind: "add",
        gitignorePath: join(root, ".gitignore"),
        entries: [entry, `${entry}.*.tmp`],
      });
      expect(await applyGit(plan, path, root)).toEqual({ kind: "ok" });
      expect(await isIgnored(name)).toBe(true);
      expect(await isIgnored(temporaryName(name, "0123456789ab"))).toBe(true);
      expect(await isIgnored(nearMiss)).toBe(false);
    },
  );

  // gitignore(5) does not decide these. A `#` or `!` is a comment or a negation only at the start of a line, and an
  // entry starts with `/`, so Git reads `/#x.env` and `/\#x.env` alike (the same holds for `]` outside a bracket,
  // in the `[` row above). The escape is defensive: these rows pin the entry text and show the escape is harmless.
  it.each([
    { label: "a leading #", name: "#x.env", entry: "/\\#x.env" },
    { label: "a leading !", name: "!x.env", entry: "/\\!x.env" },
  ])(
    "escapes $label in the entry, and Git still ignores the named file and its temporary file",
    async ({ name, entry }) => {
      initRepository();
      const path = join(root, name);
      const plan = await planGit(path, root);
      expect(plan).toEqual({
        kind: "add",
        gitignorePath: join(root, ".gitignore"),
        entries: [entry, `${entry}.*.tmp`],
      });
      expect(await applyGit(plan, path, root)).toEqual({ kind: "ok" });
      expect(await isIgnored(name)).toBe(true);
      expect(await isIgnored(temporaryName(name, "0123456789ab"))).toBe(true);
    },
  );

  it("adds an entry for the temporary file when only the env file is ignored", async () => {
    initRepository();
    await writeFile(join(root, ".gitignore"), "/.env.local\n");
    const path = join(root, ".env.local");
    const plan = await planGit(path, root);
    expect(plan).toEqual({
      kind: "add",
      gitignorePath: join(root, ".gitignore"),
      entries: ["/.env.local.*.tmp"],
    });
    expect(await applyGit(plan, path, root)).toEqual({ kind: "ok" });
  });

  it("ignores the temporary file writeEnvFile leaves behind when it is killed before the rename", async () => {
    initRepository();
    const path = join(root, ".env.local");
    await applyGit(await planGit(path, root), path, root);
    await commitIgnore();
    // A kill between the open and the rename leaves the temporary file, with the key in it, in the work tree.
    await writeFile(
      join(root, temporaryName(".env.local", "0a1b2c3d4e5f")),
      "DYNJANDI_PROJECT_KEY=x\n",
    );
    expect(git("status", "--porcelain", "--untracked-files=all").trim()).toBe("");
  });

  it("refuses with the temporary file's pattern named when git ignores only the env file after the entries", async () => {
    initRepository();
    const path = join(root, ".env.local");
    // Answers as git would for a `!*.tmp` no appended entry can beat: the env file is ignored, its temporary file not.
    const partial: GitRunner = async (args) => {
      const target = args[args.length - 1] ?? "";
      if (args[0] === "check-ignore" && args.includes("-v")) {
        return { code: 0, stdout: `.gitignore:2:!*.tmp\t${target}\n`, stderr: "" };
      }
      if (args[0] === "check-ignore")
        return { code: target.endsWith(".tmp") ? 1 : 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "true\n", stderr: "" };
    };
    const result = await applyGit(
      { kind: "add", gitignorePath: join(root, ".gitignore"), entries: ["/.env.local.*.tmp"] },
      path,
      root,
      { run: partial },
    );
    expect(result).toEqual({
      kind: "refuse",
      reason:
        "Git still does not ignore the temporary file .env.local.*.tmp, which holds the key until the rename; the rule that wins is .gitignore:2:!*.tmp",
      fix: "remove that rule, or choose another file with --file",
    });
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
      { kind: "add", gitignorePath: join(root, ".gitignore"), entries: ["/.env.local"] },
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
    if (plan.kind === "refuse") expect(plan.fix).toContain("--file");
  });

  it("passes the path to git as one argument, never through a shell", async () => {
    initRepository();
    const odd = join(root, "a b; touch pwned $(x).env");
    await planGit(odd, root);
    await expect(readFile(join(root, "pwned"))).rejects.toThrow();
  });
});
