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
- **Phase 2:** `packages/sdk/src/client.ts` checks the resolved key only for `""`, so a JS caller bypassing
  the types can pass `publicKey: null`, a number, an object or whitespace and it is sent coerced (while
  `projectKey: null` is refused). Same as HEAD for non-strings, and the service answers 401; a
  `typeof key !== "string"` refusal would close it.
- **Phase 2:** `packages/sdk/tests/project-key.test.ts`'s `getFile` alias test answers with an upload body
  and swallows the resulting error with `.catch(() => undefined)`; `FILE_BODY` from `helpers.ts` would let
  it assert success. It also casts `(error as DynjandiError)`, as `errors.test.ts` already does.
- **Phase 2:** `packages/sdk/tests/live/smoke.test.ts` keeps the helper name `requirePublicKey`, which
  could follow the variable when it is renamed.
- **Phase 2:** `ClientOptions` is now a type alias (an interface cannot extend a union), so a consumer's
  `interface X extends ClientOptions` stops compiling. Worth a line in the changeset at `/feature-close`.
