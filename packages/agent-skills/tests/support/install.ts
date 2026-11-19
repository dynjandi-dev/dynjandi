import { fencedBlocks } from "./markdown.js";

// The install commands a README shows, and the rules plan D7 gives them: every one names a skill or a path,
// and none installs everything or reaches into a hidden directory (that is where the planning workflow's
// skills live, `.claude/skills/` and `.agents/skills/`).

const INSTALLERS = [
  "gh skill install",
  "gh skill add",
  "gemini skills install",
  "claude plugin install",
];
const FORBIDDEN = ["--all", "--allow-hidden-dirs"];
// `gh skill install` flags that take a value, so the value is not mistaken for the skill.
const GH_VALUE_FLAGS = new Set(["--agent", "--dir", "--pin", "--scope"]);

/** Every line of a fenced block that starts an installer, with a trailing `\` continuation joined on. */
export function installCommands(markdown: string): string[] {
  const lines = fencedBlocks(markdown).flatMap((block) =>
    block.body.replace(/\\\n\s*/g, " ").split("\n"),
  );
  return lines
    .map((line) => line.trim().replace(/^\$\s+/, ""))
    .filter((line) => INSTALLERS.some((installer) => line.startsWith(installer)));
}

function positionals(command: string, valueFlags: Set<string>): string[] {
  const result: string[] = [];
  const words = command.split(/\s+/);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (valueFlags.has(word)) index += 1;
    else if (!word.startsWith("-")) result.push(word);
  }
  return result;
}

export function installProblems(markdown: string): string[] {
  const problems: string[] = [];
  for (const flag of FORBIDDEN) {
    // `--all` is a prefix of `--allow-hidden-dirs`, so the flag must end where a flag ends.
    if (new RegExp(`${flag}(?![\\w-])`).test(markdown)) problems.push(`the text contains ${flag}`);
  }
  if (/\bnpx\s+skills\b/.test(markdown)) problems.push("the text shows `npx skills` (plan D7)");
  for (const command of installCommands(markdown)) {
    if (command.startsWith("gh skill")) {
      // `gh skill install <repository> <skill or path>`: two positionals after `gh skill install`.
      if (positionals(command, GH_VALUE_FLAGS).length < 5) {
        problems.push(`names no skill or path: ${command}`);
      }
      // Plan D7: without a ref `gh` resolves "Latest tagged release", which holds no Dynjandi skill.
      if (!/\s--pin\s+\S+/.test(command) && !/\S@\S/.test(command)) {
        problems.push(`pins no ref: ${command}`);
      }
    } else if (command.startsWith("gemini skills install")) {
      if (!/\s--path\s+\S+/.test(command)) problems.push(`names no path: ${command}`);
    } else if (!/\bdynjandi@dynjandi\b/.test(command)) {
      problems.push(`names no plugin: ${command}`);
    }
  }
  return problems;
}
