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

### `srcset(fileId, options?)`

Builds the value of an `srcset` attribute: one `<url> <width>w` candidate per width, smallest first. Every URL
comes from `url()`, so `format`, `quality` and `crop` pass through unchanged. Like `url()`, it is synchronous,
makes no request, and is safe in browsers.

```ts
import { DEFAULT_WIDTHS } from "@dynjandi/sdk";

client.srcset(id); // widths: DEFAULT_WIDTHS, [320, 640, 960, 1280, 1920]
client.srcset(id, { widths: [320, 640], format: "webp", quality: 75 });
client.srcset(id, { crop: { width: 1600, height: 900 } }); // a fixed 16:9 at every width
```

```html
<img src="..." srcset="<the string srcset returned>" sizes="(min-width: 800px) 800px, 100vw" alt="..." />
```

Put `alt` and `sizes` on the `<img>` yourself; `srcset` returns the attribute value only.

`options` is `url()`'s without `width` and `height`, plus `widths`. A `height` is refused, because a fixed
height at several widths distorts the image; pass `crop` for a fixed aspect ratio, which resizes after it.
`widths` must be distinct integers from 1 to 10000, and an empty, repeated or non-integer list is refused with
a `DynjandiError` (status `0`) before any URL is built.

A `fileId` containing a comma, space or `/` cannot add a candidate: the grammar package percent-encodes it.

**What it costs.** Every width x format x crop is a separate variant, and each new variant counts against
your project's plan cap. Variants per image = widths x formats:

| Call | Variants per image |
|---|---|
| `srcset(id)` with the default ladder, one format | 5 x 1 = 5 |
| `srcset(id, { widths: [640, 1280] })` | 2 x 1 = 2 |
| the same default ladder in `avif`, `webp` and `jpeg` | 5 x 3 = 15 |

A smaller `widths` is how you spend less.

**Upscaling.** The SDK does not know the original's width (the upload response carries no dimensions), and
this SDK has not observed whether the service upscales a resize beyond it. Trim `widths` to no wider than
the original, or a ladder wider than it may produce duplicate or soft candidates.

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
