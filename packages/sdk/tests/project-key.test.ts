import { describe, expect, test } from "vitest";
import { createClient, DynjandiError } from "../src/index";
import { aFile, fakeFetch, firstRequest, jsonResponse, PROJECT_KEY, UPLOAD_BODY } from "./helpers";

const FILE_ID = UPLOAD_BODY.id;

// Expected values come from plan decisions D1 (only X-Project-Key is sent), D2 (publicKey stays as a
// deprecated alias) and D3 (both, neither or empty throw status 0 and never echo a value).
describe("the deprecated publicKey option", () => {
  test("still authenticates, and goes out as X-Project-Key only", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ publicKey: PROJECT_KEY, fetch: fetchMock });

    await client.upload(aFile());

    const { headers } = firstRequest(fetchMock);
    expect(headers.get("X-Project-Key")).toBe(PROJECT_KEY);
    expect(headers.has("x-public-key")).toBe(false);
  });

  test("still authenticates getFile, and goes out as X-Project-Key only", async () => {
    const fetchMock = fakeFetch(() => jsonResponse({ ...UPLOAD_BODY, id: FILE_ID }, 200));
    const client = createClient({ publicKey: PROJECT_KEY, fetch: fetchMock });

    await client.getFile(FILE_ID).catch(() => undefined);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Project-Key")).toBe(PROJECT_KEY);
    expect(headers.has("x-public-key")).toBe(false);
  });

  test("is redacted from messages like projectKey", async () => {
    const client = createClient({
      publicKey: PROJECT_KEY,
      fetch: fakeFetch(() => jsonResponse({ error: `Unknown key ${PROJECT_KEY}` }, 401)),
    });
    const error = await client.upload(aFile()).catch((e: unknown) => e);
    expect((error as DynjandiError).message).toBe("Unknown key [redacted]");
  });
});

describe("createClient key options", () => {
  const bothMessage = /projectKey.*publicKey|publicKey.*projectKey/;

  test("refuses both options, even with the same value, without echoing a value", () => {
    // @ts-expect-error projectKey and publicKey are mutually exclusive
    const create = () => createClient({ projectKey: PROJECT_KEY, publicKey: PROJECT_KEY });
    expect(create).toThrow(DynjandiError);
    expect(create).toThrow(expect.objectContaining({ status: 0 }));
    expect(create).toThrow(bothMessage);
    expect(create).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(PROJECT_KEY) }),
    );
  });

  test("refuses neither option", () => {
    // @ts-expect-error one of projectKey or publicKey is required
    const create = () => createClient({});
    expect(create).toThrow(expect.objectContaining({ name: "DynjandiError", status: 0 }));
    expect(create).toThrow("projectKey");
  });

  test("refuses an empty string for either option, without echoing a value", () => {
    for (const options of [{ projectKey: "" }, { publicKey: "" }]) {
      const create = () => createClient(options);
      expect(create).toThrow(DynjandiError);
      expect(create).toThrow(expect.objectContaining({ status: 0 }));
      expect(create).toThrow("createClient needs a non-empty projectKey.");
    }
  });

  test("refuses an empty publicKey even when projectKey is given", () => {
    // @ts-expect-error projectKey and publicKey are mutually exclusive
    expect(() => createClient({ projectKey: PROJECT_KEY, publicKey: "" })).toThrow(bothMessage);
  });
});

describe("the ClientOptions type", () => {
  test("accepts projectKey and the deprecated publicKey, and refuses both or neither", () => {
    // Checked by `tsc --noEmit` (pnpm typecheck), which includes tests/: an unused @ts-expect-error fails it.
    const options = [{ projectKey: PROJECT_KEY }, { publicKey: PROJECT_KEY }] satisfies Parameters<
      typeof createClient
    >[0][];
    expect(options).toHaveLength(2);
    // @ts-expect-error both options at once do not compile
    const both: Parameters<typeof createClient>[0] = { projectKey: "a", publicKey: "b" };
    // @ts-expect-error neither option does not compile
    const neither: Parameters<typeof createClient>[0] = {};
    expect([both, neither]).toHaveLength(2);
  });
});
