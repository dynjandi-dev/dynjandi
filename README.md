# Dynjandi SDK ecosystem

The public integration surface for [Dynjandi](https://cdn.dynjandi.dev), an image CDN: an OpenAPI
description of its public-key API (upload, and reading a stored file) and a TypeScript SDK,
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
| [`packages/focal-picker`](packages/focal-picker/README.md) | `@dynjandi/focal-picker`, a focal point picker for a CMS or admin (not published to npm, and so far it holds the DOM-free point and crop-geometry helpers and the `<dynjandi-focal-picker>` element with its crop previews, without a React wrapper) |
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
