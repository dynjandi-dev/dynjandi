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

The package is private and is never published to npm. How to install the skills is not written here yet.

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
- **Links.** Every link into this repository names a file that exists, and every `#anchor` names a heading in
  it.

`tests/checks.test.ts` tries each check on text planted in the test, so each is shown to fail for what it is
for. A prose sentence that has gone stale is not caught: when you change an SDK or CLI README fact that a skill
repeats, change the skill in the same change.

```sh
pnpm --filter @dynjandi/agent-skills run typecheck
pnpm --filter @dynjandi/agent-skills run test
```
