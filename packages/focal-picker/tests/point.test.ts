import { describe, expect, test } from "vitest";
import { clampPoint, type FocalPoint, roundPoint, stepPoint } from "../src/index";

// Expected values come from the requirements, not from the code:
// - the service and `upload` accept a point only when both coordinates are finite and in 0 to 1 inclusive
//   (packages/sdk/src/upload.ts), so nothing may be emitted outside that;
// - the plan's D5: the emitted point is rounded to 3 decimals (0.1 percent), 0.42318 becoming 0.423;
// - the number inputs step 0.1 percent, which is 0.001 as a fraction;
// - a coordinate with no meaning (NaN) falls back to 0.5, the centre, which is where the service crops when
//   no focal point is given.
// Every figure below was worked out by hand.

describe("clampPoint", () => {
  test("leaves a point inside the image alone, without rounding it", () => {
    expect(clampPoint({ x: 0.42318, y: 0.5 })).toEqual({ x: 0.42318, y: 0.5 });
  });

  test("keeps the edges", () => {
    expect(clampPoint({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
  });

  test("pulls each coordinate in on its own", () => {
    expect(clampPoint({ x: -1, y: 2 })).toEqual({ x: 0, y: 1 });
    expect(clampPoint({ x: 1.0001, y: -0.0001 })).toEqual({ x: 1, y: 0 });
  });

  test("maps infinities to the nearest edge", () => {
    expect(clampPoint({ x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY })).toEqual({
      x: 1,
      y: 0,
    });
  });

  test("maps NaN to the centre", () => {
    expect(clampPoint({ x: Number.NaN, y: 0.2 })).toEqual({ x: 0.5, y: 0.2 });
  });

  test("returns a new object and leaves its argument alone", () => {
    const point: FocalPoint = { x: 2, y: 0.5 };
    const clamped = clampPoint(point);
    expect(clamped).not.toBe(point);
    expect(point).toEqual({ x: 2, y: 0.5 });
  });
});

describe("roundPoint", () => {
  test("rounds to 3 decimals", () => {
    expect(roundPoint({ x: 0.42318, y: 0.18 })).toEqual({ x: 0.423, y: 0.18 });
    expect(roundPoint({ x: 0.4236, y: 0.0004 })).toEqual({ x: 0.424, y: 0 });
  });

  test("keeps a value that is already 3 decimals", () => {
    expect(roundPoint({ x: 0.001, y: 0.999 })).toEqual({ x: 0.001, y: 0.999 });
  });

  test("never rounds past the edge", () => {
    expect(roundPoint({ x: 0.9996, y: 0.9999 })).toEqual({ x: 1, y: 1 });
  });

  test("clamps what lies outside 0 to 1", () => {
    expect(roundPoint({ x: -0.2, y: 1.4 })).toEqual({ x: 0, y: 1 });
  });

  test("never emits negative zero", () => {
    const { x, y } = roundPoint({ x: -0.0004, y: -0 });
    expect(Object.is(x, 0)).toBe(true);
    expect(Object.is(y, 0)).toBe(true);
  });

  test("never emits a non-finite coordinate", () => {
    expect(roundPoint({ x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual({ x: 0.5, y: 1 });
    expect(roundPoint({ x: Number.NEGATIVE_INFINITY, y: Number.NaN })).toEqual({ x: 0, y: 0.5 });
  });

  test("is idempotent", () => {
    const once = roundPoint({ x: 0.42318, y: 0.6666667 });
    expect(once).toEqual({ x: 0.423, y: 0.667 });
    expect(roundPoint(once)).toEqual(once);
  });

  test("always yields a point `upload` accepts, at most 3 decimals", () => {
    const awkward = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1e9,
      1e9,
      -0,
      0.1 + 0.2,
      0.4235,
      0.9995,
      1 / 3,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
    ];
    for (const x of awkward) {
      for (const y of awkward) {
        const point = roundPoint({ x, y });
        for (const coordinate of [point.x, point.y]) {
          expect(Number.isFinite(coordinate)).toBe(true);
          expect(coordinate).toBeGreaterThanOrEqual(0);
          expect(coordinate).toBeLessThanOrEqual(1);
          expect(Math.round(coordinate * 1000) / 1000).toBe(coordinate);
        }
      }
    }
  });
});

describe("stepPoint", () => {
  test("moves one coordinate by 0.1 percent per step", () => {
    expect(stepPoint({ x: 0.423, y: 0.5 }, "x", 1)).toEqual({ x: 0.424, y: 0.5 });
    expect(stepPoint({ x: 0.423, y: 0.5 }, "y", -1)).toEqual({ x: 0.423, y: 0.499 });
  });

  test("takes several steps at once, ten being one percent", () => {
    expect(stepPoint({ x: 0.423, y: 0.5 }, "x", 10)).toEqual({ x: 0.433, y: 0.5 });
    expect(stepPoint({ x: 0.423, y: 0.5 }, "x", -10)).toEqual({ x: 0.413, y: 0.5 });
  });

  test("does not accumulate floating point error", () => {
    // 0.7 + 0.001 is 0.7010000000000001 in floating point; the emitted value is 0.701.
    expect(stepPoint({ x: 0.7, y: 0.5 }, "x", 1)).toEqual({ x: 0.701, y: 0.5 });
    let point: FocalPoint = { x: 0, y: 0 };
    for (let step = 0; step < 1000; step += 1) point = stepPoint(point, "x", 1);
    expect(point).toEqual({ x: 1, y: 0 });
  });

  test("stops at the edges", () => {
    expect(stepPoint({ x: 1, y: 0 }, "x", 1)).toEqual({ x: 1, y: 0 });
    expect(stepPoint({ x: 1, y: 0 }, "y", -1)).toEqual({ x: 1, y: 0 });
    expect(stepPoint({ x: 0.995, y: 0.5 }, "x", 10)).toEqual({ x: 1, y: 0.5 });
  });

  test("rounds a point that was not on the grid", () => {
    expect(stepPoint({ x: 0.42318, y: 0.5 }, "x", 1)).toEqual({ x: 0.424, y: 0.5 });
  });

  test("does not move for zero or non-finite steps", () => {
    expect(stepPoint({ x: 0.423, y: 0.5 }, "x", 0)).toEqual({ x: 0.423, y: 0.5 });
    expect(stepPoint({ x: 0.423, y: 0.5 }, "x", Number.NaN)).toEqual({ x: 0.423, y: 0.5 });
    expect(stepPoint({ x: 0.423, y: 0.5 }, "y", Number.POSITIVE_INFINITY)).toEqual({
      x: 0.423,
      y: 0.5,
    });
  });

  test("leaves its argument alone", () => {
    const point: FocalPoint = { x: 0.423, y: 0.5 };
    stepPoint(point, "x", 1);
    expect(point).toEqual({ x: 0.423, y: 0.5 });
  });
});
