# @dynjandi/checker

A static, client-side page where a person pastes an Uploadcare URL and sees the Dynjandi URL it becomes,
the canonical form of each operation, and every operation Dynjandi does not support. It is live at
<https://dynjandi-dev.github.io/dynjandi/> once Pages is enabled (see *Deploying*).

This package is **private** and never published to npm.

## What it checks

The input is an `http(s)` URL whose path starts with a file UUID, on any host (Uploadcare customers use their
own CDN domains). Each `-/`-delimited operation is parsed on its own with `@dynjandi/transform-grammar`, so
every problem is reported, not just the first. An operation is:

- **supported**, with its canonical form and a note for each rewrite the parser made (`scale_crop` to `crop`,
  `smart` to `face,center`, `jpg` to `jpeg`, a named quality level to its integer);
- **invalid arguments**, an operation Dynjandi has but refuses these arguments for (`format/auto`,
  `resize/0x0`), with the rule;
- **not supported**, an operation outside the grammar (`preview`, `progressive`, `stretch`, `setfill`,
  `blur`).

When everything is supported the page shows the Dynjandi URL on `https://cdn.dynjandi.dev`. When some
operations are not, it shows the URL with them removed, labelled **not equivalent**, since it is a different
image.

It states what the grammar accepts, not what the CDN will serve. The rewrite assumes the file was imported
to Dynjandi and kept its Uploadcare UUID as its file id, so only the host changes; whether a file exists or
was imported is outside its knowledge. Group URLs (`uuid~N`) and other ids are refused with a reason.

The pasted URL is never requested: the page makes no network call. Pasted text is shown with `textContent`
only, and the only link is the Dynjandi URL the checker built (`tests/render.test.ts`).

## Layout

| Path | What |
|---|---|
| `src/check.ts` | `checkUploadcareUrl(input): CheckResult`, a pure function with no DOM access |
| `src/render.ts` | `renderResult(section, result)`, builds the result with `createElement` and `textContent` |
| `src/main.ts` | wires the form to the two above |
| `index.html`, `src/style.css` | the page; light and dark themes through `prefers-color-scheme` |
| `scripts/build.mjs` | bundles with esbuild into `dist/` and prints the grammar version into the page |
| `tests/` | `check.test.ts` (the function) and `render.test.ts` (rendering, under happy-dom) |

## Build and serve

```bash
pnpm --filter @dynjandi/checker run build
python3 -m http.server 8080 -d packages/checker/dist
```

`dist/` holds `index.html`, `main.js` and `style.css` (gitignored). Serve it over HTTP: the page loads a module
script, which `file://` does not allow. It references `style.css` and `main.js` relatively, so it works under
the `/dynjandi/` path on Pages as well as at the root.

## Grammar version and bundle size

The page bundles `@dynjandi/transform-grammar` **0.2.0** and prints the version it was built with, read from
the installed package at build time. It uses the grammar's bare entry, the only one that exports
`parseOperationChain`, and that entry bundles `zod`.

`dist/main.js` is **96,247 bytes gzipped** (463,099 bytes minified) as of 2026-10-20. Measured from the
repository root after a build:

```bash
gzip -c packages/checker/dist/main.js | wc -c
```

That is a baseline to compare later changes against, not a budget. If the number matters, the alternative is
a zod-free parser export from the grammar package.

## Tests

`pnpm --filter @dynjandi/checker run test`. Expected values come from `packages/spec/openapi.yaml` and the
grammar's behaviour, not from the code under test. There is no browser test: the keyboard and contrast pass
is manual.

## Deploying

[`pages.yml`](../../.github/workflows/pages.yml) builds this package and deploys `dist/` to GitHub Pages on
a push to `main` that touches `packages/checker/`, `pnpm-lock.yaml` or the workflow, and on demand
(`workflow_dispatch`). It uses no secret.

**A workflow file enables nothing.** A repository admin has to turn Pages on once: Settings, Pages, Source
"GitHub Actions". Until then the deploy job fails at `configure-pages`. The workflow deliberately does not
enable Pages through the API.

## Release notes

`context/release.md` has no row for `packages/checker`. The package is private and never published, so no
release note is owed and the table is left alone.
