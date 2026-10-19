---
"@dynjandi/sdk": patch
---

`@dynjandi/sdk` now depends on `@dynjandi/transform-grammar` 0.2 and imports its `./builder` entry, which does not bundle `zod`, so a browser bundle that uses `url()` is much lighter. The public API is unchanged; the wording of the message for a refused option can differ.
