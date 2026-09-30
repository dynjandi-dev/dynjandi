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

**Build is empty on purpose.** Nothing here compiles to a shippable artefact yet: `@dynjandi/sdk` is a
private shell and typechecking is `tsc --noEmit`. The publish phase adds a build when `dist/` exists.

All commands run from the repository root and were run, exit 0, on 2026-09-30 (Node 24, pnpm 10.32.1).
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
```

## Test

```bash
pnpm test
```

## Not run by Gate 1

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
