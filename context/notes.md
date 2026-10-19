# Notes

Branch-local observations from the gates. Nothing reads this file; `/feature-close` deletes it.

- **Phase 1:** `.changeset/calm-owls-travel.md` was written by phase 1 (plan D5/§7), although `context/release.md` says notes are written once per feature by `/feature-close`. Close should confirm this note rather than write a second. It should also check the "much lighter" wording against phase 2's measured figure.
- **Phase 1:** `packages/sdk/tests/grammar-entry.test.ts` misses template-literal `import(`…`)` and files ending `.mts`/`.cts`/`.tsx`/`.mjs`. None of these exists under `src` today.
- **Phase 1:** the range-refusal tests in `url.test.ts` assert only that `cause` is an `Error` or defined, not that it is the grammar's `AppError` with `statusCode` 400. This gap was there before phase 1.
