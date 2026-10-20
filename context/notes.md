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
