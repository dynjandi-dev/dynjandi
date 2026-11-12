# @dynjandi/cli

The command line for [Dynjandi](https://cdn.dynjandi.dev), an image CDN. Its `dev` command runs a local Dynjandi
server for development, so an app can upload and fetch images without the live service.

**Status: not published.** This package is not on npm, and nothing
publishes it. `dev` stores uploads on disk and answers the upload, file-record, original and variant
routes below. Variants are rendered by the Dynjandi renderer: by default `dev` starts it with Docker, or you
can name one that is already running with `--renderer-url`. The renderer's image is private until
the organization makes it public, so until then only an account that can read it can use the Docker default.

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
| `--renderer-url <url>` | a renderer that is already running (`http:` or `https:`), instead of starting one with Docker | starts one with Docker |
| `--no-renderer` | run without a renderer; variant URLs answer `502` (cannot be combined with `--renderer-url`) | off |
| `--max-file-size <bytes>` | largest upload accepted | `26214400` |
| `--help` | print the options | |

Without a renderer flag, `dev` starts the renderer with Docker (see *The renderer*). The server listens on
`127.0.0.1` only, and there is no `--host`: it is not meant to be reachable from another machine.

### The renderer

By default `dev` needs Docker on `PATH` and its daemon running. It uses
`ghcr.io/dynjandi-dev/renderer:0.2.0`, pinned by digest. It asks Docker whether the image is here
(`docker image inspect`) and pulls it only if it is not: the first pull is about 100 MB and its progress is
printed on standard error, and every later start makes no registry request, so it works offline. It runs the
image with `docker run --rm --read-only --tmpfs /tmp`, its port published
on `127.0.0.1` only, under the name `dynjandi-renderer-<pid>-<random>`. There is no option to run another image;
to use a renderer you built yourself, start it and pass `--renderer-url`.

`dev` waits up to 60 seconds, counted from when the container starts (the pull does not count), for the
renderer's `GET /health` to answer, and only then prints the ready line, which names the image:
`renderer: docker (ghcr.io/dynjandi-dev/renderer:0.2.0)`. It stops the container when you press Ctrl-C, on
`SIGTERM`, and when start-up fails. Whatever `docker` prints stays off standard output.

Every container carries the label `dev.dynjandi.cli.owner=<hostname>:<pid>`. If `dev` is killed hard (`kill -9`),
its container keeps running; the next `dev` lists the containers with that label and stops each one that
this machine started and whose process is gone. A container of a `dev` that is still running, or one started on
another host, is left alone.

Each failure exits `1`, prints one line on standard error that names the fix and offers `--renderer-url <url>`
(a renderer you already run, such as a CI service container) and `--no-renderer` (run without one; variant URLs
answer `502`), and leaves standard output empty:

| Failure | The line says |
|---|---|
| `docker` is not on `PATH` | that `docker` was not found, and to install and start Docker |
| the daemon is not running | Docker's first line of standard error, and to start Docker |
| the image cannot be pulled, for example you cannot read it | Docker's first line of standard error, and a link to *If the image cannot be pulled* below |
| the renderer does not become healthy in 60 seconds, or its container exits | the last lines the container printed |

### If the image cannot be pulled

Today the renderer image can be read by accounts in the `dynjandi-dev` organization only; it becomes public
with `dynjandi-dev/dynjandi-core#373`. Until then, if you are not in the organization, the pull is denied and
Docker's first line of standard error says so. Two ways round it need no image:

- `--renderer-url <url>` uses a renderer that is already running (see *In CI, and with Docker Compose*).
- `--no-renderer` runs without one; variant URLs answer `502`.

If your account can read the image, sign in once with `docker login ghcr.io` (a personal access token with
`read:packages` as the password) and start `dev` again. Signing in does nothing for an account that cannot read
it. Once the image is public, no sign-in is needed.

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

### In CI, and with Docker Compose

`dev` starting a container needs Docker on the machine that runs it. Where a runner already runs the renderer
for you, skip that and name it with `--renderer-url`.

**GitHub Actions.** A job runs the renderer as a service container, which a step on the runner reaches at
`localhost:<port>`. Service containers need a Linux runner (`ubuntu-latest`), and `options` takes
`docker create` options except `--network`, so `--read-only --tmpfs /tmp` goes there. Pin the same tag and
digest `dev` uses (`RENDERER_IMAGE` in `packages/cli/src/dev/renderer-image.ts`). While the image is private,
the service needs `credentials` that can read it; once it is public, drop them.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      renderer:
        image: ghcr.io/dynjandi-dev/renderer:0.2.0@sha256:0231fbce1d35499bfeafb1b238951b164aafd6d3c61a491f0b27ee7d10e5b7d6
        ports:
          - 8080:8080
        options: --read-only --tmpfs /tmp
        credentials:
          username: ${{ github.actor }}
          password: ${{ secrets.GHCR_READ_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      # ... install and build @dynjandi/cli (it is not on npm yet), then:
      - run: node packages/cli/dist/cli.js dev --renderer-url http://localhost:8080 --port 4600 &
      # ... wait for http://127.0.0.1:4600/health, then run tests against origin http://127.0.0.1:4600
```

`GHCR_READ_TOKEN` is a secret holding a token that can read the package; it is yours to create, and nothing
in this repository holds one. If the runner has no Docker at all, use `--no-renderer`: every variant URL
answers `502`, and the rest of the server works.

**Docker Compose.** Run the renderer in your project's compose file and start `dev` on the host against it.
Publish the port on `127.0.0.1` only: the renderer is unauthenticated.

```yaml
services:
  renderer:
    image: ghcr.io/dynjandi-dev/renderer:0.2.0@sha256:0231fbce1d35499bfeafb1b238951b164aafd6d3c61a491f0b27ee7d10e5b7d6
    ports:
      - "127.0.0.1:8080:8080"
    read_only: true
    tmpfs:
      - /tmp
```

```sh
docker compose up -d renderer
dynjandi dev --renderer-url http://127.0.0.1:8080
```

### The end-to-end test

`pnpm --filter @dynjandi/cli run test:e2e` starts the built `dynjandi dev` with the real renderer image and
drives it with the real SDK. It is not part of `pnpm test`; `context/verify.md` lists its preconditions.

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
| `1` | a failure at run time, such as a port already in use or a renderer that Docker cannot start |
| `2` | a usage error: an unknown option, a value out of range, a bad URL; the message is on standard error and standard output stays empty |
