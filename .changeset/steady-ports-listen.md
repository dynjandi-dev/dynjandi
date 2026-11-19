---
"@dynjandi/cli": minor
---

Add `dynjandi dev`: it runs a local Dynjandi server, with the renderer started through Docker, so your app and your tests can upload and fetch images without the live service. `dynjandi dev -- <command>` runs your tests against it and stops the server when they end.
