---
type: llm
---

The run is read-only in an empty workspace, so judge the reply's plan or code, not edits.

PASS if the reply keeps the Dynjandi call off the browser: the form posts to the person's own server (a route,
action or endpoint), which calls the SDK's `upload` with the project key from the server's environment, and the
browser gets back only the id or a URL. It may say why: the service sends no CORS headers and the project key must
stay on the server.
FAIL if it calls `upload` or `getFile` from browser code, or puts the project key in browser code or in a `VITE_` or
`NEXT_PUBLIC_` variable.
