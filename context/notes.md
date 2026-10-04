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

## Phase 3

- `responsive.test.ts:277` casts `{ height: 24 } as Parameters<...>[1]`; a widened variable (as the srcset
  height test does) would avoid the assertion. Test-only.
- Bundle: 94,306 → 94,762 B gzipped (+456) and SDK-own code ~1.5 KB → 2,110 B; the old baseline predates
  phases 1–2, so the delta covers phases 1–3.
- `packages/sdk/README.md:146` wraps at ~131 chars against ~110 around it. Cosmetic.
- `"height" in options` refuses `{ height: undefined }` too, same as `srcset`.

## Phase 4

- First live run failed: the service serves `format/avif` as `Content-Type: image/heif`. User chose to
  accept either label and prove AVIF from the `ftyp` brand; service bug filed as dynjandi-core#98. Tighten
  the assertion back to `image/avif` once that is fixed.
- Upscaling observed: 320w of a 1x1 original came back 320px wide. README now says so. §9 Q3's `maxWidth`
  option idea is unaddressed — a `/roadmap` candidate if wanted.
- `expectAvifFtyp` ignores box sizes `0`/`1` (to-EOF / 64-bit); real encoders write a 32-bit size.
- Tests 2–4 reuse test 1's `fileId`; a failed upload cascades into confusing `GET` failures (always red).
  `beforeAll` for the upload, or `expect(fileId).toBeDefined()`, would clarify.
- `readPngWidth` throws a RangeError on a body under 20 bytes rather than a descriptive message.
- Local arrow `ascii` in `expectAvifFtyp`; rules.md's `function`-declaration rule targets module level.
