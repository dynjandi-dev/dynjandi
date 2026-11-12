---
"@dynjandi/sdk": patch
---

Add an `apiOrigin` client option, so server-side requests (`upload`, `getFile`) can use a different host name than the one in the variant URLs, for apps running in a container.
