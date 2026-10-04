# @dynjandi/sdk

TypeScript SDK for [Dynjandi](https://cdn.dynjandi.dev), an image CDN: upload an image, read a stored
file's record, and build the URL of any variant of it.

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

### `getFile(fileId)`

Reads the stored record of a file and resolves with `{ id, contentType, bytes, originalFilename, source,
focalX, focalY, createdAt }`. `focalX` and `focalY` are the stored focal point, both numbers from 0 to 1 or
both `null`; `originalFilename` is `null` when the upload had none.

```ts
const file = await client.getFile(id);
console.log(file.contentType, file.focalX, file.focalY);
```

**Reads are server-side only.** The CDN sends no CORS headers, so a browser cannot read the response
cross-origin. Call `getFile` from Node or a server.

The response is `Cache-Control: no-store` and the SDK does not cache it. Fetch a record once and keep it;
do not call `getFile` per rendered image. (`upload`'s result already carries the point it was uploaded
with.) An id the project does not have, an id that is not a UUID, and a file in another project are all
`404 File not found`. `getFile` throws a `DynjandiError` for a non-2xx answer (401 missing or invalid key,
404), a network failure (status `0`), a 2xx body that is not a file record (status of the response), and an
empty id or `.`/`..` (status `0`, before any request). The id is percent-encoded into the path, so it
cannot change the route.

### `url(file, options)`

Builds the URL of a variant. `file` is a file id, or a stored file: the result of `getFile` or `upload`.
It is synchronous, makes no request, and is safe in browsers. At least one option is required (the
original is served at the `url` that `upload` returns).

```ts
client.url(id, { width: 800, height: 600, format: "webp", quality: 80 });
client.url(id, { crop: { width: 1280, height: 400, focal: { x: 0.42, y: 0.18 } } });
client.url(id, { crop: { width: 400, height: 400, position: "face,attention" }, format: "avif" });

// With a stored file, a crop crops on the file's stored focal point.
const file = await client.getFile(id); // or the result of client.upload(...)
client.url(file, { crop: { width: 1280, height: 400 } }); // .../-/crop/1280x400/focal/0.42x0.18/
```

A string id behaves exactly as above. A stored file is anything with `id`, `focalX` and `focalY` (the
`StoredFile` type), so a `getFile` result and an `upload` result both work as they are, with no cast.
`upload` already returns the point it stored, so a caller who keeps that result needs no `getFile` call;
a point changed later (in the dashboard, say) is only seen by a fresh `getFile`. For a crop with a stored
file:

- a crop that names neither `position` nor `focal` uses the stored point;
- an explicit `focal` or `position` always wins over the stored point;
- a file with no stored point (`focalX` and `focalY` both `null`) crops on `center`, as a string id does.

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
404 file not found, 413 over the size limit or quota). It is `0` when there was no HTTP response: the
network request failed, or the SDK refused the call before sending anything (bad focal point, bad
options, an empty or dot-segment file id). The public key is never
part of a message.

## Bundle size

The browser bundle of `src/index.ts`, with `@dynjandi/transform-grammar` and its `zod` included, was
**94,740 bytes gzipped** (460,180 bytes minified) on 2026-10-04, with `@dynjandi/transform-grammar` 0.1.1.
Measured from this directory:

```bash
pnpm dlx esbuild@0.28.2 --bundle --minify --platform=browser --format=esm src/index.ts | gzip -9 -c | wc -c
```

Almost all of it is the grammar package's dependency: the SDK's own code is about 1.9 KB gzipped
(add `--external:@dynjandi/transform-grammar` to the command to see it), the grammar package's own code
about 2 KB minified, and `zod` about 453 KB minified. This is a baseline to compare later changes
against, not a budget.

## Live smoke test

`tests/live/smoke.test.ts` uploads a 1x1 PNG with a focal point of (0.5, 0.5) to a dedicated test project
and fetches a variant of it. It then reads the file back with `getFile`, checks the id and the point, builds
a cropped URL from that record (which must end in `focal/0.5x0.5/`) and fetches it. It does not cover a
later change of the point, for example in the dashboard: there is no public write endpoint, so the point
can only be set at upload. It needs the project's key in `DYNJANDI_SMOKE_PUBLIC_KEY` and the network, so
`pnpm test` skips it. It fails if the key is unset.

```bash
pnpm --filter @dynjandi/sdk run test:live
```

See [`context/verify.md`](https://github.com/dynjandi-dev/dynjandi/blob/main/context/verify.md) for loading the key locally without printing it.
`.github/workflows/smoke.yml` runs it daily and on demand.
