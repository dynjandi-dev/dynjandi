---
type: llm
---

The run is read-only in an empty workspace, so judge the reply's plan or code, not edits.

PASS if the reply passes `focal` (`{ x, y }`, each from 0 to 1, both sent together) to the SDK's `upload`, does the
upload on a server (the point travels from the browser to the person's own server), says a crop built from a stored
file uses its point, and, if it names `@dynjandi/focal-picker`, checks or says whether it is published (it is not on
npm unless `npm view @dynjandi/focal-picker version` prints a version) instead of telling the person to install it.
FAIL if it calls `upload` or `getFile` from browser code, puts a project key in browser code or in a `VITE_` or
`NEXT_PUBLIC_` variable, or says the picker can be installed from npm without that check.
