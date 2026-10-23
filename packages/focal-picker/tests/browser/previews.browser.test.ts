import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DynjandiFocalPicker } from "../../src/element.js";
import "../../src/element.js";
import { shown } from "./support.js";

// Real layout: each preview's window is read back from where Chromium put its <img> inside its box, and
// compared with numbers worked by hand from the plan's section 4.2 (the service's measured behaviour):
//   ratio r = w / h, image ratio q = iw / ih.
//   r >= q: window width 1, height q / r.   r < q: window width r / q, height 1.
//   left = clamp(x - width / 2, 0, 1 - width); top = clamp(y - height / 2, 0, 1 - height).
// Nothing here asks the element or `cropWindow` for an expectation.

const TAG = "dynjandi-focal-picker";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function pngFile(width: number, height: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.fillStyle = "#37a";
  context.fillRect(0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob === null) throw new Error("canvas.toBlob gave no blob");
  return new File([blob], "test.png", { type: "image/png" });
}

function part(picker: DynjandiFocalPicker, name: string): HTMLElement {
  const found = picker.shadowRoot?.querySelector<HTMLElement>(`[part~="${name}"]`);
  if (!found) throw new Error(`no part "${name}"`);
  return found;
}

function previews(picker: DynjandiFocalPicker): HTMLElement[] {
  return [...(picker.shadowRoot?.querySelectorAll<HTMLElement>('[part~="preview"]') ?? [])];
}

/** Mounts a picker showing an image of the given natural size once it has loaded. */
async function mount(width: number, height: number): Promise<DynjandiFocalPicker> {
  const picker = document.createElement(TAG) as DynjandiFocalPicker;
  picker.style.cssText = "width: 400px;";
  document.body.append(picker);
  picker.file = await pngFile(width, height);
  await shown(picker);
  // The previews' own images load the same source; wait for them too.
  await Promise.all(
    previews(picker).map((preview) =>
      (preview.querySelector('[part~="preview-image"]') as HTMLImageElement).decode(),
    ),
  );
  return picker;
}

interface Measured {
  caption: string;
  ratio: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A preview's window as fractions of the image, from layout: where the box sits over the <img>. */
function measure(preview: HTMLElement): Measured {
  const box = (
    preview.querySelector('[part~="preview-box"]') as HTMLElement
  ).getBoundingClientRect();
  const image = (
    preview.querySelector('[part~="preview-image"]') as HTMLElement
  ).getBoundingClientRect();
  return {
    caption: (preview.querySelector('[part~="preview-caption"]') as HTMLElement).textContent ?? "",
    ratio: box.width / box.height,
    left: (box.left - image.left) / image.width,
    top: (box.top - image.top) / image.height,
    width: box.width / image.width,
    height: box.height / image.height,
  };
}

function expectWindow(
  actual: Measured,
  expected: { left: number; top: number; width: number; height: number },
): void {
  // Layout is in CSS pixels and rounds to 1/64 px; the boxes are ~100 px, so 2 decimals is ample.
  expect(actual.left).toBeCloseTo(expected.left, 2);
  expect(actual.top).toBeCloseTo(expected.top, 2);
  expect(actual.width).toBeCloseTo(expected.width, 2);
  expect(actual.height).toBeCloseTo(expected.height, 2);
}

describe("crop previews", () => {
  test("show one captioned box per default ratio, hidden from assistive technology", async () => {
    const picker = await mount(200, 100);

    const boxes = previews(picker).map(measure);

    expect(boxes.map((box) => box.caption.startsWith("16:9"))).toEqual([true, false, false, false]);
    expect(boxes.map((box) => box.caption.split(/[\s,]/)[0])).toEqual([
      "16:9",
      "1:1",
      "4:5",
      "9:16",
    ]);
    // Box shapes 16/9, 1, 4/5, 9/16 = 1.7778, 1, 0.8, 0.5625.
    expect(boxes[0]?.ratio).toBeCloseTo(16 / 9, 2);
    expect(boxes[1]?.ratio).toBeCloseTo(1, 2);
    expect(boxes[2]?.ratio).toBeCloseTo(0.8, 2);
    expect(boxes[3]?.ratio).toBeCloseTo(0.5625, 2);
    for (const preview of previews(picker)) {
      expect(preview.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  test("draw the shared image, with no second object URL", async () => {
    const createUrl = vi.spyOn(URL, "createObjectURL");
    const picker = await mount(200, 100);

    const surfaceSrc = (part(picker, "image") as HTMLImageElement).src;
    expect(createUrl).toHaveBeenCalledTimes(1);
    for (const preview of previews(picker)) {
      expect((preview.querySelector('[part~="preview-image"]') as HTMLImageElement).src).toBe(
        surfaceSrc,
      );
    }
  });

  test("with no point show the centre crop and say so", async () => {
    const picker = await mount(200, 100);

    // Image 200 by 100, q = 2, point (0.5, 0.5).
    //  16:9: r = 1.7778 < 2: width 0.8889, height 1; left = 0.5 - 0.4444 = 0.0556.
    //  1:1: width 0.5, left = 0.25.   4:5: width 0.4, left = 0.3.   9:16: width 0.28125, left = 0.359375.
    const [wide, square, portrait, tall] = previews(picker).map(measure);
    expectWindow(wide as Measured, { left: 0.0556, top: 0, width: 0.8889, height: 1 });
    expectWindow(square as Measured, { left: 0.25, top: 0, width: 0.5, height: 1 });
    expectWindow(portrait as Measured, { left: 0.3, top: 0, width: 0.4, height: 1 });
    expectWindow(tall as Measured, { left: 0.359375, top: 0, width: 0.28125, height: 1 });
    for (const box of [wide, square, portrait, tall]) {
      expect(box?.caption.toLowerCase()).toContain("centre");
    }
  });

  test("follow a set point from the measured window, and drop the centre note", async () => {
    const picker = await mount(200, 100);

    picker.value = { x: 0.6, y: 0.2 };

    // q = 2, x = 0.6; every height is the whole image (all four ratios are below 2).
    //  16:9: width 0.8889, left = 0.6 - 0.4444 = 0.1556, clamped to 1 - 0.8889 = 0.1111.
    //  1:1: width 0.5, left = 0.6 - 0.25 = 0.35.
    //  4:5: width 0.4, left = 0.6 - 0.2 = 0.4.
    //  9:16: width 0.28125, left = 0.6 - 0.140625 = 0.459375.
    const [wide, square, portrait, tall] = previews(picker).map(measure);
    expectWindow(wide as Measured, { left: 0.1111, top: 0, width: 0.8889, height: 1 });
    expectWindow(square as Measured, { left: 0.35, top: 0, width: 0.5, height: 1 });
    expectWindow(portrait as Measured, { left: 0.4, top: 0, width: 0.4, height: 1 });
    expectWindow(tall as Measured, { left: 0.459375, top: 0, width: 0.28125, height: 1 });
    for (const box of [wide, square, portrait, tall]) {
      expect(box?.caption.toLowerCase()).not.toContain("centre");
    }
  });

  test("move the window vertically for a portrait photo", async () => {
    const picker = await mount(100, 200);

    picker.value = { x: 0.5, y: 0.3 };

    // q = 0.5. 16:9: r = 1.7778 >= q: width 1, height q / r = 0.5 / 1.7778 = 0.28125;
    // top = 0.3 - 0.140625 = 0.159375.   1:1: height 0.5, top = 0.3 - 0.25 = 0.05.
    // 4:5: r = 0.8: height 0.625, top = 0.3 - 0.3125 = -0.0125, clamped to 0.
    // 9:16: r = 0.5625 >= 0.5: height 0.5 / 0.5625 = 0.8889, top = 0.3 - 0.4444 -> 0.
    const [wide, square, portrait, tall] = previews(picker).map(measure);
    expectWindow(wide as Measured, { left: 0, top: 0.159375, width: 1, height: 0.28125 });
    expectWindow(square as Measured, { left: 0, top: 0.05, width: 1, height: 0.5 });
    expectWindow(portrait as Measured, { left: 0, top: 0, width: 1, height: 0.625 });
    expectWindow(tall as Measured, { left: 0, top: 0, width: 1, height: 0.8889 });
  });

  test("differ from CSS object-position at 9:16 for an off-centre point", async () => {
    const picker = await mount(200, 100);
    picker.value = { x: 0.6, y: 0.5 };

    const tall = measure(previews(picker)[3] as HTMLElement);

    // The service centres the window on the point: left = 0.6 - 0.140625 = 0.459375.
    // `object-position: 60% 50%` on a covered 9:16 box aligns the image's 60% with the box's 60%:
    // left = 0.6 * (1 - 0.28125) = 0.43125. The two differ by 0.028125 of the image width.
    expect(tall.left).toBeCloseTo(0.459375, 2);
    const objectPositionLeft = 0.43125;
    expect(Math.abs(tall.left - objectPositionLeft)).toBeGreaterThan(0.02);
  });

  test("follow a drag on every input event, before the change", async () => {
    const picker = await mount(200, 100);
    const image = part(picker, "image");
    const observed: { type: string; tallLeft: number }[] = [];
    for (const type of ["input", "change"]) {
      picker.addEventListener(type, () => {
        observed.push({
          type,
          tallLeft: measure(previews(picker)[3] as HTMLElement).left,
        });
      });
    }

    // The surface is 400 by 200 (a 400px host, image ratio 2). Drag ends at 300 of 400 = 0.75 across.
    await userEvent.dragAndDrop(image, image, {
      sourcePosition: { x: 100, y: 150 },
      targetPosition: { x: 300, y: 50 },
    });

    // 9:16: width 0.28125, so left = x - 0.140625 for x in 0.140625..0.859375.
    //  first input x = 0.25: left 0.109375;  last x = 0.75: left 0.609375.
    const inputs = observed.filter((entry) => entry.type === "input");
    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs[0]?.tallLeft).toBeCloseTo(0.109375, 2);
    expect(inputs.at(-1)?.tallLeft).toBeCloseTo(0.609375, 2);
    expect(observed.at(-1)?.type).toBe("change");
    expect(observed.at(-1)?.tallLeft).toBeCloseTo(0.609375, 2);
  });

  test("follow a typed commit", async () => {
    const picker = await mount(200, 100);
    const x = page.getByRole("spinbutton", { name: /^Focal point X\b/ });

    await userEvent.fill(x, "70");
    await userEvent.keyboard("{Enter}");

    // x = 0.7, y centre. 1:1: width 0.5, left = 0.7 - 0.25 = 0.45 (inside 0 to 1 - 0.5).
    expectWindow(measure(previews(picker)[1] as HTMLElement), {
      left: 0.45,
      top: 0,
      width: 0.5,
      height: 1,
    });
  });
});

describe("ratios", () => {
  test("take a list of [width, height] pairs and caption each", async () => {
    const picker = await mount(200, 100);

    picker.ratios = [
      [3, 2],
      [2, 1],
    ];
    picker.value = { x: 0.5, y: 0.5 };

    // 3:2 = 1.5 < 2: width 0.75, left = 0.5 - 0.375 = 0.125.  2:1 = 2 >= 2: the whole image.
    const [three, two] = previews(picker).map(measure);
    expect(previews(picker)).toHaveLength(2);
    expect(three?.caption.startsWith("3:2")).toBe(true);
    expect(two?.caption.startsWith("2:1")).toBe(true);
    expectWindow(three as Measured, { left: 0.125, top: 0, width: 0.75, height: 1 });
    expectWindow(two as Measured, { left: 0, top: 0, width: 1, height: 1 });
    expect(picker.ratios).toEqual([
      [3, 2],
      [2, 1],
    ]);
  });

  test.each([
    ["a zero side", [[0, 9]]],
    ["a negative side", [[16, -9]]],
    ["a non-finite side", [[Number.POSITIVE_INFINITY, 9]]],
    ["a pair of the wrong length", [[16]]],
    ["an empty list", []],
    ["a string", "16:9"],
  ])("fall back to the defaults with one warning for %s", async (_name, bad) => {
    const picker = await mount(200, 100);
    picker.ratios = [[3, 2]];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    picker.ratios = bad as unknown as [number, number][];

    expect(warn).toHaveBeenCalledTimes(1);
    expect(previews(picker).map((preview) => measure(preview).caption.split(/[\s,]/)[0])).toEqual([
      "16:9",
      "1:1",
      "4:5",
      "9:16",
    ]);
    expect(picker.ratios).toEqual([
      [16, 9],
      [1, 1],
      [4, 5],
      [9, 16],
    ]);
    picker.value = { x: 0.2, y: 0.2 };
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
