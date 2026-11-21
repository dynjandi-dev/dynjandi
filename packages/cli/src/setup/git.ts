import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { temporaryName } from "./env-file.js";

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
  | { kind: "add"; gitignorePath: string; entries: string[] }
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
 * D7, read only: what Git needs before the env file may be written. `envPath` is the env file's path,
 * absolute or relative to `cwd`; a relative one is resolved against `cwd`, never the process's directory.
 */
export async function planGit(
  envPath: string,
  cwd: string,
  settings: GitSettings = {},
): Promise<GitPlan> {
  // A relative path means relative to `cwd`, not to the process's directory.
  const path = resolve(cwd, envPath);
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

  // The key also sits in a temporary file beside the env file until the rename (D8), so the rule that keeps the
  // key out of Git has to cover that name too: a kill between the write and the rename leaves the file behind.
  const entries: string[] = [];
  if (!(await isIgnored(run, target, gitCwd))) entries.push(`/${escapePattern(name)}`);
  const probe = join(dirname(target), temporaryName(name, PROBE_TOKEN));
  if (!(await isIgnored(run, probe, gitCwd))) entries.push(temporaryEntry(name));
  if (entries.length === 0) return { kind: "none" };
  return { kind: "add", gitignorePath: join(directory, ".gitignore"), entries };
}

// Same length and alphabet as the token `writeEnvFile` draws, so a rule that is length- or class-sensitive agrees.
const PROBE_TOKEN = "0123456789ab";

async function isIgnored(run: GitRunner, target: string, cwd: string): Promise<boolean> {
  return (await run(["check-ignore", "-q", "--", target], cwd)).code === 0;
}

// The entry for every `temporaryName(name, <token>)`: the token is the one part that changes.
function temporaryEntry(name: string): string {
  return `/${temporaryName(escapePattern(name), "*")}`;
}

/**
 * D7: writes the `.gitignore` entry (creating the file, keeping its line endings) and asks Git again.
 * A file Git still does not ignore is refused with the rule that wins named.
 */
export async function applyGit(
  plan: GitPlan,
  envPath: string,
  cwd: string,
  settings: GitSettings = {},
): Promise<GitApplied> {
  if (plan.kind === "refuse") return plan;
  if (plan.kind !== "add") return { kind: "ok" };
  const path = resolve(cwd, envPath);
  const run = settings.run ?? spawnGit;
  const directory = dirname(path);

  await mkdir(directory, { recursive: true });
  const before = await readFile(plan.gitignorePath, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const separator = before === "" || before.endsWith("\n") ? "" : eol;
  const added = plan.entries.map((entry) => `${entry}${eol}`).join("");
  await writeFile(plan.gitignorePath, `${before}${separator}${added}`);

  const target = relative(directory, path);
  const probe = join(dirname(target), temporaryName(basename(path), PROBE_TOKEN));
  const again = await run(["check-ignore", "-q", "--", target], directory);
  const againTemporary = await run(["check-ignore", "-q", "--", probe], directory);
  if (again.code === 0 && againTemporary.code === 0) return { kind: "ok" };

  // The probe is a made-up name, so a refusal over it names the pattern and why it matters, never the probe.
  const open = again.code === 0 ? probe : target;
  const shown =
    open === probe
      ? `the temporary file ${displayPath(join(directory, temporaryName(basename(path), "*")), cwd)}, which holds the key until the rename`
      : displayPath(path, cwd);
  const why = await run(["check-ignore", "-v", "--no-index", "--", open], directory);
  const rule = why.stdout.split("\t")[0]?.trim();
  return {
    kind: "refuse",
    reason: `Git still does not ignore ${shown}${rule ? `; the rule that wins is ${rule}` : ""}`,
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
