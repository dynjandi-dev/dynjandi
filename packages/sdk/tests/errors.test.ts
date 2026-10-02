import { describe, expect, test } from "vitest";
import { createClient, DynjandiError } from "../src/index";
import { aFile, fakeFetch, jsonResponse, PUBLIC_KEY, UPLOAD_BODY } from "./helpers";

async function failureOf(fetchMock: ReturnType<typeof fakeFetch>): Promise<DynjandiError> {
  const client = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });
  const failure = await client.upload(aFile()).then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(failure instanceof DynjandiError)) {
    throw new Error("Expected upload to reject with a DynjandiError");
  }
  return failure;
}

describe("DynjandiError", () => {
  test("is an Error carrying status, message and cause", () => {
    const cause = new Error("underlying");
    const error = new DynjandiError("nope", 418, { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DynjandiError");
    expect(error.status).toBe(418);
    expect(error.message).toBe("nope");
    expect(error.cause).toBe(cause);
  });
});

describe("service errors", () => {
  test.each([
    [400, "No file provided"],
    [401, "Invalid public key"],
    [413, "File exceeds maximum allowed size"],
    [500, "Internal server error"],
  ])("maps a %i response to a DynjandiError with the service's message", async (status, error) => {
    const failure = await failureOf(fakeFetch(() => jsonResponse({ error }, status)));

    expect(failure.status).toBe(status);
    expect(failure.message).toBe(error);
  });

  test("falls back to a status message when the error body is not JSON", async () => {
    const failure = await failureOf(
      fakeFetch(() => new Response("<html>Bad gateway</html>", { status: 502 })),
    );

    expect(failure.status).toBe(502);
    expect(failure.message).toBe("Upload failed with status 502.");
    expect(failure.cause).toBeInstanceOf(Error);
  });

  test("falls back to a status message when the error body has no error string", async () => {
    const failure = await failureOf(fakeFetch(() => jsonResponse({ message: "x" }, 400)));

    expect(failure.status).toBe(400);
    expect(failure.message).toBe("Upload failed with status 400.");
  });
});

describe("network failure", () => {
  test("maps a rejected fetch to a DynjandiError with status 0 and the cause", async () => {
    const cause = new TypeError("fetch failed");
    const failure = await failureOf(
      fakeFetch(() => {
        throw cause;
      }),
    );

    expect(failure.status).toBe(0);
    expect(failure.message).toBe("Upload request failed: fetch failed");
    expect(failure.cause).toBe(cause);
  });
});

describe("malformed 2xx body", () => {
  test.each([
    ["not JSON", () => new Response("created", { status: 201 })],
    ["not an object", () => jsonResponse("created", 201)],
    ["a missing field", () => jsonResponse({ file: "a", id: "a", url: "/a", focalX: null }, 201)],
    ["a non-string id", () => jsonResponse({ ...UPLOAD_BODY, id: 7 }, 201)],
    ["a protocol-relative url", () => jsonResponse({ ...UPLOAD_BODY, url: "//evil.test/x" }, 201)],
    ["a backslash host url", () => jsonResponse({ ...UPLOAD_BODY, url: "/\\evil.test/x" }, 201)],
    ["an unparseable url", () => jsonResponse({ ...UPLOAD_BODY, url: "//" }, 201)],
    ["an unparseable host url", () => jsonResponse({ ...UPLOAD_BODY, url: "//[" }, 201)],
    ["an absolute url", () => jsonResponse({ ...UPLOAD_BODY, url: "https://evil.test/x" }, 201)],
    ["a focal value out of range", () => jsonResponse({ ...UPLOAD_BODY, focalX: 3 }, 201)],
    ["a focal value of the wrong type", () => jsonResponse({ ...UPLOAD_BODY, focalY: "0.5" }, 201)],
  ])("is a DynjandiError: %s", async (_name, respond) => {
    const failure = await failureOf(fakeFetch(respond));

    expect(failure.status).toBe(201);
    expect(failure.message).toContain("not the documented shape");
  });
});

describe("the public key", () => {
  test("never appears in a thrown error's message, even when the service echoes it", async () => {
    const failures = await Promise.all([
      failureOf(fakeFetch(() => jsonResponse({ error: "Invalid public key" }, 401))),
      failureOf(fakeFetch(() => jsonResponse({ error: `Unknown key ${PUBLIC_KEY}` }, 401))),
      failureOf(
        fakeFetch(() => {
          throw new TypeError(`could not reach host with ${PUBLIC_KEY}`);
        }),
      ),
      failureOf(fakeFetch(() => jsonResponse({ ...UPLOAD_BODY, url: 5 }, 201))),
    ]);

    for (const failure of failures) {
      expect(failure.message).not.toContain(PUBLIC_KEY);
    }
    expect(failures[1]?.message).toBe("Unknown key [redacted]");
    expect(failures[2]?.message).toBe(
      "Upload request failed: could not reach host with [redacted]",
    );
  });

  test("is not in the message of a refused focal point or invalid options", async () => {
    const client = createClient({
      publicKey: PUBLIC_KEY,
      fetch: fakeFetch(() => jsonResponse(UPLOAD_BODY, 201)),
    });
    const focalFailure = await client
      .upload(aFile(), { focal: { x: 2, y: 0 } })
      .catch((error: unknown) => error);

    expect(focalFailure).toBeInstanceOf(DynjandiError);
    expect((focalFailure as DynjandiError).message).not.toContain(PUBLIC_KEY);
    expect(() => createClient({ publicKey: PUBLIC_KEY, origin: PUBLIC_KEY })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(PUBLIC_KEY) }),
    );
  });
});
