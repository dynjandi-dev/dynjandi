# @dynjandi/focal-picker

A focal point picker for images uploaded to [Dynjandi](https://cdn.dynjandi.dev), an image CDN: a way for
a CMS or admin to choose the part of a photo that survives a crop, and hand the point to `upload` in
[`@dynjandi/sdk`](../sdk/README.md).

**Status: not published, and the picker UI is not built yet.** This package is not on npm, and nothing
publishes it. What exists so far is the point helpers: `FocalPoint` (the `{ x, y }` shape `upload` takes as
`focal`, each coordinate 0 to 1), `clampPoint`, `roundPoint` (3 decimals, never outside 0 to 1) and
`stepPoint` (a 0.1 percent keyboard step). They are DOM-free and have no runtime dependencies.

ESM only. Node 22 or newer for the tooling.
