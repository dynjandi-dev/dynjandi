---
name: dynjandi
description: >-
  Integrate Dynjandi, an image CDN at cdn.dynjandi.dev, with its TypeScript SDK @dynjandi/sdk: upload images
  from a server, build resize, crop and format variant URLs, srcset and <picture> sources, set focal points,
  use the Next.js image loader, and handle the project key (including the old publicKey option). Use when
  code or a task mentions Dynjandi, cdn.dynjandi.dev, @dynjandi/sdk, DYNJANDI_PROJECT_KEY, a project key,
  uploading images to a CDN, transform or variant URLs, responsive images, or cropping on a focal point.
  For running Dynjandi on a laptop, offline, in tests or in CI, use the dynjandi-local-dev skill instead.
---

# Dynjandi

Dynjandi is an image CDN. A server uploads an image with the SDK and gets an id back; a variant of it (a
size, a crop, a format) is a URL built from that id. This skill routes you to the right call and states the
rules that are easy to get wrong. The detail lives in the READMEs and the spec, linked below; read the
section you need rather than guessing an option name.

## Before you write code

Check what is installed; do not assume.

- Read the `@dynjandi/sdk` version in the project's `package.json` or lockfile. `projectKey` needs `0.2.0` or
  later. If the SDK is not installed, install it as the
  [SDK README](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#install) says.
- `apiOrigin` is newer than `0.2.0`: look for it in the installed package's types before using it, rather than
  trusting a version number.
- If a `dynjandi` MCP server is connected, call its `read_docs` tool with no topic to list the docs it holds.
  It cannot reach files on this machine, so it will not set up or run anything local.

## 1. Which key is which

- The **project key** (`DYNJANDI_PROJECT_KEY`) authorises uploads and file reads for one project. It stays on
  the server: never in browser code, never in a `VITE_` or `NEXT_PUBLIC_` variable, never in a log or a commit
  ([SDK usage](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#usage)).
- A **workspace API key** (`DYNJANDI_API_KEY`) is for `dynjandi setup` in CI only. It is made on the API keys page
  of the dashboard and is not a project key
  ([CLI, the credential](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#the-credential)).
- To get the project key into an app, run `dynjandi setup --json`. It writes the key to a Git-ignored env
  file and prints no key. Exit `4` means it is waiting for the person to approve in a browser: show them the
  link it printed, then run the same command again. Exit `3` means it has no usable credential. Never `cat`,
  print or paste an env file to look at the key. How to get the CLI is in
  [references/keys.md](references/keys.md).

Read the key from the environment on the server, and fail at start-up if it is missing:

```ts
import { createClient } from "@dynjandi/sdk";

const projectKey = process.env.DYNJANDI_PROJECT_KEY;
if (!projectKey) throw new Error("DYNJANDI_PROJECT_KEY is not set");

// Server-side only: the project key authorises uploads and file reads for one project.
export const dynjandi = createClient({ projectKey });
```

## 2. Uploads and file reads are server-side only

The service sends no CORS headers, so a browser cannot call `upload` or `getFile`. Do both from Node or a
server, and hand the browser only the id or the URL
([SDK, `upload`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#uploadfile--focal-),
[spec, server-side only](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/spec/openapi.yaml)).
`getFile` answers `Cache-Control: no-store` and the SDK does not cache it: fetch a record once and keep it,
rather than calling it for each rendered image
([SDK, `getFile`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#getfilefileid)).

## 3. Variants, and what each one costs

`url()`, `srcset()`, `pictureSources()` and `placeholder()` are synchronous, make no request and are safe in
a browser. Every width x format x crop is a separate variant, and each new variant counts against the
project's plan cap, so trim `widths` and `formats` to what the page needs
([SDK, `pictureSources`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#picturesourcesfile-options)).
`srcset` and `pictureSources` return data, not markup: put `alt` and `sizes` on the `<img>` yourself.

```ts
import type { Client } from "@dynjandi/sdk";

// Synchronous, makes no request, safe in a browser. Every width x format is a billed variant.
export function heroImage(client: Client, id: string) {
  const sizes = "(min-width: 800px) 800px, 100vw";
  const widths = [640, 1280];
  return {
    sources: client.pictureSources(id, { sizes, widths }), // best format first
    fallback: client.srcset(id, { format: "jpeg", widths }), // for the plain <img>, after every <source>
    placeholder: client.placeholder(id), // one more variant per image
    sizes, // put it, and your own `alt`, on the <img> too
  };
}
```

Options, limits and the cost table are in [references/variants.md](references/variants.md).

## 4. Focal points

Pass `focal` (`{ x, y }`, each from 0 to 1, both sent together) to `upload` when a person chose the point:

```ts
import type { Client } from "@dynjandi/sdk";

// Server-side only. `focal` is optional; when it is given, x and y are both sent, each from 0 to 1.
export async function uploadWithFocalPoint(client: Client, file: File) {
  const { id, url } = await client.upload(file, { focal: { x: 0.42, y: 0.18 } });
  return { id, url };
}
```

A crop built from a stored file (the result of `getFile` or `upload`) uses that file's point unless the crop
names its own `position` or `focal`:

```ts
import type { Client } from "@dynjandi/sdk";

export async function bannerUrl(client: Client, id: string) {
  const file = await client.getFile(id); // server-side only; fetch once and keep it
  // A crop that names no `position` or `focal` crops on the stored point (or the center, if none).
  return client.url(file, { crop: { width: 1280, height: 400 } });
}
```

To let a person choose the point, the repository has a picker, `@dynjandi/focal-picker`. Run
`npm view @dynjandi/focal-picker version`: a version means it can be installed; a 404 error means there is
no release of it yet, and its README describes the element and its React wrapper but gives no other way to install it
([picker README](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/focal-picker/README.md#install)).
The point travels through your own server to `upload`
([hand-off](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/focal-picker/README.md#from-the-picker-to-upload)).

## 5. Next.js

`@dynjandi/sdk/next` is a loader for `next/image`; `src` is a Dynjandi file id, not a URL, and every width
Next asks for is one billed variant. Set it up as [references/nextjs.md](references/nextjs.md) shows.

## 6. Migrating from `publicKey`

Earlier SDK versions took `createClient({ publicKey })`. It still works but is deprecated: rename the option
to `projectKey`. Passing both, neither, or an empty key throws a `DynjandiError` with status `0`, and
`ClientOptions` became a union, so `interface X extends ClientOptions` no longer compiles
([SDK, migrating](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#migrating-from-publickey)).
The header `X-Public-Key` is deprecated the same way, and new code sends `X-Project-Key` only
([spec](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/spec/openapi.yaml)).

## 7. Where the docs are

- [SDK README](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md): every call, its
  options and its errors.
- [CLI README](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md): `dynjandi setup`
  and `dynjandi dev`.
- The API description, a stable raw URL:
  `https://raw.githubusercontent.com/dynjandi-dev/dynjandi/main/packages/spec/openapi.yaml`
  ([how it is versioned](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/spec/README.md#stable-url)).
- To run the app or its tests against a local Dynjandi, with no live service, use the `dynjandi-local-dev`
  skill.
