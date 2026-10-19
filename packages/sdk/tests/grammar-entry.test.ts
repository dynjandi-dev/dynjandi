import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

/**
 * The grammar package's bare entry pulls in `zod` (about 95 KB in a browser bundle); its `./builder`
 * entry does not. The code works either way, so only this test notices another entry being imported.
 * It allows `./builder` rather than refusing `.`, so a subpath the package adds later is refused too.
 */
const GRAMMAR_IMPORT = /["'`]@dynjandi\/transform-grammar(\/[^"'`]*)?["'`]/g;

function importsOtherThanBuilder(source: string): boolean {
  return [...source.matchAll(GRAMMAR_IMPORT)].some((match) => match[1] !== "/builder");
}

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
  test("no source file imports @dynjandi/transform-grammar except its ./builder entry", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      importsOtherThanBuilder(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
