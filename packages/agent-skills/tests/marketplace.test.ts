import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { installCommands, installProblems } from "./support/install.js";
import { PACKAGE_ROOT, REPOSITORY_ROOT, readText } from "./support/skills.js";

// Phase 3 of plan #44. Every expected value comes from outside the files under test:
// - the required fields are code.claude.com *Marketplace reference* (*Top-level fields*, *Plugin entries*):
//   `name`, `owner.name`, `plugins[].name`, `plugins[].source`;
// - the names `dynjandi`, `dynjandi`, the source `./packages/agent-skills` and the install id
//   `dynjandi@dynjandi` are plan D3 (the id is "the entry's `name`, an `@`, and the marketplace `name`",
//   *Create a marketplace*);
// - no `version`: with none, a relative-path plugin in a Git-hosted marketplace takes the commit SHA of the
//   installed directory as its version (*How Claude Code computes the version*), plan D3;
// - the install rules are plan D7.

interface Marketplace {
  name?: unknown;
  owner?: { name?: unknown };
  plugins?: { name?: unknown; source?: unknown; version?: unknown }[];
  version?: unknown;
}

const marketplace = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, ".claude-plugin/marketplace.json"), "utf8"),
) as Marketplace;
const entry = marketplace.plugins?.[0];
const pluginManifestPath = (source: string) =>
  join(REPOSITORY_ROOT, source, ".claude-plugin/plugin.json");

describe(".claude-plugin/marketplace.json", () => {
  test("has the required fields of the Marketplace reference", () => {
    expect(typeof marketplace.name).toBe("string");
    expect(typeof marketplace.owner?.name).toBe("string");
    expect(marketplace.plugins).toHaveLength(1);
    expect(typeof entry?.name).toBe("string");
    expect(typeof entry?.source).toBe("string");
  });

  test("is the marketplace `dynjandi` with one plugin `dynjandi` (install id dynjandi@dynjandi)", () => {
    expect(marketplace.name).toBe("dynjandi");
    expect(entry?.name).toBe("dynjandi");
  });

  test("the entry's source is the package, which holds a plugin.json of the same name", () => {
    expect(entry?.source).toBe("./packages/agent-skills");
    const source = String(entry?.source);
    expect(existsSync(join(REPOSITORY_ROOT, source))).toBe(true);
    expect(existsSync(pluginManifestPath(source))).toBe(true);
    const plugin = JSON.parse(readText(pluginManifestPath(source))) as { name?: unknown };
    expect(plugin.name).toBe(entry?.name);
  });

  test("the source is the package this test lives in", () => {
    expect(join(REPOSITORY_ROOT, String(entry?.source))).toBe(PACKAGE_ROOT.replace(/\/$/, ""));
  });

  test("carries no version, here or in plugin.json", () => {
    expect(marketplace).not.toHaveProperty("version");
    expect(entry).not.toHaveProperty("version");
    expect(JSON.parse(readText(pluginManifestPath(String(entry?.source))))).not.toHaveProperty(
      "version",
    );
  });
});

describe("the install guide (plan D7)", () => {
  const readme = readText(join(PACKAGE_ROOT, "README.md"));

  test("shows install commands", () => {
    expect(installCommands(readme).length).toBeGreaterThan(0);
  });

  test("every install command names a skill or a path, and none installs everything", () => {
    expect(installProblems(readme)).toEqual([]);
  });

  test("the Claude Code commands use the install id", () => {
    expect(installCommands(readme)).toContain("claude plugin install dynjandi@dynjandi");
  });
});

describe("the install rules, tried on planted text", () => {
  const block = (command: string) => `\`\`\`sh\n${command}\n\`\`\`\n`;

  test.each([
    [
      "--all",
      "gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin v1 --all",
    ],
    [
      "--allow-hidden-dirs",
      "gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin v1 --allow-hidden-dirs",
    ],
  ])("refuses %s, and only for that", (flag, command) => {
    expect(installProblems(block(command))).toEqual([`the text contains ${flag}`]);
  });

  test("refuses a gh skill install that names no skill, even with a value flag", () => {
    expect(
      installProblems(block("gh skill install dynjandi-dev/dynjandi --pin v1 --agent codex")),
    ).toEqual([
      "names no skill or path: gh skill install dynjandi-dev/dynjandi --pin v1 --agent codex",
    ]);
  });

  test("refuses a gh skill install with no pinned ref", () => {
    expect(
      installProblems(
        block("gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi"),
      ),
    ).toEqual([
      "pins no ref: gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi",
    ]);
  });

  test("accepts a ref given after an @", () => {
    expect(
      installProblems(
        block("gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi@v1"),
      ),
    ).toEqual([]);
  });

  test("refuses npx skills", () => {
    expect(installProblems(block("npx skills add dynjandi-dev/dynjandi"))).toEqual([
      "the text shows `npx skills` (plan D7)",
    ]);
  });

  test("refuses a gemini install with no --path", () => {
    expect(
      installProblems(block("gemini skills install https://github.com/dynjandi-dev/dynjandi.git")),
    ).toEqual([
      "names no path: gemini skills install https://github.com/dynjandi-dev/dynjandi.git",
    ]);
  });

  test("accepts a pinned install of one skill by path", () => {
    expect(
      installProblems(
        block(
          "gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin v1 --agent codex",
        ),
      ),
    ).toEqual([]);
  });
});
