# @dynjandi/spec

The OpenAPI 3.1 description of [Dynjandi](https://cdn.dynjandi.dev)'s upload API: `POST /upload`, plus the
variant URL grammar in prose. The document is [`openapi.yaml`](openapi.yaml).

## Stable URL

```
https://raw.githubusercontent.com/dynjandi-dev/dynjandi/main/packages/spec/openapi.yaml
```

This always serves the latest spec on `main`.

**Versioned URLs.** Each release of `@dynjandi/sdk` is tagged `sdk-v<version>` (by the publish workflow,
after the package is on npm), and the spec as it was at that release is at

```
https://raw.githubusercontent.com/dynjandi-dev/dynjandi/<tag>/packages/spec/openapi.yaml
```

for example `.../dynjandi/sdk-v0.1.1/packages/spec/openapi.yaml`. **No such tag exists yet**: the first
release is published by hand and is tagged only if someone tags it by hand (see `context/release.md`), so the
first tagged URL may not appear until the next release. The tag
names the SDK's version, not the spec's: read `info.version` in the document for the spec's own.

## The contract

- **Request.** `POST https://cdn.dynjandi.dev/upload`, `multipart/form-data`, a `file` part and optional
  `focalX` and `focalY` (both or neither, each from 0 to 1 inclusive). Authenticated by an `X-Public-Key`
  header carrying the project's public key.
- **Success.** `201` with `{ file, id, url, focalX, focalY }` and `Cache-Control: no-store`. `file` and
  `id` are the same UUID. `url` is relative (`/<id>`): resolve it against the origin you called.
  `focalX` and `focalY` are `null` when no focal point was sent.
- **Errors.** Always `{ "error": "<message>" }` with `Cache-Control: no-store`: `400` (not multipart,
  no file, bad focal point), `401` (missing or invalid key), `413` (over the file-size limit or the
  storage quota), `500` (unexpected error).
- **Server-side only.** The service sends no CORS headers, so a browser cannot call `POST /upload`
  cross-origin. Upload from a server.

The URL grammar for variants (`/<id>/-/resize/800x600/` and so on) is described in the spec's
`info.description`.

## Versioning

The spec is versioned on its own with semantic versioning, in `info.version` of `openapi.yaml`. That is the
spec's only version: this package is private and never published, so the `version` in its `package.json` is
unused and is not kept in step. It is pre-1.0, so a breaking change may land in a minor version until 1.0.0.

- **Major** (after 1.0.0; minor before it): a change that breaks an existing client, such as removing or
  renaming a field, operation or parameter, making an optional field required, or narrowing what the
  service accepts.
- **Minor**: a backwards-compatible addition, such as a new operation, a new optional field, or a new
  documented status code.
- **Patch**: a change that does not alter the contract, such as a corrected description or example.

## Linting

```bash
pnpm lint
```

runs [Redocly CLI](https://redocly.com/docs/cli/) over `openapi.yaml` with its `recommended-strict`
ruleset (recommended rules, warnings treated as errors), alongside the repository's Biome check.
