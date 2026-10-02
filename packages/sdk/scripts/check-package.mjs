// Gate 1's packaging check: packs @dynjandi/sdk the way publish.yml does and asserts what the tarball
// holds, then asks npm for a publish dry run over it. Runs from the package directory (the pnpm script).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = (text) => process.stdout.write(`${text}\n`);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", ...options });

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const dir = mkdtempSync(join(tmpdir(), "dynjandi-sdk-pack-"));
const failures = [];

try {
  // `pnpm pack` runs the package's `prepack`, which builds dist/ and copies the root LICENSE in.
  run("pnpm", ["pack", "--pack-destination", dir], { stdio: ["ignore", "ignore", "inherit"] });
  const tarball = join(
    dir,
    readdirSync(dir).find((name) => name.endsWith(".tgz")) ?? "missing.tgz",
  );
  const entries = run("tar", ["-tzf", tarball])
    .split("\n")
    .filter((entry) => entry !== "" && !entry.endsWith("/"));
  out(entries.join("\n"));

  // Allowlist, not a denylist: anything that is not dist/ or one of the three top-level files is a leak.
  const topLevel = ["package/package.json", "package/README.md", "package/LICENSE"];
  const required = [
    ...topLevel,
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/generated/api.d.ts",
  ];
  for (const entry of required) {
    if (!entries.includes(entry)) failures.push(`missing from the tarball: ${entry}`);
  }
  for (const entry of entries) {
    if (!topLevel.includes(entry) && !entry.startsWith("package/dist/")) {
      failures.push(`must not be in the tarball: ${entry}`);
    }
  }

  const packed = run("tar", ["-xOzf", tarball, "package/package.json"]);
  if (JSON.parse(packed).private === true) failures.push("the packed package.json is private");
  if (/\b(workspace|file|link):/.test(packed)) {
    failures.push("the packed package.json holds a workspace:, file: or link: specifier");
  }

  if (failures.length === 0) {
    // npm refuses a dry run over a version the registry already holds, which is the normal state between
    // releases, so the dry run only runs when the version is new. The assertions above always run.
    const spec = `${manifest.name}@${manifest.version}`;
    let held = "";
    try {
      held = run("npm", ["view", spec, "version"], { stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      // Not on the registry (or it cannot be reached): treat the version as new.
    }
    if (held === manifest.version) {
      out(`${spec} is already on npm: skipping the publish dry run.`);
    } else {
      run("npm", ["publish", tarball, "--dry-run", "--access", "public"], { stdio: "inherit" });
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
out("Package check passed.");
