import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Two projects, so neither picks up the other's files:
// - "node": the DOM-free helper tests, plus the type-level test (tests/sdk-compat.test-d.ts);
// - "browser": tests/browser/** in headless Chromium through Playwright, for anything that needs real layout.
// The verbose reporter prints each test under its project's name, which the default reporter does not.
export default defineConfig({
  test: {
    reporters: ["verbose"],
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/browser/**"],
          typecheck: { enabled: true, include: ["tests/**/*.test-d.ts"] },
        },
      },
      {
        test: {
          name: "browser",
          include: ["tests/browser/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
