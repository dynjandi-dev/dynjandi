# @dynjandi/sdk

## 0.2.0

### Minor Changes

- e6e75c7: `createClient` now takes `projectKey` and sends it as `X-Project-Key`; `publicKey` still works but is deprecated, and passing both or neither is an error. `ClientOptions` is now a union, so `interface X extends ClientOptions` and a plain `Omit` or `Pick` over it stop compiling; the README's *Migrating from `publicKey`* shows the replacements.

## 0.1.1

### Patch Changes

- bb08429: Added `@dynjandi/sdk/next`, a loader for `next/image`. Use `dynjandiLoader`, or `createDynjandiLoader({ origin, format })` for another origin or a fixed output format. Existing imports are unchanged.
- 0732b76: `@dynjandi/sdk` now depends on `@dynjandi/transform-grammar` 0.2 and imports its `./builder` entry, which does not bundle `zod`, so a browser bundle that uses `url()` is much lighter. The public API is unchanged, but for a refused option the message wording can differ and the error's `cause` is now the grammar's `AppError` (`statusCode` 400, with an `issues` list) rather than a zod error.
- 2609803: Added `getFile(fileId)` to read a stored file's focal point, and `url()` now also accepts that record (or an upload result) and crops on its stored focal point. Existing calls are unchanged.
- 7fa985e: Add `client.srcset()`, `client.pictureSources()` and `client.placeholder()`, which build a responsive `srcset`, per-format `<source>` descriptors and a tiny placeholder URL from `url()`, along with the exported `DEFAULT_WIDTHS` and `DEFAULT_FORMATS`.

## 0.1.0

### Minor Changes

- First release. `createClient` gives you `upload()` for uploading files from a server and `url()` for building image variant URLs, and every failure is a `DynjandiError`.
