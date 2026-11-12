import { describe, expect, test } from "vitest";
import { createClient, DynjandiError } from "../src/index";
import { aFile, fakeFetch, firstRequest, jsonResponse, PROJECT_KEY, UPLOAD_BODY } from "./helpers";

describe("upload", () => {
  test("resolves the relative url against the default origin", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ projectKey: PROJECT_KEY, fetch: fetchMock });

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
      projectKey: PROJECT_KEY,
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
    const client = createClient({ projectKey: PROJECT_KEY, fetch: fetchMock });

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
    const client = createClient({ projectKey: PROJECT_KEY, fetch: fetchMock });

    await client.upload(aFile());

    const { form } = firstRequest(fetchMock);
    expect(form.has("focalX")).toBe(false);
    expect(form.has("focalY")).toBe(false);
  });

  test("accepts the focal bounds 0 and 1", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ projectKey: PROJECT_KEY, fetch: fetchMock });

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
    const client = createClient({ projectKey: PROJECT_KEY, fetch: fetchMock });

    const failure = await client.upload(aFile(), { focal }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DynjandiError);
    expect(failure).toMatchObject({ status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sends the project key only in the X-Project-Key header", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ projectKey: PROJECT_KEY, fetch: fetchMock });

    await client.upload(aFile(), { focal: { x: 0.1, y: 0.2 } });

    const { url, headers, form } = firstRequest(fetchMock);
    expect(headers.get("X-Project-Key")).toBe(PROJECT_KEY);
    expect(headers.has("x-public-key")).toBe(false);
    expect([...headers].filter(([name]) => name !== "x-project-key").join()).not.toContain(
      PROJECT_KEY,
    );
    expect(url).not.toContain(PROJECT_KEY);
    for (const [, value] of form) {
      expect(typeof value === "string" ? value : value.name).not.toContain(PROJECT_KEY);
    }
  });
});

// Sources: §8 of plan #43 and openapi.yaml paths: requests (and the key) go to apiOrigin, `url` = origin + `/<id>`.
describe("upload with an apiOrigin", () => {
  const ORIGIN = "http://127.0.0.1:4600";
  const API_ORIGIN = "http://host.docker.internal:4600";

  test("posts to apiOrigin with the key, resolves url on origin, and makes no request to origin", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({
      projectKey: PROJECT_KEY,
      origin: ORIGIN,
      apiOrigin: `${API_ORIGIN}/ignored`,
      fetch: fetchMock,
    });

    const result = await client.upload(aFile());

    const request = firstRequest(fetchMock);
    expect(request.url).toBe(`${API_ORIGIN}/upload`);
    expect(request.method).toBe("POST");
    expect(request.headers.get("X-Project-Key")).toBe(PROJECT_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.url).toBe(`${ORIGIN}${UPLOAD_BODY.url}`);
  });

  test("keeps url, srcset, pictureSources and placeholder on origin", () => {
    const client = createClient({
      projectKey: PROJECT_KEY,
      origin: ORIGIN,
      apiOrigin: API_ORIGIN,
    });
    const id = UPLOAD_BODY.id;

    expect(client.url(id, { width: 100 }).startsWith(`${ORIGIN}/`)).toBe(true);
    expect(client.srcset(id).startsWith(`${ORIGIN}/`)).toBe(true);
    for (const source of client.pictureSources(id)) {
      expect(source.srcset.startsWith(`${ORIGIN}/`)).toBe(true);
    }
    expect(client.placeholder(id).startsWith(`${ORIGIN}/`)).toBe(true);
  });

  test.each([
    ["a protocol-relative url", "//evil.example/x"],
    ["a backslash host url", "/\\evil.example/x"],
  ])("still refuses %s that leaves origin", async (_name, url) => {
    const fetchMock = fakeFetch(() => jsonResponse({ ...UPLOAD_BODY, url }, 201));
    const client = createClient({
      projectKey: PROJECT_KEY,
      origin: ORIGIN,
      apiOrigin: API_ORIGIN,
      fetch: fetchMock,
    });

    await expect(client.upload(aFile())).rejects.toThrow("not the documented shape");
  });

  test("sends requests to origin when apiOrigin is not given", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(UPLOAD_BODY, 201));
    const client = createClient({ projectKey: PROJECT_KEY, origin: ORIGIN, fetch: fetchMock });

    await client.upload(aFile());

    expect(firstRequest(fetchMock).url).toBe(`${ORIGIN}/upload`);
  });
});

describe("createClient", () => {
  test("refuses an empty project key", () => {
    expect(() => createClient({ projectKey: "" })).toThrow(DynjandiError);
  });

  test("refuses an origin that is not an absolute URL", () => {
    expect(() => createClient({ projectKey: PROJECT_KEY, origin: "cdn.dynjandi.dev" })).toThrow(
      DynjandiError,
    );
  });

  test("refuses an apiOrigin that is not an absolute URL, naming apiOrigin", () => {
    const attempt = () =>
      createClient({ projectKey: PROJECT_KEY, origin: "http://127.0.0.1:4600", apiOrigin: "host" });
    expect(attempt).toThrow(DynjandiError);
    expect(attempt).toThrow("apiOrigin");
    try {
      attempt();
    } catch (error) {
      expect((error as DynjandiError).status).toBe(0);
    }
  });

  // WHATWG URL reads `host.docker.internal:4600` as the scheme `host.docker.internal:`, with the origin "null":
  // it parses, so only the scheme check catches it, at createClient and not at the first request.
  test.each([
    ["no scheme, which URL reads as a scheme of its own", "host.docker.internal:4600"],
    ["a scheme fetch cannot use", "ftp://127.0.0.1:4600"],
  ])("refuses an apiOrigin with %s, naming apiOrigin", (_name, apiOrigin) => {
    const attempt = () =>
      createClient({ projectKey: PROJECT_KEY, origin: "http://127.0.0.1:4600", apiOrigin });
    expect(attempt).toThrow(DynjandiError);
    expect(attempt).toThrow("apiOrigin");
  });

  test("refuses an origin with no scheme, which URL reads as a scheme of its own", () => {
    const attempt = () => createClient({ projectKey: PROJECT_KEY, origin: "localhost:4600" });
    expect(attempt).toThrow(DynjandiError);
    expect(attempt).toThrow("origin URL");
  });
});
