# Notes

Non-blocking observations from the gates. Branch-local; `/feature-close` deletes this file.

## Phase 2 — SDK: `getFile` (#3)

- `files.ts`: a lone-surrogate id (`"\uD800"`) is refused with status 0 and no request, but the message
  reads `File request failed: URI malformed`, which suggests a request was attempted. Untested.
- `UploadConfig` now configures `getFile` too, while its doc comment still says it is what `upload` needs.
  Renaming it was outside D8's "no more than three helpers".
- `isFraction` exists twice, in `files.ts` (`unknown`) and `upload.ts` (`number`).
- The key scrub covers `DynjandiError.message` only; `cause` (for example a network error) is passed
  through unscrubbed, as `upload` already did. Relevant if a caller logs `cause`.
- §5 asked for test names to state that fields the SDK does not read are only loosely type-checked; only
  the extra-fields test says so.

## Phase 3 — SDK: `url()` takes a stored file (#3)

- Two edge behaviours of a hand-built `StoredFile` are untested: mixed null/number coordinates silently
  fall back to `center` (`url.ts`, `focalPointOf`), and out-of-range stored coordinates throw from the
  grammar schema with status 0. `getFile` and `upload` both refuse half points, so neither arises from them.
- A plain-JS caller passing `null`/`undefined` as `file` gets a native `TypeError` from `file.id`, not a
  `DynjandiError`. Outside the typed contract, and undefined behaviour before the change too.
