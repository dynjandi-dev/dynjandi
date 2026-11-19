---
"@dynjandi/cli": patch
---

Add `dynjandi dev --containers`, so an app running in a Docker container can reach the local server: it also listens on the Docker bridge gateway when this machine holds that address, and reports the origin a container should use.
