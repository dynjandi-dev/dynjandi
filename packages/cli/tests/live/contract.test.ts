/// <reference types="node" />

import { describe, test } from "vitest";
import { apiCases, createFixture, renderCases, type Target } from "../contract/cases.js";

// Live contract test: the same cases as the local run, against the real service and the dedicated test
// project. It is NOT part of `pnpm test` (see `test` and `test:live` in package.json). See context/verify.md,
// "Not run by Gate 1". One upload and five variants per run, each counting against the test project's cap.

const KEY_VARIABLE = "DYNJANDI_SMOKE_PROJECT_KEY";

function requireProjectKey(): string {
  const key = process.env[KEY_VARIABLE];
  if (key === undefined || key === "") {
    // A skipped contract test would be a false green, so an unset key fails the run. The message names the
    // variable only.
    throw new Error(
      `${KEY_VARIABLE} is not set. Locally, load it from .env (see context/verify.md); in CI it is an Actions secret.`,
    );
  }
  return key;
}

const target: Target = {
  origin: "https://cdn.dynjandi.dev",
  projectKey: requireProjectKey(),
  fetch,
};
const fixture = createFixture(target);

for (const [group, cases] of [
  ["api", apiCases(target, fixture)],
  ["render", renderCases(target, fixture)],
] as const) {
  describe(`${group} contract, live service`, () => {
    for (const { name, run } of cases) {
      test(name, { timeout: 30_000 }, run);
    }
  });
}
