import { describe, expect, test, vi } from "vitest";
import { createClient, DEFAULT_FORMATS, DEFAULT_WIDTHS, DynjandiError } from "../src/index";
import { fakeFetch, PUBLIC_KEY } from "./helpers";

const ID = "00000000-0000-4000-8000-000000000000";
const CDN = "https://cdn.dynjandi.dev";

const client = createClient({ publicKey: PUBLIC_KEY });

function failureOf(run: () => unknown): DynjandiError {
  try {
    run();
  } catch (error) {
    if (error instanceof DynjandiError) {
      return error;
    }
    throw new Error("Expected a DynjandiError", { cause: error });
  }
  throw new Error("Expected srcset() to throw");
}

describe("client.srcset", () => {
  test("one candidate per width, joined by a comma and a space", () => {
    expect(client.srcset(ID, { widths: [320, 640] })).toBe(
      `${CDN}/${ID}/-/resize/320x/ 320w, ${CDN}/${ID}/-/resize/640x/ 640w`,
    );
  });

  test("uses the client's origin", () => {
    const other = createClient({ publicKey: PUBLIC_KEY, origin: "https://img.example.com" });
    expect(other.srcset(ID, { widths: [320] })).toBe(
      `https://img.example.com/${ID}/-/resize/320x/ 320w`,
    );
  });

  test("defaults to DEFAULT_WIDTHS", () => {
    expect(DEFAULT_WIDTHS).toEqual([320, 640, 960, 1280, 1920]);
    const candidates = client.srcset(ID).split(", ");
    expect(candidates.map((candidate) => candidate.split(" ")[1])).toEqual(
      DEFAULT_WIDTHS.map((width) => `${width}w`),
    );
  });

  test("passes format and quality through, in url()'s order", () => {
    expect(client.srcset(ID, { widths: [320], format: "webp", quality: 70 })).toBe(
      `${CDN}/${ID}/-/resize/320x/-/format/webp/-/quality/70/ 320w`,
    );
  });

  test("a crop goes before each resize", () => {
    const crop = { width: 1600, height: 900 };
    expect(client.srcset(ID, { widths: [320, 640], crop })).toBe(
      [
        `${CDN}/${ID}/-/crop/1600x900/center/-/resize/320x/ 320w`,
        `${CDN}/${ID}/-/crop/1600x900/center/-/resize/640x/ 640w`,
      ].join(", "),
    );
  });

  test("sorts widths ascending", () => {
    expect(client.srcset(ID, { widths: [640, 320] })).toBe(
      `${CDN}/${ID}/-/resize/320x/ 320w, ${CDN}/${ID}/-/resize/640x/ 640w`,
    );
  });

  test("does not change the caller's widths", () => {
    const widths = [640, 320];
    client.srcset(ID, { widths });
    expect(widths).toEqual([640, 320]);
  });

  test("makes no request", () => {
    const fetchMock = fakeFetch(() => new Response(null, { status: 200 }));
    const offline = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });
    const globalFetch = vi.spyOn(globalThis, "fetch");
    offline.srcset(ID);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });
});

describe("client.srcset refusals", () => {
  test("empty widths", () => {
    const error = failureOf(() => client.srcset(ID, { widths: [] }));
    expect(error.status).toBe(0);
    expect(error.message).toContain("widths");
  });

  test.each([
    ["a fraction", 320.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("non-integer width: %s", (_name, width) => {
    const error = failureOf(() => client.srcset(ID, { widths: [320, width] }));
    expect(error.status).toBe(0);
    expect(error.message).toContain("widths");
  });

  test.each([0, -1, 10_001])("out-of-range width %d names the field", (width) => {
    const error = failureOf(() => client.srcset(ID, { widths: [320, width] }));
    expect(error.status).toBe(0);
    expect(error.message).toContain("width");
  });

  test("duplicate widths", () => {
    const error = failureOf(() => client.srcset(ID, { widths: [320, 640, 320] }));
    expect(error.status).toBe(0);
    expect(error.message).toContain("widths");
    expect(error.message).toContain("320");
  });

  test("height", () => {
    // `height` is not in the type; a JavaScript caller can still pass it.
    const options = { widths: [320], height: 200 };
    const error = failureOf(() => client.srcset(ID, options));
    expect(error.status).toBe(0);
    expect(error.message).toContain("height");
  });

  test("an empty fileId", () => {
    const error = failureOf(() => client.srcset("", { widths: [320] }));
    expect(error.status).toBe(0);
    expect(error.message).toContain("fileId");
  });
});

describe("client.srcset with an odd fileId", () => {
  test.each([
    ["a comma", "a,b"],
    ["a space", "a b"],
    ["a comma and a space", "a, 640w, https://evil.example/x"],
    ["a slash", "a/b"],
  ])("%s cannot add a candidate", (_name, fileId) => {
    const widths = [320, 640];
    const candidates = client.srcset(fileId, { widths }).split(", ");
    expect(candidates).toHaveLength(widths.length);
    for (const [index, candidate] of candidates.entries()) {
      expect(candidate).toMatch(/^\S+ \d+w$/);
      expect(candidate.startsWith(`${CDN}/`)).toBe(true);
      expect(candidate.split("/")[3]).toBe(encodeURIComponent(fileId));
      expect(candidate.endsWith(` ${widths[index]}w`)).toBe(true);
    }
  });

  test.each([".", ".."])("refuses %j, which URL resolution would collapse", (fileId) => {
    expect(failureOf(() => client.srcset(fileId, { widths: [320] })).status).toBe(0);
  });
});

describe("client.pictureSources", () => {
  test("defaults to avif then webp, with the type of each", () => {
    expect(DEFAULT_FORMATS).toEqual(["avif", "webp"]);
    const sources = client.pictureSources(ID);
    expect(sources.map((source) => source.type)).toEqual(["image/avif", "image/webp"]);
    expect(sources[0]?.srcset).toBe(client.srcset(ID, { format: "avif" }));
    expect(sources[1]?.srcset).toBe(client.srcset(ID, { format: "webp" }));
  });

  test("keeps the order given", () => {
    const sources = client.pictureSources(ID, { formats: ["webp", "avif", "png"], widths: [320] });
    expect(sources.map((source) => source.type)).toEqual(["image/webp", "image/avif", "image/png"]);
  });

  test("the jpg alias gives image/jpeg and a jpeg URL", () => {
    expect(client.pictureSources(ID, { formats: ["jpg"], widths: [320] })).toEqual([
      { type: "image/jpeg", srcset: `${CDN}/${ID}/-/resize/320x/-/format/jpeg/ 320w` },
    ]);
  });

  test("passes widths, quality and crop through to every source", () => {
    const crop = { width: 1600, height: 900 };
    const sources = client.pictureSources(ID, { widths: [640, 320], quality: 60, crop });
    const shared = { widths: [320, 640], quality: 60, crop };
    expect(sources.map((source) => source.srcset)).toEqual([
      client.srcset(ID, { ...shared, format: "avif" }),
      client.srcset(ID, { ...shared, format: "webp" }),
    ]);
    expect(sources[0]?.srcset).toContain(
      "/-/crop/1600x900/center/-/resize/320x/-/format/avif/-/quality/60/",
    );
  });

  test("sizes is copied to every source unchanged, and absent otherwise", () => {
    const sizes = '(min-width: 800px) 800px, 100vw "quoted" <b>';
    for (const source of client.pictureSources(ID, { sizes })) {
      expect(source.sizes).toBe(sizes);
    }
    for (const source of client.pictureSources(ID)) {
      expect("sizes" in source).toBe(false);
    }
  });

  test("with defaults and a jpeg fallback, a page uses 15 distinct URLs", () => {
    const candidates = [
      ...client.pictureSources(ID).map((source) => source.srcset),
      client.srcset(ID, { format: "jpeg" }),
    ].flatMap((value) => value.split(", ").map((candidate) => candidate.split(" ")[0]));
    expect(candidates).toHaveLength(DEFAULT_WIDTHS.length * 3);
    expect(new Set(candidates).size).toBe(15);
  });

  test("makes no request", () => {
    const fetchMock = fakeFetch(() => new Response(null, { status: 200 }));
    const offline = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });
    const globalFetch = vi.spyOn(globalThis, "fetch");
    offline.pictureSources(ID);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });
});

describe("client.pictureSources refusals", () => {
  test("empty formats", () => {
    const error = failureOf(() => client.pictureSources(ID, { formats: [] }));
    expect(error.status).toBe(0);
    expect(error.message).toContain("formats");
  });

  test.each([[["webp", "webp"]], [["jpeg", "jpg"]]] as const)("repeated formats %j", (formats) => {
    const error = failureOf(() => client.pictureSources(ID, { formats }));
    expect(error.status).toBe(0);
    expect(error.message).toContain("formats");
  });

  test("a format, which formats replaces", () => {
    // `format` is not in the type; a JavaScript caller can still pass it.
    const options = { widths: [320], format: "webp" };
    const error = failureOf(() => client.pictureSources(ID, options));
    expect(error.status).toBe(0);
    expect(error.message).toContain("format");
  });

  test("a format the grammar does not know", () => {
    const formats = ["gif"] as unknown as ["avif"];
    expect(failureOf(() => client.pictureSources(ID, { formats })).status).toBe(0);
  });

  test("srcset's own refusals reach the caller", () => {
    expect(failureOf(() => client.pictureSources(ID, { widths: [] })).message).toContain("widths");
    expect(failureOf(() => client.pictureSources(ID, { widths: [0] })).message).toContain("width");
  });
});

describe("client.placeholder", () => {
  test("defaults to a 24 pixel wide, quality 20 webp, in url()'s order", () => {
    expect(client.placeholder(ID)).toBe(`${CDN}/${ID}/-/resize/24x/-/format/webp/-/quality/20/`);
  });

  test("uses the client's origin", () => {
    const other = createClient({ publicKey: PUBLIC_KEY, origin: "https://img.example.com" });
    expect(other.placeholder(ID)).toBe(
      `https://img.example.com/${ID}/-/resize/24x/-/format/webp/-/quality/20/`,
    );
  });

  test("each default can be overridden on its own", () => {
    expect(client.placeholder(ID, { width: 32 })).toBe(
      `${CDN}/${ID}/-/resize/32x/-/format/webp/-/quality/20/`,
    );
    expect(client.placeholder(ID, { quality: 40 })).toBe(
      `${CDN}/${ID}/-/resize/24x/-/format/webp/-/quality/40/`,
    );
    expect(client.placeholder(ID, { format: "jpeg" })).toBe(
      `${CDN}/${ID}/-/resize/24x/-/format/jpeg/-/quality/20/`,
    );
  });

  test("keeps the crop, before the resize, so the aspect ratio is the image's", () => {
    expect(client.placeholder(ID, { crop: { width: 1600, height: 900 } })).toBe(
      `${CDN}/${ID}/-/crop/1600x900/center/-/resize/24x/-/format/webp/-/quality/20/`,
    );
  });

  test("refuses a height, naming it", () => {
    const options = { height: 24 } as Parameters<typeof client.placeholder>[1];
    const error = failureOf(() => client.placeholder(ID, options));
    expect(error.status).toBe(0);
    expect(error.message).toContain("height");
  });

  test("passes url()'s refusals through", () => {
    expect(failureOf(() => client.placeholder(ID, { width: 0 })).status).toBe(0);
  });

  test("makes no request", () => {
    const fetchMock = fakeFetch(() => new Response(null, { status: 200 }));
    const offline = createClient({ publicKey: PUBLIC_KEY, fetch: fetchMock });
    const globalFetch = vi.spyOn(globalThis, "fetch");
    offline.placeholder(ID);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });
});
