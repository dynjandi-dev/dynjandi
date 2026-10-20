# Notes

Branch-local and advisory; `/feature-close` deletes this file.

- **Phase 1:** nothing asserts the `./next` entry in `packages/sdk/package.json`'s `exports`. Deleting it
  keeps every gate green while `import "@dynjandi/sdk/next"` breaks for customers. The `"."` entry has the
  same gap. `scripts/check-package.mjs` already reads the packed `package.json` and could check that each
  `exports` target is in the tarball.
- **Phase 1:** nothing asserts that the root export stays free of `./next`. A test over `index.ts`'s
  exports, or the root bundle's inputs, would pin it.
- **Phase 1:** the bad-origin test in `tests/next.test.ts` does not assert the `cause` that `next.ts` sets,
  and its `toContain("origin")` / `toContain("fileId")` checks match the code's own message text.
- **Phase 1:** D6's structural compatibility with Next's `ImageLoaderProps` is untestable in the package
  without a `next` dependency; only a real app checks it.
- **Phase 1:** `tests/next.test.ts` imports `AppError` from the grammar's root entry while `url.test.ts`
  uses `./builder`. Both resolve to the same module, and tests are outside `grammar-entry.test.ts`'s scan.
- **Phase 2:** the proof ran with `next.config.mjs` in a `"type": "module"` app, and only `next build` plus
  `next start`; `next dev` was not run. The plan's §4 shows `next.config.js`.
- **Phase 2:** the run used a fixed `width` with no `sizes`, so it shows 2 variants per image (828w and
  1920w). The 8 device sizes plus 8 image sizes multiplier for `sizes`/`fill` images is Next's documented
  behaviour, not something measured here.
- **Phase 2:** the `Accept` checks for Q1 were edge cache hits (`cf-cache-status: HIT`). They show what a
  customer gets, not whether the origin behind the cache negotiates.
- **Phase 2:** `dynjandi-loader.js` is plain JS, so neither build type-checked it against Next's
  `ImageLoaderProps` (D6). The header files saved in the scratchpad did not record the URL each came from.
