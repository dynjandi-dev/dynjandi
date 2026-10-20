import { parseOperationChain } from "@dynjandi/transform-grammar";
import { describe, expect, test } from "vitest";
import { type CheckResult, checkUploadcareUrl } from "../src/check.js";

// Expected values come from packages/spec/openapi.yaml, "Variant URL grammar" (read 2026-10-20), and from
// plan §1, never from running the checker. Each group below names what decided it.

const ID = "5c4e2f3a-0b1d-4e6f-8a9b-1c2d3e4f5a6b";
const DYNJANDI = `https://cdn.dynjandi.dev/${ID}/`;

function ucare(path: string, host = "ucarecdn.com"): string {
  return `https://${host}/${ID}/${path}`;
}

function checked(result: CheckResult) {
  if (result.kind !== "checked") {
    throw new Error(`expected a checked result, got: ${result.reason}`);
  }
  return result;
}

function refused(result: CheckResult): string {
  if (result.kind !== "not-a-file-url") {
    throw new Error("expected a refusal");
  }
  return result.reason;
}

describe("supported operations (spec: the operation list and its examples)", () => {
  test.each([
    // [what decided it, Uploadcare path, Dynjandi path]
    ["spec example", "-/resize/800x600/", "-/resize/800x600/"],
    ["spec: width alone is allowed", "-/resize/800x/", "-/resize/800x/"],
    ["spec: height alone is allowed", "-/resize/x600/", "-/resize/x600/"],
    ["spec example", "-/crop/400x400/center/", "-/crop/400x400/center/"],
    [
      "spec example, focal point",
      "-/crop/1280x400/focal/0.42x0.18/",
      "-/crop/1280x400/focal/0.42x0.18/",
    ],
    [
      "spec example, face chain",
      "-/crop/600x600/face,attention/",
      "-/crop/600x600/face,attention/",
    ],
    ["spec: a compass position", "-/crop/300x200/northwest/", "-/crop/300x200/northwest/"],
    ["spec: format webp", "-/format/webp/", "-/format/webp/"],
    ["spec: format avif", "-/format/avif/", "-/format/avif/"],
    ["spec: format png", "-/format/png/", "-/format/png/"],
    ["spec: format jpeg", "-/format/jpeg/", "-/format/jpeg/"],
    ["spec: quality is an integer 1 to 100", "-/quality/80/", "-/quality/80/"],
    ["spec: quality lower bound", "-/quality/1/", "-/quality/1/"],
    ["spec: quality upper bound", "-/quality/100/", "-/quality/100/"],
  ])("%s: %s", (_decidedBy, path, expected) => {
    const result = checked(checkUploadcareUrl(ucare(path)));
    expect(result.fileId).toBe(ID);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]?.status).toBe("supported");
    expect(result.operations[0]?.canonical).toBe(expected);
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}${expected}`);
    expect(result.partialUrl).toBeNull();
  });

  test("operations apply in the order given (spec: the example chain)", () => {
    const result = checked(
      checkUploadcareUrl(ucare("-/resize/800x600/-/format/webp/-/quality/80/")),
    );
    expect(result.operations.map((operation) => operation.status)).toEqual([
      "supported",
      "supported",
      "supported",
    ]);
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/resize/800x600/-/format/webp/-/quality/80/`);
  });
});

describe("rewrites the parser makes, each with a note (spec and plan §1)", () => {
  test("scale_crop is written as crop and defaults to center (spec: scale_crop)", () => {
    const result = checked(checkUploadcareUrl(ucare("-/scale_crop/300x200/")));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/crop/300x200/center/`);
    expect(result.operations[0]?.note).toMatch(/scale_crop is written as crop/);
    expect(result.operations[0]?.note).toMatch(/center/);
  });

  test("scale_crop keeps a position it is given (spec: the position is optional)", () => {
    const result = checked(checkUploadcareUrl(ucare("-/scale_crop/300x200/north/")));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/crop/300x200/north/`);
    expect(result.operations[0]?.note).toMatch(/scale_crop is written as crop/);
    expect(result.operations[0]?.note).not.toMatch(/center/);
  });

  test("scale_crop accepts a focal point as crop does (spec: scale_crop)", () => {
    const result = checked(checkUploadcareUrl(ucare("-/scale_crop/300x200/focal/0.5x0.5/")));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/crop/300x200/focal/0.5x0.5/`);
  });

  test("scale_crop smart becomes face,center (spec: smart is an alias for face,center)", () => {
    const result = checked(checkUploadcareUrl(ucare("-/scale_crop/300x200/smart/")));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/crop/300x200/face,center/`);
    expect(result.operations[0]?.note).toMatch(/smart becomes face,center/);
  });

  test("crop smart becomes face,center (spec: smart is an alias for face,center)", () => {
    const result = checked(checkUploadcareUrl(ucare("-/crop/300x200/smart/")));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/crop/300x200/face,center/`);
    expect(result.operations[0]?.note).toMatch(/smart becomes face,center/);
  });

  test("format jpg becomes jpeg (spec: jpg is an alias for jpeg)", () => {
    const result = checked(checkUploadcareUrl(ucare("-/format/jpg/")));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/format/jpeg/`);
    expect(result.operations[0]?.note).toMatch(/jpg becomes jpeg/);
  });

  test.each([
    ["lightest", 55],
    ["lighter", 70],
    ["normal", 80],
    ["smart", 80],
    ["better", 88],
    ["best", 95],
  ])("quality %s becomes %i (spec: the named levels)", (level, value) => {
    const result = checked(checkUploadcareUrl(ucare(`-/quality/${level}/`)));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/quality/${value}/`);
    expect(result.operations[0]?.note).toMatch(new RegExp(`quality ${level} becomes`));
  });

  test("an operation that needs no rewrite carries no note", () => {
    const result = checked(checkUploadcareUrl(ucare("-/format/webp/")));
    expect(result.operations[0]?.note).toBeUndefined();
  });
});

describe("what the parser ignores (spec: empty segments, lone -, one trailing filename)", () => {
  test("a trailing filename after the last operation is ignored", () => {
    const result = checked(checkUploadcareUrl(ucare("-/resize/800x600/photo.jpg")));
    expect(result.operations).toHaveLength(1);
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/resize/800x600/`);
  });

  test("a trailing filename on its own after -/ is ignored", () => {
    const result = checked(checkUploadcareUrl(ucare("-/format/webp/-/photo.jpg")));
    expect(result.operations).toHaveLength(1);
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/format/webp/`);
  });

  test("empty segments and a lone - between operations are ignored", () => {
    const result = checked(
      checkUploadcareUrl(`https://ucarecdn.com/${ID}//-//resize/100x100///-/-/format/png/`),
    );
    expect(result.operations).toHaveLength(2);
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/resize/100x100/-/format/png/`);
  });
});

describe("operations Dynjandi does not have (plan §1: Unknown operation)", () => {
  test.each([
    ["preview", "-/preview/"],
    ["preview", "-/preview/800x600/"],
    ["progressive", "-/progressive/yes/"],
    ["stretch", "-/stretch/off/"],
    ["setfill", "-/setfill/ffffff/"],
    ["blur", "-/blur/20/"],
  ])("%s is unsupported: %s", (name, path) => {
    const result = checked(checkUploadcareUrl(ucare(path)));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]?.status).toBe("unsupported");
    expect(result.operations[0]?.note).toContain(name);
    expect(result.operations[0]?.canonical).toBeUndefined();
    expect(result.dynjandiUrl).toBeNull();
    expect(result.partialUrl).toBeNull();
  });
});

describe("operations Dynjandi has but refuses these arguments for (plan §1, spec ranges)", () => {
  test("format/auto is not a format (plan §1) and the reason lists the real ones (spec)", () => {
    const result = checked(checkUploadcareUrl(ucare("-/format/auto/")));
    expect(result.operations[0]?.status).toBe("invalid");
    expect(result.operations[0]?.raw).toBe("format/auto");
    expect(result.operations[0]?.note).toMatch(/jpeg, png, webp or avif/);
    expect(result.dynjandiUrl).toBeNull();
  });

  test.each([
    ["resize/0x0", "neither side given, and 0 is below the 1 minimum (spec)"],
    ["resize/10001x100", "10001 is above the 10000 maximum (spec)"],
    ["resize/800", "no x, so not <width>x<height> (spec)"],
    ["crop/100x100", "crop needs a position (spec)"],
    ["crop/100x100/nowhere", "nowhere is not a position (spec)"],
    ["quality/0", "below the 1 minimum (spec)"],
    ["quality/101", "above the 100 maximum (spec)"],
    ["quality/high", "not an integer or a named level (spec)"],
    [
      "scale_crop/300x200/smart_faces",
      "smart_faces is not a position, and not an operation (spec: scale_crop positions)",
    ],
  ])("%s is invalid: %s", (operation) => {
    const result = checked(checkUploadcareUrl(ucare(`-/${operation}/`)));
    expect(result.operations[0]?.status).toBe("invalid");
    expect(result.operations[0]?.raw).toBe(operation);
    expect(result.operations[0]?.note).toBeTruthy();
    expect(result.dynjandiUrl).toBeNull();
  });

  test("an invalid operation names its own rule, not the parser's generic message", () => {
    const note = checked(checkUploadcareUrl(ucare("-/resize/0x0/"))).operations[0]?.note ?? "";
    expect(note).toMatch(/1 to 10000/);
    expect(note).not.toMatch(/Invalid transform operations/);
  });
});

describe("several operations at once (plan D4: report every failure, not the first)", () => {
  const mixed = "-/preview/-/resize/800x600/-/blur/20/-/format/auto/-/quality/best/";

  test("every refused operation is reported, in order, with the supported ones", () => {
    const result = checked(checkUploadcareUrl(ucare(mixed)));
    expect(result.operations.map((operation) => [operation.raw, operation.status])).toEqual([
      ["preview", "unsupported"],
      ["resize/800x600", "supported"],
      ["blur/20", "unsupported"],
      ["format/auto", "invalid"],
      ["quality/best", "supported"],
    ]);
  });

  test("the partial URL keeps only the supported operations and there is no full URL (plan D6)", () => {
    const result = checked(checkUploadcareUrl(ucare(mixed)));
    expect(result.dynjandiUrl).toBeNull();
    expect(result.partialUrl).toBe(`${DYNJANDI}-/resize/800x600/-/quality/95/`);
  });

  test("with nothing supported there is no URL of either kind", () => {
    const result = checked(checkUploadcareUrl(ucare("-/preview/-/blur/20/")));
    expect(result.dynjandiUrl).toBeNull();
    expect(result.partialUrl).toBeNull();
  });
});

describe("input that is not a file URL (plan D5)", () => {
  test("a path with no UUID first segment", () => {
    expect(
      refused(checkUploadcareUrl("https://ucarecdn.com/not-a-uuid/-/resize/100x100/")),
    ).toMatch(/UUID/);
  });

  test("a group URL (uuid~N) is refused, and the reason says why", () => {
    expect(refused(checkUploadcareUrl(`https://ucarecdn.com/${ID}~3/nth/0/`))).toMatch(/uuid~N/);
  });

  test("a bare host has no file", () => {
    expect(refused(checkUploadcareUrl("https://ucarecdn.com/"))).toMatch(/UUID/);
  });

  test.each([
    ["the file id alone", `https://ucarecdn.com/${ID}/`],
    ["the file id without a slash", `https://ucarecdn.com/${ID}`],
    ["-/ with nothing after it (spec: answered with 400)", `https://ucarecdn.com/${ID}/-/`],
    ["only a filename", `https://ucarecdn.com/${ID}/photo.jpg`],
    ["only a filename after -/", `https://ucarecdn.com/${ID}/-/photo.jpg`],
  ])("no operations: %s", (_what, input) => {
    expect(refused(checkUploadcareUrl(input))).toMatch(/no operations/);
  });

  test.each([
    ["plain text", "hello"],
    ["an empty string", ""],
    ["a relative path", `/${ID}/-/resize/100x100/`],
    ["ftp", `ftp://ucarecdn.com/${ID}/-/resize/100x100/`],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
  ])("not an http(s) URL: %s", (_what, input) => {
    expect(checkUploadcareUrl(input).kind).toBe("not-a-file-url");
  });
});

describe("what is accepted around the path (plan D5)", () => {
  test("any host: a custom CDN domain is checked, and the Dynjandi URL ignores it", () => {
    const result = checked(checkUploadcareUrl(ucare("-/format/webp/", "images.example.com")));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/format/webp/`);
  });

  test("http is accepted as well as https", () => {
    const result = checked(checkUploadcareUrl(`http://ucarecdn.com/${ID}/-/format/webp/`));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/format/webp/`);
  });

  test("whitespace around the pasted text is trimmed", () => {
    const result = checked(checkUploadcareUrl(`  \n${ucare("-/format/webp/")}\t `));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/format/webp/`);
  });

  test("a query string and fragment do not reach the operations", () => {
    const result = checked(checkUploadcareUrl(`${ucare("-/format/webp/")}?x=1#top`));
    expect(result.dynjandiUrl).toBe(`${DYNJANDI}-/format/webp/`);
  });

  test("an upper-case UUID is a UUID", () => {
    const upper = ID.toUpperCase();
    const result = checked(checkUploadcareUrl(`https://ucarecdn.com/${upper}/-/format/webp/`));
    expect(result.fileId).toBe(upper);
  });
});

describe("pasted text is untrusted (security/validation.md)", () => {
  test("markup in an operation comes back as data, is reported unsupported, and builds no URL", () => {
    const result = checked(checkUploadcareUrl(ucare("-/<img src=x onerror=alert(1)>/")));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]?.status).toBe("unsupported");
    expect(result.dynjandiUrl).toBeNull();
    expect(result.partialUrl).toBeNull();
  });

  test("a supported chain beside markup never lets the markup into the partial URL", () => {
    const result = checked(checkUploadcareUrl(ucare("-/format/webp/-/<script>/")));
    expect(result.partialUrl).toBe(`${DYNJANDI}-/format/webp/`);
  });
});

describe("parity with the parser (plan §5: the splitter must not disagree with the parser)", () => {
  const chains = [
    "-/resize/800x600/-/format/webp/-/quality/80/",
    "-/resize/800x/-/format/jpg/",
    "-/scale_crop/300x200/-/quality/best/",
    "-/scale_crop/300x200/smart/-/format/avif/",
    "-/crop/1280x400/focal/0.42x0.18/-/quality/lightest/",
    "-/crop/600x600/face,attention/",
    "-/-/resize/100x100//-/format/png/photo.jpg",
  ];

  test.each(chains)(
    "a chain the checker accepts parses whole to the same operations: %s",
    (chain) => {
      const result = checked(checkUploadcareUrl(ucare(chain)));
      expect(result.dynjandiUrl).not.toBeNull();
      // The operations the parser makes of the whole pasted chain, against those of the Dynjandi URL's chain.
      const whole = parseOperationChain(chain);
      const fromUrl = parseOperationChain(
        new URL(result.dynjandiUrl ?? "").pathname.slice(ID.length + 2),
      );
      expect(fromUrl).toEqual(whole);
    },
  );

  test("a chain the checker refuses in part is refused by the whole-chain parser too", () => {
    const chain = "-/resize/800x600/-/blur/20/";
    expect(checked(checkUploadcareUrl(ucare(chain))).dynjandiUrl).toBeNull();
    expect(() => parseOperationChain(chain)).toThrow(/Unknown operation: blur/);
  });
});
