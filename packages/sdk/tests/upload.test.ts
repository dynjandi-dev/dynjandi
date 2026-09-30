import { describe, expect, test } from "vitest";
import { createClient, DynjandiError } from "../src/index";
import { aFile, fakeFetch, firstRequest, jsonResponse, PUBLIC_KEY, UPLOAD_BODY } from "./helpers";

describe("upload", () => {
  test("resolves the relative url against the default origin", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });

    const result = await client.upload(aFile());

    expect(result).toEqual({
      ...UPLOAD_BODY,
      url: `https://cdn.dynjandi.dev${UPLOAD_BODY.url}`,
    });
    const request = firstRequest(fetchMock);
    expect(request.url).toBe("https://cdn.dynjandi.dev/upload");
    expect(request.method).toBe("POST");
  });

  test("resolves the relative url against a custom origin", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({
      publicKey: PUBLIC_KEY,
      origin: "https://images.example.com",
      fetch: fetchMock,
    });

    const result = await client.upload(aFile());

    expect(result.url).toBe(`https://images.example.com${UPLOAD_BODY.url}`);
    expect(firstRequest(fetchMock).url).toBe("https://images.example.com/upload");
  });

  test("sends the file, and the focal point as decimals, in the form body", async () => {
    const fetchMock = fakeFetch(() =>
      jsonResponse({ ...UPLOAD_BODY, focalX: 0.42, focalY: 0.18 }, 201),
    );
    const client = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });

    const result = await client.upload(aFile(), { focal: { x: 0.42, y: 0.18 } });

    const { form } = firstRequest(fetchMock);
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.get("focalX")).toBe("0.42");
    expect(form.get("focalY")).toBe("0.18");
    expect(result.focalX).toBe(0.42);
    expect(result.focalY).toBe(0.18);
  });

  test("sends no focal fields when no focal point is given", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });

    await client.upload(aFile());

    const { form } = firstRequest(fetchMock);
    expect(form.has("focalX")).toBe(false);
    expect(form.has("focalY")).toBe(false);
  });

  test("accepts the focal bounds 0 and 1", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });

    await client.upload(aFile(), { focal: { x: 0, y: 1 } });

    const { form } = firstRequest(fetchMock);
    expect(form.get("focalX")).toBe("0");
    expect(form.get("focalY")).toBe("1");
  });

  test.each([
    ["x below 0", { x: -0.1, y: 0.5 }],
    ["x above 1", { x: 1.1, y: 0.5 }],
    ["y below 0", { x: 0.5, y: -1 }],
    ["y above 1", { x: 0.5, y: 2 }],
    ["x not a number", { x: Number.NaN, y: 0.5 }],
    ["y infinite", { x: 0.5, y: Number.POSITIVE_INFINITY }],
  ])("refuses a focal point with %s before sending anything", async (_name, focal) => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });

    const failure = await client.upload(aFile(), { focal }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DynjandiError);
    expect(failure).toMatchObject({ status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sends the public key only in the X-Public-Key header", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });

    await client.upload(aFile(), { focal: { x: 0.1, y: 0.2 } });

    const { url, headers, form } = firstRequest(fetchMock);
    expect(headers.get("X-Public-Key")).toBe(PUBLIC_KEY);
    expect([...headers].filter(([name]) => name !== "x-public-key").join()).not.toContain(
      PUBLIC_KEY,
    );
    expect(url).not.toContain(PUBLIC_KEY);
    for (const [, value] of form) {
      expect(typeof value === "string" ? value : value.name).not.toContain(PUBLIC_KEY);
    }
  });
});

describe("createClient", () => {
  test("refuses an empty public key", () => {
    expect(() => createClient({ publicKey: "" })).toThrow(DynjandiError);
  });

  test("refuses an origin that is not an absolute URL", () => {
    expect(() => createClient({ publicKey: PUBLIC_KEY, origin: "cdn.dynjandi.dev" })).toThrow(
      DynjandiError,
    );
  });
});
