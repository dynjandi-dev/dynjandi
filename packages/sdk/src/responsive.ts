import type { OutputFormat } from "@dynjandi/transform-grammar";
import { DynjandiError } from "./errors.js";
import { type UrlOptions, url } from "./url.js";

/**
 * The widths `srcset` uses when the caller passes none.
 *
 * This is a cost decision, not a styling one: every width is a separate variant, and each new variant
 * counts against the project's plan cap. Variants per image = widths x formats (x crops). These five
 * widths in one format are 5 variants per image; a `<picture>` with `avif`, `webp` and a `jpeg` fallback
 * is 5 x 3 = 15. Pass a shorter `widths` to spend less.
 */
export const DEFAULT_WIDTHS: readonly number[] = [320, 640, 960, 1280, 1920];

/** What `url()` takes as the file to build a variant of. The helpers follow it, so they never drift. */
type FileId = Parameters<typeof url>[1];

/**
 * `url()`'s options without the size: `srcset` varies the width itself, and a fixed `height` at a
 * varying width would distort the image. For a fixed aspect ratio pass `crop`, which resizes after it.
 */
export interface SrcsetOptions extends Omit<UrlOptions, "width" | "height"> {
  /** Distinct integers, each from 1 to 10000. Defaults to `DEFAULT_WIDTHS`. */
  widths?: readonly number[];
}

function refuse(reason: string): never {
  throw new DynjandiError(`Cannot build a srcset: ${reason}`, 0);
}

/** Checks `widths` and returns them ascending. Nothing is built from a list that fails here. */
function validatedWidths(widths: readonly number[]): number[] {
  if (widths.length === 0) {
    refuse("widths must not be empty.");
  }
  const seen = new Set<number>();
  for (const width of widths) {
    if (!Number.isInteger(width)) {
      refuse(`widths must be integers, got ${String(width)}.`);
    }
    if (seen.has(width)) {
      refuse(`widths must not repeat, got ${width} twice.`);
    }
    seen.add(width);
  }
  return [...widths].sort((a, b) => a - b);
}

/**
 * The value of an `srcset` attribute: one `<url> <width>w` candidate per width, ascending, joined by
 * `", "`. Every URL comes from `url()`; `fileId` is percent-encoded by the grammar package's builder,
 * so an id cannot add a candidate.
 *
 * Throws `DynjandiError` (status 0) for an empty, repeated or non-integer `widths`, a `height`, or a
 * value `url()` refuses (a width outside 1 to 10000, for one).
 */
export function srcset(origin: string, fileId: FileId, options: SrcsetOptions = {}): string {
  const { widths = DEFAULT_WIDTHS, ...rest } = options;
  if ("height" in rest) {
    refuse("height cannot be combined with widths; pass crop for a fixed aspect ratio.");
  }
  return validatedWidths(widths)
    .map((width) => `${url(origin, fileId, { ...rest, width })} ${width}w`)
    .join(", ");
}

/**
 * The formats `pictureSources` uses when the caller passes none, best first: the browser takes the first
 * `<source>` it supports. The fallback is not a source; render it as the `<img>` with
 * `srcset(id, { format: "jpeg" })`. With `DEFAULT_WIDTHS` this is 5 x 2 = 10 variants, 15 with the fallback.
 */
export const DEFAULT_FORMATS: readonly PictureFormat[] = ["avif", "webp"];

/** An output format, or `jpg`, the alias of `jpeg` that the service accepts in hand-written URLs. */
export type PictureFormat = OutputFormat | "jpg";

export interface PictureSourcesOptions extends Omit<SrcsetOptions, "format"> {
  /** Distinct formats, best first. Defaults to `DEFAULT_FORMATS`. `jpg` and `jpeg` are the same format. */
  formats?: readonly PictureFormat[];
  /**
   * Copied to every source as given. It is not escaped: if it reaches markup, escaping it is the
   * caller's job.
   */
  sizes?: string;
}

/** One `<source>` element's attributes. */
export interface PictureSource {
  /** `image/<format>`; `jpg` gives `image/jpeg`. */
  type: string;
  srcset: string;
  sizes?: string;
}

/** Checks `formats` and returns them as grammar formats, in the order given. */
function validatedFormats(formats: readonly PictureFormat[]): OutputFormat[] {
  if (formats.length === 0) {
    refuse("formats must not be empty.");
  }
  const seen = new Set<OutputFormat>();
  for (const format of formats) {
    const canonical = format === "jpg" ? "jpeg" : format;
    if (seen.has(canonical)) {
      refuse(`formats must not repeat, got ${canonical} twice (jpg is jpeg).`);
    }
    seen.add(canonical);
  }
  return [...seen];
}

/**
 * The attributes of one `<source>` per format, in the order given, each with the same width ladder.
 * Render the jpeg fallback yourself as the `<img>`, with `srcset(origin, fileId, { format: "jpeg" })`.
 *
 * Throws `DynjandiError` (status 0) for an empty or repeated `formats`, a `format` (use `formats`), and
 * everything `srcset` refuses. Nothing is built from a list that fails.
 */
export function pictureSources(
  origin: string,
  fileId: FileId,
  options: PictureSourcesOptions = {},
): PictureSource[] {
  const { formats = DEFAULT_FORMATS, sizes, ...rest } = options;
  if ("format" in rest) {
    refuse("format cannot be combined with formats; pass formats.");
  }
  return validatedFormats(formats).map((format) => ({
    type: `image/${format}`,
    srcset: srcset(origin, fileId, { ...rest, format }),
    ...(sizes === undefined ? {} : { sizes }),
  }));
}

/** The `placeholder` defaults. A tiny, low-quality image: it is one more variant per image. */
const PLACEHOLDER_WIDTH = 24;
const PLACEHOLDER_QUALITY = 20;
const PLACEHOLDER_FORMAT: OutputFormat = "webp";

/**
 * `url()`'s options without `height`, so the placeholder keeps the final image's aspect ratio: pass the
 * same `crop` as the image it stands in for. `width`, `format` and `quality` default as `placeholder` says.
 */
export interface PlaceholderOptions extends Omit<UrlOptions, "height"> {}

/**
 * The URL of a small, low-quality stand-in for the image: `width` 24, `quality` 20, `format` `webp`,
 * each unless the caller passes its own, with the caller's `crop` kept. It is a small resize, not a blur.
 * It is one more variant per image, counted against the plan cap like any other.
 *
 * Throws `DynjandiError` (status 0) for a `height` and for a value `url()` refuses.
 */
export function placeholder(
  origin: string,
  fileId: FileId,
  options: PlaceholderOptions = {},
): string {
  if ("height" in options) {
    throw new DynjandiError(
      "Cannot build a placeholder: height cannot be set; pass crop for a fixed aspect ratio.",
      0,
    );
  }
  const {
    width = PLACEHOLDER_WIDTH,
    quality = PLACEHOLDER_QUALITY,
    format = PLACEHOLDER_FORMAT,
    ...rest
  } = options;
  return url(origin, fileId, { ...rest, width, quality, format });
}
