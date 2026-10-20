import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, test } from "vitest";

const ENTRY = join(import.meta.dirname, "..", "src", "index.ts");

/**
 * `grammar-entry.test.ts` checks which grammar entry `src` imports; this checks what that entry brings. A
 * later `@dynjandi/transform-grammar` within the dependency range could pull `zod` into `./builder`, and
 * every other test would stay green while a browser bundle grew by about 95 KB. Bundled as the README's
 * *Bundle size* command does.
 */
async function bundleInputs(): Promise<string[]> {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    minify: true,
    platform: "browser",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  return Object.keys(result.metafile.inputs);
}

describe("the SDK's browser bundle", () => {
  test("carries the grammar package but no zod", async () => {
    const inputs = await bundleInputs();

    expect(
      inputs.some((input) => input.includes("node_modules/@dynjandi/transform-grammar/")),
    ).toBe(true);
    expect(inputs.filter((input) => input.includes("node_modules/zod/"))).toEqual([]);
  });
});
