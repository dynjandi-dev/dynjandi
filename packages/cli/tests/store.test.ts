import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isFileId, openStore } from "../src/dev/store.js";

// Expected values come from the plan, not from the code under test:
// - layout: section 4.4 (`.gitignore` holding `*`, `files/<uuid>/original`, `files/<uuid>/record.json`);
// - D5: the `.gitignore` holds `*`, and `git check-ignore` (git itself, run below) must agree it ignores the
//   directory's files and itself; a tracked data directory warns on stderr;
// - D6: ids are lowercase UUIDs (`format: uuid`, crypto.randomUUID()), temporary leftovers are removed at start and
//   nothing else is deleted, an unparseable record.json is an error that names it;
// - D13 / section 9 Q7: createdAt is an ISO 8601 UTC instant (`format: date-time`); the precision is not pinned.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("store", () => {
  let root: string;
  let dataDir: string;
  let warnings: string[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dynjandi-store-"));
    dataDir = join(root, ".dynjandi");
    warnings = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const warn = (line: string) => void warnings.push(line);
  const input = {
    bytes: Buffer.from("hello"),
    contentType: "image/png",
    originalFilename: "photo.png",
    focalX: 0.42,
    focalY: 0.18,
  };

  describe("isFileId", () => {
    it("accepts a lowercase UUID and nothing else", () => {
      expect(isFileId("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
      expect(isFileId("123E4567-E89B-42D3-A456-426614174000")).toBe(false);
      expect(isFileId("..")).toBe(false);
      expect(isFileId("%2e%2e")).toBe(false);
      expect(isFileId("../123e4567-e89b-42d3-a456-426614174000")).toBe(false);
      expect(isFileId("123e4567-e89b-42d3-a456-426614174000\n")).toBe(false);
      expect(isFileId("")).toBe(false);
    });
  });

  describe("openStore", () => {
    it("creates the directory with a .gitignore holding *", async () => {
      await openStore(dataDir, warn);
      expect((await readFile(join(dataDir, ".gitignore"), "utf8")).trim()).toBe("*");
      expect(warnings).toEqual([]);
    });

    it("leaves an existing .gitignore alone", async () => {
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, ".gitignore"), "mine\n");
      await openStore(dataDir, warn);
      expect(await readFile(join(dataDir, ".gitignore"), "utf8")).toBe("mine\n");
    });

    it("makes git ignore the data directory's files and the .gitignore itself", async () => {
      execFileSync("git", ["init", "-q"], { cwd: root });
      const store = await openStore(dataDir, warn);
      const { id } = await store.create(input);
      execFileSync("git", ["check-ignore", "-q", join(".dynjandi", "files", id, "original")], {
        cwd: root,
      });
      execFileSync("git", ["check-ignore", "-q", join(".dynjandi", ".gitignore")], { cwd: root });
      expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe(
        "",
      );
    });

    it("warns on stderr when git already tracks files in the data directory", async () => {
      execFileSync("git", ["init", "-q"], { cwd: root });
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, "old.txt"), "x");
      execFileSync("git", ["add", "-f", ".dynjandi/old.txt"], { cwd: root });
      await openStore(dataDir, warn);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("git rm -r --cached");
      expect(warnings[0]).toContain(dataDir);
    });

    it("does not warn outside a git repository", async () => {
      await openStore(dataDir, warn);
      expect(warnings).toEqual([]);
    });

    it("removes temporary leftovers and deletes nothing else", async () => {
      const first = await openStore(dataDir, warn);
      const kept = await first.create(input);
      const half = "123e4567-e89b-42d3-a456-426614174000";
      await mkdir(join(dataDir, "files", half));
      await writeFile(join(dataDir, "files", half, "original.tmp"), "partial");
      await writeFile(join(dataDir, "files", half, "record.json.tmp"), "{");
      await writeFile(join(dataDir, "files", half, "original"), "orphan");
      await openStore(dataDir, warn);
      expect((await readdir(join(dataDir, "files", half))).sort()).toEqual(["original"]);
      expect((await readdir(join(dataDir, "files", kept.id))).sort()).toEqual([
        "original",
        "record.json",
      ]);
    });
  });

  describe("create and read", () => {
    it("stores the layout of section 4.4 and reads it back whole", async () => {
      const store = await openStore(dataDir, warn);
      const record = await store.create(input);
      expect(record.id).toMatch(UUID);
      expect(record).toEqual({
        id: record.id,
        contentType: "image/png",
        bytes: 5,
        originalFilename: "photo.png",
        source: "upload",
        focalX: 0.42,
        focalY: 0.18,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
      });
      expect((await readdir(join(dataDir, "files", record.id))).sort()).toEqual([
        "original",
        "record.json",
      ]);
      expect(
        JSON.parse(await readFile(join(dataDir, "files", record.id, "record.json"), "utf8")),
      ).toEqual(record);
      expect(await store.readRecord(record.id)).toEqual(record);
      const stored = await store.read(record.id);
      expect(stored?.record).toEqual(record);
      expect(stored?.bytes.toString()).toBe("hello");
    });

    it("keeps a missing name and focal point as null", async () => {
      const store = await openStore(dataDir, warn);
      const record = await store.create({
        ...input,
        originalFilename: null,
        focalX: null,
        focalY: null,
      });
      expect(await store.readRecord(record.id)).toMatchObject({
        originalFilename: null,
        focalX: null,
        focalY: null,
      });
    });

    it("never uses originalFilename as a path", async () => {
      const store = await openStore(dataDir, warn);
      const record = await store.create({ ...input, originalFilename: "../../escape.png" });
      expect(await readdir(root)).toEqual([".dynjandi"]);
      expect((await store.readRecord(record.id))?.originalFilename).toBe("../../escape.png");
    });

    it("answers null for an unknown id", async () => {
      const store = await openStore(dataDir, warn);
      const id = "123e4567-e89b-42d3-a456-426614174000";
      expect(await store.readRecord(id)).toBeNull();
      expect(await store.read(id)).toBeNull();
    });

    it("answers null for a directory with no record (a crash before the last rename)", async () => {
      const store = await openStore(dataDir, warn);
      const id = "123e4567-e89b-42d3-a456-426614174000";
      await mkdir(join(dataDir, "files", id));
      await writeFile(join(dataDir, "files", id, "original"), "orphan");
      expect(await store.readRecord(id)).toBeNull();
      expect(await store.read(id)).toBeNull();
    });

    it("throws an error naming record.json when it is unparseable", async () => {
      const store = await openStore(dataDir, warn);
      const record = await store.create(input);
      const path = join(dataDir, "files", record.id, "record.json");
      await writeFile(path, "{not json");
      await expect(store.readRecord(record.id)).rejects.toThrow(path);
      await expect(store.read(record.id)).rejects.toThrow(path);
    });

    it("throws when record.json parses but is not a file record", async () => {
      const store = await openStore(dataDir, warn);
      const record = await store.create(input);
      const path = join(dataDir, "files", record.id, "record.json");
      await writeFile(path, JSON.stringify({ id: record.id }));
      await expect(store.readRecord(record.id)).rejects.toThrow(path);
    });

    it("keeps two concurrent creates whole and apart", async () => {
      const store = await openStore(dataDir, warn);
      const a = Buffer.alloc(200_000, "a");
      const b = Buffer.alloc(200_000, "b");
      const [first, second] = await Promise.all([
        store.create({ ...input, bytes: a, originalFilename: "a" }),
        store.create({ ...input, bytes: b, originalFilename: "b" }),
      ]);
      expect(first.id).not.toBe(second.id);
      expect((await store.read(first.id))?.bytes.equals(a)).toBe(true);
      expect((await store.read(second.id))?.bytes.equals(b)).toBe(true);
      expect(first.bytes).toBe(200_000);
    });
  });
});
