// Bundles src/main.ts with esbuild and copies the page and stylesheet into dist/. The grammar version the
// page prints is read from the installed package, so it cannot drift from what was bundled.
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

const grammar = JSON.parse(
  await readFile(join(root, "node_modules/@dynjandi/transform-grammar/package.json"), "utf8"),
);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(root, "src/main.ts")],
  outfile: join(dist, "main.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "none",
});

const html = await readFile(join(root, "index.html"), "utf8");
if (!html.includes("{{GRAMMAR_VERSION}}")) {
  throw new Error("index.html has no {{GRAMMAR_VERSION}} placeholder");
}
await writeFile(join(dist, "index.html"), html.replaceAll("{{GRAMMAR_VERSION}}", grammar.version));
await copyFile(join(root, "src/style.css"), join(dist, "style.css"));
