---
"@dynjandi/cli": patch
---

`dynjandi setup` now checks the approval link, code and expiry time it reads back from `.dynjandi/setup-approval.json` before showing them, and starts a new approval when they are not what it saved, so an edited file cannot send escape sequences to your terminal.
