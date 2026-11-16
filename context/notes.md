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

## Phase 3 — The `setup` command and its docs

- A server-supplied stored name reaches a stderr note in `packages/cli/src/setup/run.ts` without `printable()`,
  though `sentence()` and the error path both use it.
- `packages/cli/src/errors.ts` says a `pending` failure exits `4`, but `run.ts` maps it to `1`; latent until browser
  approval exists.
- The duplicate-line and different-key refusals are local but run only after the project lookup (`planEnvChange`
  after `settle`); under browser approval a person would approve and then be refused.
- `packages/cli/README.md` has a double blank line near the top.
- The exact summary sentences ("Created the project …") are pinned from the implementation; §4's example wording
  differs.
- A dry run can't see a negation rule that the real run's re-check would refuse, so it exits `0` where the real run
  exits `1` — per D11's "steps 1 to 5", but the README's "a dry run that a real run would carry out" overstates it.
- `MainSettings` carries `git` where §4 names `spawn`; the opener's fields are left to browser approval.

## The `--file` rename (#66, before Phase 4)

- No test sends `--env-file` through `main` and asserts exit `2`; the refusal is pinned as a `UsageError` in
  `packages/cli/tests/setup/options.test.ts`, and the usage-error-to-`2` mapping only generically, with `--api-key`.
- The internal names stay `envFile` (`SetupOptions`, the `--json` summary key) and `env-file.ts`: they are not option
  names.

## Phase 4 — Proof on every OS and against the live API document

- `projectKey` is checked only as a string in `packages/cli/tests/management/document.test.ts`; `api.ts` refuses
  anything but 64 lowercase hex, and the document states that only in prose, so there is no pattern to pin.
- `details.projectId`'s pattern in the `NAME_TAKEN` response is not asserted, though the document carries it.
- The `servers` assertion is an exact `toEqual`, so a `description` added to the entry turns it red although
  `setup` never reads `servers`.
- Some e2e expectations come from the code rather than a documented source (`.env.local is tracked by Git`,
  the two `Usage:` first lines).
- Two `as Json[]` casts in `document.test.ts` against `context/standards/typescript/rules.md`'s narrowing rule.
- `management-api.yml` and `context/verify.md` name `publish-cli.yml` as its caller; Phase 6 creates it.
- `context/stack.md`'s CI row places the `setup` job after the `pages.yml` clause, so "a second job" is hard to read.
- `env-file.test.ts` runs two real renames onto one target at once; on Windows that leans on the rename retry.
- The empty `GIT_CONFIG_GLOBAL` file (`packages/cli/tests/support/git-config.ts`) keeps a global `core.excludesFile`
  out, but Git still reads its default global ignore, `$XDG_CONFIG_HOME/git/ignore`; `/dev/null` let it through
  too. An `excludesFile` pointing nowhere, or `XDG_CONFIG_HOME` set to the helper's directory, would close it.
- In `leak.test.ts` the new `beforeAll`/`afterAll` sit between two `let` declarations; `removeEmptyGitConfig`
  throws on `undefined` if `beforeAll` already failed.
