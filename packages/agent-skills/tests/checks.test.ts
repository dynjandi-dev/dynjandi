import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { headingAnchors } from "./support/markdown.js";
import {
  commandProblems,
  commandsIn,
  frontmatterProblems,
  linkProblems,
  listSkills,
  publishStateProblems,
  REPOSITORY_ROOT,
  sizeProblems,
  snippetProblems,
} from "./support/skills.js";

// These tests run the checks over text planted here, so each check is shown to fail for the thing it is
// for. tests/skills.test.ts then runs the same checks over the real skills. Every expected value comes from
// outside the check: agentskills.io's *Specification* (`name` and `description`), the CLI's usage rules
// (`packages/cli/src/dev/options.ts`, `.../setup/options.ts`), and GitHub's anchor rule, which the SDK README
// already relies on in `../cli/README.md#from-an-app-in-a-container`.

const skillFile = (frontmatter: string) => `---\n${frontmatter}\n---\n\nBody.\n`;

describe("frontmatter (agentskills.io, Specification)", () => {
  const valid = "name: pdf-processing\ndescription: Extracts text from PDF files.";

  test("accepts the specification's valid example", () => {
    expect(frontmatterProblems("pdf-processing", skillFile(valid))).toEqual([]);
  });

  test.each(["PDF-Processing", "-pdf", "pdf-", "pdf--processing"])(
    "refuses the specification's invalid name %s",
    (name) => {
      const text = skillFile(`name: ${name}\ndescription: Extracts text.`);
      expect(frontmatterProblems(name, text)).not.toEqual([]);
    },
  );

  test("refuses a name that is not its directory", () => {
    expect(frontmatterProblems("other-name", skillFile(valid))).toEqual([
      "`name` (pdf-processing) must equal its directory (other-name)",
    ]);
  });

  test("refuses a name over 64 characters", () => {
    const name = "a".repeat(65);
    expect(frontmatterProblems(name, skillFile(`name: ${name}\ndescription: x`))).toEqual([
      "`name` must be 1 to 64 characters",
    ]);
  });

  test("allows a description of 1,024 characters and refuses 1,025", () => {
    const withLength = (length: number) => skillFile(`name: a\ndescription: ${"x".repeat(length)}`);
    expect(frontmatterProblems("a", withLength(1024))).toEqual([]);
    expect(frontmatterProblems("a", withLength(1025))).toEqual([
      "`description` must be 1 to 1,024 characters",
    ]);
  });

  test("refuses a missing description", () => {
    expect(frontmatterProblems("a", skillFile("name: a"))).toEqual([
      "`description` is required and must be a string",
    ]);
  });

  test.each(["allowed-tools: Bash(dynjandi *)", "version: 1", "user-invocable: false"])(
    "refuses the key in `%s`",
    (extra) => {
      expect(frontmatterProblems("a", skillFile(`name: a\ndescription: x\n${extra}`))).toHaveLength(
        1,
      );
    },
  );

  test("allows license, compatibility and metadata", () => {
    const text = skillFile(
      "name: a\ndescription: x\nlicense: MIT\ncompatibility: Needs Node 22\nmetadata:\n  author: someone",
    );
    expect(frontmatterProblems("a", text)).toEqual([]);
  });

  test("refuses a file with no frontmatter", () => {
    expect(frontmatterProblems("a", "# Title\n")).toHaveLength(1);
  });
});

describe("size (agentskills.io, Progressive disclosure)", () => {
  test("allows 499 lines and refuses 500", () => {
    expect(sizeProblems("x\n".repeat(499))).toEqual([]);
    expect(sizeProblems("x\n".repeat(500))).toHaveLength(1);
  });
});

describe("commands (the CLI's own parsers)", () => {
  const block = (...lines: string[]) => `\`\`\`sh\n${lines.join("\n")}\n\`\`\`\n`;

  test("finds a command behind each prefix and ignores other lines and other languages", () => {
    const found = commandsIn(
      `${block(
        "dynjandi dev -- pnpm test   # a comment",
        "npx @dynjandi/cli@0.1.0 setup --json",
        "node packages/cli/dist/cli.js dev --port 0",
        "docker compose up -d renderer",
      )}\n\`\`\`text\ndynjandi dev --bogus\n\`\`\`\n`,
    );
    expect(found.map((command) => [command.name, command.args])).toEqual([
      ["dev", ["--", "pnpm", "test"]],
      ["setup", ["--json"]],
      ["dev", ["--port", "0"]],
    ]);
  });

  test.each(["bash", "shell", "zsh", "console", ""])(
    "checks a command in a `%s` fence, with or without a `$ ` prompt",
    (language) => {
      const fence = (text: string) => `\`\`\`${language}\n${text}\n\`\`\`\n`;
      expect(commandProblems(fence("dynjandi dev --bogus"))).toHaveLength(1);
      expect(commandProblems(fence("$ npx @dynjandi/cli setup --api-key dyn_x"))).toHaveLength(1);
      expect(commandProblems(fence("$ dynjandi dev -- pnpm test"))).toEqual([]);
    },
  );

  test.each(["Bash", 'sh title="run it"', "shell copy"])(
    "reads the language of a `%s` fence from its first word",
    (info) => {
      expect(commandProblems(`\`\`\`${info}\ndynjandi dev --bogus\n\`\`\`\n`)).toHaveLength(1);
    },
  );

  test("accepts lines the CLI README shows", () => {
    const markdown = block(
      "dynjandi dev",
      "dynjandi dev -- pnpm test",
      "dynjandi dev --containers -- docker compose up --no-log-prefix",
      "dynjandi dev --renderer-url http://127.0.0.1:8080 -- pnpm test",
      "npx @dynjandi/cli setup --name my-app",
      "npx @dynjandi/cli setup --dry-run",
    );
    expect(commandProblems(markdown)).toEqual([]);
  });

  test("refuses an option `dynjandi dev` does not have", () => {
    const problems = commandProblems(block("dynjandi dev --bogus"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("`dynjandi dev --bogus`");
  });

  test("refuses `--host`, which `dev` deliberately does not take", () => {
    expect(commandProblems(block("dynjandi dev --host 0.0.0.0"))).toHaveLength(1);
  });

  test("refuses `--` with no command", () => {
    expect(commandProblems(block("dynjandi dev --"))).toHaveLength(1);
  });

  test("refuses `setup --api-key`, which the CLI README says is a usage error", () => {
    expect(commandProblems(block("npx @dynjandi/cli setup --api-key dyn_x"))).toHaveLength(1);
  });

  test("refuses `setup --project` and `--name` together", () => {
    expect(commandProblems(block("dynjandi setup --project a --name b"))).toHaveLength(1);
  });
});

describe("snippets (shown exactly as compiled)", () => {
  const files = new Map([
    ["a.ts", "export const a = 1;\n"],
    ["b.js", "export default 2;\n"],
  ]);

  test("accepts a block equal to a file of its language", () => {
    expect(snippetProblems("```ts\nexport const a = 1;\n```\n", files)).toEqual([]);
    expect(snippetProblems("```js\nexport default 2;\n```\n", files)).toEqual([]);
  });

  test("refuses a block that differs from the file by one character", () => {
    expect(snippetProblems("```ts\nexport const a = 2;\n```\n", files)).toHaveLength(1);
  });

  test("refuses a block whose text is a file of another language", () => {
    expect(snippetProblems("```js\nexport const a = 1;\n```\n", files)).toHaveLength(1);
  });

  test("refuses a language the check does not map to a file extension", () => {
    expect(snippetProblems("```typescript\nexport const a = 1;\n```\n", files)).toHaveLength(1);
  });

  test.each(["tsx", "jsx"])(
    "refuses a `%s` block, which this package cannot compile",
    (language) => {
      expect(
        snippetProblems(`\`\`\`${language}\nexport const a = 1;\n\`\`\`\n`, files),
      ).toHaveLength(1);
    },
  );

  test("reads a fence's language lower-cased, so a `TS` block is checked too", () => {
    expect(snippetProblems("```TS\nexport const a = 2;\n```\n", files)).toHaveLength(1);
    expect(snippetProblems("```TS\nexport const a = 1;\n```\n", files)).toEqual([]);
  });

  test("leaves blocks in other languages alone", () => {
    expect(snippetProblems("```sh\nls\n```\n```json\n{}\n```\n", files)).toEqual([]);
  });
});

describe("links", () => {
  const here = join(REPOSITORY_ROOT, "packages/agent-skills/skills/x/SKILL.md");
  const blob = "https://github.com/dynjandi-dev/dynjandi/blob/main";

  test("accepts a repository URL to a file and to a heading that exists", () => {
    const markdown = [
      `[a](${blob}/packages/cli/README.md#run-a-command-against-the-server)`,
      `[b](${blob}/packages/sdk/README.md#uploadfile--focal-)`,
      `[c](${blob}/packages/cli/README.md#from-an-app-in-a-container)`,
      "[d](https://raw.githubusercontent.com/dynjandi-dev/dynjandi/main/packages/spec/openapi.yaml)",
      "[e](https://example.com/missing#nothing)",
    ].join("\n\n");
    expect(linkProblems(here, markdown)).toEqual([]);
  });

  test("refuses a link to a heading that does not exist", () => {
    const problems = linkProblems(here, `[a](${blob}/packages/cli/README.md#no-such-heading)`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("#no-such-heading");
  });

  test("refuses a link to a file that does not exist", () => {
    expect(linkProblems(here, `[a](${blob}/packages/cli/NOPE.md)`)).toHaveLength(1);
    expect(linkProblems(here, "[a](references/nope.md)")).toHaveLength(1);
  });

  test("resolves a relative link from the file's own directory", () => {
    expect(
      linkProblems(
        join(REPOSITORY_ROOT, "packages/sdk/README.md"),
        "[a](../cli/README.md#dynjandi-dev)",
      ),
    ).toEqual([]);
  });

  test("does not read a link inside a fenced block", () => {
    expect(linkProblems(here, "```md\n[a](references/nope.md)\n```\n")).toEqual([]);
  });
});

describe("heading anchors (GitHub's rule)", () => {
  test("lower-cases, drops punctuation, turns spaces into hyphens, numbers repeats", () => {
    expect([
      ...headingAnchors(
        "# A `Code` title\n## What it costs?\n## What it costs?\n```\n# not a heading\n```\n",
      ),
    ]).toEqual(["a-code-title", "what-it-costs", "what-it-costs-1"]);
  });
});

describe("publish state (plan D5)", () => {
  test.each(["not on npm", "Not Published", "it is on npm", "this is not published yet"])(
    "refuses %s",
    (phrase) => {
      expect(publishStateProblems(`Some text, ${phrase}, more.`)).toHaveLength(1);
    },
  );

  test("accepts a check the agent runs", () => {
    expect(
      publishStateProblems(
        "Run `npm view @dynjandi/cli version`; a 404 means there is no release yet.",
      ),
    ).toEqual([]);
  });
});

describe("listing the skills (agentskills.io, Directory structure)", () => {
  test("lists a skill that is only a SKILL.md, since references/ is optional", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-skills-"));
    try {
      mkdirSync(join(root, "solo"));
      writeFileSync(join(root, "solo/SKILL.md"), skillFile("name: solo\ndescription: Alone."));
      mkdirSync(join(root, "with-references/references/deep"), { recursive: true });
      writeFileSync(join(root, "with-references/SKILL.md"), skillFile("name: with-references"));
      writeFileSync(join(root, "with-references/references/deep/a.md"), "# A\n");
      mkdirSync(join(root, "not-a-skill"));

      const listed = listSkills(root).sort((a, b) => a.directory.localeCompare(b.directory));
      expect(listed).toEqual([
        {
          directory: "solo",
          skillFile: join(root, "solo/SKILL.md"),
          markdownFiles: [join(root, "solo/SKILL.md")],
        },
        {
          directory: "with-references",
          skillFile: join(root, "with-references/SKILL.md"),
          markdownFiles: [
            join(root, "with-references/SKILL.md"),
            join(root, "with-references/references/deep/a.md"),
          ],
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
