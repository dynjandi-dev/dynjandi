import { defineConfig } from "vitest/config";
import { WAIT_BUDGET_MS } from "./tests/support/wait.js";

// Above one wait's budget (tests/support/wait.ts), so a wait that runs out fails with what it was waiting
// for instead of Vitest's bare "Test timed out". Suites with their own per-test timeouts (e2e, live) keep them.
const timeout = WAIT_BUDGET_MS + 10_000;

export default defineConfig({ test: { testTimeout: timeout, hookTimeout: timeout } });
