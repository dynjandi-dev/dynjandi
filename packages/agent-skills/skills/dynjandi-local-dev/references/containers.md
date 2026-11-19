# An app in a container

Read this when the app runs in a Docker container and `dynjandi dev` runs on the host.

The container and the browser reach the server by different names, so the app needs two origins, and the SDK
has an option for each: `origin` is what a browser loads image URLs from, and `apiOrigin` is what the container
calls for `upload` and `getFile`. `apiOrigin` defaults to `origin`
([SDK, usage](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#usage)).

Check the installed SDK's types for `apiOrigin` first. It is newer than `0.2.0`, so an older SDK refuses it at
compile time and a version number is no guide.

## Start it

`--containers` makes `dev` listen on the Docker bridge gateway as well, when the machine holds that address,
and report the origin a container should use: `DYNJANDI_CONTAINER_ORIGIN` for a command under `--`, and
`containerOrigin` with `--json`. It exits `1` when `docker` is missing
([CLI, from containers](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#from-containers)). Run the compose file under `dev`, so it reads the origins and the
key from the environment `dev` gives it:

```sh
dynjandi dev --containers -- docker compose up --no-log-prefix
```

Without `dev` in front, `docker compose` has no origins to read. Do not write a key or a port into the compose
file ([CLI, from an app in a container](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#from-an-app-in-a-container)).

## In the app

The compose file's `environment:` block maps `DYNJANDI_CONTAINER_ORIGIN` to `DYNJANDI_API_ORIGIN` and passes
`DYNJANDI_ORIGIN` and `DYNJANDI_PROJECT_KEY` through; the CLI README has it. Then:

```ts
import { createClient } from "@dynjandi/sdk";

const projectKey = process.env.DYNJANDI_PROJECT_KEY;
if (!projectKey) throw new Error("DYNJANDI_PROJECT_KEY is not set");

// In a container: `origin` is what a browser loads, `apiOrigin` is what this container calls.
// The compose file maps DYNJANDI_CONTAINER_ORIGIN to DYNJANDI_API_ORIGIN.
export const client = createClient({
  projectKey,
  origin: process.env.DYNJANDI_ORIGIN,
  apiOrigin: process.env.DYNJANDI_API_ORIGIN,
});
```

A server-side fetch of an image URL, such as Next.js's default image optimiser, uses `origin`, which from
inside the container is the container itself. Use the SDK's `createDynjandiLoader`, which builds URLs and makes
no server request, or make `origin` resolve inside the container too.

## What was run

Only Docker Desktop on macOS was run. Linux Engine (#55, #56), Docker Desktop on Windows (#47), OrbStack,
Colima, Rancher Desktop, Podman, rootless Docker and a remote `DOCKER_HOST` are untried, and on those
`host.docker.internal` may not resolve in the container. On Linux a firewall can drop traffic from a container
to the host; the CLI README gives a rule and says it has not been run. Say this to the person; do not claim it
works ([CLI, where it was run](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#from-an-app-in-a-container)).
