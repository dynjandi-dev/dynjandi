# @dynjandi/cli

The command line for [Dynjandi](https://cdn.dynjandi.dev), an image CDN. It will run a local Dynjandi
server for development, so an app can upload and fetch images without the live service.

**Status: not published, and `dynjandi dev` is unfinished.** This package is not on npm, and nothing
publishes it. Today `dev` stores uploads on disk and answers the upload, file-record, original and variant
routes below. Variants are rendered by a renderer you have already started and name with `--renderer-url`.
`dev` does not start a renderer itself yet (that needs Docker and comes later), so without either renderer
flag variant URLs answer `502`.

## Run it from a checkout

```sh
pnpm install --frozen-lockfile
pnpm --filter @dynjandi/cli run build
node packages/cli/dist/cli.js dev
```

Node 22 or newer.

## `dynjandi dev`

```sh
dynjandi dev [options]
```

| Option | Meaning | Default |
|---|---|---|
| `--port <n>` | port to listen on; `0` takes a free one and the ready line shows it | `4600` |
| `--data-dir <path>` | where files are kept | `.dynjandi` in the working directory |
| `--project-key <key>` | the key the server accepts | `dynjandi-local` |
| `--renderer-url <url>` | a renderer that is already running (`http:` or `https:`) | none |
| `--no-renderer` | run without a renderer; variant URLs answer `502` (cannot be combined with `--renderer-url`) | off |
| `--max-file-size <bytes>` | largest upload accepted | `26214400` |
| `--help` | print the options | |

Give `dev` one of the two renderer flags. With neither, `dev` will start the renderer with Docker, but that is
not built yet: the ready line says so and variant URLs answer `502` with a message naming both flags. The server
listens on `127.0.0.1` only, and there is no `--host`: it is not meant to be reachable from another machine.

### The project key

`POST /upload` and `GET /files/{id}` need the project key, as the live service does. The default is
`dynjandi-local`; `--project-key <key>` replaces it. The server reads it from `X-Project-Key`, or from the
deprecated `X-Public-Key`, and treats an empty header as absent.

| Request | Answer |
|---|---|
| no key, or an empty one | `401 {"error":"Missing X-Project-Key"}` |
| any other key | `401 {"error":"Invalid project key"}` |
| both headers, with different values | `400 {"error":"X-Project-Key and X-Public-Key differ"}` |

The key opens a server on your own machine that holds your own files, so the ready line prints the default key.
A key you pass with `--project-key` is never printed, on standard output or standard error.

### Routes

Every error is `{"error": "<message>"}` with `Cache-Control: no-store`, as in the
API description (`packages/spec/openapi.yaml`).

| Request | Answer |
|---|---|
| `POST /upload` | `201 {"file","id","url","focalX","focalY"}`, with `url` set to `/<id>`. The request is `multipart/form-data` with a `file` part and, optionally, both `focalX` and `focalY` (0 to 1). No point is chosen for you: without both, the point is `null`. |
| `GET /files/{id}` | `200` with the file's record: `id`, `contentType`, `bytes`, `originalFilename`, `source` (`"upload"`), `focalX`, `focalY`, `createdAt`. Needs the key. |
| `GET /<id>` | `200` with the original bytes under the type they were uploaded with. Needs no key. |
| `GET /<id>/-/<operations>` | A variant: the original, transformed by the renderer. See *Variant URLs*. |
| `GET /health` | `200 {"ok":true}` |
| any other `GET` | `404` |
| any other method | `405 {"error":"Method not allowed"}` |

The errors of `POST /upload` are `400` (`Expected multipart/form-data`, `Invalid multipart body`,
`No file provided`, `Both focalX and focalY are required`, `Invalid focal coordinates`) and `413`
(`File exceeds maximum allowed size`, once the file is larger than `--max-file-size`). An id that is not a
lowercase UUID, or that is unknown, is `404 {"error":"File not found"}`.

Originals carry `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: default-src 'none'; sandbox`, so an uploaded SVG or HTML file is shown under its own
type but cannot run script on the server's origin. The server sends no CORS headers: upload and read from
your server, not from a browser page, as with the live service.

### Variant URLs

`GET /<id>/-/<operations>` takes the same operation chain as the live service, for example
`/<id>/-/resize/800x600/format/webp` (the grammar is in `packages/spec/openapi.yaml`, *Variant URL grammar*).
The server parses the chain with `@dynjandi/transform-grammar` (pinned to `0.3.0`), and only then looks for the
file. It sends the original's bytes to `POST /transform` on the renderer, with the parsed chain in the
`X-Dynjandi-Ops` header (base64url of its JSON), and answers with the renderer's bytes and `Content-Type`.
Variants carry the same three headers as originals. Nothing is cached on the server: each request renders
again, and the browser keeps what it fetched. There is no `Accept` negotiation: the chain's `format` decides
the type, or the renderer does when the chain names none.

| Request | Answer |
|---|---|
| a chain that does not parse, or `/<id>/-/` with none | `400` with the grammar's message, such as `Unknown operation: bogus`; the renderer is not called |
| an unknown id | `404 {"error":"File not found"}` |
| the renderer answers `4xx` or `504` | the same status and message, such as `400 Unsupported input format` |
| the renderer is unreachable or answers anything else | `502 {"error":"Renderer unavailable"}`; standard error names the URL |
| the renderer does not answer within 30 seconds | `504 {"error":"Render request timed out"}` |
| started with `--no-renderer` | `502`, with a message naming `--no-renderer` |
| started with neither renderer flag | `502`, with a message saying Docker start-up is not built yet and naming `--renderer-url` and `--no-renderer` |

With `--renderer-url`, `dev` asks the renderer's `GET /health` once at start-up and warns on standard error if
it does not answer; it starts either way. The renderer is unauthenticated, so run it on your own machine only.

**How close a local render is to production.** A local render matches production on dimensions, `Content-Type`
and status, but not on bytes: the renderer's `entropy` and `attention` crops, for one, can pick windows that
differ by a few hundred pixels. Do not use it for pixel-exact comparison.

### The data directory

Files live in `.dynjandi/` in the directory you start `dev` from (or in `--data-dir`):

```
.dynjandi/.gitignore                  holds `*`, so git ignores the directory and the file itself
.dynjandi/files/<id>/original         the uploaded bytes
.dynjandi/files/<id>/record.json      the record `GET /files/{id}` returns
```

`dev` writes the `.gitignore` the first time it uses the directory, and leaves one that is already there
alone. If git already tracks files in the directory, it warns on standard error. A file is written under a
temporary name and renamed, and its record is written last, so a record always means a whole file; temporary
leftovers from a crash are removed at start and nothing else is ever deleted. To start again, remove the
directory.

### Point the SDK at the server

```ts
import { createClient } from "@dynjandi/sdk";

const dynjandi = createClient({
  projectKey: "dynjandi-local",
  origin: "http://127.0.0.1:4600",
});
const { id, url } = await dynjandi.upload(file);
```

Use the port from the ready line if you passed `--port 0`.

### Output and exit codes

Standard output holds one line when the server is ready: the origin, the project key (only when it is the
default; a `--project-key` value is never printed), the data directory and the renderer. Everything else goes
to standard error, one line per request with its method, path and status.

| Exit code | When |
|---|---|
| `0` | stopped by `SIGINT` or `SIGTERM`, or `--help` |
| `1` | a failure at run time, such as a port already in use |
| `2` | a usage error: an unknown option, a value out of range, a bad URL; the message is on standard error and standard output stays empty |
