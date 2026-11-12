# Notes

Non-blocking review observations for #43, by phase. Read by nobody; `/feature-close` deletes this file.

## Phase 1 — Host names the server answers to

- The trailing-dot cases (`localhost.` in `packages/cli/tests/api.test.ts`, `localhost.:4600` in `hostOf`'s
  cases) cite no source; RFC 1034 §3.1 (absolute names) would anchor them, and `evil.example.` being refused is
  not asserted.
- Two expected values are the code's own choices: the exact `--allow-host` wildcard usage message in
  `options.test.ts`, and the `< 400` bound in "cuts a very long host".
- The rewritten refusal case dropped `/no/such/route`, which #48's block checked; the Done-when routes are covered.
- `hostOf` accepts bracketed names (`[localhost]`, `[dev.test]` when allowed). Harmless — no browser sends that
  form — but its JSDoc says only IPv6 literals come back unbracketed.
- `--allow-host` accepts all-numeric names (`1.2.3`, `123`); browsers turn those into IPv4, which is allowed anyway.
- The `--allow-host` help line (`packages/cli/src/dev/options.ts:40`) is 134 characters against ~90 for the rest.
- `startServer`'s `allowHosts` is not lower-cased; `parseDevOptions` lower-cases, and only the CLI calls it today.
- `context/stack.md`'s `packages/cli` `src/` list does not name `dev/host-check` — it already omits `api`,
  `store` and `docker`.

## Phase 3 — The SDK's `apiOrigin` and the spec's `url` wording

- `packages/sdk/README.md` links `../cli/README.md#from-an-app-in-a-container`, which Phase 4 writes; the heading
  has to be exactly "From an app in a container", and the link goes if the feature closes without Phase 4.
- The *Usage* container example sets `origin: process.env.DYNJANDI_ORIGIN` with no fallback; unset, URLs fall
  back to `cdn.dynjandi.dev` (§5). The documented compose path's `${VAR:?}` keeps it set.
- A new `upload.test.ts` case uses `(error as DynjandiError).status`, against `typescript/rules.md`'s
  no-assertions rule; `files.test.ts`'s `rejection()` helper narrows with `instanceof` instead.
- `packages/spec/README.md:32` and the SDK README's *`upload`* line run past the prevailing wrap width.
- A non-http `apiOrigin` (`file:///x`) passes validation and fails only at request time, as `origin` already does.
