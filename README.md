# Dynjandi SDK ecosystem

The public integration surface for [Dynjandi](https://cdn.dynjandi.dev), an image CDN: an OpenAPI
description of its upload API and a TypeScript SDK, `@dynjandi/sdk`.

**Status: early.** Nothing here is published to npm yet, and both packages are currently empty shells.

## What is in here

| Path | What |
|---|---|
| `packages/spec` | The OpenAPI spec for the upload API |
| `packages/sdk` | `@dynjandi/sdk`, a TypeScript client built on `fetch`, `FormData` and `Blob` |

## Developing

Requires Node 22 or newer and pnpm (the version is pinned in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

`pnpm format` rewrites files to the Biome style. The commands CI and the review gate run are listed in
[`context/verify.md`](context/verify.md).

## Licence

[MIT](LICENSE)
