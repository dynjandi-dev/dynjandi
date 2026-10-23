import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// The README's hand-off section shows two files. Those files are real source in tests/handoff/, which
// `pnpm typecheck` compiles against the SDK and the picker's own entries, so the snippets cannot stop
// type-checking without a failure. This test holds the other half: the README holds each file's text,
// character for character, so the page cannot drift from what was compiled.
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("README hand-off snippets", () => {
  test.each([
    ["tests/handoff/server.ts", "ts"],
    ["tests/handoff/UploadForm.tsx", "tsx"],
  ])("%s is shown verbatim", (path, language) => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    expect(readme).toContain(`\`\`\`${language}\n${source}\`\`\``);
  });
});
