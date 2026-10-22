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
