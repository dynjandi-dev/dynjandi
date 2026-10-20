import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, test } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

/**
 * `grammar-entry.test.ts` checks which grammar entry `src` imports; this checks what that entry brings. A
 * later `@dynjandi/transform-grammar` within the dependency range could pull `zod` into `./builder`, and
 * every other test would stay green while a browser bundle grew by about 95 KB. Bundled as the README's
 * *Bundle size* command does.
 */
async function bundleInputs(entry: string): Promise<string[]> {
  const result = await build({
    entryPoints: [join(SRC, entry)],
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
  test.each([
    ["the root export", "index.ts"],
    ["the ./next export", "next.ts"],
  ])("%s carries the grammar package but no zod", async (_name, entry) => {
    const inputs = await bundleInputs(entry);

    expect(
      inputs.some((input) => input.includes("node_modules/@dynjandi/transform-grammar/")),
    ).toBe(true);
    expect(inputs.filter((input) => input.includes("node_modules/zod/"))).toEqual([]);
  });
});
