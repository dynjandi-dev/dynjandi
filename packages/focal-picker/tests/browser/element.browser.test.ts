import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DynjandiFocalPicker } from "../../src/element.js";
import "../../src/element.js";

// Real layout and real input: clicks and drags go through Playwright's mouse (userEvent.click and
// userEvent.dragAndDrop), so Chromium itself raises the pointer events at real coordinates, and typing is
// real keystrokes. Dispatching synthetic PointerEvents would test the handlers against numbers this file
// invented, not against what a browser sends.
//
// Every expected point is arithmetic on the displayed image's measured rectangle: a position the test
// clicks (pixels from the image's top-left) divided by the image's measured size. Never read from the
// element.

const TAG = "dynjandi-focal-picker";
const PADDING = 40; // host padding, so the host's box is never the image's box

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** A solid PNG of the given natural size, made in the page: no fixtures, no network. */
async function pngFile(width: number, height: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.fillStyle = "#3a7";
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

/** Mounts a picker whose content box is `width` px wide, showing a 200 by 100 image once it has loaded. */
async function mount(width = 400): Promise<DynjandiFocalPicker> {
  const picker = document.createElement(TAG) as DynjandiFocalPicker;
  picker.style.cssText = `width: ${width}px; padding: ${PADDING}px;`;
  document.body.append(picker);
  picker.file = await pngFile(200, 100);
  await (part(picker, "image") as HTMLImageElement).decode();
  return picker;
}

interface Seen {
  type: string;
  detail: unknown;
}

function record(picker: DynjandiFocalPicker): Seen[] {
  const seen: Seen[] = [];
  for (const type of ["input", "change"]) {
    picker.addEventListener(type, (event) => {
      seen.push({ type, detail: (event as CustomEvent).detail });
    });
  }
  return seen;
}

function field(axis: "X" | "Y"): HTMLInputElement {
  return page
    .getByRole("spinbutton", { name: new RegExp(`^Focal point ${axis}\\b`) })
    .element() as HTMLInputElement;
}

/** The marker's centre as a fraction of the displayed image, from layout. */
function markerFraction(picker: DynjandiFocalPicker): { x: number; y: number } {
  const image = part(picker, "image").getBoundingClientRect();
  const marker = part(picker, "marker").getBoundingClientRect();
  return {
    x: (marker.left + marker.width / 2 - image.left) / image.width,
    y: (marker.top + marker.height / 2 - image.top) / image.height,
  };
}

function expectAgreement(picker: DynjandiFocalPicker, x: number, y: number): void {
  expect(picker.value).toEqual({ x, y });
  expect(field("X").value).toBe(String(x * 100));
  expect(field("Y").value).toBe(String(y * 100));
  const marker = markerFraction(picker);
  // Within half a pixel of the image's size (400 by 200 in these tests).
  expect(marker.x).toBeCloseTo(x, 2);
  expect(marker.y).toBeCloseTo(y, 2);
}

describe("surface", () => {
  test("a click sets the point at the clicked place on the displayed image", async () => {
    const picker = await mount(400);
    const image = part(picker, "image");
    const rect = image.getBoundingClientRect();
    // The image is the content box, not the host's box: the point must come from the image.
    expect(rect.width).toBe(400);
    expect(rect.height).toBe(200);
    expect(picker.getBoundingClientRect().width).toBe(400 + 2 * PADDING);

    // 100 px of 400 is 0.25; 150 px of 200 is 0.75.
    await userEvent.click(image, { position: { x: 100, y: 150 } });

    expectAgreement(picker, 0.25, 0.75);
  });

  test("the point is rounded to 3 decimals", async () => {
    const picker = await mount(300);
    expect(part(picker, "image").getBoundingClientRect().width).toBe(300);

    // 100 px of 300 is 0.3333...; 3 decimals is 0.333. 75 px of 150 is 0.5.
    await userEvent.click(part(picker, "image"), { position: { x: 100, y: 75 } });

    expect(picker.value).toEqual({ x: 0.333, y: 0.5 });
  });

  test("a drag emits input events and then exactly one change, each carrying the point", async () => {
    const picker = await mount(400);
    const seen = record(picker);
    const image = part(picker, "image");

    await userEvent.dragAndDrop(image, image, {
      sourcePosition: { x: 100, y: 150 },
      targetPosition: { x: 300, y: 50 },
    });

    // Drag ends at 300 of 400 = 0.75 across, 50 of 200 = 0.25 down.
    expectAgreement(picker, 0.75, 0.25);
    const types = seen.map((entry) => entry.type);
    expect(types.filter((type) => type === "change")).toHaveLength(1);
    expect(types.at(-1)).toBe("change");
    expect(types.length).toBeGreaterThan(1);
    expect(types.slice(0, -1).every((type) => type === "input")).toBe(true);
    expect(seen.at(-1)?.detail).toEqual({ x: 0.75, y: 0.25 });
    expect(seen[0]?.detail).toEqual({ x: 0.25, y: 0.75 });
  });

  test("a drag released outside the picker still ends: the point clamps to the edge and one change is emitted", async () => {
    const picker = await mount(400);
    const seen = record(picker);
    const image = part(picker, "image");
    const rect = image.getBoundingClientRect();
    // A target 60 px below the image's bottom edge, outside the host (whose padding is 40 px), directly
    // under the picked x. Only pointer capture lets the surface see the release there.
    const outside = document.createElement("div");
    outside.style.cssText = `position: fixed; left: ${rect.left}px; top: ${rect.bottom + 60}px; width: 400px; height: 50px;`;
    document.body.append(outside);

    await userEvent.dragAndDrop(image, outside, {
      sourcePosition: { x: 100, y: 50 },
      targetPosition: { x: 100, y: 10 },
    });

    // Start: 100 of 400 = 0.25 across, 50 of 200 = 0.25 down. Release: same x, 70 px below the bottom
    // edge, so y is past 1 and clamps to 1.
    expectAgreement(picker, 0.25, 1);
    expect(seen.at(-1)).toEqual({ type: "change", detail: { x: 0.25, y: 1 } });
    expect(seen.filter((entry) => entry.type === "change")).toHaveLength(1);
  });

  test("a click on the point that is already set emits nothing", async () => {
    const picker = await mount(400);
    picker.value = { x: 0.5, y: 0.5 };
    const seen = record(picker);

    // 200 of 400 and 100 of 200 are exactly the centre.
    await userEvent.click(part(picker, "image"), { position: { x: 200, y: 100 } });

    expect(picker.value).toEqual({ x: 0.5, y: 0.5 });
    expect(seen).toEqual([]);
  });

  test("the surface and the marker are hidden from assistive technology", async () => {
    const picker = await mount();
    expect(part(picker, "surface").getAttribute("aria-hidden")).toBe("true");
    expect(part(picker, "marker").closest('[aria-hidden="true"]')).not.toBeNull();
    expect(getComputedStyle(part(picker, "surface")).touchAction).toBe("none");
  });
});

describe("value", () => {
  test("starts as null with no marker and empty inputs", async () => {
    const picker = await mount();
    expect(picker.value).toBeNull();
    expect(part(picker, "marker").checkVisibility()).toBe(false);
    expect(field("X").value).toBe("");
    expect(field("Y").value).toBe("");
  });

  test("setting it moves the marker and the inputs and emits nothing", async () => {
    const picker = await mount();
    const seen = record(picker);

    picker.value = { x: 0.25, y: 0.75 };

    expectAgreement(picker, 0.25, 0.75);
    expect(part(picker, "marker").checkVisibility()).toBe(true);
    expect(seen).toEqual([]);
  });

  test("setting null clears the point", async () => {
    const picker = await mount();
    picker.value = { x: 0.25, y: 0.75 };

    picker.value = null;

    expect(picker.value).toBeNull();
    expect(part(picker, "marker").checkVisibility()).toBe(false);
    expect(field("X").value).toBe("");
  });

  test("a value outside 0 to 1 is brought inside and rounded, as upload needs", async () => {
    const picker = await mount();
    picker.value = { x: 1.5, y: 0.12345 };
    expect(picker.value).toEqual({ x: 1, y: 0.123 });
  });

  test("the getter hands out a copy", async () => {
    const picker = await mount();
    picker.value = { x: 0.25, y: 0.75 };
    const read = picker.value;
    if (read === null) throw new Error("value is null");
    read.x = 0.9;
    expect(picker.value).toEqual({ x: 0.25, y: 0.75 });
  });
});

describe("inputs", () => {
  test("show percent with a 0.1 step, and are labelled", async () => {
    const picker = await mount();
    picker.value = { x: 0.423, y: 0.5 };
    expect(field("X").value).toBe("42.3");
    expect(field("Y").value).toBe("50");
    expect(field("X").step).toBe("0.1");
    expect(field("X").min).toBe("0");
    expect(field("X").max).toBe("100");
  });

  test("typing in X changes the point, moves the marker, and emits one change", async () => {
    const picker = await mount();
    picker.value = { x: 0.25, y: 0.75 };
    const seen = record(picker);

    const x = field("X");
    x.focus();
    x.select();
    await userEvent.keyboard("40");
    await userEvent.keyboard("{Enter}");

    expectAgreement(picker, 0.4, 0.75);
    // Typing is committed on change, not per keystroke; the native input events must not leak out
    // of the shadow root as events without a detail.
    expect(seen).toEqual([{ type: "change", detail: { x: 0.4, y: 0.75 } }]);
  });

  test("entry is committed on blur", async () => {
    const picker = await mount();
    picker.value = { x: 0.25, y: 0.75 };
    const seen = record(picker);

    await userEvent.fill(field("Y"), "10");
    await userEvent.tab();

    expectAgreement(picker, 0.25, 0.1);
    expect(seen).toEqual([{ type: "change", detail: { x: 0.25, y: 0.1 } }]);
  });

  test("an entry that lands on the current point emits nothing", async () => {
    const picker = await mount();
    picker.value = { x: 0.25, y: 0.75 };
    const seen = record(picker);

    // "25.0" differs from the shown "25", so the browser fires its change event, but it is 0.25 again.
    await userEvent.fill(field("X"), "25.0");
    await userEvent.tab();

    expectAgreement(picker, 0.25, 0.75);
    expect(seen).toEqual([]);
  });

  test("entering a value with more than one decimal rounds the point to 3 decimals", async () => {
    const picker = await mount();
    picker.value = { x: 0.25, y: 0.75 };

    await userEvent.fill(field("X"), "42.34");
    await userEvent.tab();

    // 42.34 percent is 0.4234; 3 decimals is 0.423, shown as 42.3.
    expect(picker.value).toEqual({ x: 0.423, y: 0.75 });
    expect(field("X").value).toBe("42.3");
  });

  test("an empty entry restores the last good value and emits nothing", async () => {
    const picker = await mount();
    picker.value = { x: 0.25, y: 0.75 };
    const seen = record(picker);

    await userEvent.clear(field("X"));
    await userEvent.tab();

    expectAgreement(picker, 0.25, 0.75);
    expect(seen).toEqual([]);
  });

  test("an entry outside 0 to 100 restores the last good value and emits nothing", async () => {
    const picker = await mount();
    picker.value = { x: 0.25, y: 0.75 };
    const seen = record(picker);

    await userEvent.fill(field("X"), "150");
    await userEvent.tab();
    await userEvent.fill(field("Y"), "-5");
    await userEvent.tab();

    expectAgreement(picker, 0.25, 0.75);
    expect(seen).toEqual([]);
  });

  test("an empty entry while there is no point leaves it without one", async () => {
    const picker = await mount();
    const seen = record(picker);

    await userEvent.click(field("X"));
    await userEvent.tab();

    expect(picker.value).toBeNull();
    expect(seen).toEqual([]);
  });

  test("the first entry while there is no point takes the centre for the other axis", async () => {
    const picker = await mount();

    await userEvent.fill(field("X"), "20");
    await userEvent.tab();

    expect(picker.value).toEqual({ x: 0.2, y: 0.5 });
  });

  test("a click then agrees with the inputs after an entry", async () => {
    const picker = await mount();
    await userEvent.fill(field("X"), "20");
    await userEvent.tab();

    await userEvent.click(part(picker, "image"), { position: { x: 200, y: 100 } });

    expectAgreement(picker, 0.5, 0.5);
  });
});

describe("image source", () => {
  test("a File shows its image through an object URL, revoked when the file changes and on disconnect", async () => {
    const create = vi.spyOn(URL, "createObjectURL");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const picker = document.createElement(TAG) as DynjandiFocalPicker;
    document.body.append(picker);
    const first = await pngFile(200, 100);
    const second = await pngFile(100, 100);

    picker.file = first;
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenLastCalledWith(first);
    const firstUrl = create.mock.results[0]?.value as string;
    const image = part(picker, "image") as HTMLImageElement;
    expect(image.src).toBe(firstUrl);
    await image.decode();
    expect(image.naturalWidth).toBe(200);
    expect(revoke).not.toHaveBeenCalled();

    picker.file = second;
    expect(revoke).toHaveBeenCalledExactlyOnceWith(firstUrl);
    expect(create).toHaveBeenCalledTimes(2);
    const secondUrl = create.mock.results[1]?.value as string;
    expect(image.src).toBe(secondUrl);

    picker.remove();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenLastCalledWith(secondUrl);
  });

  test("a file that is reconnected gets a fresh object URL", async () => {
    const create = vi.spyOn(URL, "createObjectURL");
    const picker = document.createElement(TAG) as DynjandiFocalPicker;
    document.body.append(picker);
    picker.file = await pngFile(200, 100);
    picker.remove();

    document.body.append(picker);

    expect(create).toHaveBeenCalledTimes(2);
    await (part(picker, "image") as HTMLImageElement).decode();
  });

  test("setting the file to null releases the URL", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const picker = await mount();

    picker.file = null;

    expect(revoke).toHaveBeenCalledTimes(1);
  });

  test("the src attribute shows an image by URL", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 50;
    canvas.height = 20;
    const picker = document.createElement(TAG) as DynjandiFocalPicker;
    document.body.append(picker);

    picker.setAttribute("src", canvas.toDataURL("image/png"));

    const image = part(picker, "image") as HTMLImageElement;
    await image.decode();
    expect(image.naturalWidth).toBe(50);
    expect(picker.src).toBe(picker.getAttribute("src"));
  });

  test("an image that cannot be read shows an error, not a blank", async () => {
    const picker = document.createElement(TAG) as DynjandiFocalPicker;
    document.body.append(picker);

    picker.file = new File(["this is not an image"], "broken.png", { type: "image/png" });

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("This image could not be loaded.");
    expect(part(picker, "surface").checkVisibility()).toBe(false);
  });

  test("the error goes away when a readable image replaces it", async () => {
    const picker = document.createElement(TAG) as DynjandiFocalPicker;
    document.body.append(picker);
    picker.file = new File(["this is not an image"], "broken.png", { type: "image/png" });
    await expect.element(page.getByRole("alert")).toBeVisible();

    picker.file = await pngFile(200, 100);

    await expect.poll(() => part(picker, "surface").checkVisibility()).toBe(true);
    expect(part(picker, "error").checkVisibility()).toBe(false);
  });
});

describe("registration", () => {
  test("importing the module a second time registers nothing twice", async () => {
    const registered = customElements.get(TAG);
    expect(registered).toBeDefined();
    const define = vi.spyOn(customElements, "define");

    // A query string makes the browser evaluate the module again, as two copies of a bundle would.
    await import(/* @vite-ignore */ `../../src/element.ts?again=${Date.now()}`);

    expect(define).not.toHaveBeenCalled();
    expect(customElements.get(TAG)).toBe(registered);
  });
});
