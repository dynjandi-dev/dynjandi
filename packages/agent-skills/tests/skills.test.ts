import { relative } from "node:path";
import { describe, expect, test } from "vitest";
import {
  commandProblems,
  frontmatterProblems,
  linkProblems,
  listSkills,
  PACKAGE_ROOT,
  readSnippets,
  readText,
  sizeProblems,
  snippetProblems,
} from "./support/skills.js";

// The checks of plan D6 over every `skills/*/SKILL.md` and the markdown under its `references/`, so a skill
// added later is covered with no edit here. The checks themselves are tried against planted text in
// tests/checks.test.ts.

const skills = listSkills();
const snippets = readSnippets();

test("finds the dynjandi skill", () => {
  expect(skills.map((skill) => skill.directory)).toContain("dynjandi");
});

describe.each(skills)("skill $directory", (skill) => {
  test("frontmatter follows the specification", () => {
    expect(frontmatterProblems(skill.directory, readText(skill.skillFile))).toEqual([]);
  });

  test("SKILL.md stays under 500 lines", () => {
    expect(sizeProblems(readText(skill.skillFile))).toEqual([]);
  });

  describe.each(skill.markdownFiles.map((file) => [relative(PACKAGE_ROOT, file), file] as const))(
    "%s",
    (_shown, file) => {
      const text = readText(file);

      test("every dynjandi dev and dynjandi setup command parses", () => {
        expect(commandProblems(text)).toEqual([]);
      });

      test("every code block is a compiled snippet, shown exactly", () => {
        expect(snippetProblems(text, snippets)).toEqual([]);
      });

      test("every link resolves, and every anchor names a heading", () => {
        expect(linkProblems(file, text)).toEqual([]);
      });
    },
  );
});
