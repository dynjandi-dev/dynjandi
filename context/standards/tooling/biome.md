# Biome

## Purpose

Biome replaces both ESLint and Prettier with a single fast tool. It handles formatting, linting, and import organization.

## Why Biome

- 10–100× faster than ESLint + Prettier
- Single config, single tool, single install
- Zero-conflict formatting (no Prettier vs. ESLint format fights)
- Built-in import organizer

## Setup

```bash
pnpm add --save-dev --save-exact @biomejs/biome
pnpm biome init
```

Or copy [`templates/biome-example.json`](../templates/biome-example.json) into your project as
`biome.json` — it ships under an `-example` name so Biome does not pick it up as a live config where
these standards are vendored.

## Key Commands

```bash
# Check (lint + format check, no writes)
pnpm biome check .

# Format files
pnpm biome format --write .

# Lint files
pnpm biome lint .

# Fix lint + format in one pass
pnpm biome check --write .

# CI — no writes, exit non-zero on error
pnpm biome ci .
```

## CI Integration

```yaml
# .github/workflows/ci.yml
- name: Biome check
  run: pnpm biome ci .
```

`biome ci` is equivalent to `biome check` but never writes files and always exits non-zero on any finding.

## Editor Integration

Install the Biome VS Code extension: `biomejs.biome`

Enable format on save:

```json
// .vscode/settings.json
{
  "[typescript]": { "editor.defaultFormatter": "biomejs.biome" },
  "[typescriptreact]": { "editor.defaultFormatter": "biomejs.biome" },
  "[javascript]": { "editor.defaultFormatter": "biomejs.biome" },
  "[json]": { "editor.defaultFormatter": "biomejs.biome" },
  "editor.formatOnSave": true
}
```

## Config Reference

See [`templates/biome-example.json`](../templates/biome-example.json) for the canonical Biome config.
Rename it to `biome.json` when you copy it in.

## Migrating from ESLint + Prettier

```bash
pnpm biome migrate eslint --include-inspired
pnpm biome migrate prettier
```

Biome can automatically migrate most ESLint and Prettier configs.

## Enforcement — the gmt Date ban

A project linting with Biome installs `@northguild/gmt-biome`, which bans every `Date` API via GritQL
plugins. [`dates.md`](dates.md) has the full table and the rationale; the Biome half is:

```json
{
  "plugins": ["./node_modules/@northguild/gmt-biome/plugins/all.grit"]
}
```

Plugin paths are filesystem paths — Biome resolves no npm specifiers in `plugins`, the `.grit` extension is
required, and `extends` cannot distribute plugins because paths in an extended config resolve against the
consuming project root.

**This needs Biome 2 or newer.** `plugins` does not exist in Biome 1, and
[`../templates/biome-example.json`](../templates/biome-example.json) is still written against the 1.9.4 schema, so the
plugin cannot be dropped into that starter as it stands — migrate the config to Biome 2 first.

## DO NOT

- Run both Biome and Prettier on the same files — they will conflict
- Disable rules with `// biome-ignore` without a specific comment explaining why
- Skip `biome ci` in CI pipelines

## See Also

- [`ci.md`](ci.md) — `biome ci` as the gating command
- [`dependencies.md`](dependencies.md) — replacing ESLint + Prettier
- [`vite.md`](vite.md) — editor integration
