# @dynjandi/cli

`dynjandi dev` runs a local Dynjandi server, so your app and your tests can upload and fetch images without
the live service.

```sh
dynjandi dev                      # 1. start the server (Docker starts the renderer)
```

```ts
// 2. point the SDK at it
import { createClient } from "@dynjandi/sdk";

const dynjandi = createClient({
  projectKey: process.env.DYNJANDI_PROJECT_KEY ?? "dynjandi-local",
  origin: process.env.DYNJANDI_ORIGIN ?? "http://127.0.0.1:4600",
});
```

```sh
dynjandi dev -- pnpm test         # 3. run your tests against it; the server stops when they end
```

Step 3 sets `DYNJANDI_ORIGIN` and `DYNJANDI_PROJECT_KEY` for the command, stops the server and the renderer
container when the command exits, and exits with the command's code.

**Status: not published.** This package is not on npm and nothing publishes it, so `npx @dynjandi/cli` and
`npm i -g @dynjandi/cli` do not work yet. Until it is published, run the commands above from a checkout of this
repository (see *Run it from a checkout*: put `node packages/cli/dist/cli.js` where `dynjandi` is written) or
from a tarball: `pnpm --filter @dynjandi/cli pack` in the checkout writes `dynjandi-cli-0.0.0.tgz` to the
directory you ran it in; in your project, `npm i -D <path to that file>`, then put `npx dynjandi` where
`dynjandi` is written. Variants are rendered by the Dynjandi renderer, which `dev` starts with Docker, or you
can name one that is already running with `--renderer-url`. The renderer's image is private
until the organization makes it public, so until then only an account that can read it can use the Docker
default.

**Where it was run.** The quick start has been run on macOS. Linux is covered by CI for the parts that need no
Docker; the Docker path has not run on a CI runner yet. Windows has not been tried, and nothing here claims
it works there.

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
dynjandi dev [options] -- <command> [args...]
```

| Option | Meaning | Default |
|---|---|---|
| `--port <n>` | port to listen on; `0` takes a free one and the ready line shows it | `4600`; `0` under `--` |
| `--data-dir <path>` | where files are kept | `.dynjandi` in the working directory |
| `--project-key <key>` | the key the server accepts | `dynjandi-local` |
| `--renderer-url <url>` | a renderer that is already running (`http:` or `https:`), instead of starting one with Docker | starts one with Docker |
| `--no-renderer` | run without a renderer; variant URLs answer `502` (cannot be combined with `--renderer-url`) | off |
| `--max-file-size <bytes>` | largest upload accepted | `26214400` |
| `--allow-host <name>` | also answer to this `Host` name (repeatable; an exact DNS name, no port, no wildcard; see *Host names*) | none |
| `--json` | print the ready line as one JSON object (see *Output and exit codes*) | off |
| `--help` | print the options | |

Without a renderer flag, `dev` starts the renderer with Docker (see *The renderer*). The server listens on
`127.0.0.1` only, and there is no `--host`: it is not meant to be reachable from another machine. A request for a `Host` name the server does not know is refused (see *Host names*).

### Host names

The server answers only when the request's `Host` is an IP address, `localhost` or a name under `.localhost`,
`host.docker.internal` (the name a container on Docker Desktop reaches your machine by), or a name you add with
`--allow-host <name>`. The port is ignored and case does not matter. Any other name gets
`421 {"error":"Host not allowed"}`, and one line on standard error quotes the refused host and names
`--allow-host`. The check runs before every route, `/health` included.

It exists because the default key is printed and documented. A web page that has used DNS rebinding to point its
own domain at `127.0.0.1` looks same-origin with the server, and without the check it could upload with that key
and read the answers. Such a page sends its own name in `Host`, which is not on the list. If you reach the server
by a name of your own, such as an `/etc/hosts` alias, add it: `dynjandi dev --allow-host dev.test`.

### The renderer

By default `dev` needs Docker on `PATH` and its daemon running. It uses
`ghcr.io/dynjandi-dev/renderer:0.2.0`, pinned by digest. It asks Docker whether the image is here
(`docker image inspect`) and pulls it only if it is not: the first pull is about 100 MB and its progress is
printed on standard error, and every later start makes no registry request, so it works offline. It runs the
image with `docker run --rm --read-only --tmpfs /tmp --sig-proxy=false`, its port published
on `127.0.0.1` only, under the name `dynjandi-renderer-<pid>-<random>`. `--sig-proxy=false` keeps a Ctrl-C,
which reaches `docker run` from the terminal too, from stopping the container under a command that is still
finishing: only `dev` stops it. There is no option to run another image;
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
| `GET /health` | `200 {"ok":true,"service":"dynjandi-dev","version":"<this CLI's version>","renderer":"docker"\|"url"\|"none"}`. No key. It tells a `dev` server from anything else on the port, and whether variants can render. |
| any request with a `Host` the server does not know | `421 {"error":"Host not allowed"}`, before any route; see *Host names* |
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

**GitHub Actions: run `dev` on the runner.** A GitHub-hosted Ubuntu runner has Docker: the Ubuntu 24.04 runner
image's software list names Docker Client and Docker Server 28.0.4
([`actions/runner-images`, Ubuntu2404-Readme.md](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md),
read 2026-11-12). So `dev` starts the renderer itself, with the image it pins, and nobody copies a digest. While
the image is private, sign in first with a token that can read it (`GHCR_READ_TOKEN` is a secret you create;
nothing in this repository holds one), and drop that step once the image is public.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
        env:
          GHCR_READ_TOKEN: ${{ secrets.GHCR_READ_TOKEN }}
      # ... install and build @dynjandi/cli (it is not on npm yet), then:
      - run: node packages/cli/dist/cli.js dev -- pnpm test
```

`dev -- <tests>` waits for the renderer, runs your tests against `DYNJANDI_ORIGIN`, and stops the server and
the container on the way out, so there is no background process or wait loop.

**GitHub Actions: a service container, when you would rather not have `dev` start the renderer.** The job can
run the renderer as a service container, which a step reaches at `localhost:<port>`, and name it with
`--renderer-url`. Service containers need a Linux runner, and `options` takes `docker create` options except
`--network`, so `--read-only --tmpfs /tmp` goes there. This and the compose recipe below are the only places a
digest is copied: pin the same tag and digest `dev` uses (`RENDERER_IMAGE` in
`packages/cli/src/dev/renderer-image.ts`) and update it when the CLI's pin moves. While the image is private, the
service needs `credentials` that can read it; once it is public, drop them.

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
      - run: node packages/cli/dist/cli.js dev --renderer-url http://localhost:8080 -- pnpm test
```

If the runner has no Docker at all, use `--no-renderer`: every variant URL
answers `502`, and the rest of the server works.

**Docker Compose.** Also for a setup where `dev` does not start the renderer: run it in your project's compose
file and start `dev` on the host against it. Like the service container above, this copies the digest, and
nothing outside these two recipes asks you to. Publish the port on `127.0.0.1` only: the renderer is
unauthenticated.

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
dynjandi dev --renderer-url http://127.0.0.1:8080 -- pnpm test
```

### The end-to-end test

`pnpm --filter @dynjandi/cli run test:e2e` starts the built `dynjandi dev` with the real renderer image and
drives it with the real SDK. It is not part of `pnpm test`; `context/verify.md` lists its preconditions.

### Run a command against the server

```sh
dynjandi dev -- pnpm test
```

Everything after the first `--` is a command and its arguments. Once the server (and the renderer) is ready,
`dev` runs the command, without a shell and with its standard input, output and error inherited, and with two
variables added to its environment:

| Variable | Value |
|---|---|
| `DYNJANDI_ORIGIN` | the server's origin, `http://127.0.0.1:<port>`; pass it to the SDK as `origin` |
| `DYNJANDI_PROJECT_KEY` | the key the server accepts: `dynjandi-local`, or your `--project-key` value |

When the command exits, `dev` stops the server and the container and exits with the command's code, or with
`128 + n` if signal `n` ended it (`137` for `SIGKILL`, `143` for `SIGTERM`). `SIGTERM` sent to `dev` is
forwarded to the command, and so is `SIGINT` when `dev` is not in a terminal. A Ctrl-C in a terminal already
reaches the command, as it reaches every process in the job, so `dev` does not send it a second one (many test
runners read a second `SIGINT` as "force quit" and skip their teardown); it waits for the command instead.
Either way, `dev` then exits with whatever the command exits with. Because the server
and the container are stopped on the way out, there is nothing to wait for or tear down, which suits a script,
a CI step or an agent.

Under `--` three defaults change:

- `--port` defaults to `0`, a free port, so parallel checkouts and agents do not collide. The command learns
  it from `DYNJANDI_ORIGIN`.
- The ready line goes to standard error, so standard output carries only the command's output.
- The per-request lines are off. Failures and warnings still print on standard error.

`--` with no command is a usage error (exit `2`). A `--project-key` value reaches the command in
`DYNJANDI_PROJECT_KEY` and is printed nowhere.

**Env loaders and the inherited variable.** An app that also loads a `.env` file keeps the value `dev` gives it,
because these loaders do not override a variable that is already set in the environment:

| Loader | Keeps an inherited `DYNJANDI_PROJECT_KEY`? | Documentation |
|---|---|---|
| dotenv | Yes. `override` defaults to `false`: "Override any environment variables that have already been set on your machine with values from your .env file(s)", so without it the existing value stays. | dotenv README, *config* options, `override` |
| Next.js | Yes. "Environment variables are looked up in the following places, in order, stopping once the variable is found", and `process.env` is first, before every `.env*` file. | Next.js, *Environment Variables*, *Environment Variable Load Order* |
| Vite | Yes. "Environment variables that already exist when Vite is executed have the highest priority and will not be overwritten by `.env` files." | Vite, *Env Variables and Modes*, *.env Files* |

Vite exposes only variables that start with `VITE_` (the default `envPrefix`) to client code through
`import.meta.env`, and Next.js only those that start with `NEXT_PUBLIC_`. `DYNJANDI_ORIGIN` and
`DYNJANDI_PROJECT_KEY` have neither prefix, so they are available to server-side and config code and are not
put in a browser bundle; to use one in the browser, read it in a config file and pass it on deliberately.
Checked against the documentation on 2026-11-12.

### Point the SDK at the server

```ts
import { createClient } from "@dynjandi/sdk";

const dynjandi = createClient({
  projectKey: process.env.DYNJANDI_PROJECT_KEY ?? "dynjandi-local",
  origin: process.env.DYNJANDI_ORIGIN ?? "http://127.0.0.1:4600",
});
const { id, url } = await dynjandi.upload(file);
```

Run under `dynjandi dev -- <command>`, the two variables are set. Started on its own, the defaults match
`dev`'s; use the port from the ready line if you passed `--port 0`.

### Output and exit codes

Without `--`, standard output holds one line when the server is ready: the origin, the project key (only when
it is the default; a `--project-key` value is never printed), the data directory and the renderer. Everything
else goes to standard error, one line per request with its method, path and status. Under `--`, the ready line
goes to standard error and the request lines are off (see *Run a command against the server*).

`--json` prints that line as one JSON object, for a script or an agent that started `dev` in the background:

```json
{"origin":"http://127.0.0.1:55415","projectKey":"dynjandi-local","dataDir":"/work/app/.dynjandi","renderer":{"kind":"none"}}
```

`renderer` is `{"kind":"docker","image":"<tag>"}`, `{"kind":"url","url":"<url>"}` or `{"kind":"none"}`.
`projectKey` is present only when it is the default. Errors stay one line on standard error.

| Exit code | When |
|---|---|
| `0` | stopped by `SIGINT` or `SIGTERM`, or `--help`; under `--`, the command exited `0` |
| `1` | a failure at run time, such as a port already in use, a renderer that Docker cannot start, or a command that cannot be started |
| `2` | a usage error: an unknown option, a value out of range, a bad URL, `--` with no command; the message is on standard error and standard output stays empty |
| the command's code | under `--`, once the command has run |
| `128 + n` | under `--`, when signal `n` ended the command |

Under `--`, `0`, `1` and `2` can also be the command's own code. They are `dev`'s own when a failure comes
before the command starts (`1` or `2`), when a stop signal arrives during start-up (`0`, and the command is not
run), and when stopping the server after the command fails (`1`, replacing the command's code).
