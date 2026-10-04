---
"@dynjandi/sdk": patch
---

Added `getFile(fileId)` to read a stored file's focal point, and `url()` now also accepts that record (or an upload result) and crops on its stored focal point. Existing calls are unchanged.
