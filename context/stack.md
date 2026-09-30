# Stack

What this project is, and what an agent has to know before touching it. Run `/onboard` to fill it in.

What each section takes is in [`stack.notes.md`](stack.notes.md). `/onboard` reads that file when it fills
this one.

The public integration surface for Dynjandi, an image CDN at `cdn.dynjandi.dev`: an OpenAPI spec and a
TypeScript SDK (`@dynjandi/sdk`). The service itself lives in a separate private repository; this one was
split out of it on 2026-09-30 so the spec and SDK can be public and permissively licensed.

**Two package shells exist and nothing else yet.** `packages/spec` holds no spec yet and `packages/sdk` holds
an empty entry point and a placeholder test; both are `private`. The design is in issue #1
(`sdk-ecosystem`), not here.

| Concern | Target |
|---|---|
| Runtime | Node 22 and 24 (`engines.node >=22`); the SDK targets `fetch`, `FormData` and `Blob` only |
| Language | TypeScript 7 (strict, `tsconfig.base.json`), ESM |
| Package manager | pnpm 10 workspaces, no Nx (`packageManager` in `package.json`) |
| Lint and format | Biome 2 (`biome.json`), scoped to code: `context/`, `.claude/` and `.agents/` are ignored |
| Test | Vitest 5 |
| CI | GitHub Actions, `.github/workflows/ci.yml`, Node 22 and 24 |
| Database | None |
| Storage | None |
| Hosting | None; nothing is deployed from here |

## Layout

```
package.json, pnpm-workspace.yaml, pnpm-lock.yaml   workspace root and scripts
tsconfig.base.json, biome.json, LICENSE (MIT)        shared config
packages/spec/    OpenAPI spec package (shell)
packages/sdk/     @dynjandi/sdk: src/, tests/, tsconfig.json (shell)
.github/workflows/ci.yml                             lint, format, typecheck, test
context/   workflow state and project answers (verify, git, tracking, release, executors, standards)
```

## Conventions

- Tooling versions are pinned exactly in the root `package.json`; GitHub Actions are pinned to a major tag.
- Root scripts are the single entry points (`lint`, `format`, `format:check`, `typecheck`, `test`); the
  workspace scripts they fan out to (`pnpm -r run`) live in each package.
- Each package extends `tsconfig.base.json`; generated code goes under a `generated/` directory, which Biome
  ignores.
- Licence is MIT, copyright "Dynjandi contributors".

## Documentation

- `README.md` — the repository's front page, for anyone arriving from GitHub or npm. First version written;
  it owes updates when the spec and SDK become publishable.

Nothing is published outside this repository. The private service repository describes the upload
contract and URL grammar for its own maintainers, but it is not a surface a change here has to reach.

## Also in `context/`

Verification commands are in [`verify.md`](verify.md), not here. Executor dispatch is in
[`executors.md`](executors.md), who commits is in [`git.md`](git.md), and what a change announces is in
[`release.md`](release.md).
