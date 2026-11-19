---
type: llm
---

The workspace holds an admin app (Vite config reading DYNJANDI_PUBLIC_KEY, SDK 0.1.0, a hand-written stand-in
upload server that simulates a dropped upload) and a site whose client only builds URLs and has no `origin`.
The run is read-only, so judge the reply's plan, not edits.

PASS if the reply proposes `dynjandi dev` or `dynjandi dev -- <command>`, threads `DYNJANDI_ORIGIN` into every
client including the URL-only one, and keeps the stand-in for the dropped-upload test.
FAIL if it writes a new fake server, points at production, or puts a key in browser code.
