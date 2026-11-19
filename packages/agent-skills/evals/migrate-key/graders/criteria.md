---
type: llm
---

The run is read-only in an empty workspace, so judge the reply's plan or code, not edits. The person may not have
a project in view; a reply that looks for the installed SDK version and finds none is fine.

PASS if the reply renames the `publicKey` option of `createClient` to `projectKey` (SDK 0.2.0 or later), checks the
installed `@dynjandi/sdk` version rather than assuming it, reads the key from a server-side environment variable
such as `DYNJANDI_PROJECT_KEY`, and mentions that passing both options or neither throws, or that `X-Public-Key` is
deprecated in favour of `X-Project-Key`.
FAIL if it leaves `publicKey` in place as the recommended form, puts the key in browser code or in a `VITE_` or
`NEXT_PUBLIC_` variable, or claims `apiOrigin` exists in 0.2.0 without checking the installed types.
