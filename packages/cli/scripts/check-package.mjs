// Gate 1's packaging check: packs @dynjandi/cli the way publish.yml packs the SDK (nothing publishes
// this package yet) and asserts what the tarball holds, then asks npm for a publish dry run over it. Runs from the package directory (the pnpm script).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = (text) => process.stdout.write(`${text}\n`);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", ...options });

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const dir = mkdtempSync(join(tmpdir(), "dynjandi-cli-pack-"));
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
    "package/dist/cli.js",
    "package/dist/dev/options.js",
    "package/dist/dev/server.js",
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
  const packedManifest = JSON.parse(packed);
  if (packedManifest.private === true) failures.push("the packed package.json is private");
  if (/\b(workspace|file|link):/.test(packed)) {
    failures.push("the packed package.json holds a workspace:, file: or link: specifier");
  }

  // The `dynjandi` command: the bin entry must exist in the tarball and start with a node shebang.
  const binPath = packedManifest.bin?.dynjandi;
  if (binPath === undefined) {
    failures.push("the packed package.json has no bin.dynjandi");
  } else {
    const binEntry = `package/${binPath.replace(/^\.\//, "")}`;
    if (!entries.includes(binEntry)) {
      failures.push(`bin.dynjandi points at ${binPath}, which is not in the tarball`);
    } else {
      const source = run("tar", ["-xOzf", tarball, binEntry]);
      if (!source.startsWith("#!/usr/bin/env node\n")) {
        failures.push(`${binPath} does not start with a node shebang`);
      }
    }
  }

  if (failures.length === 0) {
    // npm refuses a dry run over a version the registry already holds, so the dry run only runs when the
    // version is new. A package that is not on npm at all (the state of this one: nothing publishes it yet)
    // makes `npm view` fail with E404, which is treated as new. The assertions above always run.
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
