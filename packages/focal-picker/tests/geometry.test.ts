import { describe, expect, test } from "vitest";
import { cropWindow, pointFromRect } from "../src/index";
import fixture from "./fixtures/service-crops.json";

// Expected windows come from tests/fixtures/service-crops.json, measured from the live service in Phase 2
// (plan D4), never from the function under test. Each row is asserted within its OWN recorded tolerance:
// the ~0.002 `top` on the downscaled landscape rows is the measuring instrument's bias, which the
// tolerance already covers.
// `pointFromRect` figures were worked out by hand on the rectangle stated in each test.

/** "16:9" to 16 / 9. The fixture records ratios as text; `cropWindow` takes the number. */
function ratioNumber(ratio: string): number {
  const [boxWidth, boxHeight] = ratio.split(":").map(Number);
  return (boxWidth ?? Number.NaN) / (boxHeight ?? Number.NaN);
}

describe("cropWindow against the service's measured crops", () => {
  test("the fixture holds rows to assert", () => {
    expect(fixture.rows.length).toBeGreaterThan(0);
  });

  for (const row of fixture.rows) {
    const name = `${row.source.width}x${row.source.height} at ${row.ratio}, point ${row.point.x},${row.point.y}`;
    test(name, () => {
      const window = cropWindow(row.source, ratioNumber(row.ratio), row.point);
      expect(Math.abs(window.left - row.observed.left)).toBeLessThanOrEqual(row.tolerance);
      expect(Math.abs(window.top - row.observed.top)).toBeLessThanOrEqual(row.tolerance);
      expect(Math.abs(window.width - row.observed.width)).toBeLessThanOrEqual(row.tolerance);
      expect(Math.abs(window.height - row.observed.height)).toBeLessThanOrEqual(row.tolerance);
    });
  }
});

describe("cropWindow stays inside the image", () => {
  const images = [
    { width: 510, height: 255 },
    { width: 255, height: 510 },
    { width: 400, height: 400 },
  ];
  const ratios = [16 / 9, 1, 4 / 5, 9 / 16];
  const edges = [0, 1];

  for (const image of images) {
    for (const ratio of ratios) {
      for (const x of edges) {
        for (const y of edges) {
          test(`${image.width}x${image.height}, ratio ${ratio.toFixed(3)}, point ${x},${y}`, () => {
            const window = cropWindow(image, ratio, { x, y });
            // Fractions of the image: never negative, never past 1 (small slack for float rounding).
            expect(window.left).toBeGreaterThanOrEqual(0);
            expect(window.top).toBeGreaterThanOrEqual(0);
            expect(window.width).toBeGreaterThan(0);
            expect(window.height).toBeGreaterThan(0);
            expect(window.left + window.width).toBeLessThanOrEqual(1 + 1e-12);
            expect(window.top + window.height).toBeLessThanOrEqual(1 + 1e-12);
            // Cover scale: one side of the window is the whole image.
            expect(Math.max(window.width, window.height)).toBeCloseTo(1, 12);
          });
        }
      }
    }
  }

  test("a point outside 0 to 1 is clamped, not extrapolated", () => {
    const window = cropWindow({ width: 510, height: 255 }, 1, { x: 5, y: -3 });
    // 1:1 on a 2:1 image shows half the width; x clamped to 1 puts the window on the right half.
    expect(window.left).toBeCloseTo(0.5, 12);
    expect(window.top).toBe(0);
  });

  test("a ratio the image already has shows all of it", () => {
    // Hand check: 2:1 on a 2:1 image is the whole image whatever the point.
    expect(cropWindow({ width: 600, height: 300 }, 2, { x: 0.3, y: 0.9 })).toEqual({
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    });
  });

  test("rejects a size or ratio that is not a positive finite number", () => {
    const point = { x: 0.5, y: 0.5 };
    expect(() => cropWindow({ width: 0, height: 100 }, 1, point)).toThrow(RangeError);
    expect(() => cropWindow({ width: 100, height: Number.NaN }, 1, point)).toThrow(RangeError);
    expect(() => cropWindow({ width: 100, height: 100 }, 0, point)).toThrow(RangeError);
    expect(() => cropWindow({ width: 100, height: 100 }, Number.POSITIVE_INFINITY, point)).toThrow(
      RangeError,
    );
  });
});

describe("pointFromRect", () => {
  // Displayed image: left 100, top 50, 200 wide, 100 tall (so it spans x 100 to 300, y 50 to 150).
  const rect = { left: 100, top: 50, width: 200, height: 100 };

  test("maps the corners and the middle", () => {
    expect(pointFromRect(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(pointFromRect(300, 150, rect)).toEqual({ x: 1, y: 1 });
    expect(pointFromRect(200, 100, rect)).toEqual({ x: 0.5, y: 0.5 });
  });

  test("scales each axis by its own side", () => {
    // (130 - 100) / 200 = 0.15 and (125 - 50) / 100 = 0.75
    expect(pointFromRect(130, 125, rect)).toEqual({ x: 0.15, y: 0.75 });
  });

  test("clamps a pointer outside the rectangle, per axis", () => {
    expect(pointFromRect(0, 1000, rect)).toEqual({ x: 0, y: 1 });
    expect(pointFromRect(900, -20, rect)).toEqual({ x: 1, y: 0 });
    expect(pointFromRect(150, 1000, rect)).toEqual({ x: 0.25, y: 1 });
  });

  test("a zero-size or invalid rectangle gives the centre, never NaN", () => {
    expect(pointFromRect(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(pointFromRect(500, -500, { left: 0, top: 0, width: 0, height: 100 })).toEqual({
      x: 0.5,
      y: 0,
    });
    expect(pointFromRect(10, 10, { left: 0, top: 0, width: -5, height: Number.NaN })).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  test("a NaN pointer coordinate gives the centre on that axis", () => {
    expect(pointFromRect(Number.NaN, 100, rect)).toEqual({ x: 0.5, y: 0.5 });
  });

  test("an infinite pointer coordinate gives the nearest edge on that axis", () => {
    expect(pointFromRect(Number.POSITIVE_INFINITY, 100, rect)).toEqual({ x: 1, y: 0.5 });
    expect(pointFromRect(Number.NEGATIVE_INFINITY, 100, rect)).toEqual({ x: 0, y: 0.5 });
  });

  test("does not round", () => {
    // (101 - 100) / 200 = 0.005, which rounding to 3 decimals would turn into 0.005 too; use 1/3.
    const point = pointFromRect(100 + 100 / 3, 50, { left: 100, top: 50, width: 100, height: 100 });
    expect(point.x).toBeCloseTo(1 / 3, 12);
    expect(point.x).not.toBe(0.333);
  });
});
