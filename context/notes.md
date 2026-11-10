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
