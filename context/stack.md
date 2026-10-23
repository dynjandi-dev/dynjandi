# Stack

What this project is, and what an agent has to know before touching it. Run `/onboard` to fill it in.

What each section takes is in [`stack.notes.md`](stack.notes.md). `/onboard` reads that file when it fills
this one.

The public integration surface for Dynjandi, an image CDN at `cdn.dynjandi.dev`: an OpenAPI spec, a
TypeScript SDK (`@dynjandi/sdk`) and a focal point picker (`@dynjandi/focal-picker`, not yet published). The service itself lives in a separate private repository; this one was
split out of it on 2026-09-30 so the spec and SDK can be public and permissively licensed.

**The spec and the SDK's three operations exist, and the SDK is publishable.** `packages/spec/openapi.yaml`
describes `POST /upload`, `GET /files/{id}` and the variant URL grammar, and is linted by `pnpm lint`.
`packages/sdk` has `createClient`, `upload`, `getFile`, `url`, the responsive helpers `srcset`,
`pictureSources` and `placeholder`, and `DynjandiError`, plus a `next/image` loader at the `@dynjandi/sdk/next` subpath (`createDynjandiLoader`, `dynjandiLoader`); request and response
types are generated from the spec, and `url()` maps its options onto `@dynjandi/transform-grammar`'s operations and builder. `@dynjandi/sdk` is a public package (`0.1.0`, built to `dist/`); `@dynjandi/spec` stays `private`, since
the spec is served from its raw GitHub URL. The design is in issue #1 (`sdk-ecosystem`), not here.

`packages/focal-picker` is a public package (`0.0.0`, built to `dist/`) that is **not on npm and that nothing
publishes yet**; so far it holds DOM-free helpers — the point (`FocalPoint`, `clampPoint`, `roundPoint`,
`stepPoint`) and the crop geometry (`cropWindow`, `pointFromRect`) — plus, at the separate `./element` entry (the only one with a side effect), the `<dynjandi-focal-picker>` custom element: image surface, marker, X/Y inputs and DOM crop previews (`ratios`) — and, at `./react`, the `FocalPicker` component over it (React and `react-dom` are optional peers, `^19.0.0`). No runtime dependencies. Its only tie to the SDK is a type-level test, so `@dynjandi/sdk`
is a `devDependency`. The design is in issue #4.

| Concern | Target |
|---|---|
| Runtime | Node 22 and 24 (`engines.node >=22`); the SDK targets `fetch`, `FormData` and `Blob` only, with one runtime dependency, `@dynjandi/transform-grammar` (which installs `zod` as a transitive dependency, but the SDK imports its `./builder` entry, so `zod` is not in the browser bundle) |
| Language | TypeScript 7 (strict, `tsconfig.base.json`), ESM |
| Package manager | pnpm 10 workspaces, no Nx (`packageManager` in `package.json`) |
| Lint and format | Biome 2 (`biome.json`), scoped to code: `context/`, `.claude/` and `.agents/` are ignored; the OpenAPI spec is linted by Redocly CLI (`recommended-strict`), called from the root `lint` script |
| Test | Vitest 5; for the picker it also runs in a real browser (headless Chromium through `@vitest/browser-playwright`, a separate `browser` project beside its `node` one). `pnpm test` runs the offline tests only; `packages/sdk/tests/live/` is a live smoke test against `cdn.dynjandi.dev`, run by `test:live` and never by `pnpm test` |
| CI | GitHub Actions: `ci.yml` on Node 22 and 24 (its `build` and `check:package` steps cover the SDK and the picker; it installs Playwright's Chromium, cached by the pinned version, before `pnpm test`); `pages.yml` deploys the checker page; `smoke.yml` runs the live smoke test daily, on demand, and as the precondition `publish.yml` calls; `publish.yml` publishes the SDK to npm (trusted publishing, no token); nothing publishes the picker |
| Database | None |
| Storage | None |
| Hosting | GitHub Pages serves `packages/checker`'s page at `https://dynjandi-dev.github.io/dynjandi/`, deployed by `pages.yml` once a person sets the repo's Pages source to "GitHub Actions"; nothing else is deployed from here. `@dynjandi/sdk` is the one package this repository publishes to npm: its first version by hand, every later one by `publish.yml`; `@dynjandi/focal-picker` is not published yet |

## Layout

```
package.json, pnpm-workspace.yaml, pnpm-lock.yaml   workspace root and scripts
tsconfig.base.json, biome.json, LICENSE (MIT)        shared config
packages/spec/    openapi.yaml (OpenAPI 3.1, upload + file read + URL grammar prose), README.md
packages/sdk/     @dynjandi/sdk: src/ (client, upload, files, http, url, next, errors, generated/api.d.ts), tests/ (live/ = smoke test),
                  scripts/check-package.mjs, tsconfig.json, tsconfig.build.json (emits dist/, gitignored), README.md
packages/focal-picker/ @dynjandi/focal-picker (public, unpublished): src/ (point, geometry, index, element, react), tests/ (point.test.ts, readme.test.ts + handoff/ (the README's hand-off snippets as compiled files), browser/react.browser.test.tsx, geometry.test.ts, browser/element.browser.test.ts, browser/previews.browser.test.ts, browser/a11y.browser.test.ts (axe-core), browser/e2e.browser.test.ts (keyboard, forced colours, reflow, reduced motion, drag cost), browser/support.ts (shared helpers), sdk-compat.test-d.ts = the type-level
                  tie to the SDK, browser/ = tests run in Chromium), vitest.config.ts (node and browser projects), scripts/check-package.mjs, tsconfig.json, tsconfig.build.json (emits dist/, gitignored), README.md
packages/checker/ @dynjandi/checker (private): src/ (check, render, main, style.css), index.html, scripts/build.mjs (esbuild into
                  dist/, gitignored), tests/, README.md
.pnpmfile.cjs     gives openapi-typescript its own TypeScript 5 (it cannot run on TypeScript 7)
.changeset/       release notes, one file each; consumed by changeset:prepare-release (context/release.md)
.github/workflows/ci.yml                             lint, format, typecheck, build, package check, test, generated-types drift
.github/workflows/smoke.yml                          live smoke test: daily, workflow_dispatch, workflow_call
.github/workflows/publish.yml                        publishes @dynjandi/sdk when its version is not on npm
.github/workflows/pages.yml                          builds packages/checker and deploys dist/ to GitHub Pages
context/   workflow state and project answers (verify, git, tracking, release, executors, standards)
```

## Conventions

- Tooling versions are pinned exactly — shared tools in the root `package.json`, a package's own tools (Redocly
  in `packages/spec`) in that package's; GitHub Actions are pinned to a major tag.
- Root scripts are the single entry points (`lint`, `format`, `format:check`, `typecheck`, `test`,
  `build`, `check:package`, `check:generated`); the workspace scripts they fan out to (`pnpm -r run`, or `pnpm --filter` for the
  spec lint and `check:generated`) live in each package.
- Each package extends `tsconfig.base.json`; generated code goes under a `generated/` directory, which Biome
  ignores. It is committed, never edited by hand: `pnpm --filter @dynjandi/sdk run generate` rewrites
  `packages/sdk/src/generated/api.d.ts` from the spec, and `pnpm check:generated` fails if it is stale.
- Licence is MIT, copyright "Dynjandi contributors". The root `LICENSE` is copied into `packages/sdk/` and `packages/focal-picker/` by their
  `prepack` (gitignored there) so the tarball carries it.
- Relative imports in `packages/sdk/src` end in `.js`: the emitted ESM has to resolve under Node, and the
  build compiles under `NodeNext` to enforce it. `packages/spec`'s `info.version` is the spec's version;
  the package's own `version` is unused (it is private).
- The live smoke test's key is `DYNJANDI_SMOKE_PUBLIC_KEY`: an Actions secret in CI, a gitignored `.env` at the
  repository root locally. It belongs to a dedicated test project, and no tracked file holds it.

## Documentation

- `README.md` — the repository's front page, for anyone arriving from GitHub. It links the SDK and the spec
  and says how to install the SDK; a change to what is published, or to how, owes it an update.
- `packages/spec/README.md` — the spec's stable URL, versioning rule and contract summary. Changes to
  `openapi.yaml` that move `info.version` or the contract owe it an update.
- `packages/sdk/README.md` — the SDK's usage (`upload`, `getFile`, `url`, `srcset`, `pictureSources`, `placeholder`, using with Next.js, errors), what is tested where, the gzipped
  bundle-size baseline and the command that measured it, and how to run the live smoke test. A change to the
  SDK's public API or its dependencies owes it an update.

- `packages/focal-picker/README.md` — what the picker package holds so far (install, the element, `value` and its events, the crop previews and `ratios`, and the point and crop-geometry helpers), the React wrapper and its version range, the hand-off from the picker to `upload`, and that it is not published. It must not claim a feature before a phase has landed it, nor that the package is on npm before it is.

- `packages/checker/README.md` — what the checker page checks, how to build and serve it, the grammar version
  and gzipped bundle size it records (with the command), and how `pages.yml` deploys it. A change to the
  checker's behaviour, its dependencies or its deployment owes it an update.

`@dynjandi/sdk` is the one package this repository publishes to npm: its first version by hand, every later
one by `publish.yml` (`@dynjandi/focal-picker` is public but unpublished; nothing publishes it yet) ([`release.md`](release.md) says how), and its README becomes the npm package page. The
spec is served from this repository's raw GitHub URL, and each release `publish.yml` makes is tagged
`sdk-v<version>`, which versions it. The private service repository describes the upload contract and URL
grammar for its own maintainers, but it is not a surface a change here has to reach.

## Also in `context/`

Verification commands are in [`verify.md`](verify.md), not here. Executor dispatch is in
[`executors.md`](executors.md), who commits is in [`git.md`](git.md), and what a change announces is in
[`release.md`](release.md).
