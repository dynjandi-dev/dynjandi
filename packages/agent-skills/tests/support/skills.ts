import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDevOptions } from "@dynjandi/cli/dev/options";
import { parseSetupOptions } from "@dynjandi/cli/setup/options";
import { parse } from "yaml";
import { fencedBlocks, headingAnchors, withoutFencedBlocks } from "./markdown.js";

export const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
export const SNIPPETS_DIRECTORY = join(PACKAGE_ROOT, "tests/snippets");

export interface Skill {
  /** The directory's name under `skills/`. */
  directory: string;
  /** Absolute path of the skill's `SKILL.md`. */
  skillFile: string;
  /** Every markdown file the skill holds: `SKILL.md`, then `references/**`. Absolute paths. */
  markdownFiles: string[];
}

function markdownUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? markdownUnder(join(directory, entry.name))
        : entry.name.endsWith(".md")
          ? [join(directory, entry.name)]
          : [],
    )
    .sort();
}

/** Every `skills/<name>/` that has a `SKILL.md`, so a skill added later is checked with no edit here. */
export function listSkills(): Skill[] {
  const skillsDirectory = join(PACKAGE_ROOT, "skills");
  return readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ directory: entry.name, root: join(skillsDirectory, entry.name) }))
    .filter(({ root }) => existsSync(join(root, "SKILL.md")))
    .map(({ directory, root }) => ({
      directory,
      skillFile: join(root, "SKILL.md"),
      markdownFiles: [join(root, "SKILL.md"), ...markdownUnder(join(root, "references"))],
    }));
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

export function lineCount(text: string): number {
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

// --- (c) frontmatter and size, agentskills.io and code.claude.com *Skills* (plan §8) ---

// Outside Claude Code these are the only keys a SKILL.md may carry; plan D4 also drops `allowed-tools`.
const ALLOWED_KEYS = new Set(["name", "description", "license", "compatibility", "metadata"]);
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function splitFrontmatter(text: string): { frontmatter: string; body: string } | undefined {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  return match === null ? undefined : { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

export function frontmatterProblems(directory: string, text: string): string[] {
  const parts = splitFrontmatter(text);
  if (parts === undefined) return ["SKILL.md does not start with a `---` frontmatter block"];

  let data: unknown;
  try {
    data = parse(parts.frontmatter);
  } catch (error) {
    return [`frontmatter is not YAML: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return ["frontmatter is not a mapping"];
  }
  const fields = data as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of Object.keys(fields)) {
    if (!ALLOWED_KEYS.has(key)) problems.push(`frontmatter key \`${key}\` is not allowed`);
  }

  const { name, description, compatibility, metadata } = fields;
  if (typeof name !== "string") {
    problems.push("`name` is required and must be a string");
  } else {
    if (name.length < 1 || name.length > 64) problems.push("`name` must be 1 to 64 characters");
    if (!NAME_PATTERN.test(name)) {
      problems.push("`name` may hold only a-z, 0-9 and hyphens, none leading, trailing or doubled");
    }
    if (name !== directory)
      problems.push(`\`name\` (${name}) must equal its directory (${directory})`);
  }
  if (typeof description !== "string") {
    problems.push("`description` is required and must be a string");
  } else if (description.trim().length < 1 || description.length > 1024) {
    problems.push("`description` must be 1 to 1,024 characters");
  }
  if (compatibility !== undefined) {
    if (
      typeof compatibility !== "string" ||
      compatibility.length < 1 ||
      compatibility.length > 500
    ) {
      problems.push("`compatibility` must be 1 to 500 characters");
    }
  }
  if (metadata !== undefined) {
    const isStringMap =
      typeof metadata === "object" &&
      metadata !== null &&
      !Array.isArray(metadata) &&
      Object.values(metadata).every((value) => typeof value === "string");
    if (!isStringMap) problems.push("`metadata` must map string keys to string values");
  }
  return problems;
}

/** "Keep your main `SKILL.md` under 500 lines" (agentskills.io, *Progressive disclosure*). */
export function sizeProblems(text: string): string[] {
  const lines = lineCount(text);
  return lines < 500 ? [] : [`SKILL.md has ${lines} lines; keep it under 500`];
}

// --- (b) every `dynjandi dev` and `dynjandi setup` line parses through the CLI's own parsers ---

const COMMAND_LINE =
  /^(?:npx\s+@dynjandi\/cli(?:@\S+)?|node\s+\S*cli\.js|npx\s+dynjandi|dynjandi)\s+(dev|setup)(?:\s+(.*))?$/;

export interface Command {
  name: "dev" | "setup";
  args: string[];
  line: string;
}

/** The `dev` and `setup` lines of the fenced `sh` blocks, with their prefix and trailing comment stripped. */
export function commandsIn(markdown: string): Command[] {
  return fencedBlocks(markdown)
    .filter((block) => block.language === "sh")
    .flatMap((block) => block.body.split("\n"))
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .flatMap((line) => {
      const match = COMMAND_LINE.exec(line);
      const name = match?.[1];
      if (name !== "dev" && name !== "setup") return [];
      return [{ name, args: (match?.[2] ?? "").split(/\s+/).filter(Boolean), line }];
    });
}

export function commandProblems(markdown: string): string[] {
  const problems: string[] = [];
  for (const command of commandsIn(markdown)) {
    try {
      if (command.name === "dev") parseDevOptions(command.args, PACKAGE_ROOT);
      else parseSetupOptions(command.args);
    } catch (error) {
      problems.push(
        `\`${command.line}\`: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return problems;
}

// --- (a) every code snippet is a compiled file, shown character for character ---

const SNIPPET_LANGUAGES: Record<string, string> = {
  ts: ".ts",
  tsx: ".tsx",
  js: ".js",
  jsx: ".jsx",
};
const CODE_LANGUAGES = new Set([
  ...Object.keys(SNIPPET_LANGUAGES),
  "typescript",
  "javascript",
  "mjs",
]);

/** `files`: the text of each file under `tests/snippets/`, by file name. */
export function snippetProblems(markdown: string, files: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const block of fencedBlocks(markdown)) {
    if (!CODE_LANGUAGES.has(block.language)) continue;
    const extension = SNIPPET_LANGUAGES[block.language];
    if (extension === undefined) {
      problems.push(`a \`${block.language}\` block: write the language as ts, tsx, js or jsx`);
      continue;
    }
    const matches = [...files].some(
      ([name, text]) => name.endsWith(extension) && text === block.body,
    );
    if (!matches) {
      const first = block.body.split("\n")[0] ?? "";
      problems.push(
        `a \`${block.language}\` block starting \`${first}\` is no file in tests/snippets/`,
      );
    }
  }
  return problems;
}

export function readSnippets(): Map<string, string> {
  return new Map(
    readdirSync(SNIPPETS_DIRECTORY)
      .filter((name) => statSync(join(SNIPPETS_DIRECTORY, name)).isFile())
      .map((name) => [name, readText(join(SNIPPETS_DIRECTORY, name))] as const),
  );
}

// --- (d) every link into this repository resolves, and every `#anchor` names a heading ---

const REPOSITORY_URL =
  /^https:\/\/(?:github\.com\/dynjandi-dev\/dynjandi\/(?:blob|tree)|raw\.githubusercontent\.com\/dynjandi-dev\/dynjandi)\/main\/([^#?]*)(?:#(.*))?$/;

interface Target {
  path: string;
  anchor: string | undefined;
}

function targetOf(file: string, link: string): Target | undefined {
  const repositoryUrl = REPOSITORY_URL.exec(link);
  if (repositoryUrl !== null) {
    return { path: resolve(REPOSITORY_ROOT, repositoryUrl[1] ?? ""), anchor: repositoryUrl[2] };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return undefined;
  const [pathPart = "", anchor] = link.split("#");
  return { path: pathPart === "" ? file : resolve(dirname(file), pathPart), anchor };
}

export function linkProblems(file: string, markdown: string): string[] {
  const problems: string[] = [];
  const links = [...withoutFencedBlocks(markdown).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)];
  for (const match of links) {
    const link = match[1] ?? "";
    const target = targetOf(file, link);
    if (target === undefined) continue;
    const shown = relative(REPOSITORY_ROOT, target.path);
    if (!existsSync(target.path)) {
      problems.push(`${link}: ${shown} does not exist`);
      continue;
    }
    if (target.anchor === undefined || target.anchor === "") continue;
    if (!target.path.endsWith(".md")) {
      problems.push(`${link}: ${shown} is not a markdown file, so it has no headings to name`);
    } else if (!headingAnchors(readText(target.path)).has(target.anchor)) {
      problems.push(`${link}: ${shown} has no heading with the anchor #${target.anchor}`);
    }
  }
  return problems;
}

// --- (e) no skill says whether a package is on npm (plan D5, §2): the agent checks at run time ---

const PUBLISH_STATE_PHRASES = ["not on npm", "not published", "is on npm"];

export function publishStateProblems(markdown: string): string[] {
  const lower = markdown.toLowerCase();
  return PUBLISH_STATE_PHRASES.filter((phrase) => lower.includes(phrase)).map(
    (phrase) => `says "${phrase}": state the check (\`npm view\`), not the package's publish state`,
  );
}
