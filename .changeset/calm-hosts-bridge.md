---
"@dynjandi/sdk": patch
---

Add an `apiOrigin` client option, so server-side requests (`upload`, `getFile`) can use a different host name than the one in the variant URLs, for apps running in a container.

`createClient` and `createDynjandiLoader` now refuse, when they are called, an `origin` or `apiOrigin` that is not an `http://` or `https://` URL. One with no scheme, such as `localhost:4600`, parses as a scheme of its own, so it used to be accepted and then fail at the first request.
