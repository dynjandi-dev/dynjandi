// The renderer image `dynjandi dev` starts, pinned by tag and by the registry's index digest (D3; renderer
// README: pin both, never `latest`). The digest is plan section 9 Q1's, read with `docker buildx imagetools
// inspect`. Its grammar label is 0.3.0, the exact version of @dynjandi/transform-grammar this package pins.
// There is deliberately no way to override it (D2): `--renderer-url` covers a renderer built from source.
export const RENDERER_IMAGE_TAG = "ghcr.io/dynjandi-dev/renderer:0.2.0";
const RENDERER_IMAGE_DIGEST =
  "sha256:0231fbce1d35499bfeafb1b238951b164aafd6d3c61a491f0b27ee7d10e5b7d6";
export const RENDERER_IMAGE = `${RENDERER_IMAGE_TAG}@${RENDERER_IMAGE_DIGEST}`;

/** The port the renderer listens on inside its container. */
export const RENDERER_CONTAINER_PORT = 8080;
