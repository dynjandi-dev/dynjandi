---
"@dynjandi/cli": patch
---

`dynjandi dev` now escapes DEL and the C1 control characters in the `Host` it logs when it refuses a request, so a hostile header cannot send escape sequences to your terminal.
