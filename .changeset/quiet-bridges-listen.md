---
"@dynjandi/cli": patch
---

`dynjandi dev --containers` now uses the default bridge's IPv4 gateway when the bridge also lists an IPv6 one, instead of whichever came first.
