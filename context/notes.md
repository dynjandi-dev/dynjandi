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
