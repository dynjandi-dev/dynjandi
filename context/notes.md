# Notes

Non-blocking review observations for the active feature (#37, local-dev-server). Read by nothing;
`/feature-close` deletes this file.

## Phase 1

- The ready line prints `renderer: docker` by default though nothing starts Docker until Phase 5; the README
  says only that the renderer flags do nothing yet.
- Signals are tested by `process.emit` in-process; the entry-point block in `packages/cli/src/cli.ts`
  (`realpathSync` comparison, `process.exitCode`) has no test until Phase 6's real run.
- `cli.ts` adds the SIGINT/SIGTERM listeners before `startServer`; a failed start leaves them registered
  (harmless in the CLI, leaks across tests in one worker).
- `packages/cli/package.json` sets `"sideEffects": false` while `cli.ts` runs top-level code as the bin.
- `context/stack.md`: the CI row's "nothing publishes the picker" does not mention the CLI; the intro has two
  "and"s in a row.
- `--port 04600` is accepted as 4600.
- `tests/server.test.ts` port-taken case calls `startServer` twice without closing the failed servers.

## Phase 2

- Unpinned rules (mutations survive): the D7 `Content-Length` pre-check alone, the D6 temp-file-then-rename and
  record-last order, and the explicit `request.resume()` (Node discards the unread body anyway). The large-body
  subprocess test covers the `Content-Length` path only; the streamed overflow is pinned at small sizes only.
- `FRAMING = 65_536` in `tests/api.test.ts` copies the implementation's multipart allowance; a file at the cap
  with more than 64 KiB of other fields is a `413`.
- `@northguild/gmt` declares `engines.node >=22.16.0`; `@dynjandi/cli` declares `>=22`.
- §9 Q4 open: `formData()` verified on Node 24.22.1 only; CI's Node 22 leg answers it once the branch is pushed.
- `getUtcNow()` gives nanosecond `createdAt` (the service writes milliseconds); a bare `Blob` is stored as
  `originalFilename: "blob"` and no test asserts it (§9 Q7, compared live in Phase 4).
- `readBody` resolves a client abort as a `413` rather than reaching the 500 path; `trackedFiles` and
  `removeTemporaryFiles` swallow every error, EACCES included.
- `scripts/check-package.mjs`'s required list does not name `dist/dev/{api,store,project-key,responses}.js`.
- `dist/dev/store.d.ts` type-imports `@dynjandi/sdk`, a devDependency (harmless for a bin with no `types`).
- `openStore` runs before `listen`, so a taken port still creates `.dynjandi/`; `server.test.ts`'s `mkdtemp`
  directory is never removed.
- The gmt lint plugin `tooling/dates.md` asks for is not set up anywhere in the repo (predates this feature).

## Phase 3

- Unpinned (mutations survive): only renderer `200` counts as success (any other 2xx is a `502`), the
  `Render failed` fallback for a non-JSON error body, the Docker ready-line wording, and the 30 s default
  `DEFAULT_RENDER_TIMEOUT_MS`.
- On a renderer 5xx the renderer's own `{ error }` text is neither read nor logged; stderr gets the status only.
- `renderer.ts` casts `original as Uint8Array<ArrayBuffer>` for fetch's body typing, and names a helper
  `describe` (Vitest's name).
- The stub's `/focal-suggestion` answer omits `detector` (grammar README); nothing calls it yet.

## Phase 4

- The contract fixture no longer asserts its own `201`; a refused upload shows as the upload case failing plus
  secondary failures in the cases that use it (still red, less clear).
- `loopbackOnly` in `tests/contract/local.test.ts` is a prefix check: `http://127.0.0.1:1@example.com/` passes it.
  Cases only build URLs from `target.origin`; `new URL(url).hostname` would close it.
- The D9 cache header is asserted against the CDN only (render group); locally it is pinned by `api.test.ts` and
  `variants.test.ts` until Phase 6 runs **render** against the real renderer.
- Variant fetches retry on 404/5xx up to 4 times, so a flaky day spends more of the test project's cap.
- `smoke.yml` keeps `timeout-minutes: 5` with the contract step added; tight only on an already-failing run.
- §4.6 says "six variants"; its own list is five (four PNG sizes and webp), which is what the suite and docs say.
- §9 Q7 stays open: `createdAt` is checked for format only, and the fixture is a named `File`, so the bare-`Blob`
  filename is never sent to the CDN.

## Phase 5

- Checked with the real `docker` (Phase 6): with the pinned image cached, `docker pull <tag@sha256>` under an
  empty `DOCKER_CONFIG` exits `0` ("Image is up to date"), so an expired `docker login` does not stop `dev`. A
  fully offline machine was not tried.
- Also unverified against real Docker: the stderr of a down daemon and of a denied ghcr pull (the fake's strings
  are guesses); a terminal Ctrl-C during the pull can race the abort and exit `1` "could not pull"; a signal
  in the first health poll can send `docker stop` before the container exists; `docker stop` waits out its
  10 s grace if the renderer ignores SIGTERM as PID 1.
- Any failing `docker version` reads "Docker is not running … start Docker"; on Linux a socket permission error
  needs a different fix.
- Unpinned (mutations survive): the 60 s `DEFAULT_HEALTH_TIMEOUT_MS`, the `container.kill` fallback when
  `docker stop` fails, `docker port` without the abort signal, a ready line printed when a signal lands between
  healthy and `listen`, and `localhost` for `127.0.0.1` in the renderer URL.
- `docker.test.ts`'s `not.toContain(...)` checks on `io.stdout` cannot fail (child output could only reach
  the real `process.stdout`); D12 is pinned by the last-log-lines assertions instead.
- `isHealthy` drops the last `/health` fetch error, so the never-healthy message has the container's logs but
  not why the probe failed.
- `fake-docker.mjs`'s `run` polls for its stop marker with no lifetime cap, so a red test run leaves it running
  under PID 1 (six were left by development runs and killed by hand).
- Tests use `as` casts (`JSON.parse(line) as string[]`, the spawn options); the header comment of
  `docker.test.ts` does not list the three tests the loopback added (each cites §4.5 beside it).
- `docker.test.ts` "starts the pinned image locked down…" failed once under a load average near 176
  (`callsTo("run")[0]` undefined) and passed five reruns: the fake's `port` answers at once and the stub is
  already healthy, so the ready line can precede the fake `run` process logging its arguments. Real
  `docker port` fails until the container exists; a fake that does the same removes the race.

## Phase 6

- The CI recipe waits on `dev`'s `/health`, which answers whether or not the renderer is up, and the image has no
  `HEALTHCHECK`; waiting on the service's own `http://localhost:8080/health` too would be safer.
- The CI recipe publishes `8080:8080` on every interface (harmless on hosted runners); the compose example binds
  `127.0.0.1`.
- The compose shell line runs `dynjandi dev`, which is not on `PATH` outside this repository until the package is
  published (§9 Q3); the CI snippet uses `node packages/cli/dist/cli.js`.
- `context/verify.md` *Test* still names only the `tests/live/` excludes; its e2e section says `tests/e2e/` is
  excluded too.
- `dev.e2e.test.ts`'s container check filters on `dynjandi-renderer-`, so another running `dev` would fail it;
  `dynjandi-renderer-${child.pid}-` would tie it to this run. A broken ready line fails after the 180 s
  `beforeAll` timeout rather than with a message, and `afterAll` dereferences an unset `child` if setup fails early.
- The e2e test cannot see `--read-only` or the image reference (both pinned by `docker.test.ts`); the `stack.md`
  *Runtime* row is unchanged, the CLI's dependencies and Docker being in the paragraph above it.
- Named arrow consts `fixture` and `casesFor` in the e2e test (`typescript/rules.md` prefers `function`).
- `packages/cli/tests/contract/local.test.ts:9` says "the real one is Phase 6's"; still true, but a phase reference
  that reads oddly once the plan is archived.

## Phase 5 amendment (D15–D17), Gate 2 notes

- The `docker ps --format` template in `docker.ts` (`stopOrphans`) is untested: the fake ignores `--format`, so
  only the by-hand run on real Docker covers it.
- The cleanup's failure paths (`could not list earlier renderers`, `could not stop renderer`, and the catch that
  lets start-up go on) and `isGone` treating `EPERM` as alive have no test.
- `isGone` reads `(error as NodeJS.ErrnoException).code`, a type assertion `typescript/rules.md` discourages.
- A denied pull prints Docker's error twice: once streamed, once quoted in the failure line.
- The dead-pid fixture assumes a just-exited child's pid is not reused during the test.
