import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FileRecord } from "@dynjandi/sdk";
import { getUtcNow, startOfUtc } from "@northguild/gmt/utc";

const execFileAsync = promisify(execFile);

// Layout (section 4.4):
//   <data-dir>/.gitignore                  "*"
//   <data-dir>/files/<uuid>/original       the uploaded bytes
//   <data-dir>/files/<uuid>/record.json    the FileRecord as GET /files/{id} returns it
const GITIGNORE = ".gitignore";
const FILES_DIR = "files";
const ORIGINAL = "original";
const RECORD = "record.json";
const TEMP_SUFFIX = ".tmp";

// A lowercase UUID, anchored. An id from a URL is checked against this before it reaches any path (D6).
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isFileId(value: string): boolean {
  return FILE_ID.test(value);
}

export interface NewFile {
  bytes: Uint8Array;
  contentType: string;
  originalFilename: string | null;
  focalX: number | null;
  focalY: number | null;
}

export interface StoredFile {
  record: FileRecord;
  bytes: Buffer;
}

function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === "number";
}

function isFileRecord(value: unknown): value is FileRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "contentType" in value &&
    typeof value.contentType === "string" &&
    "bytes" in value &&
    typeof value.bytes === "number" &&
    "originalFilename" in value &&
    (value.originalFilename === null || typeof value.originalFilename === "string") &&
    "source" in value &&
    typeof value.source === "string" &&
    "focalX" in value &&
    isNullableNumber(value.focalX) &&
    "focalY" in value &&
    isNullableNumber(value.focalY) &&
    "createdAt" in value &&
    typeof value.createdAt === "string"
  );
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// Writes next to the destination under a temporary name, then renames: a reader sees the whole file or none.
async function writeAtomically(path: string, data: Uint8Array | string): Promise<void> {
  const temporary = `${path}${TEMP_SUFFIX}`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}

export class FileStore {
  readonly #filesDir: string;

  constructor(filesDir: string) {
    this.#filesDir = filesDir;
  }

  /** Stores the bytes, then the record last, so a record always means a whole file (D6). */
  async create(input: NewFile): Promise<FileRecord> {
    const id = randomUUID();
    const dir = join(this.#filesDir, id);
    await mkdir(dir);
    const record: FileRecord = {
      id,
      contentType: input.contentType,
      bytes: input.bytes.byteLength,
      originalFilename: input.originalFilename,
      source: "upload",
      focalX: input.focalX,
      focalY: input.focalY,
      // The live service stores whole Unix seconds, so its createdAt is floored to the second and always ends
      // `.000Z`; dev writes the same form, where getUtcNow() alone would carry nanoseconds.
      createdAt: startOfUtc(getUtcNow(), "second", { fractionalSecondDigits: 3 }),
    };
    await writeAtomically(join(dir, ORIGINAL), input.bytes);
    await writeAtomically(join(dir, RECORD), JSON.stringify(record));
    return record;
  }

  /** `null` when there is no such file. Throws when the record exists but cannot be read. */
  async readRecord(id: string): Promise<FileRecord | null> {
    const path = join(this.#filesDir, id, RECORD);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${path} is not valid JSON`, { cause: error });
    }
    if (!isFileRecord(parsed)) throw new Error(`${path} is not a file record`);
    return parsed;
  }

  async read(id: string): Promise<StoredFile | null> {
    const record = await this.readRecord(id);
    if (record === null) return null;
    try {
      return { record, bytes: await readFile(join(this.#filesDir, id, ORIGINAL)) };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
}

// Removes the temporary names a crash left behind. Nothing else is ever deleted (D6).
async function removeTemporaryFiles(filesDir: string): Promise<void> {
  for (const id of await readdir(filesDir)) {
    const dir = join(filesDir, id);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // not a directory: not ours
    }
    for (const name of names) {
      if (name.endsWith(TEMP_SUFFIX)) await rm(join(dir, name), { force: true });
    }
  }
}

// The files git tracks under the directory. Empty outside a repository or without git: nothing to warn about.
async function trackedFiles(dataDir: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "--", "."], { cwd: dataDir });
    return stdout.split("\n").filter((line) => line !== "");
  } catch {
    return [];
  }
}

/**
 * Prepares the data directory and returns the store over it: creates it, writes the self-ignoring
 * `.gitignore` if there is none (D5), removes temporary leftovers, and warns through `warn` when git already
 * tracks files in it.
 */
export async function openStore(dataDir: string, warn: (line: string) => void): Promise<FileStore> {
  const filesDir = join(dataDir, FILES_DIR);
  await mkdir(filesDir, { recursive: true });
  try {
    await writeFile(join(dataDir, GITIGNORE), "*\n", { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  await removeTemporaryFiles(filesDir);

  const tracked = await trackedFiles(dataDir);
  if (tracked.length > 0) {
    warn(
      `warning: git tracks ${tracked.length} file(s) in ${dataDir}, so uploads may be committed; untrack them with: git rm -r --cached ${dataDir}`,
    );
  }
  return new FileStore(filesDir);
}
