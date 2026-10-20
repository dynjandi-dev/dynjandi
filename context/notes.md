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
