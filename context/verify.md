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

All commands run from the repository root and were run, exit 0, on 2026-10-01 (Node 24, pnpm 10.32.1).
Install first with `pnpm install --frozen-lockfile`. `.github/workflows/ci.yml` runs the same commands.

## Lint

```bash
pnpm lint
pnpm format:check
```

`pnpm lint` also lints the OpenAPI spec: Biome over the code, then Redocly CLI (`recommended-strict`) over
`packages/spec/openapi.yaml`. A spec that does not validate fails it.

## Typecheck

```bash
pnpm typecheck
```

## Build

```bash
pnpm build
pnpm check:package
```

`pnpm build` compiles `@dynjandi/sdk` into `packages/sdk/dist/` (ESM JavaScript and `.d.ts`, with the
generated types copied in, which `tsc` does not emit) under `NodeNext` resolution, so a relative import
missing its `.js` extension fails here and not in a consumer's build.

`pnpm check:package` packs the SDK exactly as `publish.yml` does (`pnpm pack`, whose `prepack` builds and
copies the root `LICENSE` in) and asserts the tarball holds `dist/`, `README.md`, `LICENSE` and
`package.json` and **nothing else** (so no `src/`, `tests/`, `scripts/` or `node_modules`), that its
`package.json` is not private and has no `workspace:`, `file:` or `link:` specifier, and then runs
`npm publish --dry-run` over the tarball. npm refuses a dry run over a version the registry already
holds, which is the state between releases, so the dry run is skipped (with a message) when
`npm view @dynjandi/sdk@<version>` returns that version; the assertions always run. The real dry run is
therefore seen on the change that bumps the version.

## Test

```bash
pnpm test
```

This excludes `packages/sdk/tests/live/`, which needs a secret and the network: see *Not run by Gate 1*.

## Generated types

```bash
pnpm check:generated
```

Regenerates the SDK's types from `packages/spec/openapi.yaml` into a temporary file and diffs it against
`packages/sdk/src/generated/api.d.ts` **on disk** (not git HEAD), so it is right on an uncommitted tree. It
fails when the spec and the committed file disagree; fix with `pnpm --filter @dynjandi/sdk run generate`.
`openapi-typescript` needs TypeScript 5, so `.pnpmfile.cjs` gives it its own copy; the repo stays on 7.

## Not run by Gate 1

### Live smoke test

```bash
pnpm --filter @dynjandi/sdk run test:live
```

Uploads a 1x1 PNG to the dedicated test project on the live service, then fetches one SDK-built variant
and expects 200 with an `image/*` content type. It needs the project's key in `DYNJANDI_SMOKE_PUBLIC_KEY`
and the network (`https://cdn.dynjandi.dev`), so `pnpm test` excludes `tests/live/` and never touches
either. It fails, rather than skips, when the key is unset.

It is not in the gate because it can go red with nothing in the diff: the service changes, the network
drops, the test project's quota fills. It belongs to whatever watches the service, not the change:
`.github/workflows/smoke.yml` runs it daily and on demand, and is callable (`workflow_call`): `publish.yml`
calls it before it publishes, with the key from the Actions secret `DYNJANDI_SMOKE_PUBLIC_KEY`.

By hand, load the key from the gitignored `.env` at the repository root into the one command's
environment, without printing it:

```bash
(set -a; . ./.env; set +a; pnpm --filter @dynjandi/sdk run test:live)
```

Never `cat` the file or echo the variable. The test and the SDK keep the key out of their output, but a
shell trace or a pasted log would not.

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
