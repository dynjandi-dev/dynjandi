// openapi-typescript 7 prints its output with the TypeScript 5 compiler API, which TypeScript 7 no
// longer ships, and declares `typescript ^5.x` as a peer. A peer resolves to the workspace's
// TypeScript 7 (and pnpm puts that peer's `tsc` on the depending package's PATH), so make it an
// ordinary dependency instead: openapi-typescript gets its own TypeScript 5, nothing else does.
// Remove this when openapi-typescript supports TypeScript 7.
function readPackage(pkg) {
  if (pkg.name === "openapi-typescript" && pkg.version === "7.13.0") {
    delete pkg.peerDependencies?.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: "5.9.3" };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
