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

## Phase 2 — `--containers`: the way in for containers, and the origin they use

- A gateway equal to `127.0.0.1` is planned twice (`["127.0.0.1","127.0.0.1"]`); the second bind would fail as
  "port N is already in use on 127.0.0.1", a misleading line. Unrealistic for a Docker bridge.
- No test uploads with `dynjandi-local` on the second listener (D4); it is pinned only through the shared
  handler, which the `421`-on-both test shows.
- The `--json`-under-`--` test with `very-secret` writes the environment report but never reads
  `DYNJANDI_CONTAINER_ORIGIN`; the value cannot hold the key by construction.
- No test covers SIGTERM while `docker network inspect` is running (the `RendererStartAborted` rethrow in
  `readContainerPlan`).
- The `--help` test's `not.toContain("--host ")` passes only because the help says `--host:`.
- `packages/cli/README.md` has a double blank line before `### Host names`.
- `DockerResult` is exported from `docker.ts` but imported nowhere else; `containers.ts` uses
  `Awaited<ReturnType<typeof runDocker>>`. `const gatewayText = gateway;` in `containers.ts` is a redundant alias.
- `packages/cli/src/dev/docker.ts` was not on the phase's Files line; the `runDocker` export is what §4.1 needs.

## Phase 4 — An app in a container, end to end, and the compose recipe

- The recipe's SDK tarball step does not say when it goes away; one sentence ("once a released `@dynjandi/sdk`
  has `apiOrigin`, install it from npm") would, as *In CI* does for its token.
- `packages/cli/README.md` "so one compose file can serve both systems" leans on the Linux half, which was not run;
  the "untried" list puts Linux Engine under "`host.docker.internal` may not resolve", though the recipe uses the
  gateway address there.
- No standing assertion pins the e2e case's premise — that the container cannot reach `origin`; the one-off
  mutation (`ECONNREFUSED 127.0.0.1`) proved it once. `container-app.mjs` could probe `DYNJANDI_ORIGIN/health`.
- `context/verify.md`'s e2e preconditions: the `docker login ghcr.io` line now follows two images but only the
  renderer is private; "about 100 MB" omits the Node image, whose pull falls inside the 120 s test timeout.
- Plan §5 said the README would say server-side fetches use `apiOrigin`; the README says `apiOrigin` is only for
  `upload`/`getFile` and offers the loader instead — closer to D6.
- `containers.e2e.test.ts` uses `as` on `JSON.parse` results (as `dev.e2e.test.ts` already does) and an
  in-test `await import("node:http")`.
- Both e2e files' "no renderer left" assertion fails while another `dev` is running on the machine (predates Phase 4).
- `packages/cli/package.json` was not on the phase's Files line; `test:e2e` gained `--no-file-parallelism`.
