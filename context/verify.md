# Verification commands

This project's real verification stack. **Gate 1 reads this file** — no skill, agent prompt or role file
carries a copy of these commands, because a hardcoded stack rots the moment the project changes shape.

This is the single home for every command in this project. If you find a command written down anywhere else
in `context/`, that copy is the one that is wrong.

Keep it in step with CI. If a command here fails while CI is green, this file is the one that is wrong.

Run `/onboard` to fill these sections in — it proposes candidates, **runs each one, and writes only the
ones that exit 0.** Filling them in by hand is fine too; running them first is not optional either way.

What each section takes, and the alternative answers written out, are in
[`verify.notes.md`](verify.notes.md). `/onboard` reads that file when it fills this one.

All commands run from the repository root and were run, exit 0, on 2026-10-22 (Node 24, pnpm 10.32.1), in
this tree and in a fresh clone prepared as *Prepare a fresh tree* says. `.github/workflows/ci.yml` runs the
same commands.

None of them looks inside `.phase-trees/`, where `/feature-implement` puts a round's scratch checkouts:
`.gitignore` lists it, and Biome, which does not read that file here, excludes it in `biome.json`'s
`files.includes`. Proven by `/onboard` on 2026-10-19 with a lint failure, a format failure and a failing
test planted under it — every command below passed over them.

## Lint

```bash
pnpm lint
pnpm format:check
```

`pnpm lint` also lints the OpenAPI spec: Biome over the code, then Redocly CLI (`recommended-strict`) over
`packages/spec/openapi.yaml`. A spec that does not validate fails it.

It also fails on a skipped or focused test — `.skip`, `xit`, `xdescribe`, `.only`, `fit` — because
`biome.json` raises `noSkippedTests` and `noFocusedTests` to `error`; at their default `warn` neither fails
the run, and Vitest reports a skipped test as a pass. Vitest's own `.fails`, `.todo`, `.skipIf` and
`.runIf` are not caught; none is used.

## Typecheck

```bash
pnpm typecheck
```

## Build

```bash
pnpm build
pnpm check:package
```

`pnpm build` compiles `@dynjandi/sdk` into `packages/sdk/dist/`, `@dynjandi/focal-picker` into
`packages/focal-picker/dist/` and `@dynjandi/cli` into `packages/cli/dist/` (ESM JavaScript and `.d.ts`; the SDK's build also copies the generated types
in, which `tsc` does not emit) under `NodeNext` resolution, so a relative import
missing its `.js` extension fails here and not in a consumer's build.

`pnpm check:package` runs for the SDK, for `@dynjandi/focal-picker` and for `@dynjandi/cli`. It packs the SDK exactly as `publish.yml` does (`pnpm pack`, whose `prepack` builds and
copies the root `LICENSE` in) and asserts the tarball holds `dist/`, `README.md`, `LICENSE` and
`package.json` and **nothing else** (so no `src/`, `tests/`, `scripts/` or `node_modules`), that its
`package.json` is not private and has no `workspace:`, `file:` or `link:` specifier, and then runs
`npm publish --dry-run` over the tarball. npm refuses a dry run over a version the registry already
holds, which is the state between releases, so the dry run is skipped (with a message) when
`npm view @dynjandi/sdk@<version>` returns that version; the assertions always run. The real dry run is
therefore seen on the change that bumps the version. The picker is not on npm at all, so `npm view` finds
nothing and its dry run always runs. Its tarball allowlist is the same four entries, and it requires
`dist/index.js`, `dist/index.d.ts`, `dist/element.js`, `dist/element.d.ts`, `dist/react.js` and `dist/react.d.ts`. It also fails when the packed `package.json` has `dependencies`, or when React and `react-dom` are not both optional peers (`peerDependenciesMeta`) or any other peer is present. The CLI's tarball allowlist is the same four entries, and it requires `dist/cli.js`, `dist/dev/options.js`, `dist/dev/server.js`, `dist/setup/options.js` and `dist/setup/run.js`; its `bin.dynjandi` must exist in the tarball and start with a `#!/usr/bin/env node` line. It is not on npm either, so its dry run always runs.

## Test

```bash
pnpm test
```

The picker runs two Vitest projects (`packages/focal-picker/vitest.config.ts`): `node`, its helper tests (including `tests/readme.test.ts`, which holds the README's hand-off snippets equal to the type-checked files in `tests/handoff/`) plus the
type-level test (`tests/sdk-compat.test-d.ts`, which `pnpm typecheck` covers as well), and `browser`, which runs
`tests/browser/**/*.browser.test.{ts,tsx}` in headless Chromium (the `.tsx` one renders the React wrapper through `vitest-browser-react`) through `@vitest/browser-playwright`. It needs the
browser installed (see *Prepare a fresh tree*); without it the browser project fails rather than skips. The picker
uses the `verbose` reporter so the output names the project of every test (`|node|`, `|browser (chromium)|`).
Failure screenshots land in `packages/focal-picker/.vitest/`, which `.gitignore` lists.

The CLI's run includes the offline contract suite (`packages/cli/tests/contract/local.test.ts`): the **api** cases of `packages/cli/tests/contract/cases.ts` against `dynjandi dev` started in process on a free port of `127.0.0.1`, with a `fetch` that refuses any URL outside `127.0.0.1`, so no request leaves the machine.

The CLI's `--containers` tests (`packages/cli/tests/containers.test.ts`) run `docker` as a fake on `PATH`, but open a real second listener on an address this machine lists in `os.networkInterfaces()` besides `127.0.0.1`: `::1`, or where IPv6 is off, the first non-internal IPv4 address. A machine with neither, such as a container with IPv6 off and `--network none`, fails them rather than skipping them.

`packages/agent-skills` runs three files, with no network and no model (`packages/agent-skills/tests/`). `skills.test.ts` runs the checks over **every** `packages/agent-skills/skills/*/SKILL.md` and the markdown under its `references/`, so a skill added later is covered with no edit: the frontmatter (`name` 1 to 64 characters of `a-z`, `0-9` and single hyphens, equal to its directory; `description` 1 to 1,024 characters; only the keys `name`, `description`, `license`, `compatibility` and `metadata`), a `SKILL.md` under 500 lines, every `dynjandi dev` and `dynjandi setup` line of a fenced `sh` block (its `npx @dynjandi/cli` or `node …/cli.js` prefix stripped) parsing through the CLI's own `parseDevOptions` and `parseSetupOptions` with no usage error, every `ts`, `tsx`, `js` or `jsx` block equal, character for character, to a file in `packages/agent-skills/tests/snippets/`, and every link to this repository (a relative path, or a `github.com/dynjandi-dev/dynjandi/blob/main` or `raw.githubusercontent.com/dynjandi-dev/dynjandi/main` URL) naming a file that exists and, with a `#anchor`, a heading in it. `marketplace.test.ts` checks `.claude-plugin/marketplace.json` (the required fields of code.claude.com's *Marketplace reference*, the names `dynjandi`, the source `./packages/agent-skills` holding a `plugin.json` of the same name, and no `version` in either file) and the package README's install commands (each names a skill or a path and pins a ref, none shows `--all`, `--allow-hidden-dirs` or an `npx skills` install). `checks.test.ts` tries each of those checks on text planted in the test, so each is shown to fail for what it is for. The snippets are compiled by `pnpm typecheck` (this package's `tsconfig.json` maps `@dynjandi/sdk` and `@dynjandi/sdk/next` to `packages/sdk/src/`, and the CLI's two option parsers to `packages/cli/src/`, so neither needs built output).

This excludes `packages/sdk/tests/live/` and `packages/cli/tests/live/`, which need a secret and the network, and `packages/cli/tests/management/`, which needs the network: see *Not run by Gate 1*. The CLI's `setup` tests (`packages/cli/tests/setup/`) are in the run: they use a stub management API injected as `fetch` (no port is opened) and a temporary directory, and never reach `app.dynjandi.dev`.

## Generated types

```bash
pnpm check:generated
```

Regenerates the SDK's types from `packages/spec/openapi.yaml` into a temporary file and diffs it against
`packages/sdk/src/generated/api.d.ts` **on disk** (not git HEAD), so it is right on an uncommitted tree. It
fails when the spec and the committed file disagree; fix with `pnpm --filter @dynjandi/sdk run generate`.
`openapi-typescript` needs TypeScript 5, so `.pnpmfile.cjs` gives it its own copy; the repo stays on 7.

## Not run by Gate 1

### Plugin validation

```bash
claude plugin validate .
```

Validates `.claude-plugin/marketplace.json` and the plugin it lists. It needs the `claude` binary, which this
repository does not install, so Gate 1 cannot run it. Run it by hand from the repository root after a change to
`.claude-plugin/` or to `packages/agent-skills/.claude-plugin/plugin.json`; `marketplace.test.ts` covers the
fields it checks that a machine without `claude` can.

### Plugin eval (paid)

```bash
claude plugin eval packages/agent-skills --scaffold --trust-plugin --json packages/agent-skills/evals/results/run.json --model <model> --judge-model <model> --max-cost-usd <usd>
```

Runs the four cases in `packages/agent-skills/evals/` with and without the plugin and reports each case's score,
the difference between the two, and whether its `Skill` grader fired. It is paid: every run, the judge and the
baseline call a model with your credentials. It needs Claude Code 2.1.269 or later and Git 2.31 or later, and it
is by hand only. Not in the gate, and not in CI.

- `--scaffold` runs `local-admin`'s `fixture.sh` (author-supplied Bash, run as you); without it that case starts in
  an empty workspace.
- `--trust-plugin` skips the first-run trust prompt; pass it only for this repository's own plugin.
- `--json [path]` writes the full run result; the path must end in `.json`. `evals/results/` is Git-ignored.
- Pin `--model` and `--judge-model` so two runs compare; unpinned, the model is the session's default and the
  judge is `haiku`.
- `--max-cost-usd` is a hard ceiling: the run aborts and reports partial results (exit `2`).
- `--ablation none --runs 1` is the cheap load check: one arm, one run per case.
- `--threshold` defaults to `1.0` and exits `1` below it. What pass line to hold is open (issue #44, section 9
  Q3); none is set here.

### Live smoke test

```bash
pnpm --filter @dynjandi/sdk run test:live
```

Uploads a 1x1 PNG with a focal point of (0.5, 0.5) to the dedicated test project on the live service,
then fetches SDK-built variants of it and reads it back, expecting 200 for each fetch:

- a 16w webp via `url()`, `image/*`;
- the record read back with `getFile`, asserted to carry the same id and the same point; a cropped URL
  built from that record, asserted to end in `focal/0.5x0.5/` (the stored point was used) and fetched,
  `image/*`. That proves the read endpoint and the record-built focal URL against the real service, not
  where the crop lands: the image is 1x1. It does not cover a later change of the point (in the dashboard,
  say): there is no public write endpoint, so the point can only be set at upload;
- one `srcset` candidate, a 320w png: `image/*` and a PNG body, whose width is written to stdout (not
  asserted) to show whether the service upscales a resize past the 1x1 original;
- one `avif` source from `pictureSources`: content type `image/avif` or `image/heif`, because the service
  currently mislabels AVIF as heif (dynjandi-core#98), and a body with an ISOBMFF `ftyp` box whose major
  brand is `avif`/`avis` or whose compatible brands include `avif`;
- the `placeholder`, `image/*`.

That is five variants per run, each counting against the test project's cap. It needs the project's key in
`DYNJANDI_SMOKE_PROJECT_KEY` and the network (`https://cdn.dynjandi.dev`), so `pnpm test` excludes `tests/live/` and never touches
either. It fails, rather than skips, when the key is unset.

It is not in the gate because it can go red with nothing in the diff: the service changes, the network
drops, the test project's quota fills. It belongs to whatever watches the service, not the change:
`.github/workflows/smoke.yml` runs it daily and on demand, and is callable (`workflow_call`): `publish.yml`
calls it before it publishes, with the key from the Actions secret `DYNJANDI_SMOKE_PROJECT_KEY`.

By hand, load the key from the gitignored `.env` at the repository root into the one command's
environment, without printing it:

```bash
(set -a; . ./.env; set +a; pnpm --filter @dynjandi/sdk run test:live)
```

Never `cat` the file or echo the variable. The test and the SDK keep the key out of their output, but a
shell trace or a pasted log would not.

### Live contract suite

```bash
(set -a; . ./.env; set +a; pnpm --filter @dynjandi/cli run test:live)
```

Runs the CLI's contract cases (`packages/cli/tests/contract/cases.ts`) against `https://cdn.dynjandi.dev` with the test project's key in `DYNJANDI_SMOKE_PROJECT_KEY`: both groups, **api** (upload, the file record, every `400`/`401`/`404` message, `no-store`, the original's bytes, `/<id>/-/` and unknown-operation `400`, the `OPTIONS` `405`) and **render** (a 40x20 PNG resized and cropped to four sizes, each read from the PNG header, one `format/webp/` variant, and the immutable `Cache-Control` on the original and the variants). It is one upload and five variants per run, each variant counting against the test project's cap. The offline run of the **api** group is in `pnpm test`; a case one target fails and the other passes is drift. `format/webp/` and the four sizes are not run offline, since a stub renderer cannot decode a picture; the end-to-end run below runs them against the real renderer.

Like the smoke test it needs the key and the network, fails rather than skips when the key is unset, and never prints it; `.github/workflows/smoke.yml` runs it after the SDK smoke test, with the secret given to that step only. Never `cat` `.env` or echo the variable.

### End-to-end run with the real renderer

```bash
pnpm build
pnpm --filter @dynjandi/cli run test:e2e
```

Starts the built `dynjandi dev` (`packages/cli/dist/cli.js`) as a child process with `--port 0` and a temporary
`--data-dir`, takes the origin from its ready line, and drives it with the real SDK and the real renderer image
that `dev` starts with Docker: an upload with a focal point, `getFile`, the original, the four sizes and the
`webp` variant of the contract's **render** cases (built with `client.url()` and read back from the PNG header
and the WebP signature), then `SIGTERM`: exit code `0` and no `dynjandi-renderer-*` container left.

It then runs the quick start's third command, `dynjandi dev -- node <script>`, with its own data directory and the
real renderer: the script reads `DYNJANDI_ORIGIN` and `DYNJANDI_PROJECT_KEY`, drives the real SDK (an upload, then a
`client.url()` variant fetched and its PNG width read), and exits `3` on purpose. The test asserts that `dev` exits
`3` (the script's code, not `dev`'s own `0` or `1`), that standard output holds only the script's line, that the
ready line went to standard error, and that no `dynjandi-renderer-*` container is left.

A second case, `tests/e2e/containers.e2e.test.ts`, starts `dynjandi dev --containers --json --port 0` with a
temporary `--data-dir` and takes `origin` and `containerOrigin` from the JSON line. It runs
`tests/support/container-app.mjs` in a Node container, pinned by version tag and digest
(`node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5`, the digest of the
tag's multi-arch index from `docker buildx imagetools inspect`; `NODE_IMAGE` in the test). In the container the
script drives the built SDK (`packages/sdk/dist`) with `origin` and `apiOrigin`: `GET /health` (`service` is
`dynjandi-dev`), an upload with a focal point, `getFile` and `client.url()`. The test then fetches the `url` and the
variant on the host: `200`, the uploaded bytes, a PNG of the asked size; a `Host: evil.example` request gets `421`;
`SIGTERM` exits `0` and leaves no `dynjandi-renderer-*` container. The container resolves the SDK by mounting the
whole repository, read-only, at the same path as on the host, because `node_modules` holds pnpm symlinks (the SDK's
`@dynjandi/transform-grammar`) that a mount of `packages/sdk` alone would leave dangling. The two files share one
container namespace and each asserts no `dynjandi-renderer-*` is left, so `test:e2e` runs them one after the other
(`--no-file-parallelism`).

Preconditions: `pnpm build` has been run (it uses the built bin, not the source); Docker is installed and its
daemon is running; the pinned renderer image (`ghcr.io/dynjandi-dev/renderer:0.2.0@sha256:...`, in
`packages/cli/src/dev/renderer-image.ts`) and the pinned Node image above are pulled or pullable, and while the package is private that needs a
`docker login ghcr.io` with an account that can read it. A first pull is about 100 MB; the test allows 180
seconds to start. `pnpm test` excludes `tests/e2e/`. It is not in the gate because it needs Docker and the
registry and can go red with nothing in the diff; whether CI runs it is open (issue #37, section 9 Q2).

A third case, `tests/e2e/setup.e2e.test.ts`, runs the built `dynjandi setup` and needs no Docker, so it can be run alone
(`pnpm build && pnpm --filter @dynjandi/cli exec vitest run tests/e2e/setup.e2e.test.ts`). It covers what only the built
binary shows: `--help`, `setup` with `CI=1` and no key exiting `3` with standard output empty, `--api-key` exiting `2`,
`setup --file <a new path>` exiting `3` (not Node's `9` for a missing `--env-file`, #66) and writing nothing, `--env-file`
refused with a message naming `--file`, and a tracked env file exiting `1` with the Git message (not `3`, so the guard runs
before the credential). No case reaches the network: the child process gets an environment without any `DYNJANDI_*`
variable (a key in the developer's shell is not passed on), and preloads a module that makes `fetch` exit `99`.

### Three-system setup tests

```bash
pnpm --filter @dynjandi/cli run test:setup
```

Runs `packages/cli/tests/setup/` only. `pnpm test` already runs them on this machine; the `setup` job of
`.github/workflows/ci.yml` runs this command on `ubuntu-latest`, `macos-latest` and `windows-latest` with Node 24, so the
env file's atomic rename, `.gitignore` line endings, file modes and path handling are proven on all three. It runs only
these tests because the rest of the CLI's suite puts a Unix script on `PATH` as `docker`
(`tests/support/fake-docker.mjs`) and the package's `build` script uses `rm` and `chmod`; the job therefore has no `build`
step, and the tests import from `src/`. Its first step sets `git config --global core.autocrlf false` before checkout, so
Windows does not check the README out with CRLF endings (a test reads its fenced blocks). It cannot be run for Windows or macOS from another system: its result is the
pull request's check.

### Management API document check

```bash
pnpm --filter @dynjandi/cli run test:management
```

Fetches `https://app.dynjandi.dev/api/openapi.json` with no key and asserts what `dynjandi setup` depends on: the bearer
scheme, `GET /api/projects` (an `id` and a `name` per project), `POST /api/projects` (a `name` of 1 to 200 characters;
`201` with `project.id`, `project.name` and `project.projectKey`; `409 NAME_TAKEN` with `details.projectId` and
`details.name`), `GET /api/projects/{id}` (`id`, `name`, `projectKey`; `404`), the error envelope, the id pattern and the
`Retry-After` header of a `429`, and the browser approval's two calls: `POST /api/device/code` (public; `device_code`, `user_code`,
`verification_uri`, `verification_uri_complete`, `expires_in`, `interval`), `POST /api/device/token` (public; `access_token`,
`token_type` `Bearer`, `expires_in`; the outcomes `authorization_pending`, `slow_down`, `access_denied`, `expired_token` and
`invalid_grant` as `400` error codes) and the `cliToken` scheme the three project calls accept. It sends no credential and writes nothing.

It is not in the gate because it can go red with nothing in the diff: the dashboard changes. It belongs to whatever
watches the service: `.github/workflows/management-api.yml` runs it daily, on demand, and is callable (`workflow_call`) as
the precondition of the CLI's publish workflow. It is deliberately not in `smoke.yml`, which `publish.yml` calls before an
SDK release.

### Focal crop capture

```bash
(set -a; . ./.env; set +a; pnpm --filter @dynjandi/focal-picker run capture:crops)
```

Uploads two gradient PNGs (510x255 and 255x510, built in memory; red rises with x, green with y) to the
dedicated test project, fetches 20 `crop/<w>x<h>/focal/<x>x<y>/` variants as PNG, decodes them and rewrites
`packages/focal-picker/tests/fixtures/service-crops.json` with the window each one showed, as fractions of the
source, with a per-row tolerance. The committed fixture is what the picker's crop geometry follows. A run is 22
requests (2 uploads, 20 variants), each variant counting against the test project's cap.

It is not in the gate for the same reasons as the smoke test: it needs the key and the network, spends the cap,
and can go red with nothing in the diff because the service changed. Run it by hand only when the service's
crop behaviour is in doubt. To compare the live service with the committed fixture without rewriting it, and
at about a quarter of the cost (6 requests), add `--check --every 6` after the script name; it exits non-zero when a
row differs by more than its tolerance. Never `cat` `.env` or echo the variable; the script never prints the key.

## Prepare a fresh tree

```bash
pnpm install --frozen-lockfile
pnpm --filter @dynjandi/focal-picker exec playwright install --only-shell chromium
```

The second command downloads the headless Chromium the picker's browser tests run in, at the Playwright version
the picker pins. On Linux, CI adds `--with-deps` for the system libraries.

What makes a clean checkout of this repository runnable, in order — the dependency install, and anything
else that has to exist before the sections above can pass. **Gate 1 does not run it**, which is why it sits
below that line: an ordinary phase works in a tree that is already prepared.

Nothing else is needed: nothing is generated before the gate (`api.d.ts` is committed), and `dist/`
is built by `pnpm build` itself. Verified on 2026-10-22 (Node 24, with the browser install above) in a `git clone --no-hardlinks` of
this repository: the install, then every section above, exit 0, and `git status --porcelain` printed
nothing afterwards.

**Empty is an answer with a cost.** `/feature-implement` runs phases side by side in fresh checkouts and
cannot without this, so it falls back to one phase at a time and names this section as the reason.

## Rules

- **A missing entry is skipped, never faked.** An empty section above means there is no such step. Gate 1
  skips it and says so; it never substitutes a command it invented.
- **Docs-only changes run Lint only**, plus a read of the diff. Skip build and test for changes that touch
  no application code.
- **Exit 0 is the verdict.** A non-zero exit is a Gate 1 failure regardless of what the summary text says.
- **If this file has no filled-in section at all, Gate 1 stops and says so.** It does not guess.
- **The four headings are not a limit.** They are what every project has; a section added above *Not run by
  Gate 1* is run like any other, in the order it appears. What decides where a check goes is whether this
  gate can afford it on every phase — not which of the four it sounds most like.
- **Cost is the first question about where a check goes, and attribution is the second.** A check that can
  turn red with nothing in the diff — a dependency audit, where an advisory is published against a lockfile
  nobody touched — blocks the next phase for a condition that phase did not cause, however fast it runs.
  Gate 1 cannot tell that from a defect the change introduced, so it goes under *Not run by Gate 1*, named
  to whatever watches the repository rather than the change. The exception is a project that holds the
  check clean as a standing invariant: there a red one really is this change's problem, and it belongs in
  a gate section like any other.
