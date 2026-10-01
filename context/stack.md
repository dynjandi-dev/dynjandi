# Stack

What this project is, and what an agent has to know before touching it. Run `/onboard` to fill it in.

What each section takes is in [`stack.notes.md`](stack.notes.md). `/onboard` reads that file when it fills
this one.

The public integration surface for Dynjandi, an image CDN at `cdn.dynjandi.dev`: an OpenAPI spec and a
TypeScript SDK (`@dynjandi/sdk`). The service itself lives in a separate private repository; this one was
split out of it on 2026-09-30 so the spec and SDK can be public and permissively licensed.

**The spec and the SDK's two operations exist; nothing is published.** `packages/spec/openapi.yaml`
describes `POST /upload` and the variant URL grammar, and is linted by `pnpm lint`. `packages/sdk` has
`createClient`, `upload`, `url` and `DynjandiError`; upload types are generated from the spec, and `url()`
maps its options onto `@dynjandi/transform-grammar`'s operations and builder. Both packages are `private`. The design is in issue #1
(`sdk-ecosystem`), not here.

| Concern | Target |
|---|---|
| Runtime | Node 22 and 24 (`engines.node >=22`); the SDK targets `fetch`, `FormData` and `Blob` only, with one runtime dependency, `@dynjandi/transform-grammar` (which brings `zod`) |
| Language | TypeScript 7 (strict, `tsconfig.base.json`), ESM |
| Package manager | pnpm 10 workspaces, no Nx (`packageManager` in `package.json`) |
| Lint and format | Biome 2 (`biome.json`), scoped to code: `context/`, `.claude/` and `.agents/` are ignored; the OpenAPI spec is linted by Redocly CLI (`recommended-strict`), called from the root `lint` script |
| Test | Vitest 5 |
| CI | GitHub Actions, `.github/workflows/ci.yml`, Node 22 and 24 |
| Database | None |
| Storage | None |
| Hosting | None; nothing is deployed from here |

## Layout

```
package.json, pnpm-workspace.yaml, pnpm-lock.yaml   workspace root and scripts
tsconfig.base.json, biome.json, LICENSE (MIT)        shared config
packages/spec/    openapi.yaml (OpenAPI 3.1, upload + URL grammar prose), README.md
packages/sdk/     @dynjandi/sdk: src/ (client, upload, url, errors, generated/api.d.ts), tests/, tsconfig.json
.pnpmfile.cjs     gives openapi-typescript its own TypeScript 5 (it cannot run on TypeScript 7)
.github/workflows/ci.yml                             lint, format, typecheck, test, generated-types drift
context/   workflow state and project answers (verify, git, tracking, release, executors, standards)
```

## Conventions

- Tooling versions are pinned exactly — shared tools in the root `package.json`, a package's own tools (Redocly
  in `packages/spec`) in that package's; GitHub Actions are pinned to a major tag.
- Root scripts are the single entry points (`lint`, `format`, `format:check`, `typecheck`, `test`,
  `check:generated`); the workspace scripts they fan out to (`pnpm -r run`, or `pnpm --filter` for the
  spec lint and `check:generated`) live in each package.
- Each package extends `tsconfig.base.json`; generated code goes under a `generated/` directory, which Biome
  ignores. It is committed, never edited by hand: `pnpm --filter @dynjandi/sdk run generate` rewrites
  `packages/sdk/src/generated/api.d.ts` from the spec, and `pnpm check:generated` fails if it is stale.
- Licence is MIT, copyright "Dynjandi contributors".

## Documentation

- `README.md` — the repository's front page, for anyone arriving from GitHub or npm. First version written;
  it owes updates when the spec and SDK become publishable.
- `packages/spec/README.md` — the spec's stable URL, versioning rule and contract summary. Changes to
  `openapi.yaml` that move `info.version` or the contract owe it an update.

Nothing is published outside this repository. The private service repository describes the upload
contract and URL grammar for its own maintainers, but it is not a surface a change here has to reach.

## Also in `context/`

Verification commands are in [`verify.md`](verify.md), not here. Executor dispatch is in
[`executors.md`](executors.md), who commits is in [`git.md`](git.md), and what a change announces is in
[`release.md`](release.md).
