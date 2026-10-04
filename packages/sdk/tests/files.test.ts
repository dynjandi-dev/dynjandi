import { describe, expect, test } from "vitest";
import { createClient, DynjandiError } from "../src/index";
import {
  FILE_BODY,
  FILE_ID,
  fakeFetch,
  firstGetRequest,
  jsonResponse,
  PUBLIC_KEY,
} from "./helpers";

function clientAnswering(respond: () => Response | Promise<Response>) {
  const fetchMock = fakeFetch(respond);
  return { fetchMock, client: createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock }) };
}

async function rejection(promise: Promise<unknown>): Promise<DynjandiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DynjandiError) return error;
    throw error;
  }
  throw new Error("Expected a DynjandiError");
}

describe("getFile", () => {
  test("resolves with the record the service sent", async () => {
    const { client } = clientAnswering(() => jsonResponse(FILE_BODY, 200));

    expect(await client.getFile(FILE_ID)).toEqual(FILE_BODY);
  });

  test("sends a GET to /files/<id> with the key in the header only", async () => {
    const { client, fetchMock } = clientAnswering(() => jsonResponse(FILE_BODY, 200));

    await client.getFile(FILE_ID);

    const request = firstGetRequest(fetchMock);
    expect(request.url).toBe(`https://cdn.dynjandi.dev/files/${FILE_ID}`);
    expect(request.method).toBe("GET");
    expect(request.headers.get("X-Public-Key")).toBe(PUBLIC_KEY);
    expect(request.body).toBeUndefined();
    expect(request.url).not.toContain(PUBLIC_KEY);
  });

  test("uses a custom origin", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(FILE_BODY, 200));
    const client = createClient({
      publicKey: PUBLIC_KEY,
      origin: "https://images.example.com",
      fetch: fetchMock,
    });

    await client.getFile(FILE_ID);

    expect(firstGetRequest(fetchMock).url).toBe(`https://images.example.com/files/${FILE_ID}`);
  });

  test("accepts a record with no stored point and no original filename", async () => {
    const body = { ...FILE_BODY, focalX: null, focalY: null, originalFilename: null };
    const { client } = clientAnswering(() => jsonResponse(body, 200));

    expect(await client.getFile(FILE_ID)).toEqual(body);
  });

  test("keeps a record that has fields the SDK does not know", async () => {
    const { client } = clientAnswering(() => jsonResponse({ ...FILE_BODY, width: 1 }, 200));

    expect(await client.getFile(FILE_ID)).toMatchObject(FILE_BODY);
  });

  test("throws the service message and status on 401 for a missing key", async () => {
    const { client } = clientAnswering(() => jsonResponse({ error: "Missing X-Public-Key" }, 401));

    const error = await rejection(client.getFile(FILE_ID));

    expect(error.status).toBe(401);
    expect(error.message).toBe("Missing X-Public-Key");
  });

  test("throws the service message and status on 401 for an invalid key", async () => {
    const { client } = clientAnswering(() => jsonResponse({ error: "Invalid public key" }, 401));

    const error = await rejection(client.getFile(FILE_ID));

    expect(error.status).toBe(401);
    expect(error.message).toBe("Invalid public key");
  });

  test("throws the service message and status on 404", async () => {
    const { client } = clientAnswering(() => jsonResponse({ error: "File not found" }, 404));

    const error = await rejection(client.getFile(FILE_ID));

    expect(error.status).toBe(404);
    expect(error.message).toBe("File not found");
  });

  test("falls back to a status message when an error body is not the documented shape", async () => {
    const { client } = clientAnswering(
      () => new Response("<html>Bad gateway</html>", { status: 502 }),
    );

    const error = await rejection(client.getFile(FILE_ID));

    expect(error.status).toBe(502);
    expect(error.message).toBe("File request failed with status 502.");
  });

  test("throws status 0 with the cause when the network request fails", async () => {
    const cause = new TypeError("fetch failed");
    const { client } = clientAnswering(() => {
      throw cause;
    });

    const error = await rejection(client.getFile(FILE_ID));

    expect(error.status).toBe(0);
    expect(error.message).toBe("File request failed: fetch failed");
    expect(error.cause).toBe(cause);
  });

  test("throws the response status when a 200 is not JSON", async () => {
    const { client } = clientAnswering(() => new Response("not json", { status: 200 }));

    const error = await rejection(client.getFile(FILE_ID));

    expect(error.status).toBe(200);
    expect(error.message).toContain("not the documented shape");
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  test("throws when a 200 body is JSON but not a record", async () => {
    const { client } = clientAnswering(() => jsonResponse({ id: FILE_ID }, 200));

    const error = await rejection(client.getFile(FILE_ID));

    expect(error.status).toBe(200);
    expect(error.message).toContain("not the documented shape");
  });

  test.each([
    ["only focalX", { focalX: 0.5, focalY: null }],
    ["only focalY", { focalX: null, focalY: 0.5 }],
    ["a point outside 0 to 1", { focalX: 1.5, focalY: 0.5 }],
    ["a non-numeric point", { focalX: "0.5", focalY: "0.5" }],
  ])("treats a 200 with %s as malformed", async (_name, point) => {
    const { client } = clientAnswering(() => jsonResponse({ ...FILE_BODY, ...point }, 200));

    const error = await rejection(client.getFile(FILE_ID));

    expect(error.status).toBe(200);
    expect(error.message).toContain("not the documented shape");
  });

  test.each([
    ["a/b", "a%2Fb"],
    ["a?b=1", "a%3Fb%3D1"],
    ["a#b", "a%23b"],
    ["../x", "..%2Fx"],
    ["a b", "a%20b"],
  ])("keeps the id %j inside /files/ as one segment", async (id, encoded) => {
    const { client, fetchMock } = clientAnswering(() =>
      jsonResponse({ error: "File not found" }, 404),
    );

    await rejection(client.getFile(id));

    const url = new URL(firstGetRequest(fetchMock).url);
    expect(url.pathname).toBe(`/files/${encoded}`);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  test.each(["", ".", ".."])("refuses the id %j with status 0 before any request", async (id) => {
    const { client, fetchMock } = clientAnswering(() => jsonResponse(FILE_BODY, 200));

    const error = await rejection(client.getFile(id));

    expect(error.status).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("never puts the key in a message, even when the service echoes it", async () => {
    const answers = [
      () => jsonResponse({ error: `Invalid public key ${PUBLIC_KEY}` }, 401),
      () => jsonResponse({ error: "File not found" }, 404),
      () => new Response("not json", { status: 200 }),
      () => jsonResponse({ id: FILE_ID }, 200),
      () => {
        throw new TypeError(`connect failed for ${PUBLIC_KEY}`);
      },
    ];

    for (const answer of answers) {
      const { client } = clientAnswering(answer);
      const error = await rejection(client.getFile(FILE_ID));
      expect(error.message).not.toContain(PUBLIC_KEY);
    }
    const { client } = clientAnswering(() => jsonResponse(FILE_BODY, 200));
    expect((await rejection(client.getFile(""))).message).not.toContain(PUBLIC_KEY);
  });
});
