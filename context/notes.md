# Notes

Non-blocking observations from the review gate, for a person. Nothing reads this file; `/feature-close`
deletes it.

## Phase 1 — Workspace, toolchain and CI skeleton

- `tooling/biome.md` says to use `biome ci` in pipelines; `ci.yml` runs `biome check --formatter-enabled=false .`
  and `biome format .` instead — same effect (read-only, exit 1 on findings), and it keeps CI identical to
  `verify.md`.
- `packageManager` pins `pnpm@10.32.1`; latest 10.x is 10.34.6, latest overall 12.8.1.
- No dependency audit anywhere (`tooling/ci.md` asks for `pnpm audit --audit-level=high` when dependencies
  change). Per `verify.md`'s rules it belongs under *Not run by Gate 1*, run by something watching the repo.
- `packages/sdk/package.json` calls `tsc` and `vitest` through the root's hoisted bins and declares no
  devDependencies of its own — worth revisiting when phase 6 makes the package publishable.
- The reason Build is empty sits in `verify.md`'s preamble, not under `## Build`.
- `README.md`'s package table describes what the packages will be; the "empty shells" status line above it is
  what keeps it true today.

## Phase 2 — The OpenAPI spec

- **For the user:** the spec calls the public key "a publishable identifier, not a secret", yet whoever holds
  it can upload any file into the project up to its quota. A wording decision, left as is.
- **For the user:** Redocly CLI sends telemetry on every lint run (local and CI) unless
  `REDOCLY_TELEMETRY=off` is set.
- Focal both-or-neither is prose only; OpenAPI 3.1 `dependentRequired` could express it
  (`openapi-typescript` ignores it, so phase 3's client-side check is needed either way).
- Root `engines.node` says `>=22`; `@redocly/cli` 2.57.0 and rolldown (phase 1) need `>=22.12`.
- Two version numbers: `packages/spec/package.json` `0.0.0` vs `info.version` `0.1.0` — phase 6 decides
  which one moves a publish.
- The stable raw-GitHub URL 404s until the branch merges to `main`.
- `packages/spec/README.md` promises to say how tagged spec URLs work once releases are cut — phase 6.
- The service already has `GET /files/<id>` (`X-Public-Key`, file metadata), not in the spec by D6.

## Phase 3 — SDK: client, upload and errors

- `resolveOnOrigin`'s `catch` drops the `new URL` parse error, so the `DynjandiError` for an unparseable
  `url` has no `cause` (the shape and off-origin failures have none either).
- Key redaction (`replaceAll(publicKey, "[redacted]")`) garbles a message when the key is very short, and
  misses a percent-encoded echo — neither matters for today's 64-hex keys. `cause` is not redacted.
- `createClient` normalises `origin` with `new URL(...).origin`: a path is dropped silently, and a
  non-`http(s)` scheme is accepted and only fails at upload (status 0). An `undefined` key from plain JS is
  accepted.
- "Both or neither" focal is enforced by the `focal?: { x, y }` type; no `@ts-expect-error` test pins it.
- One cast in `errors.test.ts` (`focalFailure as DynjandiError`) after an `instanceof` assertion.
- A non-JSON error body (e.g. an HTML 502) is not kept on the error; `cause` is the JSON parse error.
- `.pnpmfile.cjs` is pinned to `openapi-typescript@7.13.0`; bumping it silently turns the hook off (the drift
  check would then fail loudly). Remove the hook once `openapi-typescript` supports TypeScript 7.

## Phase 4 — SDK: URL builder

- **For the user:** `@dynjandi/transform-grammar` is a caret range (`^0.1.0`, so 0.1.x). `url()` delegates its
  strings to the grammar, so a grammar patch can change the URLs consumers get (focal rounding,
  `FACE_DETECTOR_VERSION`). Plan §9 Q9 says "the SDK pins whatever ships" — decide whether that means exact.
- Upstream (dynjandi-core, not this repo): the grammar's `resizeOperationSchema` lets both dimensions be
  `null`, so `{ width: null }` from untyped JS builds `/-/resize/x/`, which the server rejects; and
  `buildVariantUrl` leaves a `.`/`..` file id unencoded, giving a dot-segment URL.
- The fixed operation order (crop → resize → format → quality) is documented only on the private
  `toOperations`, not on the public `UrlOptions`.
- `url.ts` JSDoc contradicts itself: the `UrlOptions` comment says the ranges are not repeated, while the
  width/height fields say "Integer from 1 to 10000".
- `null` options from plain JS let a `TypeError` escape `url()` (not the grammar's error, so D4 holds).
- NaN, Infinity and fractional values get zod's union message (`resize: Invalid input`), less specific than
  the out-of-range messages.
- `url.ts` throws a `DynjandiError` inside its own `try` and re-throws it; moving the `safeParse` check out of
  the `try` would read more plainly.
