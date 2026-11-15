# Notes

Non-blocking review notes for this feature's phases (#35, `cli-project-setup`). Nothing reads this file;
`/feature-close` deletes it.

## Phase 1 — Management client and secret handling

- The `CODE: message` failure format and control characters becoming spaces (`packages/cli/tests/setup/api.test.ts`)
  are the client's own wording; no plan row decides them. Phase 3's summary and leak tests are where they get a source.
- `redact()` keeps one module-level registry of every `Secret`, so the `getProject` scrubbing test
  (`api.test.ts`, "scrubbed by redact") proves its point only when run alone; a sweep should use a key no earlier
  test has built.
- Two guarded `as` casts in `packages/cli/src/setup/api.ts` (the error envelope and the project list) against
  `context/standards/typescript/rules.md`'s "narrowing over assertions".
- A transport failure is rebuilt as a `ManagementError` without `{ cause }` (`api.ts`), against
  `context/standards/typescript/error-handling.md`; defensible under D12, since a `cause` could carry unredacted text.
- The 401 message is D3's wording, hard-coded; D18's "the approval expired; run again" needs it to depend on which
  credential was used.
- `redirect: "error"` and treating a `201` without the `{ project }` wrapper as an unknown outcome are additions the
  plan does not name; both are justified at the trust boundary.

## Phase 2 — Env file and Git guard

- An empty `NAME=` is treated as unset and filled without `--force` (`packages/cli/src/setup/env-file.ts`); D8 says
  only "a different key or id", so the reading has no source in the plan yet.
- A plan that both replaces one line and appends another reports `append`; the Scope names the four kinds but not
  this mixed case. Harmless while the caller maps both to a write.
- The tracked check passes the file name to `git ls-files` as a pathspec, so `*.env` is refused as tracked when
  `a.env` is; a refusal, never a leak. `:(literal)` would make it exact.
- `lstat(...).catch(() => undefined)` in `packages/cli/src/setup/git.ts` treats any error as "no file", and a
  `check-ignore` exit `128` is read like `1`; both fail safe.
- `spawnGit` is an arrow assigned to a `GitRunner` type, where `context/standards/typescript/rules.md` asks for a
  `function` declaration.
- D7's "say once on stderr" sentence for `no-repo` is not in `git.ts`, which only returns `no-repo`; it belongs to
  `setup`'s runner.
- The coder reports writing each test file in one pass with its implementation, not red first.
