---
"@dynjandi/sdk": minor
---

`createClient` now takes `projectKey` and sends it as `X-Project-Key`; `publicKey` still works but is deprecated, and passing both or neither is an error. `ClientOptions` is now a type alias, so an `interface X extends ClientOptions` must become an intersection type.
