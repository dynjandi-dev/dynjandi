import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

export interface GitResult {
  /** `null` when git could not be started (not installed). */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `git` with an argument array in a directory. Tests inject one; production spawns. */
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

export interface GitSettings {
  run?: GitRunner;
}

export type GitPlan =
  | { kind: "none" }
  | { kind: "add"; gitignorePath: string; entry: string }
  | { kind: "no-repo" }
  | { kind: "refuse"; reason: string; fix: string };

export type GitApplied = { kind: "ok" } | { kind: "refuse"; reason: string; fix: string };

// An argument array and no shell, so a path is never parsed by one (docker.ts is the precedent).
const spawnGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", () => resolve({ code: null, stdout, stderr }));
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });

/**
 * D7, read only: what Git needs before the env file may be written. `path` is the env file's path
 * (absolute, or relative to `cwd`).
 */
export async function planGit(
  path: string,
  cwd: string,
  settings: GitSettings = {},
): Promise<GitPlan> {
  const run = settings.run ?? spawnGit;
  const directory = dirname(path);
  const name = basename(path);

  const existing = await lstat(path).catch(() => undefined);
  if (existing?.isSymbolicLink()) {
    return {
      kind: "refuse",
      reason: `${path} is a symbolic link, and writing it would replace the link and not the file it points to`,
      fix: "pass the file it points to with --file",
    };
  }

  // The env file's directory may not exist yet: ask Git from the nearest one that does.
  const gitCwd = await existingDirectory(directory, cwd);
  const target = relative(gitCwd, path);
  const inside = await run(["rev-parse", "--is-inside-work-tree"], gitCwd);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") return { kind: "no-repo" };

  const tracked = await run(["ls-files", "--error-unmatch", "--", target], gitCwd);
  if (tracked.code === 0) {
    return {
      kind: "refuse",
      reason: `${displayPath(path, cwd)} is tracked by Git, so a key written to it would be committed`,
      fix: `git rm --cached ${displayPath(path, cwd)}`,
    };
  }

  const ignored = await run(["check-ignore", "-q", "--", target], gitCwd);
  if (ignored.code === 0) return { kind: "none" };
  return {
    kind: "add",
    gitignorePath: join(directory, ".gitignore"),
    entry: `/${escapePattern(name)}`,
  };
}

/**
 * D7: writes the `.gitignore` entry (creating the file, keeping its line endings) and asks Git again.
 * A file Git still does not ignore is refused with the rule that wins named.
 */
export async function applyGit(
  plan: GitPlan,
  path: string,
  cwd: string,
  settings: GitSettings = {},
): Promise<GitApplied> {
  if (plan.kind === "refuse") return plan;
  if (plan.kind !== "add") return { kind: "ok" };
  const run = settings.run ?? spawnGit;
  const directory = dirname(path);

  await mkdir(directory, { recursive: true });
  const before = await readFile(plan.gitignorePath, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const separator = before === "" || before.endsWith("\n") ? "" : eol;
  await writeFile(plan.gitignorePath, `${before}${separator}${plan.entry}${eol}`);

  const target = relative(directory, path);
  const again = await run(["check-ignore", "-q", "--", target], directory);
  if (again.code === 0) return { kind: "ok" };

  const why = await run(["check-ignore", "-v", "--no-index", "--", target], directory);
  const rule = why.stdout.split("\t")[0]?.trim();
  return {
    kind: "refuse",
    reason: `Git still does not ignore ${displayPath(path, cwd)}${rule ? `; the rule that wins is ${rule}` : ""}`,
    fix: "remove that rule, or choose another file with --file",
  };
}

// The env file's directory may not exist yet; ask git from the nearest one that does.
async function existingDirectory(directory: string, cwd: string): Promise<string> {
  let current = directory;
  for (;;) {
    const stats = await lstat(current).catch(() => undefined);
    if (stats?.isDirectory()) return current;
    const parent = dirname(current);
    if (parent === current) return cwd;
    current = parent;
  }
}

function displayPath(path: string, cwd: string): string {
  const shown = relative(cwd, path);
  return shown === "" || shown.startsWith("..") ? path : shown;
}

// A file name is a glob in .gitignore: escape what would otherwise be read as a pattern.
function escapePattern(name: string): string {
  return name
    .replace(/[\\*?[\]]/g, "\\$&")
    .replace(/^[#!]/, "\\$&")
    .replace(/ +$/, (spaces) => spaces.replace(/ /g, "\\ "));
}
