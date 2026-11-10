# @dynjandi/cli

The command line for [Dynjandi](https://cdn.dynjandi.dev), an image CDN. It will run a local Dynjandi
server for development, so an app can upload and fetch images without the live service.

**Status: not published, and `dynjandi dev` is unfinished.** This package is not on npm, and nothing
publishes it. Today `dev` only starts a server on `127.0.0.1` that answers `GET /health`. It stores nothing,
accepts no upload and serves no image or variant yet; those are not claimed here until they land.

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
| `--data-dir <path>` | where files will be kept | `.dynjandi` in the working directory |
| `--project-key <key>` | the key the server will accept | `dynjandi-local` |
| `--renderer-url <url>` | a renderer that is already running (`http:` or `https:`) | none |
| `--no-renderer` | run without a renderer (cannot be combined with `--renderer-url`) | off |
| `--max-file-size <bytes>` | largest upload accepted | `26214400` |
| `--help` | print the options | |

`--data-dir`, `--project-key`, `--renderer-url`, `--no-renderer` and `--max-file-size` are checked and shown
in the ready line but do nothing yet. The server listens on `127.0.0.1` only, and there is no `--host`: it is
not meant to be reachable from another machine.

What it answers today:

| Request | Answer |
|---|---|
| `GET /health` | `200 {"ok":true}` |
| any other `GET` | `404 {"error":"Not found"}` |
| any other method | `405 {"error":"Method not allowed"}` |

It sends no CORS headers.

### Output and exit codes

Standard output holds one line when the server is ready: the origin, the project key (only when it is the
default; a `--project-key` value is never printed), the data directory and the renderer. Everything else goes
to standard error, one line per request with its method, path and status.

| Exit code | When |
|---|---|
| `0` | stopped by `SIGINT` or `SIGTERM`, or `--help` |
| `1` | a failure at run time, such as a port already in use |
| `2` | a usage error: an unknown option, a value out of range, a bad URL; the message is on standard error and standard output stays empty |
