# Notes — sdk-responsive-images (#5)

Branch-local review observations. Read by nothing; deleted whole by `/feature-close`.

## Phase 1

- **D7 reading:** out-of-range widths are refused by `url()` mid-build (message `resize width: ...`), not
  before any URL is built; empty, duplicate and non-integer widths are refused up front. Callers see no
  difference (it throws either way).
- **Upscaling (§9 Q3) is unobserved.** No smoke key on this machine at Phase 1. The README hedges and says
  to trim `widths`. Phase 4, run with the key, is where it can be observed.
- **Unsourced README claim removed** ("variants are rendered on first request"): nothing in the repo states it.
- `Client.srcset` is typed `fileId: string` while `srcset()` follows `url()`'s parameter type; both change
  together when #3 lands. `DEFAULT_WIDTHS` is `readonly` in type only.
- `responsive.test.ts` "makes no request": `mockRestore()` runs after the assertions, so a failing assertion
  leaves the global `fetch` spy in place.

## Phase 2

- README wording fixed before commit: the fallback `<img>` must come after every `<source>` (not "last
  child"); the 2 x 3 = 6 cost row assumes the fallback uses the same `widths`.
- `responsive.test.ts:236` casts `["gif"] as unknown as ["avif"]`; `typescript/rules.md` prefers
  `// @ts-expect-error` with a comment. Test-only.
- The runtime-`format` refusal test asserts only `toContain("format")`, which every formats refusal matches.
- `failureOf`'s message "Expected srcset() to throw" now also covers `pictureSources`.
- `PictureSource.type` is `string`; could be `` `image/${OutputFormat}` ``.
- Timing: `url()` ~0.73–0.80 µs/call; `pictureSources` with defaults ~9.0–9.2 µs/call (10 `url()` calls).
