import {
  buildVariantUrl,
  type CropOperation,
  type CropPosition,
  FACE_DETECTOR_VERSION,
  type NormalizedOperation,
  normalizedOperationsSchema,
  type OutputFormat,
} from "@dynjandi/transform-grammar";
import { DynjandiError } from "./errors.js";

/** The grammar's face-detection crop position, `face,<position>`, taken from its own types. */
export type FaceCropPosition = Extract<CropOperation, { detector: unknown }>["position"];

interface CropSize {
  /** Integer from 1 to 10000. */
  width: number;
  /** Integer from 1 to 10000. */
  height: number;
}

/** Crop to exactly `width` x `height`, centred on a compass, content-aware or face-chain position. */
export interface PositionedCrop extends CropSize {
  /** Defaults to `center`. */
  position?: CropPosition | FaceCropPosition;
  focal?: never;
}

/** Crop to exactly `width` x `height`, centred on a focal point, each coordinate from 0 to 1. */
export interface FocalCrop extends CropSize {
  position?: never;
  focal: { x: number; y: number };
}

export type CropOptions = PositionedCrop | FocalCrop;

/**
 * What a variant looks like. At least one option is required: the original image is served at the
 * `url` that `upload` returns, and the grammar rejects an empty operation chain.
 *
 * Ranges (dimensions 1 to 10000, quality 1 to 100) are the grammar package's; this type does not
 * repeat them, and `url()` refuses a value the grammar would not accept.
 */
export interface UrlOptions {
  /** Scales to this width. Omit one of `width` and `height` to keep the aspect ratio. */
  width?: number;
  height?: number;
  format?: OutputFormat;
  /** An integer. The grammar's named levels (`best`, `smart`...) are for hand-written URLs only. */
  quality?: number;
  crop?: CropOptions;
}

function isFaceCropPosition(
  position: CropPosition | FaceCropPosition,
): position is FaceCropPosition {
  return position.startsWith("face,");
}

function toCropOperation(crop: CropOptions): CropOperation {
  const { width, height } = crop;
  if (crop.focal !== undefined) {
    return {
      op: "crop",
      width,
      height,
      position: "focal",
      focalX: crop.focal.x,
      focalY: crop.focal.y,
    };
  }
  const position = crop.position ?? "center";
  if (isFaceCropPosition(position)) {
    return { op: "crop", width, height, position, detector: FACE_DETECTOR_VERSION };
  }
  return { op: "crop", width, height, position };
}

/**
 * Operations apply in order, so the order is fixed: crop, resize, format, quality.
 *
 * The crop and its focal point are about the original image's composition, so it goes first; resize
 * then scales the cropped region to its delivery size (`crop 1280x400` then `resize 640x`). Format and
 * quality describe the output encoding, so they come last, and quality is set after the format it
 * applies to.
 */
function toOperations(options: UrlOptions): NormalizedOperation[] {
  const operations: NormalizedOperation[] = [];
  if (options.crop !== undefined) {
    operations.push(toCropOperation(options.crop));
  }
  if (options.width !== undefined || options.height !== undefined) {
    operations.push({ op: "resize", width: options.width ?? null, height: options.height ?? null });
  }
  if (options.format !== undefined) {
    operations.push({ op: "format", format: options.format });
  }
  if (options.quality !== undefined) {
    operations.push({ op: "quality", quality: options.quality });
  }
  return operations;
}

/** Names the operation and field an issue is about, e.g. `resize width: Too small...`. */
function describeInvalidOperations(
  operations: NormalizedOperation[],
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map(({ path, message }) => {
      const [index, ...field] = path;
      const operation = typeof index === "number" ? operations[index]?.op : undefined;
      const where = [operation, ...field.map(String)]
        .filter((part) => part !== undefined)
        .join(" ");
      return where === "" ? message : `${where}: ${message}`;
    })
    .join("; ");
}

/**
 * Builds a variant URL on `origin` by mapping `options` to the grammar package's operations and
 * handing them to its builder. Nothing here writes, parses or hashes the grammar.
 *
 * Every failure is a `DynjandiError` with status `0` (there is no HTTP response): an empty `fileId`,
 * no options, or a value the grammar refuses. The grammar package's own error is kept as `cause`.
 */
export function url(origin: string, fileId: string, options: UrlOptions): string {
  if (fileId === "") {
    throw new DynjandiError("Cannot build a variant URL: fileId must not be empty.", 0);
  }

  const operations = toOperations(options);
  try {
    // `buildVariantUrl` serialises whatever it is given, so range checks come from the grammar's schema.
    const checked = normalizedOperationsSchema.safeParse(operations);
    if (!checked.success) {
      throw new DynjandiError(
        `Cannot build a variant URL: ${describeInvalidOperations(operations, checked.error.issues)}`,
        0,
        { cause: checked.error },
      );
    }
    return buildVariantUrl(origin, fileId, operations);
  } catch (cause) {
    if (cause instanceof DynjandiError) {
      throw cause;
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new DynjandiError(`Cannot build a variant URL: ${reason}`, 0, { cause });
  }
}
