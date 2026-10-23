import { afterEach, describe, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import type { DynjandiFocalPicker } from "../../src/element.js";
import { allParts, decodeAll, field, mount, part, pngFile } from "./support.js";

// What decides each expectation:
// - Keyboard order: the element's documented structure, X input then Y input, and nothing else focusable.
// - Preview windows: arithmetic from the plan's section 4.2 (cover-scale, centre on the point, clamp). For a
//   1:1 box on a 2:1 image the window is 0.5 wide and 1 high, so left = clamp(x - 0.25, 0, 0.5).
// - Reflow: WCAG 1.4.10 (no horizontal scroll at 320 CSS px, which is 400% of 1280 and 200% of 640).
// - The frame budget: 1000 ms / 60 Hz = 16.7 ms (plan section 8).
// Nothing here asks the element for an expectation.

const DEFAULT_VIEWPORT: [number, number] = [414, 896];

afterEach(async () => {
  document.body.replaceChildren();
  await page.viewport(...DEFAULT_VIEWPORT);
  await emulate({ "forced-colors": "", "prefers-reduced-motion": "" });
});

/** Emulates CSS media features page-wide through the Chrome DevTools protocol ("" clears one). */
async function emulate(features: Record<string, string>): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: Object.entries(features).map(([name, value]) => ({ name, value })),
  });
}

/** Where the focus is, looking through the picker's shadow root. */
function focused(picker: DynjandiFocalPicker): Element | null {
  return picker.shadowRoot?.activeElement ?? null;
}

/** A 1:1 preview's window over a 2:1 image, as the fraction of the image's width its left edge sits at. */
function squareWindowLeft(picker: DynjandiFocalPicker): number {
  const preview = [...(picker.shadowRoot?.querySelectorAll('[part~="preview"]') ?? [])].find(
    (candidate) => candidate.textContent?.includes("1:1"),
  );
  if (!preview) throw new Error("no 1:1 preview");
  const box = preview.querySelector('[part~="preview-box"]')?.getBoundingClientRect();
  const image = preview.querySelector('[part~="preview-image"]')?.getBoundingClientRect();
  if (!box || !image) throw new Error("preview has no box or image");
  return (box.left - image.left) / image.width;
}

describe("keyboard only", () => {
  async function mountBetweenButtons() {
    const before = document.createElement("button");
    before.textContent = "before";
    const picker = await mount({ width: 400, image: [800, 400] });
    const after = document.createElement("button");
    after.textContent = "after";
    document.body.prepend(before);
    document.body.append(after);
    return { before, picker, after };
  }

  test("Tab reaches X, then Y, then leaves: there is no trap and nothing else to stop on", async () => {
    const { before, picker, after } = await mountBetweenButtons();
    before.focus();

    await userEvent.tab();
    expect(picker.shadowRoot?.activeElement).toBe(field(picker, "X"));
    await userEvent.tab();
    expect(picker.shadowRoot?.activeElement).toBe(field(picker, "Y"));
    await userEvent.tab();
    expect(document.activeElement).toBe(after);

    // And back again, through the same two stops.
    await userEvent.tab({ shift: true });
    expect(picker.shadowRoot?.activeElement).toBe(field(picker, "Y"));
    await userEvent.tab({ shift: true });
    expect(picker.shadowRoot?.activeElement).toBe(field(picker, "X"));
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(before);
  });

  test("nothing but the two inputs in the element is reachable by Tab", async () => {
    const { picker } = await mountBetweenButtons();
    // An element is a tab stop when the browser gives it a tabIndex of 0 or more.
    const stops = [...(picker.shadowRoot?.querySelectorAll("*") ?? [])].filter(
      (element) => (element as HTMLElement).tabIndex >= 0,
    );
    expect(stops).toEqual([field(picker, "X"), field(picker, "Y")]);
  });

  test("typing in X then Y changes the point, the inputs and the previews", async () => {
    const { before, picker } = await mountBetweenButtons();
    const events: string[] = [];
    picker.addEventListener("change", (event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      events.push(`${x},${y}`);
    });
    const centred = squareWindowLeft(picker);
    // No point yet: the previews show the centre crop, left = 0.5 - 0.25.
    expect(centred).toBeCloseTo(0.25, 2);

    before.focus();
    await userEvent.tab();
    await userEvent.keyboard("20{Enter}");
    // 20% across on a 2:1 image: left = clamp(0.2 - 0.25, 0, 0.5) = 0.
    expect(picker.value).toEqual({ x: 0.2, y: 0.5 });
    expect(squareWindowLeft(picker)).toBeCloseTo(0, 2);

    await userEvent.tab();
    await userEvent.keyboard("75");
    await userEvent.tab();
    expect(picker.value).toEqual({ x: 0.2, y: 0.75 });
    expect(field(picker, "X").value).toBe("20");
    expect(field(picker, "Y").value).toBe("75");
    expect(events).toEqual(["0.2,0.5", "0.2,0.75"]);

    // X again, now to 90%: left = clamp(0.9 - 0.25, 0, 0.5) = 0.5.
    field(picker, "X").select();
    await userEvent.keyboard("90{Enter}");
    expect(picker.value).toEqual({ x: 0.9, y: 0.75 });
    expect(squareWindowLeft(picker)).toBeCloseTo(0.5, 2);
  });

  test("focus is visibly marked on each input", async () => {
    const { before, picker } = await mountBetweenButtons();
    before.focus();
    for (const axis of ["X", "Y"] as const) {
      await userEvent.tab();
      const input = field(picker, axis);
      expect(focused(picker)).toBe(input);
      expect(input.matches(":focus-visible")).toBe(true);
      const style = getComputedStyle(input);
      expect(style.outlineStyle).not.toBe("none");
      expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThan(0);
    }
  });
});

describe("forced colours", () => {
  test("the marker and the focus indicator stay visible", async () => {
    await emulate({ "forced-colors": "active" });
    expect(matchMedia("(forced-colors: active)").matches).toBe(true);
    const picker = await mount({ width: 400, image: [800, 400] });
    picker.value = { x: 0.5, y: 0.5 };
    const marker = part(picker, "marker");
    const style = getComputedStyle(marker);

    // box-shadow is dropped in forced colours, so the border and the outline must carry both tones.
    const border = Number.parseFloat(style.borderTopWidth);
    const outline = Number.parseFloat(style.outlineWidth);
    expect(marker.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(style.display).not.toBe("none");
    expect(style.visibility).toBe("visible");
    expect(border).toBeGreaterThanOrEqual(2);
    expect(style.borderTopStyle).toBe("solid");
    expect(outline).toBeGreaterThanOrEqual(2);
    expect(style.outlineStyle).toBe("solid");
    expect(style.outlineColor).not.toBe(style.borderTopColor);

    await userEvent.tab();
    const input = field(picker, "X");
    expect(picker.shadowRoot?.activeElement).toBe(input);
    const focus = getComputedStyle(input);
    expect(focus.outlineStyle).not.toBe("none");
    expect(Number.parseFloat(focus.outlineWidth)).toBeGreaterThan(0);
  });
});

describe("reflow", () => {
  test("at 320 CSS px (200% zoom of a 640 px window) nothing scrolls sideways", async () => {
    await page.viewport(320, 640);
    const picker = await mount({ image: [1600, 900] });
    picker.value = { x: 0.5, y: 0.5 };
    await decodeAll(picker);

    expect(picker.scrollWidth).toBeLessThanOrEqual(picker.clientWidth);
    expect(picker.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    // Every part sits inside the window. The preview images are skipped: they are deliberately larger than
    // their boxes, which clip them.
    for (const element of allParts(picker)) {
      if (element.getAttribute("part") === "preview-image") continue;
      const right = element.getBoundingClientRect().right;
      expect(right, element.getAttribute("part") ?? "").toBeLessThanOrEqual(window.innerWidth);
    }
  });
});

describe("reduced motion", () => {
  test("no part has a transition or an animation", async () => {
    await emulate({ "prefers-reduced-motion": "reduce" });
    expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    const picker = await mount({ width: 400, image: [800, 400] });
    picker.value = { x: 0.3, y: 0.3 };

    const everything = [...(picker.shadowRoot?.querySelectorAll("*") ?? []), ...allParts(picker)];
    expect(everything.length).toBeGreaterThan(10);
    for (const element of everything) {
      const style = getComputedStyle(element);
      const name = `${element.tagName.toLowerCase()}[${element.getAttribute("part") ?? ""}]`;
      expect(style.animationName, name).toBe("none");
      expect(style.transitionProperty === "all" ? style.transitionDuration : "0s", name).toBe("0s");
      expect(style.transitionDuration, name).toBe("0s");
    }
    expect(picker.shadowRoot?.getAnimations?.() ?? []).toEqual([]);
  });
});

describe("pointer-move cost", () => {
  test("a drag over a 24-megapixel image with four previews stays under one frame", async () => {
    const FRAME_MS = 1000 / 60; // 16.7 ms, plan section 8
    const picker = document.createElement("dynjandi-focal-picker") as DynjandiFocalPicker;
    picker.style.cssText = "width: 600px;";
    document.body.append(picker);
    picker.file = await pngFile(6000, 4000);
    await decodeAll(picker);
    const surface = part(picker, "surface");
    const image = part(picker, "image").getBoundingClientRect();
    expect(part(picker, "previews").querySelectorAll('[part~="preview"]')).toHaveLength(4);

    // A synthetic pointer is not an active pointer, so the browser would refuse to capture it.
    const capture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = () => {};
    const pointer = (type: string, x: number, y: number) =>
      new PointerEvent(type, {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientX: image.left + x,
        clientY: image.top + y,
        bubbles: true,
        composed: true,
      });

    let inputs = 0;
    picker.addEventListener("input", () => inputs++);
    const handler: number[] = [];
    const withLayout: number[] = [];
    let start = 0;
    const begin = () => {
      start = performance.now();
    };
    const end = () => {
      handler.push(performance.now() - start);
      // What the browser must do next for the frame: restyle and lay out what the handler changed.
      for (const element of picker.shadowRoot?.querySelectorAll("img, [part~='marker']") ?? []) {
        element.getBoundingClientRect();
      }
      withLayout.push(performance.now() - start);
    };
    try {
      surface.dispatchEvent(pointer("pointerdown", 10, 10));
      // Capture runs before the surface's own handler and bubble after it: the span is the element's work.
      window.addEventListener("pointermove", begin, { capture: true });
      window.addEventListener("pointermove", end);
      const moves = 300;
      for (let step = 1; step <= moves; step++) {
        // 2 px steps on a 600 px image are 0.003, more than the 0.001 rounding, so every move changes the point.
        surface.dispatchEvent(pointer("pointermove", 10 + (step % 280) * 2, 10 + (step % 140) * 2));
      }
      surface.dispatchEvent(pointer("pointerup", 100, 100));
    } finally {
      window.removeEventListener("pointermove", begin, { capture: true });
      window.removeEventListener("pointermove", end);
      Element.prototype.setPointerCapture = capture;
    }

    const sorted = (list: number[]) => [...list].sort((a, b) => a - b);
    const stat = (list: number[]) => {
      const s = sorted(list);
      return {
        median: s[Math.floor(s.length / 2)] ?? 0,
        p95: s[Math.floor(s.length * 0.95)] ?? 0,
        max: s.at(-1) ?? 0,
      };
    };
    const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
    const a = stat(handler);
    const b = stat(withLayout);
    // biome-ignore lint/suspicious/noConsole: the measured figure is the point of this test and goes in the commit message.
    console.info(
      `pointer-move cost over ${handler.length} moves, 6000x4000 image, 4 previews: handler mean ${mean(handler).toFixed(3)} ms, median ${a.median.toFixed(3)} ms, p95 ${a.p95.toFixed(3)} ms, max ${a.max.toFixed(3)} ms; with forced layout mean ${mean(withLayout).toFixed(3)} ms, median ${b.median.toFixed(3)} ms, p95 ${b.p95.toFixed(3)} ms, max ${b.max.toFixed(3)} ms (budget ${FRAME_MS.toFixed(1)} ms)`,
    );
    expect(handler).toHaveLength(300);
    // The press and every move changed the point and was reported, so the measured work includes the render.
    expect(inputs).toBe(301);
    expect(mean(withLayout)).toBeLessThan(FRAME_MS);
    expect(b.p95).toBeLessThan(FRAME_MS);
  });
});
