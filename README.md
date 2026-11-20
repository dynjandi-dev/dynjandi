# Dynjandi SDK ecosystem

The public integration surface for [Dynjandi](https://cdn.dynjandi.dev), an image CDN: an OpenAPI
description of its project-key API (upload, and reading a stored file) and a TypeScript SDK,
`@dynjandi/sdk`.

**Status: early.** `@dynjandi/sdk` is published to npm (`npm i @dynjandi/sdk`).
The OpenAPI spec for that API is written
([`packages/spec`](packages/spec/README.md)). The SDK can upload files and read a stored
file back (both server-side), and build image variant URLs, including responsive `srcset`, `<picture>`
source and placeholder helpers.

## What is in here

| Path | What |
|---|---|
| [`packages/spec`](packages/spec/README.md) | The OpenAPI spec for the API (not published to npm; served from this repository) |
| [`packages/sdk`](packages/sdk/README.md) | `@dynjandi/sdk`, a TypeScript client built on `fetch`, `FormData` and `Blob` |
| [`packages/focal-picker`](packages/focal-picker/README.md) | `@dynjandi/focal-picker`, a focal point picker for a CMS or admin (not published to npm; it holds the DOM-free point and crop-geometry helpers, the `<dynjandi-focal-picker>` element with its crop previews, and a React wrapper at `./react`) |
| [`packages/cli`](packages/cli/README.md) | `@dynjandi/cli`, the `dynjandi` command line; `dynjandi setup` sets up a project and writes its key to a gitignored env file, and `dynjandi dev` runs a local server for development (on npm: `npx @dynjandi/cli`) |
| [`packages/agent-skills`](packages/agent-skills/README.md) | `@dynjandi/agent-skills`, agent skills that teach a coding agent to integrate Dynjandi and to run it locally (private, never on npm; installed from this repository, see [For coding agents](#for-coding-agents)) |
| [`packages/checker`](packages/checker/README.md) | A static page that checks which operations of an Uploadcare URL Dynjandi supports (private; deployed to GitHub Pages by `pages.yml` once Pages is enabled: <https://dynjandi-dev.github.io/dynjandi/>) |

## Using it

```bash
npm i @dynjandi/sdk
```

Once it is on npm, that is the install command; usage is in [`packages/sdk/README.md`](packages/sdk/README.md).
The spec is at
`https://raw.githubusercontent.com/dynjandi-dev/dynjandi/main/packages/spec/openapi.yaml`
([how it is versioned](packages/spec/README.md)).
For `next/image`, `@dynjandi/sdk/next` is a custom loader; see
[Using with Next.js](packages/sdk/README.md#using-with-nextjs).

To set up a project without copying a key, `dynjandi setup` (`npx @dynjandi/cli setup`; see [`packages/cli`](packages/cli/README.md))
finds or creates the project for your directory and writes its `DYNJANDI_PROJECT_KEY` to an env file Git
ignores, never printing it. It asks for your approval in the browser, or in CI reads a workspace API key from `DYNJANDI_API_KEY`.

To develop without the live service, `dynjandi dev` (`npx @dynjandi/cli dev`; see [`packages/cli`](packages/cli/README.md))
runs a local server on `127.0.0.1` that stores uploads on disk and renders variants with the Dynjandi
renderer, started with Docker or taken from `--renderer-url`. `dynjandi dev -- <command>` runs your tests
against it and stops it when they end, with `DYNJANDI_ORIGIN` and `DYNJANDI_PROJECT_KEY` set for the command;
point the SDK's `origin` and key at those. With `--containers`, `dev` also gives containers a way in, and
`DYNJANDI_CONTAINER_ORIGIN` names the origin they use.

## For coding agents

This repository holds two agent skills, `dynjandi` (integrating the SDK and the service) and
`dynjandi-local-dev` (running Dynjandi locally), and a Claude Code plugin marketplace that carries them. The
install guide, one section per vendor (Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI and Antigravity,
Windsurf, opencode, and a line for any other agent), is
[`packages/agent-skills/README.md`](packages/agent-skills/README.md#install). The skills are not on npm and
are not listed in any vendor's directory; they install from this repository once the commits that hold them
are on `main`.

## Developing

Requires Node 22 or newer and pnpm (the version is pinned in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm --filter @dynjandi/focal-picker exec playwright install --only-shell chromium
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm check:package
pnpm test
pnpm check:generated
```

`pnpm format` rewrites files to the Biome style. The commands CI and the review gate run are listed in
[`context/verify.md`](context/verify.md). A live smoke test against the real CDN runs separately and needs
a test project's key; see [`packages/sdk/README.md`](packages/sdk/README.md). A push to `main` that bumps
`packages/sdk/package.json`'s version publishes it; [`context/release.md`](context/release.md) says how.

## Licence

[MIT](LICENSE)
