# Notes

Non-blocking observations from the review gates of #36 (rename-public-key-to-project-key). Read by nothing;
`/feature-close` deletes this file.

- **Phase 1:** `packages/spec/openapi.yaml`'s `POST /upload` 400 says "The `error` message is one of:" and
  does not list `X-Project-Key and X-Public-Key differ`, which the service now also returns. D4 kept a 400
  *response* off `GET /files/{id}`; this one already exists, and adding the message is a doc-comment change
  in `api.d.ts` only.
- **Phase 1:** `packages/spec/README.md`'s error summaries (400 and 401/404 lists) leave out the
  differing-headers 400, and the README never mentions the deprecated `X-Public-Key` alias.
- **Phase 1:** the `projectKey` scheme description joins D6's first two sentences with a colon; the
  Authentication section uses them verbatim. Cosmetic.
