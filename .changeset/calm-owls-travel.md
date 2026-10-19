---
"@dynjandi/sdk": patch
---

`@dynjandi/sdk` now depends on `@dynjandi/transform-grammar` 0.2 and imports its `./builder` entry, which does not bundle `zod`, so a browser bundle that uses `url()` is much lighter. The public API is unchanged, but for a refused option the message wording can differ and the error's `cause` is now the grammar's `AppError` (`statusCode` 400, with an `issues` list) rather than a zod error.
