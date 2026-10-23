import { clampPoint, type FocalPoint } from "./point.js";

/** The size of an image, in any unit: only the proportion matters. */
export interface ImageSize {
  width: number;
  height: number;
}

/**
 * A rectangle as fractions of the image: `left` and `top` from its top-left corner, `width` and `height`
 * as shares of the image's width and height. All lie in 0 to 1, and `left + width` and `top + height` do
 * not pass 1.
 */
export interface CropWindow {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The displayed image's rectangle in the same coordinates as the pointer, such as a `DOMRect` from
 * `getBoundingClientRect()`. A plain shape, so nothing here needs the DOM.
 */
export interface PointerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/** Centres a span of `extent` on `centre` and keeps it inside 0 to 1. */
function placeSpan(centre: number, extent: number): number {
  return Math.min(1 - extent, Math.max(0, centre - extent / 2));
}

/**
 * The part of an image that survives a crop to `ratio`, as fractions of the image. This is the service's
 * measured behaviour (tests/fixtures/service-crops.json): the image is scaled to cover the box, the
 * window is centred on the focal point, and it is clamped to stay inside the image. One side of the
 * window is therefore always the whole image.
 *
 * @param image the source image's size.
 * @param ratio the box's width divided by its height (16:9 is `16 / 9`).
 * @param point the focal point; clamped into 0 to 1 first.
 * @throws RangeError when a size or the ratio is not a positive finite number.
 */
export function cropWindow(image: ImageSize, ratio: number, point: FocalPoint): CropWindow {
  assertPositive(image.width, "image width");
  assertPositive(image.height, "image height");
  assertPositive(ratio, "ratio");

  const imageRatio = image.width / image.height;
  const width = ratio >= imageRatio ? 1 : ratio / imageRatio;
  const height = ratio >= imageRatio ? imageRatio / ratio : 1;
  const focal = clampPoint(point);

  return { left: placeSpan(focal.x, width), top: placeSpan(focal.y, height), width, height };
}

function fractionAlong(pointer: number, start: number, extent: number): number {
  // A rectangle with no usable size has no position to point at: NaN lets clampPoint pick the centre.
  if (!(extent > 0) || !Number.isFinite(extent)) return Number.NaN;
  return (pointer - start) / extent;
}

/**
 * The focal point under a pointer, from its position on the displayed image. Clamped into 0 to 1, so a
 * pointer outside the rectangle gives the nearest edge; not rounded (see `roundPoint`). A rectangle with
 * no positive finite size, or a NaN pointer coordinate, gives the centre on that axis, never NaN; an
 * infinite pointer coordinate gives the nearest edge.
 *
 * @param clientX the pointer's horizontal position, in the rectangle's coordinate space.
 * @param clientY the pointer's vertical position, in the rectangle's coordinate space.
 * @param rect the displayed image's rectangle.
 */
export function pointFromRect(clientX: number, clientY: number, rect: PointerRect): FocalPoint {
  return clampPoint({
    x: fractionAlong(clientX, rect.left, rect.width),
    y: fractionAlong(clientY, rect.top, rect.height),
  });
}
