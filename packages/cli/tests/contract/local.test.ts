import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, test } from "vitest";
import { startServer } from "../../src/dev/server.js";
import { apiCases, createFixture, type Target } from "./cases.js";

// The api contract cases against the local server, in process and offline. The render cases are not run
// here: they need a renderer, and the real one is Phase 6's (a stub renderer cannot decode a picture).

// The local server's key is a flag (D1); this is its default.
const KEY = "dynjandi-local";
const LOOPBACK = "http://127.0.0.1:";

// Offline: a fetch that refuses any URL not on 127.0.0.1, so a case that wandered off would fail rather than
// reach out. Every request the cases make goes through it.
const loopbackOnly: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(LOOPBACK)) {
    throw new Error(`the offline contract run refuses a request outside 127.0.0.1: ${url}`);
  }
  return fetch(input, init);
};

const dataDir = await mkdtemp(join(tmpdir(), "dynjandi-contract-"));
const running = await startServer({
  port: 0,
  dataDir,
  projectKey: KEY,
  maxFileSize: 26_214_400,
  renderer: { kind: "none" },
});
afterAll(async () => {
  await running.close();
  await rm(dataDir, { recursive: true, force: true });
});

const target: Target = { origin: running.url, projectKey: KEY, fetch: loopbackOnly };

describe("api contract, local server", () => {
  const cases = apiCases(target, createFixture(target));
  test.each(cases.map((c) => [c.name, c.run] as const))("%s", async (_name, run) => {
    await run();
  });
});
