// Takes the grammar from @dynjandi/transform-grammar's bare entry, which bundles zod (plan D3): the only
// entry that exports `parseOperationChain`. Nothing here re-implements what the service accepts; this file
// only splits the path and words the explanations.
import {
  AppError,
  buildVariantUrl,
  type NormalizedOperation,
  parseOperationChain,
  serializeOperationChain,
} from "@dynjandi/transform-grammar";

const DYNJANDI_ORIGIN = "https://cdn.dynjandi.dev";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNKNOWN_OPERATION = "Unknown operation: ";

export interface OperationReport {
  /** The operation as written in the pasted URL, without the `-/` that introduced it. */
  raw: string;
  status: "supported" | "invalid" | "unsupported";
  /** Supported only: the operation as Dynjandi writes it, `-/<operation>/`. Concatenated, these are the URL's chain. */
  canonical?: string;
  /** Supported: what the parser rewrote. Invalid and unsupported: why Dynjandi refuses it. */
  note?: string;
}

export type CheckResult =
  | { kind: "not-a-file-url"; reason: string }
  | {
      kind: "checked";
      fileId: string;
      operations: OperationReport[];
      /** Set when every operation is supported. */
      dynjandiUrl: string | null;
      /** Set when some are not and some are: the URL without the refused ones, which is a different image. */
      partialUrl: string | null;
    };

// Sentences for an operation Dynjandi knows but whose arguments it refuses. They restate the spec's grammar
// (packages/spec/openapi.yaml) because the parser's own message for a schema failure is only
// "Invalid transform operations". Wording only: whether an input passes is always the parser's decision.
const DIMENSIONS = "each side an integer from 1 to 10000";
const ARGUMENT_HELP: Record<string, string> = {
  resize: `resize takes <width>x<height>, ${DIMENSIONS}, and at least one side (for example 800x600, 800x or x600).`,
  crop: `crop takes <width>x<height>, ${DIMENSIONS}, then a position such as center, face,center or focal/0.5x0.5.`,
  scale_crop: `scale_crop takes <width>x<height>, ${DIMENSIONS}, and optionally a position such as center, smart or focal/0.5x0.5.`,
  format: "format takes jpeg, png, webp or avif (jpg is accepted as jpeg); auto is not a format.",
  quality:
    "quality takes an integer from 1 to 100, or lightest, lighter, normal, smart, better or best.",
};

interface ParsedGroup {
  report: OperationReport;
  operations: NormalizedOperation[];
}

/** A `-`-introduced run of path segments, for example `["resize", "800x600"]`. */
function splitIntoGroups(segments: string[]): string[][] {
  const groups: string[][] = [];
  for (const segment of segments) {
    if (segment === "-") {
      groups.push([]);
    } else if (segment !== "") {
      groups.at(-1)?.push(segment);
    }
  }
  return groups.filter((group) => group.length > 0);
}

function rewriteNote(segments: string[]): string | undefined {
  const notes: string[] = [];
  const [name, size, position] = segments;
  if (name === "scale_crop") {
    notes.push("scale_crop is written as crop");
    if (position === undefined) {
      notes.push("a missing position becomes center");
    }
  }
  if ((name === "crop" || name === "scale_crop") && position === "smart") {
    notes.push("smart becomes face,center");
  }
  if (name === "format" && size === "jpg") {
    notes.push("jpg becomes jpeg");
  }
  if (name === "quality" && size !== undefined && !/^\d+$/.test(size)) {
    notes.push(`quality ${size} becomes its integer`);
  }
  return notes.length > 0 ? `${notes.join("; ")}.` : undefined;
}

function refusal(segments: string[], message: string): OperationReport {
  const raw = segments.join("/");
  const name = segments[0] ?? "";
  if (message === `${UNKNOWN_OPERATION}${name}`) {
    return {
      raw,
      status: "unsupported",
      note: `Dynjandi has no ${name} operation. It supports resize, crop, scale_crop, format and quality.`,
    };
  }
  if (message.startsWith(UNKNOWN_OPERATION)) {
    const extra = message.slice(UNKNOWN_OPERATION.length);
    return {
      raw,
      status: "invalid",
      note: `${extra} follows ${name} but is not part of its arguments, and is not an operation (operations start with -/).`,
    };
  }
  return {
    raw,
    status: "invalid",
    note: ARGUMENT_HELP[name] ?? `Dynjandi refuses this: ${message}.`,
  };
}

function parseGroup(segments: string[]): ParsedGroup | null {
  const raw = segments.join("/");
  let operations: NormalizedOperation[];
  try {
    operations = parseOperationChain(raw);
  } catch (error) {
    if (error instanceof AppError) {
      return { report: refusal(segments, error.message), operations: [] };
    }
    throw error;
  }
  if (operations.length === 0) {
    // Only a trailing filename such as photo.jpg: the parser ignores it, so there is nothing to report.
    return null;
  }
  const note = rewriteNote(segments);
  const report: OperationReport = {
    raw,
    status: "supported",
    canonical: serializeOperationChain(operations),
  };
  if (note !== undefined) {
    report.note = note;
  }
  return { report, operations };
}

export function checkUploadcareUrl(input: string): CheckResult {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { kind: "not-a-file-url", reason: "That is not a URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "not-a-file-url", reason: "Only http and https URLs can be checked." };
  }

  const [fileId, ...rest] = url.pathname.split("/").filter((segment) => segment !== "");
  if (fileId === undefined || !UUID.test(fileId)) {
    return {
      kind: "not-a-file-url",
      reason:
        "The path does not start with a file UUID. Group URLs (uuid~N) and other ids are not checked.",
    };
  }
  if (rest[0] !== "-") {
    return {
      kind: "not-a-file-url",
      reason:
        "The URL has no operations after the file id; they start with -/, for example -/resize/800x/.",
    };
  }

  const parsed = splitIntoGroups(rest)
    .map(parseGroup)
    .filter((group) => group !== null);
  if (parsed.length === 0) {
    return { kind: "not-a-file-url", reason: "The URL has no operations after the file id." };
  }

  const operations = parsed.map((group) => group.report);
  const supported = parsed.flatMap((group) => group.operations);
  const variantUrl =
    supported.length > 0 ? buildVariantUrl(DYNJANDI_ORIGIN, fileId, supported) : null;
  const allSupported = operations.every((report) => report.status === "supported");
  return {
    kind: "checked",
    fileId,
    operations,
    dynjandiUrl: allSupported ? variantUrl : null,
    partialUrl: allSupported ? null : variantUrl,
  };
}
