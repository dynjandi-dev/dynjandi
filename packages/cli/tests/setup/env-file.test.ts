import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  pickEnvFile,
  planEnvChange,
  readProjectId,
  writeEnvFile,
} from "../../src/setup/env-file.js";

// Expected values come from the plan (D5, D6, D8, D9) and issue #67, not from the code under test:
// - D5 step 3: the env file's DYNJANDI_PROJECT_ID is read back, with or without `export ` or quotes;
// - D6: --file, else an existing .env.local, else an existing .env, else a new .env.local;
// - D8: only the two variable lines (with or without `export `) are replaced, every other byte stays,
//   a missing variable is appended after a final newline is added, a different value is refused without
//   --force, the same value writes nothing, a name twice is ambiguous, 0600 off Windows, the rename is
//   retried on Windows (five times) and then refused with "close the file and run again".
const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);
const change = { key: KEY, id: "my-project" };

describe("pickEnvFile (D6)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dynjandi-env-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("takes the given path, relative to the working directory", async () => {
    await writeFile(join(root, ".env.local"), "");
    expect(await pickEnvFile(root, join("config", "secrets.env"))).toBe(
      join(root, "config", "secrets.env"),
    );
  });

  it("takes an existing .env.local before .env", async () => {
    await writeFile(join(root, ".env.local"), "");
    await writeFile(join(root, ".env"), "");
    expect(await pickEnvFile(root, undefined)).toBe(join(root, ".env.local"));
  });

  it("takes an existing .env when there is no .env.local", async () => {
    await writeFile(join(root, ".env"), "");
    expect(await pickEnvFile(root, undefined)).toBe(join(root, ".env"));
  });

  it("names a new .env.local when neither exists", async () => {
    expect(await pickEnvFile(root, undefined)).toBe(join(root, ".env.local"));
  });
});

describe("planEnvChange (D8, D9)", () => {
  it("appends both variables to an empty file", () => {
    expect(planEnvChange("", change, { force: false })).toEqual({
      kind: "append",
      content: `DYNJANDI_PROJECT_KEY=${KEY}\nDYNJANDI_PROJECT_ID=my-project\n`,
    });
  });

  it("adds the missing final newline before appending, keeping other lines byte for byte", () => {
    const before = "# a comment\n\nOTHER='x y'\nDYNJANDI_PUBLIC_KEY=legacy";
    expect(planEnvChange(before, change, { force: false })).toEqual({
      kind: "append",
      content: `${before}\nDYNJANDI_PROJECT_KEY=${KEY}\nDYNJANDI_PROJECT_ID=my-project\n`,
    });
  });

  it("appends with CRLF when the file uses CRLF", () => {
    const result = planEnvChange("A=1\r\nB=2\r\n", change, { force: false });
    expect(result).toEqual({
      kind: "append",
      content: `A=1\r\nB=2\r\nDYNJANDI_PROJECT_KEY=${KEY}\r\nDYNJANDI_PROJECT_ID=my-project\r\n`,
    });
  });

  it("replaces an empty variable in place without --force, keeping an export prefix and CRLF", () => {
    const before = "A=1\r\nexport DYNJANDI_PROJECT_KEY=\r\nDYNJANDI_PROJECT_ID=\r\nB=2\r\n";
    expect(planEnvChange(before, change, { force: false })).toEqual({
      kind: "replace",
      content: `A=1\r\nexport DYNJANDI_PROJECT_KEY=${KEY}\r\nDYNJANDI_PROJECT_ID=my-project\r\nB=2\r\n`,
    });
  });

  it("appends only the id when the key is already there", () => {
    expect(planEnvChange(`DYNJANDI_PROJECT_KEY=${KEY}\n`, change, { force: false })).toEqual({
      kind: "append",
      content: `DYNJANDI_PROJECT_KEY=${KEY}\nDYNJANDI_PROJECT_ID=my-project\n`,
    });
  });

  it("reports unchanged for the same key and id, with or without export or quotes", () => {
    const before = `export DYNJANDI_PROJECT_KEY="${KEY}"\nDYNJANDI_PROJECT_ID=my-project`;
    expect(planEnvChange(before, change, { force: false })).toEqual({ kind: "unchanged" });
  });

  it("refuses a different key without --force, naming the variable and not the value", () => {
    const result = planEnvChange(`DYNJANDI_PROJECT_KEY=${OTHER_KEY}\n`, change, { force: false });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") return;
    expect(result.reason).toContain("DYNJANDI_PROJECT_KEY");
    expect(result.reason).toContain("--force");
    expect(result.reason).not.toContain(OTHER_KEY);
  });

  it("refuses a different id without --force", () => {
    const result = planEnvChange(
      `DYNJANDI_PROJECT_KEY=${KEY}\nDYNJANDI_PROJECT_ID=other\n`,
      change,
      { force: false },
    );
    expect(result.kind).toBe("refuse");
  });

  it("replaces a different key with --force", () => {
    expect(
      planEnvChange(`# keep\nDYNJANDI_PROJECT_KEY=${OTHER_KEY}\nX=1\n`, change, { force: true }),
    ).toEqual({
      kind: "append",
      content: `# keep\nDYNJANDI_PROJECT_KEY=${KEY}\nX=1\nDYNJANDI_PROJECT_ID=my-project\n`,
    });
  });

  it("refuses a name that appears twice as ambiguous, even with --force", () => {
    const result = planEnvChange(`DYNJANDI_PROJECT_ID=a\nexport DYNJANDI_PROJECT_ID=b\n`, change, {
      force: true,
    });
    expect(result.kind).toBe("refuse");
    if (result.kind === "refuse") expect(result.reason).toContain("DYNJANDI_PROJECT_ID");
  });

  it("does not treat a commented-out variable as present", () => {
    const before = `# DYNJANDI_PROJECT_KEY=${OTHER_KEY}\n`;
    expect(planEnvChange(before, change, { force: false })).toEqual({
      kind: "append",
      content: `${before}DYNJANDI_PROJECT_KEY=${KEY}\nDYNJANDI_PROJECT_ID=my-project\n`,
    });
  });
});

describe("readProjectId (D5 step 3)", () => {
  it("reads a plain line", () => {
    expect(readProjectId(`DYNJANDI_PROJECT_KEY=${KEY}\nDYNJANDI_PROJECT_ID=my-project\n`)).toBe(
      "my-project",
    );
  });

  it("reads a line with an export prefix", () => {
    expect(readProjectId("export DYNJANDI_PROJECT_ID=my-project\n")).toBe("my-project");
  });

  it("strips double and single quotes", () => {
    expect(readProjectId('DYNJANDI_PROJECT_ID="my-project"\n')).toBe("my-project");
    expect(readProjectId("DYNJANDI_PROJECT_ID='my-project'\n")).toBe("my-project");
  });

  it("reads a CRLF file without the carriage return", () => {
    expect(readProjectId("DYNJANDI_PROJECT_ID=my-project\r\n")).toBe("my-project");
  });

  it("is undefined for an empty value, an empty quoted value, a missing line and a comment", () => {
    expect(readProjectId("DYNJANDI_PROJECT_ID=\n")).toBeUndefined();
    expect(readProjectId('DYNJANDI_PROJECT_ID=""\n')).toBeUndefined();
    expect(readProjectId(`DYNJANDI_PROJECT_KEY=${KEY}\n`)).toBeUndefined();
    expect(readProjectId("# DYNJANDI_PROJECT_ID=my-project\n")).toBeUndefined();
    expect(readProjectId("")).toBeUndefined();
  });
});

describe("writeEnvFile (D8)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dynjandi-envw-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes the content and leaves no temporary file", async () => {
    const path = join(root, ".env.local");
    await writeEnvFile(path, "A=1\n");
    expect(await readFile(path, "utf8")).toBe("A=1\n");
    expect(await readdir(root)).toEqual([".env.local"]);
  });

  it.skipIf(process.platform === "win32")("comes out 0600 whatever the old mode", async () => {
    const path = join(root, ".env.local");
    await writeFile(path, "old\n", { mode: 0o644 });
    await writeEnvFile(path, "new\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("keeps one complete file when two writes run at once", async () => {
    const path = join(root, ".env.local");
    const a = `${"A".repeat(200_000)}\n`;
    const b = `${"B".repeat(200_000)}\n`;
    await Promise.all([writeEnvFile(path, a), writeEnvFile(path, b)]);
    const text = await readFile(path, "utf8");
    expect([a, b]).toContain(text);
    expect(await readdir(root)).toEqual([".env.local"]);
  });

  it("retries a rename that fails with EBUSY twice on Windows, then succeeds", async () => {
    const path = join(root, ".env.local");
    let calls = 0;
    const delays: number[] = [];
    await writeEnvFile(path, "A=1\n", {
      platform: "win32",
      sleep: async (ms) => void delays.push(ms),
      rename: async (from, to) => {
        calls += 1;
        if (calls <= 2) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        const { rename } = await import("node:fs/promises");
        await rename(from, to);
      },
    });
    expect(calls).toBe(3);
    expect(delays).toHaveLength(2);
    expect(await readFile(path, "utf8")).toBe("A=1\n");
    expect(await readdir(root)).toEqual([".env.local"]);
  });

  it("gives up after five retries on Windows with a message to close the file", async () => {
    const path = join(root, ".env.local");
    let calls = 0;
    await expect(
      writeEnvFile(path, "A=1\n", {
        platform: "win32",
        sleep: async () => {},
        rename: async () => {
          calls += 1;
          throw Object.assign(new Error("busy"), { code: "EPERM" });
        },
      }),
    ).rejects.toThrow(/close the file and run again/);
    expect(calls).toBe(6);
    expect(await readdir(root)).toEqual([]);
  });

  it("does not retry off Windows", async () => {
    const path = join(root, ".env.local");
    let calls = 0;
    await expect(
      writeEnvFile(path, "A=1\n", {
        platform: "linux",
        sleep: async () => {},
        rename: async () => {
          calls += 1;
          throw Object.assign(new Error("busy"), { code: "EBUSY" });
        },
      }),
    ).rejects.toThrow("busy");
    expect(calls).toBe(1);
  });

  it("refuses to write through a symbolic link", async () => {
    await mkdir(join(root, "real"));
    const target = join(root, "real", "target");
    await writeFile(target, "keep\n");
    const link = join(root, ".env.local");
    try {
      await symlink(target, link);
    } catch {
      return; // symbolic links need a privilege on some Windows setups
    }
    await expect(writeEnvFile(link, "A=1\n")).rejects.toThrow(/symbolic link/);
    expect(await readFile(target, "utf8")).toBe("keep\n");
  });
});
