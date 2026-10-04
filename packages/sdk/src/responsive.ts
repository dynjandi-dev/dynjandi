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
