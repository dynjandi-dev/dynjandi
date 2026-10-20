import { AppError, parseOperationChain } from "@dynjandi/transform-grammar";
import { describe, expect, test } from "vitest";
import { DynjandiError } from "../src/index";
import { createDynjandiLoader, dynjandiLoader } from "../src/next";

const ID = "00000000-0000-4000-8000-000000000000";
const CDN = "https://cdn.dynjandi.dev";

function failureOf(run: () => unknown): DynjandiError {
  try {
    run();
  } catch (error) {
    if (error instanceof DynjandiError) {
      return error;
    }
    throw new Error("Expected a DynjandiError", { cause: error });
  }
  throw new Error("Expected the loader to throw");
}

/** The operations a loader URL asks for, as the service reads them: its path after the file id. */
function operationsOf(loaded: string, id: string) {
  return parseOperationChain(new URL(loaded).pathname.slice(`/${id}/`.length));
}

const loader = createDynjandiLoader();

// Expected URLs are written from the variant grammar in packages/spec/openapi.yaml
// (`/{id}/-/resize/<w>x/`, `/-/quality/<q>/`, `/-/format/<f>/`) and each is also parsed back through
// the grammar package's parseOperationChain, which decides what the service would read.
describe("createDynjandiLoader", () => {
  test("width becomes a resize to that width", () => {
    const loaded = loader({ src: ID, width: 800 });

    expect(loaded).toBe(`${CDN}/${ID}/-/resize/800x/`);
    expect(operationsOf(loaded, ID)).toEqual([{ op: "resize", width: 800, height: null }]);
  });

  test("a quality from Next becomes a quality operation after the resize", () => {
    const loaded = loader({ src: ID, width: 640, quality: 75 });

    expect(loaded).toBe(`${CDN}/${ID}/-/resize/640x/-/quality/75/`);
    expect(operationsOf(loaded, ID)).toEqual([
      { op: "resize", width: 640, height: null },
      { op: "quality", quality: 75 },
    ]);
  });

  test("an omitted quality emits no quality operation", () => {
    expect(loader({ src: ID, width: 640 })).not.toContain("quality");
    expect(loader({ src: ID, width: 640, quality: undefined })).toBe(`${CDN}/${ID}/-/resize/640x/`);
  });

  test("the factory's format becomes a format operation between resize and quality", () => {
    const withFormat = createDynjandiLoader({ format: "webp" });

    const loaded = withFormat({ src: ID, width: 640, quality: 75 });

    expect(loaded).toBe(`${CDN}/${ID}/-/resize/640x/-/format/webp/-/quality/75/`);
    expect(operationsOf(loaded, ID)).toEqual([
      { op: "resize", width: 640, height: null },
      { op: "format", format: "webp" },
      { op: "quality", quality: 75 },
    ]);
  });

  test("no format is emitted unless the factory is given one", () => {
    expect(loader({ src: ID, width: 640, quality: 75 })).not.toContain("format");
  });

  test("a custom origin is used, reduced to its origin", () => {
    const custom = createDynjandiLoader({ origin: "https://img.example.com/ignored" });

    expect(custom({ src: ID, width: 800 })).toBe(`https://img.example.com/${ID}/-/resize/800x/`);
  });

  test("dynjandiLoader is the default-origin loader with no format", () => {
    expect(dynjandiLoader({ src: ID, width: 800, quality: 60 })).toBe(
      `${CDN}/${ID}/-/resize/800x/-/quality/60/`,
    );
  });

  test("the boundary widths and qualities are accepted", () => {
    expect(loader({ src: ID, width: 1, quality: 1 })).toBe(`${CDN}/${ID}/-/resize/1x/-/quality/1/`);
    expect(loader({ src: ID, width: 10000, quality: 100 })).toBe(
      `${CDN}/${ID}/-/resize/10000x/-/quality/100/`,
    );
  });
});

describe("createDynjandiLoader failures", () => {
  test("a bad origin throws when the loader is created, not when it is called", () => {
    const failure = failureOf(() => createDynjandiLoader({ origin: "not a url" }));

    expect(failure.status).toBe(0);
    expect(failure.message).toContain("origin");
  });

  test("an empty src is refused", () => {
    const failure = failureOf(() => loader({ src: "", width: 640 }));

    expect(failure.status).toBe(0);
    expect(failure.message).toContain("fileId");
  });

  // An id is one path segment: RFC 3986 percent-encodes "/" as %2F and "," as %2C, so none of these
  // can add a segment or an operation. The "-/" id is the grammar's operation separator.
  test.each([
    ["a slash", "a/b", "a%2Fb"],
    ["the operation separator", "a-/b", "a-%2Fb"],
    ["a comma", "a,b", "a%2Cb"],
  ])("an id with %s is percent-encoded and adds no operation", (_name, src, encoded) => {
    const loaded = loader({ src, width: 640 });

    expect(loaded).toBe(`${CDN}/${encoded}/-/resize/640x/`);
    expect(operationsOf(loaded, encoded)).toEqual([{ op: "resize", width: 640, height: null }]);
  });

  test.each([
    ["a width of zero", { width: 0 }],
    ["a width above 10000", { width: 10001 }],
    ["a fractional width", { width: 12.5 }],
    ["a quality of zero", { width: 640, quality: 0 }],
    ["a quality above 100", { width: 640, quality: 101 }],
  ])("refuses %s", (_name, props) => {
    const failure = failureOf(() => loader({ src: ID, ...props }));

    expect(failure.status).toBe(0);
    expect(failure.cause).toBeInstanceOf(AppError);
  });
});
