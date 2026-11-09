---
"@dynjandi/sdk": minor
---

`createClient` now takes `projectKey` and sends it as `X-Project-Key`; `publicKey` still works but is deprecated, and passing both or neither is an error. `ClientOptions` is now a union, so `interface X extends ClientOptions` and a plain `Omit` or `Pick` over it stop compiling; the README's *Migrating from `publicKey`* shows the replacements.
