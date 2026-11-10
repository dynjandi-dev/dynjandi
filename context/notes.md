# Notes

Non-blocking review observations for the active feature (#37, local-dev-server). Read by nothing;
`/feature-close` deletes this file.

## Phase 1

- The ready line prints `renderer: docker` by default though nothing starts Docker until Phase 5; the README
  says only that the renderer flags do nothing yet.
- Signals are tested by `process.emit` in-process; the entry-point block in `packages/cli/src/cli.ts`
  (`realpathSync` comparison, `process.exitCode`) has no test until Phase 6's real run.
- `cli.ts` adds the SIGINT/SIGTERM listeners before `startServer`; a failed start leaves them registered
  (harmless in the CLI, leaks across tests in one worker).
- `packages/cli/package.json` sets `"sideEffects": false` while `cli.ts` runs top-level code as the bin.
- `context/stack.md`: the CI row's "nothing publishes the picker" does not mention the CLI; the intro has two
  "and"s in a row.
- `--port 04600` is accepted as 4600.
- `tests/server.test.ts` port-taken case calls `startServer` twice without closing the failed servers.
