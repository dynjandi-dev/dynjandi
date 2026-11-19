import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

// Expected values come from the repository's tree and from the plan's D13, not from the code under test:
// the URLs are written out here, and the paths they name are checked against the files on disk.
const REPO = resolve(fileURLToPath(import.meta.url), "../../../..");
const SKILLS_URL = "https://github.com/dynjandi-dev/dynjandi/tree/main/packages/agent-skills";
const INSTALL_URL =
  "https://github.com/dynjandi-dev/dynjandi/blob/main/packages/agent-skills/README.md#install";

async function help(): Promise<string> {
  const out: string[] = [];
  const code = await main(["--help"], { stdout: (t) => out.push(t), stderr: () => {} });
  expect(code).toBe(0);
  return out.join("");
}

describe("the pointer to the agent skills (D13)", () => {
  it("is in dynjandi --help", async () => {
    expect(await help()).toContain(SKILLS_URL);
  });

  it("is in the CLI and SDK READMEs, which are npm pages, as absolute URLs", () => {
    for (const readme of ["packages/cli/README.md", "packages/sdk/README.md"]) {
      const text = readFileSync(resolve(REPO, readme), "utf8");
      expect(text, readme).toContain("## Using Dynjandi from a coding agent");
      expect(text, readme).toContain(SKILLS_URL);
      expect(text, readme).toContain(INSTALL_URL);
    }
  });

  it("names a directory that exists and an install guide with an Install heading", () => {
    expect(existsSync(resolve(REPO, "packages/agent-skills"))).toBe(true);
    const guide = readFileSync(resolve(REPO, "packages/agent-skills/README.md"), "utf8");
    expect(guide).toMatch(/^## Install$/m);
  });
});
