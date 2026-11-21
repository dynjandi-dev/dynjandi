// How long one wait gives something a test started in the background (a ready line, a file, a docker call)
// before it gives up. Sized for a loaded runner, not for an idle laptop: a root `pnpm test` runs every
// package at once, Chromium tests included, and the same wait that takes 100 ms alone has taken seconds.
// The wait returns the moment its condition holds, so a generous budget costs nothing on a green run.
// vitest.config.ts derives the test timeout from it, so a single wait that runs out reports what it was
// waiting for rather than Vitest's bare timeout.
export const WAIT_BUDGET_MS = 20_000;

export async function waitFor(condition: () => boolean, what: string): Promise<void> {
  // performance.now() is monotonic, so a wall-clock change mid-wait moves no deadline.
  const deadline = performance.now() + WAIT_BUDGET_MS;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(`never happened: ${what}`);
    await new Promise((done) => setTimeout(done, 10));
  }
}
