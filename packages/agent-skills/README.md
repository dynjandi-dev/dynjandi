# @dynjandi/agent-skills

Agent skills for [Dynjandi](https://cdn.dynjandi.dev), an image CDN: markdown that teaches a coding agent
to use `@dynjandi/sdk` and the service without being told how. This package is also the root of a Claude Code
plugin named `dynjandi` (`.claude-plugin/plugin.json`).

| Skill | For |
|---|---|
| [`dynjandi`](skills/dynjandi/SKILL.md) | integrating the SDK and the service: which key is which, uploads, `getFile`, variant URLs and what each costs, focal points, the Next.js loader, the `publicKey` to `projectKey` migration, where the docs are |
| [`dynjandi-local-dev`](skills/dynjandi-local-dev/SKILL.md) | running Dynjandi locally with `dynjandi dev`: getting the CLI, `dev -- <command>`, giving every client the origin, `--containers` and `apiOrigin`, the renderer, CI and Compose, what to do with an existing fake, what `dev` does not do |

Each skill is a `SKILL.md` with `references/*.md` files it loads when it needs them. It uses the portable
frontmatter only (`name` and `description`), and there are no scripts, no hooks and no MCP server, so
installing it asks nothing more of a person than reading markdown.

## What this is not

These are not the planning workflow's skills. `.claude/skills/` and `.agents/skills/` in this repository belong
to the workflow (`/feature-plan`, `/orchestrate` and the rest, described in [`AGENTS.md`](../../AGENTS.md)),
and nothing here edits them or installs from them. Every skill in this package is named `dynjandi` or
`dynjandi-<topic>`, so no name meets a workflow skill's.

The package is private and is never published to npm. The skills install from this GitHub repository, as
[the next section](#install) says.

## Install

The skills install from this GitHub repository, not from npm, and nothing here lists Dynjandi in any
directory or marketplace. Each vendor section below says where that vendor reads a skill from and gives the
command that installs it from this repository. The sources were read on **2026-11-19**; a vendor can move a
path or a command after that, and the commands for vendors other than Claude Code and `gh` were not run
(see *Notes*). Every command names one skill by its path; install both, `dynjandi` and `dynjandi-local-dev`,
by running the command once for each.

The skills live under `packages/agent-skills/skills/<name>/` and nowhere else. The `.claude/skills/` and
`.agents/skills/` directories of this repository are the planning workflow's, not Dynjandi's, so no command
below points at them.

`<ref>` in a `gh skill` command is a git tag, a commit SHA or a branch name: `gh skill install` takes all
three through `--pin`, or after an `@` on the skill (tried on 2026-11-19 against `dynjandi-dev/dynjandi`'s tag
`sdk-v0.2.0`, its `main` commit SHA and the branch `main`; a ref that does not exist fails with `No commit
found`). Without a ref `gh` installs from "Latest tagged release in the repository" (`gh skill install
--help`), so always give one. A commit SHA stays put; `main` moves.

### Claude Code

Reads `.claude/skills/`, `~/.claude/skills/` and a plugin's `skills/`; `.agents/skills/` is not listed. This
repository is a plugin marketplace named `dynjandi` (`.claude-plugin/marketplace.json`) with one plugin,
`dynjandi`, whose root is this package.

```sh
claude plugin marketplace add dynjandi-dev/dynjandi
claude plugin install dynjandi@dynjandi
```

That installs at user scope. For a project, so that teammates get it from the committed `.claude/settings.json`,
add `--scope project`:

```sh
claude plugin install dynjandi@dynjandi --scope project
```

Without a GitHub SSH key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` before `marketplace add`. The plugin has no
`version`, so Claude Code takes the commit SHA of the installed directory as its version and an update follows
the repository's commits. Sources (read 2026-11-19, URLs fetched and confirmed 2026-11-19): code.claude.com,
[*Skills*](https://code.claude.com/docs/en/skills);
[*Create a marketplace*](https://code.claude.com/docs/en/plugins/create-marketplace);
[*Host and maintain a marketplace*](https://code.claude.com/docs/en/plugins/host-marketplace);
[*Grant access to a private marketplace*](https://code.claude.com/docs/en/plugins/host-marketplace#grant-access-to-a-private-marketplace);
[*Plugin loading reference*](https://code.claude.com/docs/en/plugins/loading);
[*Marketplace reference*](https://code.claude.com/docs/en/plugins/marketplace-reference).

### OpenAI Codex

Reads `.agents/skills/` from the working directory up to the repository root, and `~/.agents/skills/`.

```sh
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin <ref> --agent codex
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi-local-dev --pin <ref> --agent codex
```

Or copy the skill directory into `.agents/skills/`. Source (read 2026-11-19): [*Build skills*](https://learn.chatgpt.com/docs/build-skills) (learn.chatgpt.com).

### Cursor

Reads `.agents/skills/`, `.cursor/skills/`, and for compatibility `.claude/skills/`, `.codex/skills/` and the
`~/` forms.

```sh
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin <ref> --agent cursor
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi-local-dev --pin <ref> --agent cursor
```

Or copy. Cursor's GitHub import wants a `.cursor-plugin/marketplace.json`, which this repository does not
have. Source (read 2026-11-19): [*Skills*](https://cursor.com/docs/skills) (cursor.com; the page is titled *Agent Skills*).

### GitHub Copilot

Reads `.github/skills/`, `.claude/skills/`, `.agents/skills/`, and `~/.copilot/skills/`, `~/.agents/skills/`.
`gh skill` needs `gh` 2.90 or later and is in preview.

```sh
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin <ref>
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi-local-dev --pin <ref>
```

Source (read 2026-11-19): [*Adding agent skills*](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) (docs.github.com; the page is titled *Adding agent skills for GitHub Copilot CLI*).

### Gemini CLI and Antigravity CLI

Gemini CLI reads `.gemini/skills/` or `.agents/skills/`; its own page says Antigravity CLI replaced it.
Antigravity reads `.agents/skills/`.

```sh
gemini skills install https://github.com/dynjandi-dev/dynjandi.git --path packages/agent-skills/skills/dynjandi --scope workspace
gemini skills install https://github.com/dynjandi-dev/dynjandi.git --path packages/agent-skills/skills/dynjandi-local-dev --scope workspace
```

For Antigravity, use `gh skill` with `--agent antigravity-cli`, or copy; no install-from-GitHub command of
`agy` itself has been verified.

```sh
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin <ref> --agent antigravity-cli
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi-local-dev --pin <ref> --agent antigravity-cli
```

Sources (read 2026-11-19): [*Skills*](https://geminicli.com/docs/cli/skills/) (geminicli.com); antigravity.google, *Migrating from Gemini CLI*, whose URL could not be confirmed (that site renders its pages in the browser and the paths tried returned 404), so it is named but not linked; the Antigravity directory above is as the plan recorded it from that page and is not re-verified.

### Windsurf (Devin desktop)

Reads `.devin/skills/`, `.agents/skills/`, and the legacy `.windsurf/skills/`.

```sh
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin <ref> --agent devin
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi-local-dev --pin <ref> --agent devin
```

Or copy. Source (read 2026-11-19): [*Skills*](https://docs.devin.ai/desktop/devin-local/customizations) (docs.windsurf.com's skills page, `docs.windsurf.com/windsurf/cascade/skills`, redirects there; the page is titled *Devin Local Customizations*).

### opencode

Reads `.opencode/skills/`, `.claude/skills/` and `.agents/skills/`.

```sh
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin <ref> --agent opencode
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi-local-dev --pin <ref> --agent opencode
```

Or copy. Source (read 2026-11-19): [*Agent Skills*](https://opencode.ai/docs/skills/) (opencode.ai; the page is titled *Skills*).

### Amp, Cline and the rest of `gh skill`'s list

Not verified separately. `gh skill install --help` lists the `--agent` values; use the same command with the
one for your agent:

```sh
gh skill install dynjandi-dev/dynjandi packages/agent-skills/skills/dynjandi --pin <ref> --agent <id>
```

### Any other agent

Copy the skill directory into `.agents/skills/` (`packages/agent-skills/skills/dynjandi/` to
`.agents/skills/dynjandi/`, and the same for `dynjandi-local-dev`). That is the project-level directory of
the cross-vendor convention that every vendor above except Claude Code reads ([*How to add skills support*](https://agentskills.io/client-implementation/adding-skills-support), read 2026-11-19). The format is the [agentskills.io](https://agentskills.io/specification)
`SKILL.md`.

### Notes

- **The Dynjandi skill paths resolve only once this branch is merged to `main`.** Until then a `gh skill`
  path above, and `claude plugin marketplace add dynjandi-dev/dynjandi`, find nothing on GitHub. A `gh skill`
  command with no ref also needs a release tag cut after the skills landed; with `--pin` of a commit SHA or
  branch that holds them it does not.
- **What was run.** The install of the real Dynjandi skills through `gh skill` has not been run, because the
  skills were not on GitHub when this was written. The `gh skill` ref forms above were tried on 2026-11-19
  against an existing skill in this repository, and the Claude Code commands were run against a local clone of
  the branch with Claude Code 2.1.328 and a throwaway configuration directory. The commands for Codex, Cursor,
  Copilot (other than through `gh skill`), Gemini CLI, Antigravity, Windsurf and opencode were not run, and
  those vendors' tools were not installed; their rows are what the cited pages said on the date given.
- **One skill at a time.** The guide installs one named skill per command, never everything in the
  repository and never from a hidden directory, so the workflow's skills are not pulled in.
  `tests/marketplace.test.ts` fails if a command in this section does otherwise.
- **No listing.** Nothing here is submitted to a vendor's directory or marketplace, and this repository
  carries no `agent-skills` topic.

## How the skills are kept true

A skill repeats facts from the [SDK](../sdk/README.md) and [CLI](../cli/README.md) READMEs and the
[API description](../spec/openapi.yaml), and links the section each comes from. `pnpm test` and
`pnpm typecheck` check what a machine can, over every `skills/*/SKILL.md` and the markdown under its
`references/`, offline and with no model:

- **Frontmatter and size** follow the [agentskills.io specification](https://agentskills.io/specification): a
  `name` of 1 to 64 characters (`a-z`, `0-9`, single hyphens) equal to its directory, a `description` of 1 to
  1,024 characters, only the keys `name`, `description`, `license`, `compatibility` and `metadata`, and a
  `SKILL.md` under 500 lines.
- **Commands.** Every `dynjandi dev` and `dynjandi setup` line in a fenced `sh` block parses through the
  CLI's own option parsers (`parseDevOptions`, `parseSetupOptions`), so a flag the CLI would refuse fails.
- **Snippets.** Every `ts`, `tsx`, `js` or `jsx` block in a skill is a file in `tests/snippets/`, shown
  character for character. `pnpm typecheck` compiles those files against the SDK's source, so a snippet the
  SDK's types no longer accept fails.
- **Marketplace and install guide.** `.claude-plugin/marketplace.json` has the required fields, its entry's
  `source` holds a `plugin.json` of the same name, neither file has a `version`, and every install command in
  *Install* names a skill or a path and pins a ref, and the text never shows the install-everything or
  hidden-directory flags of `gh skill` or an install through the `skills` npm CLI (`tests/marketplace.test.ts`).
- **Links.** Every link into this repository names a file that exists, and every `#anchor` names a heading in
  it.

`tests/checks.test.ts` tries each check on text planted in the test, so each is shown to fail for what it is
for. A prose sentence that has gone stale is not caught: when you change an SDK or CLI README fact that a skill
repeats, change the skill in the same change.

```sh
pnpm --filter @dynjandi/agent-skills run typecheck
pnpm --filter @dynjandi/agent-skills run test
```
