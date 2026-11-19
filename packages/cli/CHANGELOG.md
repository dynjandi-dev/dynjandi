# @dynjandi/cli

## 0.1.0

### Minor Changes

- 41c5638: Add `dynjandi setup`: it opens the browser for a one-click approval, creates the project (or finds it again) and writes its `DYNJANDI_PROJECT_KEY` to a gitignored env file, so no key is copied, pasted or printed.
- be25f11: Add `dynjandi dev`: it runs a local Dynjandi server, with the renderer started through Docker, so your app and your tests can upload and fetch images without the live service. `dynjandi dev -- <command>` runs your tests against it and stops the server when they end.

### Patch Changes

- 721331a: `dynjandi --help` now points to the agent skills for using Dynjandi from a coding agent.
- be25f11: Add `dynjandi dev --containers`, so an app running in a Docker container can reach the local server: it also listens on the Docker bridge gateway when this machine holds that address, and reports the origin a container should use.
