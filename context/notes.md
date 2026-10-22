# Notes

Branch-local review notes for `feature/4-focal-point-picker`. Nothing reads this file; `/feature-close`
deletes it.

## Phase 1 — Package scaffold and point helpers

- Nothing pins D1's "no runtime dependencies": `packages/focal-picker/scripts/check-package.mjs` never
  inspects the packed manifest's `dependencies`, nor `dist/*.js` for bare-specifier imports.
- `context/release.md`: "No dependent can be dragged into a release: the SDK depends on no workspace
  package" no longer covers the picker, which has the SDK as a devDependency; "changesets would version and
  tag it" — only if a note names it, and tagging is `publish.yml`'s.
- `context/release.md`'s picker row says it deserves a note "once it is published". The plan said "notes
  like the SDK's", so `/feature-close` for #4 should settle whether this feature writes a picker note.
- `publish.yml`'s build job runs the root scripts, so a picker failure now blocks an SDK publish; no doc says
  so.
- Cosmetics: the picker's `package.json` description says "Not yet published."; its README links
  `../sdk/README.md`, which will not resolve on npm; `context/stack.md`'s `.js`-imports convention names only
  `packages/sdk/src`, and one line there has a doubled parenthetical.

## Phase 2 — Measure the service's crop geometry

- Done-when's "re-running reproduces the same rows" was checked on 4 of the 20 rows (`--check --every 6`)
  to stay inside the quota; a full `--check` is 22 requests.
- The ~0.002 `top` in the downscaled landscape rows is the instrument, not the service:
  `capture-crops.mjs`'s gradient puts value/255 at pixel `x+1`, not the pixel centre, on a 255-px axis. Its
  comment says otherwise. Within tolerance.
- The tolerance comment says "one pixel of the cover-scaled image" but divides by the smaller scaled
  dimension, so on the cropped axis it is about two pixels. Still well below the gap between candidate
  formulas (≥ 0.011).
- Grid gaps: 16:9 on the 2:1 source has only the 0.5 row unclamped; the vertical axis is measured by two
  portrait rows only, and no row measures a vertical clamp at 0.
- `zlib.crc32` needs Node ≥ 22.2 while `engines` says `>=22` (dev-only script); `context/stack.md`'s Layout
  and Test rows do not mention `capture-crops.mjs` or `tests/fixtures/`.
