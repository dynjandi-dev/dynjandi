# Stack

What this project is, and what an agent has to know before touching it. Run `/onboard` to fill it in.

What each section takes is in [`stack.notes.md`](stack.notes.md). `/onboard` reads that file when it fills
this one.

The public integration surface for Dynjandi, an image CDN at `cdn.dynjandi.dev`: an OpenAPI spec, a
TypeScript SDK (`@dynjandi/sdk`) and a focal point picker (`@dynjandi/focal-picker`, not yet published) and a command line (`@dynjandi/cli`, on npm since 0.1.0), and agent skills that teach a coding agent to use them (`@dynjandi/agent-skills`, private, never on npm). The service itself lives in a separate private repository; this one was
split out of it on 2026-09-30 so the spec and SDK can be public and permissively licensed.

**The spec and the SDK's three operations exist, and the SDK is publishable.** `packages/spec/openapi.yaml`
describes `POST /upload`, `GET /files/{id}` and the variant URL grammar, and is linted by `pnpm lint`.
`packages/sdk` has `createClient`, `upload`, `getFile`, `url`, the responsive helpers `srcset`,
`pictureSources` and `placeholder`, and `DynjandiError`, plus a `next/image` loader at the `@dynjandi/sdk/next` subpath (`createDynjandiLoader`, `dynjandiLoader`); request and response
types are generated from the spec, and `url()` maps its options onto `@dynjandi/transform-grammar`'s operations and builder. `@dynjandi/sdk` is a public package (on npm, `0.2.1` as of 2026-11-20, built to `dist/`); `@dynjandi/spec` stays `private`, since
the spec is served from its raw GitHub URL. The design is in issue #1 (`sdk-ecosystem`), not here.

`packages/focal-picker` is a public package (`0.0.0`, built to `dist/`) that is **not on npm and that nothing
publishes yet**; so far it holds DOM-free helpers — the point (`FocalPoint`, `clampPoint`, `roundPoint`,
`stepPoint`) and the crop geometry (`cropWindow`, `pointFromRect`) — plus, at the separate `./element` entry (the only one with a side effect), the `<dynjandi-focal-picker>` custom element: image surface, marker, X/Y inputs and DOM crop previews (`ratios`) — and, at `./react`, the `FocalPicker` component over it (React and `react-dom` are optional peers, `^19.0.0`). No runtime dependencies. Its only tie to the SDK is a type-level test, so `@dynjandi/sdk`
is a `devDependency`. The design is in issue #4.

`packages/cli` is a public package (built to `dist/`, bin `dynjandi`) **on npm since 0.1.0**, which was published by hand on 2026-11-20; `publish-cli.yml` publishes every version after it. It holds `dynjandi setup`, which finds or creates a project through the management API (`https://app.dynjandi.dev`, with the person's approval in the browser, or a workspace API key in `DYNJANDI_API_KEY` for CI) and writes `DYNJANDI_PROJECT_KEY` and `DYNJANDI_PROJECT_ID` to a gitignored env file (`src/setup/`), and `dynjandi dev`, a local server on `127.0.0.1` (and, with `--containers`, a way in from containers: the default bridge's gateway when this host holds it, and the origin containers use) that stores uploads on disk and serves file records and originals (`POST /upload`, `GET /files/{id}`, `GET /<id>`, `GET /health`) and variants rendered by a renderer, which `dev` starts with Docker by default (the image pinned by tag and digest, in `src/dev/renderer-image.ts`) or takes from `--renderer-url`. Its runtime dependencies are `@northguild/gmt` and `@dynjandi/transform-grammar` (pinned exactly); `@dynjandi/sdk` is a `devDependency`. Docker (on `PATH`, daemon running) is needed to run the renderer: by `dynjandi dev` by default, and by the end-to-end test; `--renderer-url` and `--no-renderer` need none; `--containers` needs the `docker` CLI and a running daemon in every mode.

`packages/agent-skills` is a private package (`@dynjandi/agent-skills`, `0.0.0`, neither versioned nor tagged by changesets, never published to npm) that is also the root of a Claude Code plugin: `.claude-plugin/plugin.json` names it `dynjandi`, with no `version` field, and `skills/<name>/SKILL.md` holds the skills, each with `references/*.md` it loads on demand. There are two skills: `dynjandi` (integrating the SDK and the service) and `dynjandi-local-dev` (`dynjandi dev`, tests, containers, CI). Its plugin components are markdown only: portable frontmatter (`name`, `description`), no scripts, no hooks, no MCP server. `evals/` holds one scaffold script (`evals/local-admin/fixture.sh`) that only `claude plugin eval --scaffold` runs. **These are not the planning workflow's skills**: `.claude/skills/` and `.agents/skills/` belong to the workflow (`AGENTS.md`), and nothing in this package edits or installs from them. Its tests are Gate 1's: they check every `skills/*/SKILL.md` against the agentskills.io rules and against this repository's own READMEs, parsers and SDK types (see `verify.md`, *Test*). Its one tooling dependency beyond the workspace's is `yaml` (pinned), to read frontmatter.

| Concern | Target |
|---|---|
| Runtime | Node 22 and 24 (`engines.node >=22`); the SDK targets `fetch`, `FormData` and `Blob` only, with one runtime dependency, `@dynjandi/transform-grammar` (which installs `zod` as a transitive dependency, but the SDK imports its `./builder` entry, so `zod` is not in the browser bundle) |
| Language | TypeScript 7 (strict, `tsconfig.base.json`), ESM |
| Package manager | pnpm 10 workspaces, no Nx (`packageManager` in `package.json`) |
| Lint and format | Biome 2 (`biome.json`), scoped to code: `context/`, `.claude/` and `.agents/` are ignored; the OpenAPI spec is linted by Redocly CLI (`recommended-strict`), called from the root `lint` script |
| Test | Vitest 5; for the picker it also runs in a real browser (headless Chromium through `@vitest/browser-playwright`, a separate `browser` project beside its `node` one). `pnpm test` runs the offline tests only, including the CLI's contract suite (the **api** cases against `dynjandi dev` in process); `packages/sdk/tests/live/` is a live smoke test and `packages/cli/tests/live/` the same contract cases (both groups) against `cdn.dynjandi.dev`, each run by its package's `test:live` and never by `pnpm test`; `packages/cli/tests/e2e/` starts the built `dynjandi dev` with the real renderer in Docker (`test:e2e`, by hand, never by `pnpm test`); its `containers.e2e.test.ts` case runs the SDK in a pinned Node container against `dev --containers`, and its `setup.e2e.test.ts` runs the built `dynjandi setup` with no Docker and no network; `packages/cli/tests/management/` checks the management API's published document (`test:management`, never by `pnpm test`) |
| CI | GitHub Actions: `ci.yml` on Node 22 and 24 (its `build` and `check:package` steps cover the SDK, the picker and the CLI; it installs Playwright's Chromium, cached by the pinned version, before `pnpm test`); `pages.yml` deploys the checker page; a second job, `setup`, runs `pnpm --filter @dynjandi/cli run test:setup` on Ubuntu, macOS and Windows with Node 24 (no `build` step: `dev`'s tests and the CLI's `build` script are Unix-only); `smoke.yml` runs the live smoke test and the live contract suite daily, on demand, and as the precondition `publish.yml` calls; `management-api.yml` runs the management API document check daily, on demand, and as `workflow_call`, apart from `smoke.yml` so a dashboard change cannot block an SDK release; `publish.yml` publishes the SDK to npm (trusted publishing, no token); `publish-cli.yml` does the same for the CLI (the same job split and guards, preconditions `smoke.yml` and `management-api.yml`, tags `cli-v<version>`; its first run, on the 2026-11-19 release merge, failed at `npm publish` with `E404` because `0.1.0` had not been published by hand first); nothing publishes the picker |
| Database | None |
| Storage | None |
| Hosting | GitHub Pages serves `packages/checker`'s page at `https://dynjandi-dev.github.io/dynjandi/`, deployed by `pages.yml` once a person sets the repo's Pages source to "GitHub Actions"; nothing else is deployed from here. `@dynjandi/sdk` is published to npm: its first version by hand, every later one by `publish.yml`; `@dynjandi/cli` the same way through `publish-cli.yml` (its first version, `0.1.0`, by hand on 2026-11-20); `@dynjandi/focal-picker` is not published yet |

## Layout

```
package.json, pnpm-workspace.yaml, pnpm-lock.yaml   workspace root and scripts
tsconfig.base.json, biome.json, LICENSE (MIT)        shared config
packages/spec/    openapi.yaml (OpenAPI 3.1, upload + file read + URL grammar prose), README.md
packages/sdk/     @dynjandi/sdk: src/ (client, upload, files, http, url, next, errors, generated/api.d.ts), tests/ (live/ = smoke test),
                  scripts/check-package.mjs, tsconfig.json, tsconfig.build.json (emits dist/, gitignored), README.md
packages/focal-picker/ @dynjandi/focal-picker (public, unpublished): src/ (point, geometry, index, element, react), tests/ (point.test.ts, readme.test.ts + handoff/ (the README's hand-off snippets as compiled files), browser/react.browser.test.tsx, geometry.test.ts, browser/element.browser.test.ts, browser/previews.browser.test.ts, browser/a11y.browser.test.ts (axe-core), browser/e2e.browser.test.ts (keyboard, forced colours, reflow, reduced motion, drag cost), browser/support.ts (shared helpers), sdk-compat.test-d.ts = the type-level
                  tie to the SDK, browser/ = tests run in Chromium), vitest.config.ts (node and browser projects), scripts/check-package.mjs, tsconfig.json, tsconfig.build.json (emits dist/, gitignored), README.md
packages/cli/     @dynjandi/cli (public, on npm): src/ (cli, errors, dev/options, dev/server, dev/variants, dev/renderer, setup/ = secret, api, approval, open-browser, git, env-file, options, run), tests/ (setup/ = the `setup` tests against a stub management API and real temporary Git repositories, support/ = the stubs and test helpers, contract/ = the cases shared by the offline and live runs, live/ = the live contract test, e2e/ = the end-to-end tests: `dev` with the real renderer, and the built `setup`, management/ = the check of the management API's published document), scripts/check-package.mjs, tsconfig.json,
                  tsconfig.build.json (emits dist/, gitignored), README.md
packages/agent-skills/ @dynjandi/agent-skills (private, never published): the Claude Code plugin root. .claude-plugin/plugin.json (name `dynjandi`, no version), skills/dynjandi/ (SKILL.md + references/), skills/dynjandi-local-dev/ (SKILL.md + references/), tests/ (skills.test.ts runs the skill checks over every skills/*/SKILL.md; marketplace.test.ts checks ../../.claude-plugin/marketplace.json and the README's install commands; checks.test.ts tries each check on planted text; support/ = the checks; snippets/ = the code the skills show, compiled by `typecheck` against the SDK's source), evals/ (claude plugin eval cases: <case>/prompt.md + graders/; local-admin/case.yaml + fixture.sh, run only with --scaffold; results/ Git-ignored), README.md, tsconfig.json, vitest.config.ts
packages/checker/ @dynjandi/checker (private): src/ (check, render, main, style.css), index.html, scripts/build.mjs (esbuild into
                  dist/, gitignored), tests/, README.md
.claude-plugin/   marketplace.json: the Claude Code marketplace `dynjandi`, one plugin `dynjandi`, `"source": "./packages/agent-skills"`, no `version` (install id `dynjandi@dynjandi`); tests/marketplace.test.ts in packages/agent-skills checks it
.pnpmfile.cjs     gives openapi-typescript its own TypeScript 5 (it cannot run on TypeScript 7)
.worktree.yml     team settings for the worktree CLI (context/executors.md): source branch origin/main, branch prefixes
.changeset/       release notes, one file each; consumed by changeset:prepare-release (context/release.md)
.github/workflows/ci.yml                             lint, format, typecheck, build, package check, test, generated-types drift; setup tests on Ubuntu, macOS and Windows
.github/workflows/smoke.yml                          live smoke test: daily, workflow_dispatch, workflow_call
.github/workflows/management-api.yml                management API document check: daily, workflow_dispatch, workflow_call
.github/workflows/publish.yml                        publishes @dynjandi/sdk when its version is not on npm
.github/workflows/publish-cli.yml                    publishes @dynjandi/cli when its version is not on npm (first version by hand)
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
- Licence is MIT, copyright "Dynjandi contributors". The root `LICENSE` is copied into `packages/sdk/`, `packages/focal-picker/` and `packages/cli/` by their
  `prepack` (gitignored there) so the tarball carries it.
- Relative imports in `packages/sdk/src` end in `.js`: the emitted ESM has to resolve under Node, and the
  build compiles under `NodeNext` to enforce it. `packages/spec`'s `info.version` is the spec's version;
  the package's own `version` is unused (it is private).
- The live smoke test's key is `DYNJANDI_SMOKE_PROJECT_KEY`: an Actions secret in CI, a gitignored `.env` at the
  repository root locally. It belongs to a dedicated test project, and no tracked file holds it.

## Documentation

- `README.md` — the repository's front page, for anyone arriving from GitHub. It links the SDK and the spec
  and says how to install the SDK; a change to what is published, or to how, owes it an update.
- `packages/spec/README.md` — the spec's stable URL, versioning rule and contract summary. Changes to
  `openapi.yaml` that move `info.version` or the contract owe it an update.
- `packages/sdk/README.md` — the SDK's usage (`upload`, `getFile`, `url`, `srcset`, `pictureSources`, `placeholder`, using with Next.js, errors), what is tested where, the gzipped
  bundle-size baseline and the command that measured it, and how to run the live smoke test. A change to the
  SDK's public API or its dependencies owes it an update.

- `packages/focal-picker/README.md` — what the picker package holds so far (install, the element, `value` and its events, the crop previews and `ratios`, and the point and crop-geometry helpers), the React wrapper and its version range, the hand-off from the picker to `upload`, and that it is not published. It must not claim a feature before a phase has landed it, nor a version on npm before it is.

- `packages/cli/README.md` — status (on npm; later versions published by `publish-cli.yml`), the `setup` command (its credential, options, how the project and the env file are chosen, the Git rule, the summary and `--json`, the exit codes, the platforms and the known limit) and the `dev` options, what the server answers, the exit codes, and the CI and compose recipes for the renderer. It must not claim a feature before a phase has landed it, nor a version on npm before it is.

- `packages/agent-skills/README.md` — what the package is (a plugin root of agent skills, markdown only, not the planning workflow's `.claude/skills/`), its per-vendor install guide (each vendor's section cites its source and the date read), and how its checks run. A change to a README fact that a skill repeats owes the skill an update: **an SDK or CLI README fact that `packages/agent-skills/skills/` repeats** (an option, a flag, an exit code, a variable name, a default) **is changed there in the same change**. The skills link the README section each such sentence comes from, and the package's tests catch some drift (a command line the CLI would refuse, a snippet that no longer compiles, a link to a heading that moved) but not a sentence that went stale in prose. It must not claim a package is on npm before it is: a skill states a condition the agent checks (`npm view <package> version`), not a publish state.

- `packages/checker/README.md` — what the checker page checks, how to build and serve it, the grammar version
  and gzipped bundle size it records (with the command), and how `pages.yml` deploys it. A change to the
  checker's behaviour, its dependencies or its deployment owes it an update.

`@dynjandi/sdk` and `@dynjandi/cli` are the packages on npm from this repository: each one's first version by
hand, every later one by `publish.yml` and `publish-cli.yml` respectively (`@dynjandi/focal-picker` is public but unpublished; nothing publishes it yet) ([`release.md`](release.md) says how), and its README becomes the npm package page. The
spec is served from this repository's raw GitHub URL, and each release `publish.yml` makes is tagged
`sdk-v<version>`, which versions it. The private service repository describes the upload contract and URL
grammar for its own maintainers, but it is not a surface a change here has to reach.

## Also in `context/`

Verification commands are in [`verify.md`](verify.md), not here. Executor dispatch is in
[`executors.md`](executors.md), who commits is in [`git.md`](git.md), and what a change announces is in
[`release.md`](release.md).
