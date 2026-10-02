import { AppError } from "@dynjandi/transform-grammar";
import { describe, expect, test } from "vitest";
import { createClient, DynjandiError } from "../src/index";
import { PUBLIC_KEY } from "./helpers";

const ID = "00000000-0000-4000-8000-000000000000";
const CDN = "https://cdn.dynjandi.dev";

const client = createClient({ publicKey: PUBLIC_KEY });

function failureOf(run: () => string): DynjandiError {
  try {
    run();
  } catch (error) {
    if (error instanceof DynjandiError) {
      return error;
    }
    throw new Error("Expected a DynjandiError", { cause: error });
  }
  throw new Error("Expected url() to throw");
}

describe("client.url", () => {
  test("resize with both dimensions", () => {
    expect(client.url(ID, { width: 800, height: 600 })).toBe(`${CDN}/${ID}/-/resize/800x600/`);
  });

  test("resize with width only", () => {
    expect(client.url(ID, { width: 800 })).toBe(`${CDN}/${ID}/-/resize/800x/`);
  });

  test("resize with height only", () => {
    expect(client.url(ID, { height: 600 })).toBe(`${CDN}/${ID}/-/resize/x600/`);
  });

  test("format", () => {
    expect(client.url(ID, { format: "webp" })).toBe(`${CDN}/${ID}/-/format/webp/`);
  });

  test("quality", () => {
    expect(client.url(ID, { quality: 80 })).toBe(`${CDN}/${ID}/-/quality/80/`);
  });

  test("crop defaults to the centre", () => {
    expect(client.url(ID, { crop: { width: 400, height: 400 } })).toBe(
      `${CDN}/${ID}/-/crop/400x400/center/`,
    );
  });

  test("crop with a named position", () => {
    expect(client.url(ID, { crop: { width: 400, height: 400, position: "northeast" } })).toBe(
      `${CDN}/${ID}/-/crop/400x400/northeast/`,
    );
  });

  test("crop with a focal point", () => {
    expect(
      client.url(ID, { crop: { width: 1280, height: 400, focal: { x: 0.42, y: 0.18 } } }),
    ).toBe(`${CDN}/${ID}/-/crop/1280x400/focal/0.42x0.18/`);
  });

  test("crop with a face chain", () => {
    expect(client.url(ID, { crop: { width: 600, height: 600, position: "face,attention" } })).toBe(
      `${CDN}/${ID}/-/crop/600x600/face,attention/`,
    );
  });

  test("combined options apply in a fixed order: crop, resize, format, quality", () => {
    const url = client.url(ID, {
      quality: 80,
      format: "webp",
      height: 300,
      width: 640,
      crop: { width: 1280, height: 400, focal: { x: 0.5, y: 0.25 } },
    });

    expect(url).toBe(
      `${CDN}/${ID}/-/crop/1280x400/focal/0.5x0.25/-/resize/640x300/-/format/webp/-/quality/80/`,
    );
  });

  test("builds on the client's origin", () => {
    const custom = createClient({
      publicKey: PUBLIC_KEY,
      origin: "https://img.example.com/ignored",
    });

    expect(custom.url(ID, { width: 800, height: 600 })).toBe(
      `https://img.example.com/${ID}/-/resize/800x600/`,
    );
  });
});

describe("client.url failures", () => {
  test("a value the grammar refuses is a DynjandiError, not the grammar's error", () => {
    const failure = failureOf(() => client.url(ID, { width: 10001 }));

    expect(failure).toBeInstanceOf(DynjandiError);
    expect(failure).not.toBeInstanceOf(AppError);
    expect(failure.status).toBe(0);
    expect(failure.message).toContain("resize width");
    expect(failure.cause).toBeInstanceOf(Error);
  });

  test.each([
    ["a zero width", { width: 0 }],
    ["a fractional height", { height: 12.5 }],
    ["a quality above 100", { quality: 101 }],
    ["a quality below 1", { quality: 0 }],
    ["a focal coordinate above 1", { crop: { width: 10, height: 10, focal: { x: 1.5, y: 0 } } }],
    ["a crop dimension of zero", { crop: { width: 0, height: 10 } }],
  ])("refuses %s", (_name, options) => {
    const failure = failureOf(() => client.url(ID, options));

    expect(failure.status).toBe(0);
    expect(failure.cause).toBeDefined();
  });

  test("no options is refused: the original image is the url upload returns", () => {
    const failure = failureOf(() => client.url(ID, {}));

    expect(failure.status).toBe(0);
    expect(failure.message).toBe("Cannot build a variant URL: Missing operations");
    expect(failure.cause).toBeInstanceOf(AppError);
    expect(failure.cause).toMatchObject({ statusCode: 400 });
  });

  test("an empty file id is refused", () => {
    const failure = failureOf(() => client.url("", { width: 100 }));

    expect(failure.status).toBe(0);
    expect(failure.message).toContain("fileId");
  });
});
