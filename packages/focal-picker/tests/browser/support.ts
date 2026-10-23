import type { DynjandiFocalPicker } from "../../src/element.js";
import "../../src/element.js";

// Shared by the browser tests. Not a test file: the browser project only runs *.browser.test.ts.

export const TAG = "dynjandi-focal-picker";

/** A solid-colour PNG of the given size, drawn on a canvas. */
export async function pngFile(width: number, height: number, colour = "#37a"): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.fillStyle = colour;
  context.fillRect(0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob === null) throw new Error("canvas.toBlob gave no blob");
  return new File([blob], "test.png", { type: "image/png" });
}

export function part(picker: DynjandiFocalPicker, name: string): HTMLElement {
  const found = picker.shadowRoot?.querySelector<HTMLElement>(`[part~="${name}"]`);
  if (!found) throw new Error(`no part "${name}"`);
  return found;
}

export function allParts(picker: DynjandiFocalPicker): HTMLElement[] {
  return [...(picker.shadowRoot?.querySelectorAll<HTMLElement>("[part]") ?? [])];
}

/** The X or Y input, found the way a person finds it: by its label text. */
export function field(picker: DynjandiFocalPicker, axis: "X" | "Y"): HTMLInputElement {
  const labels = [...(picker.shadowRoot?.querySelectorAll("label") ?? [])];
  const label = labels.find((candidate) => candidate.textContent?.includes(`Focal point ${axis}`));
  const input = label?.querySelector("input");
  if (!input) throw new Error(`no ${axis} input`);
  return input;
}

/** Mounts a picker; with a size, it also waits for that image and every preview image to decode. */
export async function mount(
  options: { width?: number; image?: [number, number] } = {},
): Promise<DynjandiFocalPicker> {
  const picker = document.createElement(TAG) as DynjandiFocalPicker;
  if (options.width !== undefined) picker.style.cssText = `width: ${options.width}px;`;
  document.body.append(picker);
  if (options.image) {
    picker.file = await pngFile(...options.image);
    await decodeAll(picker);
  }
  return picker;
}

/**
 * Resolves once the element shows its image, loaded. The element reveals it from the image's `load` event,
 * which can come after `decode()` resolves, so a test that waits on `decode()` alone can measure a hidden,
 * 0 px image. The element's own `load` listener was added first, so it has run by the time this one does.
 * A reconnected element reloads into a surface that is already showing, hence `complete` too.
 */
export async function shown(picker: DynjandiFocalPicker): Promise<void> {
  const image = part(picker, "image") as HTMLImageElement;
  if (!part(picker, "surface").hidden && image.complete) return;
  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("the image did not load")), {
      once: true,
    });
  });
}

/** Waits for the element to show its image, then for every image in it to decode. */
export async function decodeAll(picker: DynjandiFocalPicker): Promise<void> {
  await shown(picker);
  const images = picker.shadowRoot?.querySelectorAll("img") ?? [];
  await Promise.all([...images].map((image) => image.decode()));
}
