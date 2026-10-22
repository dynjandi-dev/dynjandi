/**
 * A focal point: the part of an image to keep when it is cropped. Each coordinate is a fraction of the
 * image, 0 to 1 inclusive, from the left (`x`) and from the top (`y`). This is the shape `upload` takes as
 * `focal`.
 */
export interface FocalPoint {
  x: number;
  y: number;
}

export type FocalAxis = "x" | "y";

/** The smallest step a point moves by: 0.1 percent, as a fraction. */
const STEP = 0.001;

/** Where the service crops when no focal point is given, and what a coordinate with no value falls back to. */
const CENTRE = 0.5;

function clampCoordinate(value: number): number {
  if (Number.isNaN(value)) return CENTRE;
  // Math.max(0, -0) is +0, so a negative zero never escapes.
  return Math.min(1, Math.max(0, value));
}

function roundCoordinate(value: number): number {
  return Math.round(clampCoordinate(value) * 1000) / 1000;
}

/**
 * Pulls each coordinate into 0 to 1. Infinities become the nearest edge and NaN becomes the centre, so the
 * result is always a point `upload` accepts. Does not round.
 */
export function clampPoint(point: FocalPoint): FocalPoint {
  return { x: clampCoordinate(point.x), y: clampCoordinate(point.y) };
}

/** Clamps, then rounds each coordinate to 3 decimals (0.1 percent): the value the picker emits. */
export function roundPoint(point: FocalPoint): FocalPoint {
  return { x: roundCoordinate(point.x), y: roundCoordinate(point.y) };
}

/**
 * Moves one coordinate by `steps` times 0.1 percent (negative moves back), for a number input's keyboard
 * step. The result is rounded and stays inside 0 to 1. A `steps` that is not finite moves nothing.
 */
export function stepPoint(point: FocalPoint, axis: FocalAxis, steps: number): FocalPoint {
  const moved = Number.isFinite(steps) ? point[axis] + steps * STEP : point[axis];
  return roundPoint({ ...point, [axis]: moved });
}
