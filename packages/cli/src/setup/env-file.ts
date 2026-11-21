import { randomBytes } from "node:crypto";
import { rename as fsRename, lstat, open, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const KEY_NAME = "DYNJANDI_PROJECT_KEY";
const ID_NAME = "DYNJANDI_PROJECT_ID";

// D8: a rename over a file another process holds open fails with one of these on Windows.
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRIES = 5;
const RENAME_RETRY_DELAY_MS = 100;

/**
 * D7: the name of the temporary file `writeEnvFile` creates beside `name`. It holds the key until the rename, so
 * `planGit` asks Git about this exact shape and adds an entry for it (`temporaryEntry`) when nothing ignores it.
 */
export function temporaryName(name: string, token: string): string {
  return `${name}.${token}.tmp`;
}

export interface EnvChange {
  key: string;
  id: string;
}

export type EnvPlan =
  | { kind: "unchanged" }
  | { kind: "replace"; content: string }
  | { kind: "append"; content: string }
  | { kind: "refuse"; reason: string };

/** D6: `--file`, else an existing `.env.local`, else an existing `.env`, else a new `.env.local`. */
export async function pickEnvFile(cwd: string, given: string | undefined): Promise<string> {
  if (given !== undefined) return resolve(cwd, given);
  for (const name of [".env.local", ".env"]) {
    const candidate = resolve(cwd, name);
    if (await exists(candidate)) return candidate;
  }
  return resolve(cwd, ".env.local");
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

interface Line {
  text: string;
  eol: string;
}

// Splits into lines keeping each line's own ending, so joining them gives back the input exactly.
function splitLines(content: string): Line[] {
  const lines: Line[] = [];
  const pattern = /([^\n]*?)(\r?\n|$)/gy;
  while (pattern.lastIndex < content.length) {
    const match = pattern.exec(content);
    if (match === null) break;
    lines.push({ text: match[1] ?? "", eol: match[2] ?? "" });
  }
  return lines;
}

const VARIABLE_LINE =
  /^(\s*(?:export\s+)?)(DYNJANDI_PROJECT_KEY|DYNJANDI_PROJECT_ID)(\s*=\s*)(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if (trimmed.length >= 2 && (first === '"' || first === "'") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * The `DYNJANDI_PROJECT_ID` the file holds, which D5's step 3 reads so a plain re-run reconnects. `undefined` when
 * the file has no such line or it is empty. The first line wins; `planEnvChange` refuses a name that appears twice.
 */
export function readProjectId(content: string): string | undefined {
  for (const line of splitLines(content)) {
    const match = VARIABLE_LINE.exec(line.text);
    if (match?.[2] !== ID_NAME) continue;
    const value = unquote(match[4] ?? "");
    return value === "" ? undefined : value;
  }
  return undefined;
}

/**
 * D8 and D9 over the file's text. Pure: nothing is read or written here. A different value is refused
 * without `force`, and a refusal names the variable, never the value it holds.
 */
export function planEnvChange(
  content: string,
  change: EnvChange,
  options: { force: boolean },
): EnvPlan {
  const wanted = new Map([
    [KEY_NAME, change.key],
    [ID_NAME, change.id],
  ]);
  const lines = splitLines(content);
  const found = new Map<string, number>();

  for (const [index, line] of lines.entries()) {
    const match = VARIABLE_LINE.exec(line.text);
    const name = match?.[2];
    if (name === undefined) continue;
    if (found.has(name)) {
      return {
        kind: "refuse",
        reason: `${name} appears more than once in the env file; remove the extra line and run again`,
      };
    }
    found.set(name, index);
  }

  const edited = lines.map((line) => ({ ...line }));
  let replaced = false;
  for (const [name, value] of wanted) {
    const index = found.get(name);
    if (index === undefined) continue;
    const line = edited[index];
    const match = line === undefined ? null : VARIABLE_LINE.exec(line.text);
    if (line === undefined || match === null) continue;
    const current = unquote(match[4] ?? "");
    if (current === value) continue;
    if (current !== "" && !options.force) {
      return {
        kind: "refuse",
        reason: `${name} in the env file already holds a different value, which belongs to another project; pass --force to replace it`,
      };
    }
    line.text = `${match[1] ?? ""}${name}${match[3] ?? ""}${value}`;
    replaced = true;
  }

  const missing = [...wanted].filter(([name]) => !found.has(name));
  if (missing.length === 0 && !replaced) return { kind: "unchanged" };

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const last = edited[edited.length - 1];
  if (missing.length > 0 && last !== undefined && last.eol === "") last.eol = eol;
  const kept = edited.map((line) => line.text + line.eol).join("");
  if (missing.length === 0) return { kind: "replace", content: kept };
  const appended = missing.map(([name, value]) => `${name}=${value}${eol}`).join("");
  return { kind: "append", content: kept + appended };
}

export interface WriteEnvFileOptions {
  /** Tests inject these; production uses the platform's. */
  rename?: (from: string, to: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  platform?: NodeJS.Platform;
}

/**
 * D8: the content goes to a temporary file beside the target (`wx`, mode 0600, flushed) and is renamed
 * over it, so a reader sees the old file or the new one and never half of either.
 */
export async function writeEnvFile(
  path: string,
  content: string,
  options: WriteEnvFileOptions = {},
): Promise<void> {
  const rename = options.rename ?? fsRename;
  const sleep = options.sleep ?? ((ms: number) => delay(ms));
  const platform = options.platform ?? process.platform;

  // The atomic replace would replace a link and leave its target alone (D7), so refuse before writing.
  const existing = await lstat(path).catch((error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing?.isSymbolicLink()) {
    throw new Error(`${path} is a symbolic link; pass the file it points to with --file`);
  }

  const temporary = join(
    dirname(path),
    temporaryName(basename(path), randomBytes(6).toString("hex")),
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
  await handle.close();

  try {
    await renameWithRetry(rename, sleep, platform, temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function renameWithRetry(
  rename: (from: string, to: string) => Promise<void>,
  sleep: (ms: number) => Promise<void>,
  platform: NodeJS.Platform,
  from: string,
  to: string,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const retryable =
        platform === "win32" &&
        isErrnoException(error) &&
        RETRYABLE_RENAME_CODES.has(error.code ?? "");
      if (!retryable) throw error;
      if (attempt >= RENAME_RETRIES) {
        throw new Error(`${to} is in use by another program; close the file and run again`, {
          cause: error,
        });
      }
      await sleep(RENAME_RETRY_DELAY_MS);
    }
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
