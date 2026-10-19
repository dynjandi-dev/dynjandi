import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

/**
 * The grammar package's bare entry pulls in `zod` (about 95 KB in a browser bundle); its `./builder`
 * entry does not. The code works either way, so only this test notices the bare import returning.
 */
const BARE_GRAMMAR_IMPORT = /["']@dynjandi\/transform-grammar["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|js)$/.test(entry.name) ? [path] : [];
  });
}

describe("the SDK's grammar import", () => {
  test("no source file imports the bare @dynjandi/transform-grammar entry", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      BARE_GRAMMAR_IMPORT.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
