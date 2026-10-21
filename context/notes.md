# Notes

Non-blocking observations from the gates, for a person. Nothing reads this file; `/feature-close` deletes it.

## Phase 1 — The checking function and its tests

- `packages/checker/src/check.ts`'s refusal of a path whose first segment after the id is not `-` has no
  test of its own: both refusal paths say "no operations", so removing it passes. `${ID}/resize/100x100/-/format/webp/`
  expected to be refused would pin it.
- A filename in the middle of a chain (`-/resize/100x100/photo.jpg/-/format/webp/`) is accepted per operation,
  while the whole-chain parser rejects it. The Dynjandi URL the checker builds still serves; Uploadcare puts
  filenames only at the end.
- `rewriteNote` reads input tokens: `scale_crop/300x200/photo.jpg` gets no defaults-to-center note.
- The test that an upper-case UUID keeps its case has no source in the spec or plan (relates to §9 Q5).
- Wording: the "follows … but is not part of its arguments" sentence misreads a bad position as a stray
  operation; unsupported names are shown percent-encoded; the supported-operations list in the unsupported
  sentence is hand-written; "That is not a URL." gives no next step.
- The root `pnpm build` filters to the SDK, so it never runs the checker's `build`.

## Phase 2 — The page

- `dist/main.js` is 96,247 bytes gzipped (`gzip -c dist/main.js | wc -c`), not the ~65 KB the plan quotes:
  the grammar README's 65,401 is a `buildVariantUrl`-only control, and zod 4.6.5's locale files ride along.
  §9 Q4 was asked against the smaller number.
- `index.html`'s result `<section>` names `aria-labelledby="result-heading"`, an id that exists only after the
  first render.
- `src/render.ts` is not on the plan's Files line; it holds the rendering so `render.test.ts` drives the real path.
- Rules no test pins: D6's order (operation list before the URL block), the glyph's `aria-hidden`, the
  label/live-region markup in `index.html`, and the build's grammar-version substitution. The "shown decoded"
  test only asserts the absence of `%3C`.
- The keyboard pass was CDP-driven headless Chrome, not a person with a screen reader; announcement is
  inferred from the `aria-live="polite"` wrapper.
- `rel="noopener noreferrer"` on the result link does nothing without `target`.

## Phase 3 — Publish it and document it

- The first merge to `main` triggers `pages.yml`; it fails unless Pages (source "GitHub Actions") is enabled
  first. Enable it before merging, or re-run with `workflow_dispatch` after.
- `pages.yml`'s path filter leaves out `tsconfig.base.json`, the root `package.json` and `.pnpmfile.cjs`, which
  can affect the build. No `timeout-minutes` is set (`smoke.yml` uses 5).
- `context/stack.md`'s Hosting row says "GitHub Pages serves", present tense, qualified by "once".
- `context/release.md`'s "One event ships anything" and "a feature's merge ships nothing", and
  `.changeset/README.md`'s "ships nothing", now have the checker page as an exception.
- `packages/checker/README.md` says `release.md` has "no row" for the package; its "everything else" row
  arguably covers it. Either way no note is owed.
- The repository and stack intros do not mention the checker (incomplete, not false).
- §8's live check used a fresh upload to the smoke project, not an imported file: it checks the grammar, not
  that an import keeps the Uploadcare id (§1's assumption, §9 Q5).
