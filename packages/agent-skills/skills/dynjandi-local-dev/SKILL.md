---
name: dynjandi-local-dev
description: >-
  Run Dynjandi, an image CDN, locally with no live service: start a local Dynjandi with `dynjandi dev` (from
  @dynjandi/cli), run an app, tests or e2e against it offline with `dynjandi dev -- <command>`, point every
  @dynjandi/sdk client at DYNJANDI_ORIGIN, reach it from an app in a Docker container with --containers,
  and set it up in CI or Docker Compose. Use when a task says to run the app or its tests without the
  live CDN, offline, locally or in CI, or finds a fake, mock or stand-in of Dynjandi (a hand-written
  upload server, a stubbed createClient) and has to decide whether to keep it. For uploads, variant URLs,
  focal points and keys, use the dynjandi skill.
---

# Dynjandi, locally

`dynjandi dev` is a Dynjandi server on this machine. An app or a test uploads and fetches images against it
instead of the live service, with the same SDK calls
([CLI, `dynjandi dev`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#dynjandi-dev)). This skill states the rules that are easy to get wrong; the
detail is in the CLI README, linked per section. How to call the SDK is the `dynjandi` skill's.

## 1. Get the CLI

Check at run time; do not assume. Run `npm view @dynjandi/cli version`.

- A version printed: use `npx @dynjandi/cli@<that version>` where `dynjandi` is written below.
- A 404: there is no release yet. Build it from a checkout of `https://github.com/dynjandi-dev/dynjandi` and use
  `node packages/cli/dist/cli.js` where `dynjandi` is written (Node 22 or newer; the build commands are in
  [CLI, run it from a checkout](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#run-it-from-a-checkout)).

## 2. Run the command against it

Prefer this. It starts the server on a free port, waits until it is ready, runs your command with
`DYNJANDI_ORIGIN` and `DYNJANDI_PROJECT_KEY` set, stops the server and the renderer when the command ends, and
exits with the command's code, so there is nothing to tear down
([CLI, run a command against the server](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#run-a-command-against-the-server)):

```sh
dynjandi dev -- pnpm test
```

`DYNJANDI_PROJECT_KEY` is `dynjandi-local` unless `--project-key` changed it, and that key is for this local
server only. Never print or `cat` an env file to look at a key, and never put the key in a `VITE_` or
`NEXT_PUBLIC_` variable ([CLI, env loaders](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#run-a-command-against-the-server)).

To keep the server running while you work, start it alone and read the origin from its one JSON line:

```sh
dynjandi dev --json --port 0
```

The object has `origin`, `dataDir` and `renderer`, and `projectKey` only when it is the default
([CLI, output and exit codes](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#output-and-exit-codes)). Stop it with `SIGINT` or `SIGTERM`.
Started alone, it uses port `4600` unless `--port` says otherwise, and a port already in use is exit `1`.
If the person already has one running, use it rather than starting a second.

## 3. Give every client the origin

An SDK client sends uploads to its `origin` and builds every URL on its `origin`, and the default is production
([SDK, usage](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#usage)). So pass `DYNJANDI_ORIGIN` to **every** `createClient`, including a client made
only to build URLs. If one is missed, its URLs point at production while the uploads went to the local server.
Find every `createClient` in the project before you finish, and make them all through one function:

```ts
import { createClient } from "@dynjandi/sdk";

// Make every client through this: one that only builds URLs needs the origin too, or its URLs
// point at production while the uploads went to the local server. Unset, `origin` is production.
export function makeClient() {
  const projectKey = process.env.DYNJANDI_PROJECT_KEY;
  if (!projectKey) throw new Error("DYNJANDI_PROJECT_KEY is not set");
  return createClient({ projectKey, origin: process.env.DYNJANDI_ORIGIN });
}
```

The Next.js loader is not a client: `createDynjandiLoader` takes its own `origin`, and without one it builds
production URLs
([SDK, using with Next.js](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#using-with-nextjs)). Set the loader file up as the `dynjandi`
skill's [Next.js reference](../dynjandi/references/nextjs.md) shows, with the origin added:

```js
// dynjandi-loader.js
import { createDynjandiLoader } from "@dynjandi/sdk/next";

// The loader takes its own origin; it reads no client's. Unset, it builds production URLs.
export default createDynjandiLoader({
  origin: process.env.DYNJANDI_ORIGIN ?? "https://cdn.dynjandi.dev",
});
```

`DYNJANDI_ORIGIN` has neither a `VITE_` nor a `NEXT_PUBLIC_` prefix, so a bundler does not put it in browser
code ([CLI, env loaders](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#run-a-command-against-the-server)). A Next.js `loaderFile` is a loader that runs in a
browser, so there `process.env.DYNJANDI_ORIGIN` is undefined and the loader above would build production URLs.
The origin is not a secret, so pass it on deliberately from the config file, with Next.js's documented `env`
option, which inlines the value into the JavaScript bundle at build time
([Next.js, `env`](https://nextjs.org/docs/app/api-reference/config/next-config-js/env)). Read it as
`process.env.DYNJANDI_ORIGIN` exactly, because Next.js replaces that expression and destructuring `process.env`
does not work:

```js
// next.config.mjs
// The origin is not a secret, so it may reach the browser bundle. The project key never may:
// do not add DYNJANDI_PROJECT_KEY here.
export default {
  images: { loader: "custom", loaderFile: "./dynjandi-loader.js" },
  env: { DYNJANDI_ORIGIN: process.env.DYNJANDI_ORIGIN ?? "https://cdn.dynjandi.dev" },
};
```

Pass the origin only. `DYNJANDI_PROJECT_KEY` never goes in the config's `env`, in a `NEXT_PUBLIC_` variable or in
browser code.

Because the value is fixed when the bundle is built, the build has to run inside the same `dynjandi dev -- ...`
that runs the app. A build made beforehand, or in another `dev` run, keeps the production origin, or the port of
a server that has stopped, because `dev` takes a free port each time. Run both under one command, or run
`next dev`, which starts with the config:

```sh
dynjandi dev -- sh -c "next build && next start"
```

## 4. The app runs in a container

`--containers` lets a container reach the server, and adds `DYNJANDI_CONTAINER_ORIGIN` to a command run under
`--`. The app then needs two origins: `origin` for the browser and `apiOrigin` for the container. The recipe,
the snippet and what was and was not run are in [references/containers.md](references/containers.md).

```sh
dynjandi dev --containers -- docker compose up --no-log-prefix
```

`apiOrigin` is newer than SDK `0.2.0`: look for it in the installed package's types before using it, and do not
trust a version number
([SDK, usage](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#usage)).

## 5. The renderer

By default `dev` starts the renderer with Docker, so Docker must be installed and running
([CLI, the renderer](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#the-renderer)). If Docker prints that the pull of the image was denied, the image is
private for now. If the person's account can read it, they sign in once with `docker login ghcr.io`; if it
cannot, signing in does nothing, so use a renderer that is already running, or none
([CLI, if the image cannot be pulled](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#if-the-image-cannot-be-pulled)):

```sh
dynjandi dev --renderer-url http://127.0.0.1:8080 -- pnpm test
dynjandi dev --no-renderer -- pnpm test
```

With `--no-renderer` every variant URL answers `502` and the rest of the server works.

## 6. CI and Docker Compose

Do not copy a recipe from here. The CLI README holds the GitHub Actions job, the service-container variant and
the Compose file, with the renderer image and its digest, which change with the CLI:
[CLI, in CI, and with Docker Compose](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#in-ci-and-with-docker-compose). For an app that itself runs in a
container, [CLI, from an app in a container](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#from-an-app-in-a-container).

## 7. An existing fake of Dynjandi

Read it before you replace it. A stand-in the team wrote on purpose often does something `dev` does not: it
simulates a failure, such as a dropped upload, or it records what it received so a test can assert on it. `dev`
has no fault injection ([CLI, routes](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#routes)). Keep a stand-in like that, and its tests. Use `dev` in its place where
real crops and resizes matter, and for running the app. If you are not
sure why a fake exists, leave it and say so.

## 8. What `dev` does not do

- It sends no CORS headers, as the live service sends none: upload and read from a server, not a browser page
  ([CLI, routes](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#routes)).
- It injects no faults: no slow, dropped or failing responses on request.
- Its variant bytes differ from production's. Dimensions, `Content-Type` and status match; do not compare
  pixels ([CLI, variant URLs](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#variant-urls)).
- It listens on `127.0.0.1` only, and there is no option to listen anywhere else. `--containers` adds one more
  address, for this machine's containers and never for other machines. A request with a `Host` name it does not
  know gets `421` ([CLI, host names](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#host-names)). Never suggest exposing it: no `0.0.0.0`, no published
  port, no tunnel, no hosts-file alias for another machine. The renderer has no authentication either.
- It has been run on macOS only. Linux with Docker Engine and `--containers` (#55, #56) and Windows (#47) are
  untried, so say so rather than promise they work
  ([CLI, where it was run](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#from-an-app-in-a-container)).
