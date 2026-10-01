# @dynjandi/sdk

TypeScript SDK for [Dynjandi](https://cdn.dynjandi.dev), an image CDN: upload an image, and build the URL of
any variant of it.

## Install

```bash
npm i @dynjandi/sdk
```

Releases are published by
[`publish.yml`](https://github.com/dynjandi-dev/dynjandi/blob/main/.github/workflows/publish.yml) with
npm provenance. ESM only.

## Requirements

Node 22 or newer (`engines.node`) is the only runtime the tests run on. The SDK uses `fetch`, `FormData` and `Blob` and
nothing else, so it is intended to work in browsers and Workers too, but nothing here tests either: treat
that as untested.

## Usage

```ts
import { createClient } from "@dynjandi/sdk";

const client = createClient({ publicKey: "YOUR_PUBLIC_KEY" });
```

`origin` defaults to `https://cdn.dynjandi.dev`. Pass `origin` to use another one.

### `upload(file, { focal? })`

Uploads a `Blob` or `File` and resolves with `{ file, id, url, focalX, focalY }`. `url` is absolute, on the
client's origin. `focal` is `{ x, y }`, each from 0 to 1, and both are sent together.

```ts
const { id, url } = await client.upload(file, { focal: { x: 0.42, y: 0.18 } });
```

**Uploads are server-side only.** The CDN sends no CORS headers, so a browser cannot `POST /upload`
cross-origin. Call `upload` from Node or a server.

### `url(fileId, options)`

Builds the URL of a variant. It is synchronous, makes no request, and is safe in browsers. At least one
option is required (the original is served at the `url` that `upload` returns).

```ts
client.url(id, { width: 800, height: 600, format: "webp", quality: 80 });
client.url(id, { crop: { width: 1280, height: 400, focal: { x: 0.42, y: 0.18 } } });
client.url(id, { crop: { width: 400, height: 400, position: "face,attention" }, format: "avif" });
```

The URL grammar itself comes from `@dynjandi/transform-grammar`; the SDK maps these options onto it and
never writes the grammar itself. Ranges (dimensions 1 to 10000, quality 1 to 100) are the grammar's, and
`url()` refuses what it would not accept.

## Errors

Every failure is a `DynjandiError` with `status`, `message` and, where there is one, `cause`.

```ts
import { DynjandiError } from "@dynjandi/sdk";

try {
  await client.upload(file);
} catch (error) {
  if (error instanceof DynjandiError) {
    console.error(error.status, error.message);
  }
}
```

`status` is the HTTP status of the response that caused the failure (401 invalid key, 400 bad request,
413 over the size limit or quota). It is `0` when there was no HTTP response: the network request failed,
or the SDK refused the call before sending anything (bad focal point, bad options). The public key is never
part of a message.

## Bundle size

The browser bundle of `src/index.ts`, with `@dynjandi/transform-grammar` and its `zod` included, was
**94,306 bytes gzipped** (458,625 bytes minified) on 2026-10-01, with `@dynjandi/transform-grammar` 0.1.1.
Measured from this directory:

```bash
pnpm dlx esbuild@0.28.2 --bundle --minify --platform=browser --format=esm src/index.ts | gzip -9 -c | wc -c
```

Almost all of it is the grammar package's dependency: the SDK's own code is about 1.5 KB gzipped
(add `--external:@dynjandi/transform-grammar` to the command to see it), the grammar package's own code
about 2 KB minified, and `zod` about 453 KB minified. This is a baseline to compare later changes
against, not a budget.

## Live smoke test

`tests/live/smoke.test.ts` uploads a 1x1 PNG to a dedicated test project and fetches a variant of it. It
needs the project's key in `DYNJANDI_SMOKE_PUBLIC_KEY` and the network, so `pnpm test` skips it. It fails
if the key is unset.

```bash
pnpm --filter @dynjandi/sdk run test:live
```

See [`context/verify.md`](https://github.com/dynjandi-dev/dynjandi/blob/main/context/verify.md) for loading the key locally without printing it.
`.github/workflows/smoke.yml` runs it daily and on demand.
