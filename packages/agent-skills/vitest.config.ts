import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The CLI's own option parsers are the specification of what `dynjandi dev` and `dynjandi setup` accept
// (the command checks in tests/support/skills.ts, run by tests/skills.test.ts and tests/checks.test.ts).
// They are reached through the same mapping tsconfig.json has, so the check needs no built output:
// `pnpm typecheck` runs before `pnpm build`.
const cliSource = (path: string) => fileURLToPath(new URL(`../cli/src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@dynjandi/cli/dev/options": cliSource("dev/options.ts"),
      "@dynjandi/cli/setup/options": cliSource("setup/options.ts"),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
