# Notes

Branch-local, advisory. Nothing reads this file; `/feature-close` deletes it.

## Phase 1 — Gate 2, non-blocking

- `packages/agent-skills/vitest.config.ts` cites `tests/commands.test.ts`, which does not exist (the tests are `skills.test.ts` and `checks.test.ts`).
- Rules implemented with no test that fails if they stop: `compatibility` 1–500 and `metadata` string-to-string; empty or whitespace `name`/`description`; a 64-character `name` accepted; the "not YAML" and "not a mapping" branches; the link check's "not a markdown file" branch; the `npx dynjandi` prefix and the `tree/main` URL form.
- `listSkills` reads `references/` without checking it exists, so a skill with no `references/` makes the suite throw at load. Loud, not silent, but "a skill added later is covered with no edit" is then not quite true.
- The D5 404 sentence ("it is not published yet") in `SKILL.md` and `references/keys.md` will collide with any later test that bans the phrase "not published".
- §4.2 item 5's "core#312 removes it on the service" is not in the skill's migration section.
- D6 links that are missing or name a weaker source: `SKILL.md` cites SDK *Usage* for the `VITE_`/`NEXT_PUBLIC_` rule (CLI README *Env loaders and the inherited variable* says it); the stored-focal-point crop; `--api-key` in `keys.md`; `projectKey` needs 0.2.0 (the SDK CHANGELOG).
- `keys.md` says to run from the app's directory with `node packages/cli/dist/cli.js`, a path that only works from the checkout; `node <checkout>/packages/cli/dist/cli.js` is clearer. The CLI README has the same wording.
- `keys.md` omits `setup`'s exit `1`; `nextjs.md` drops the README's "when this was tested" qualifier on the original format being served.
- Style against `typescript/rules.md`: one `as Record<string, unknown>` after `yaml.parse`; module-level arrow-function constants in `checks.test.ts` and `vitest.config.ts`; `noPropertyAccessFromIndexSignature` off for all of `tests/`, not only snippets.
- Loopback re-review: `nextjs.md`'s last bullet repeats the line above it about `createDynjandiLoader({ origin, format })`, and the two fixed sentences run past the ~110-column wrap.

## Phase 2 — Gate 2, non-blocking

- `tests/snippets/local-next-loader.js` copies `https://cdn.dynjandi.dev` by hand (the loader's `origin?: string` type forces a fallback); it drifts silently if the SDK's `DEFAULT_ORIGIN` changes.
- `dynjandi-local-dev` SKILL.md says "there is no option to listen anywhere else", then that `--containers` adds an address; the CLI README's "the one flag that listens anywhere else is `--containers`" reads better.
- "Run on macOS only" understates the CLI README, which says Linux CI covers the parts that need no Docker.
- The publish-state check is not listed in the package README's *How the skills are kept true* or in `context/verify.md` *Test* (incomplete, not untrue).
- The banned-phrase list misses "not yet on npm" (the SDK README's own wording), "isn't on npm", "unpublished".
- `node packages/cli/dist/cli.js` is relative to the dynjandi checkout while `dev` runs from the app's directory (same as the CLI README).
- `references/containers.md` says an older SDK "refuses `apiOrigin` at compile time" — TypeScript only; plain JS ignores the key.
- Loopback re-review: no test checks that `DYNJANDI_PROJECT_KEY` never appears in a snippet's `env:` or a `NEXT_PUBLIC_` name; and `dynjandi/references/nextjs.md` says to pass `origin` to `createDynjandiLoader` without saying how it reaches the browser (a pointer to the local-dev skill's §3 would close it).
- Loopback 2 re-review: "or run `next dev`" could say `dynjandi dev -- next dev` outright; `sh -c "next build && next start"` calls a bare `next`, which needs `node_modules/.bin` on PATH (likely under `npx @dynjandi/cli`, not under the checkout's `node packages/cli/dist/cli.js`) — `npx next …` or the project's scripts are safer; `sh -c` is POSIX-only (Windows is already stated as untried).
