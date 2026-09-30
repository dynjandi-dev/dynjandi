# Notes

Non-blocking observations from the review gate, for a person. Nothing reads this file; `/feature-close`
deletes it.

## Phase 1 — Workspace, toolchain and CI skeleton

- `tooling/biome.md` says to use `biome ci` in pipelines; `ci.yml` runs `biome check --formatter-enabled=false .`
  and `biome format .` instead — same effect (read-only, exit 1 on findings), and it keeps CI identical to
  `verify.md`.
- `packageManager` pins `pnpm@10.32.1`; latest 10.x is 10.34.6, latest overall 12.8.1.
- No dependency audit anywhere (`tooling/ci.md` asks for `pnpm audit --audit-level=high` when dependencies
  change). Per `verify.md`'s rules it belongs under *Not run by Gate 1*, run by something watching the repo.
- `packages/sdk/package.json` calls `tsc` and `vitest` through the root's hoisted bins and declares no
  devDependencies of its own — worth revisiting when phase 6 makes the package publishable.
- The reason Build is empty sits in `verify.md`'s preamble, not under `## Build`.
- `README.md`'s package table describes what the packages will be; the "empty shells" status line above it is
  what keeps it true today.
