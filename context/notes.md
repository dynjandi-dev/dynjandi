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

## Phase 3 — Crop-window geometry

- `tests/geometry.test.ts` only asserts the fixture has more than zero rows; a fixture cut down to one row
  would still pass. Pinning the count (20) would catch it.
- A NaN focal point passed to `cropWindow` (centred, via `clampPoint`) is not asserted at that level.
- The private helpers `placeSpan` and `fractionAlong` are not verb-first (`typescript/naming.md`).
- The "does not round" test's comment is muddled working; the test itself is sound.
- `pointFromRect` with an infinite pointer and an infinite `rect.left` gives the centre (Inf − Inf); the
  JSDoc covers finite rectangles only. Harmless.
- `context/stack.md`'s edited helpers sentence runs past the surrounding wrap width.

## Phase 4 — Browser test driver

- Not provable before the push: CI's Node 22/24 matrix, the new `ci.yml` browser steps (cache miss and hit),
  and the `--only-shell` launch path. Check them on the PR's first CI run.
- The clean-clone proof ran with Chromium already in the machine-wide Playwright cache, so a cold download
  was not exercised; `verify.md`'s "fails rather than skips" without a browser was not shown either.
- `publish.yml`'s build job now runs only the SDK's tests (it used to run the checker's too, through root
  `pnpm test`); `ci.yml` still runs every package's. A picker failure still blocks an SDK publish through
  `build` and `check:package` (the phase 1 note above).
- The README's Developing block has no Linux `--with-deps` hint, which `verify.md` carries.
- `biome.json` does not exclude `.vitest/` (it holds only PNGs today); the CI cache key reads the
  `package.json` specifier, which equals the installed version only while the pin is exact.
- `publish.yml`'s header comment line for `build` runs past the neighbouring wrap width.

## Phase 5 — Element: surface, marker, inputs, value

- Rules the element implements that no test pins (each mutation survives): only the primary button-0
  pointer starts a drag; `file` wins over `src`; a non-Blob `file` throws `TypeError`; `pointercancel` ends a
  drag; the marker's two tones (a computed-style check would pin it); the `<style>` fallback (Chromium always
  has `adoptedStyleSheets`).
- The `value` setter does not validate untyped input: `picker.value = { x: 0.3 }` holds `y: NaN` until the
  next emission re-rounds it. Same root as bug #21 (`roundPoint`).
- The image error ("This image could not be loaded.") explains the failure but not a next step
  (`typescript/error-handling.md` asks for both).
- `tests/browser/element.browser.test.ts` casts with `as` (`DynjandiFocalPicker`, `HTMLImageElement`,
  `CustomEvent`); the `HTMLElementTagNameMap` entry should make most of them unnecessary.
- The outside-release drag test uses a `position: fixed` target, so it assumes a viewport about 350px tall.

## Phase 6 — Element: crop previews

- Nothing pins "no DOM rebuild per pointer move" (rebuilding the previews on every render passes every
  test); asserting the preview nodes' identity across a drag would.
- "Warns once" for an invalid `ratios` is read as once per assignment, not per page; the README says so.
- Untested: the `ratios` getter and setter copying, and the preview strip staying hidden until the image
  loads.
- The previews' expected values are worked from §4.2's formula; the Phase 2 fixture's 2:1 and 1:2 rows have
  the same proportions and could be cited as the source instead.
- `previews.browser.test.ts` casts with `as` where `HTMLElementTagNameMap` already types the element, and
  queries by `part` (the previews are aria-hidden, so there is no role to query).
