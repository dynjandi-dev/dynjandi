import { cropWindow, type ImageSize, pointFromRect } from "./geometry.js";
import { type FocalPoint, roundPoint } from "./point.js";

/** The tag name `./element` registers. */
export const TAG_NAME = "dynjandi-focal-picker";

const STYLE = `
:host { display: block; }
:host([hidden]) { display: none; }
.surface {
  position: relative;
  display: block;
  line-height: 0;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.surface[hidden] { display: none; }
.image { display: block; width: 100%; height: auto; }
/* Two tones: a white ring inside a dark one, so it keeps 3:1 against a white, a black or a mid-grey image. */
.marker {
  position: absolute;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  transform: translate(-50%, -50%);
  border: 3px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 2px #000, inset 0 0 0 2px #000;
  pointer-events: none;
}
.marker[hidden] { display: none; }
/* Forced colours drop box-shadow and recolour the border to CanvasText, so the second tone is an outline in a system colour (which is kept). */
@media (forced-colors: active) {
  .marker { outline: 2px solid Canvas; }
}
.error { margin: 0; padding: 0.75em 1em; border: 1px solid currentColor; }
.error[hidden] { display: none; }
.fields { display: flex; flex-wrap: wrap; gap: 0.75em 1.5em; margin-top: 0.75em; }
.field { display: flex; flex-direction: column; gap: 0.25em; }
.field input { width: 8em; font: inherit; }
.previews { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.75em 1em; margin-top: 0.75em; }
.previews[hidden] { display: none; }
.preview { margin: 0; }
/* The box has the ratio's shape; the image inside is sized and offset in percent of the box. */
.preview-box { position: relative; overflow: hidden; height: 7rem; }
.preview-image { position: absolute; display: block; max-width: none; }
.preview-caption { margin-top: 0.25em; font-size: 0.875em; }
`;

/** What `ratios` holds until it is set: the sizes a CMS most often crops to. */
const DEFAULT_RATIOS: ReadonlyArray<readonly [number, number]> = [
  [16, 9],
  [1, 1],
  [4, 5],
  [9, 16],
];

/** A list of `[width, height]` pairs that are all positive and finite, and not empty. */
function isRatioList(list: unknown): list is [number, number][] {
  return (
    Array.isArray(list) &&
    list.length > 0 &&
    list.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        pair.every((side) => typeof side === "number" && Number.isFinite(side) && side > 0),
    )
  );
}

interface Preview {
  figure: HTMLElement;
  ratio: number;
  label: string;
  image: HTMLImageElement;
  caption: HTMLElement;
}

let sheet: CSSStyleSheet | undefined;

/** One stylesheet shared by every instance, adopted where the browser can and copied into a <style> where not. */
function applyStyle(root: ShadowRoot): void {
  try {
    sheet ??= new CSSStyleSheet();
    if (sheet.cssRules.length === 0) sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.append(style);
  }
}

/** Percent as the inputs show it: 0.423 is "42.3". Dividing the rounded thousandths avoids 42.300000000000004. */
function toPercent(fraction: number): string {
  return String(Math.round(fraction * 1000) / 10);
}

/** An input's text as a fraction, or null when it is empty, not a number, or outside 0 to 100 percent. */
function fromPercent(text: string): number | null {
  if (text.trim() === "") return null;
  const percent = Number(text);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return percent / 100;
}

function createField(label: string): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "100";
  input.step = "0.1";
  wrapper.append(text, input);
  return { wrapper, input };
}

/**
 * `<dynjandi-focal-picker>`: shows an image and lets a person choose its focal point by clicking or
 * dragging on it, or by typing percentages. It reports the point and sends nothing anywhere.
 *
 * - `file` (property): a `File` or `Blob` to show. Wins over `src`.
 * - `src` (attribute and property): a URL to show.
 * - `value` (property): `{ x, y }` (each 0 to 1) or `null` for no point. Setting it emits no event.
 * - `ratios` (property): the crop shapes to preview, as `[width, height]` pairs; default 16:9, 1:1, 4:5, 9:16.
 *   An invalid list is replaced by the default and warned about once.
 * - `input` event: while a drag moves the point. `change` event: once when a drag ends, and when a typed
 *   entry is committed. Both carry `detail: { x, y }`.
 */
export class DynjandiFocalPicker extends HTMLElement {
  static observedAttributes = ["src"];

  #value: FocalPoint | null = null;
  #file: Blob | null = null;
  #objectUrl: string | null = null;
  /** The value when the current drag began; null when no drag is under way. */
  #dragStart: { pointerId: number; from: FocalPoint | null } | null = null;
  #ratios: [number, number][] = DEFAULT_RATIOS.map(([w, h]) => [w, h]);
  #previews: Preview[] = [];
  /** The loaded image's natural size, which the preview geometry needs; null until it has loaded. */
  #natural: ImageSize | null = null;
  /** The URL the surface image shows, which every preview image shows too: one object URL, not many. */
  #source: string | null = null;

  readonly #surface = document.createElement("div");
  readonly #image = document.createElement("img");
  readonly #marker = document.createElement("div");
  readonly #error = document.createElement("p");
  readonly #previewStrip = document.createElement("div");
  readonly #x = createField("Focal point X (%)");
  readonly #y = createField("Focal point Y (%)");

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    applyStyle(root);

    // The surface is a pointer affordance only: the inputs are the accessible path.
    this.#surface.className = "surface";
    this.#surface.setAttribute("part", "surface");
    this.#surface.setAttribute("aria-hidden", "true");
    this.#image.className = "image";
    this.#image.setAttribute("part", "image");
    this.#image.alt = "";
    this.#image.draggable = false;
    this.#marker.className = "marker";
    this.#marker.setAttribute("part", "marker");
    this.#marker.hidden = true;
    this.#surface.append(this.#image, this.#marker);

    this.#error.className = "error";
    this.#error.setAttribute("part", "error");
    this.#error.setAttribute("role", "alert");
    this.#error.textContent = "This image could not be loaded.";
    this.#error.hidden = true;

    const fields = document.createElement("div");
    fields.className = "fields";
    fields.setAttribute("part", "fields");
    fields.setAttribute("role", "group");
    fields.setAttribute("aria-label", "Focal point");
    fields.append(this.#x.wrapper, this.#y.wrapper);

    // Like the surface, the previews are a visual aid; the inputs carry the same point for everyone.
    this.#previewStrip.className = "previews";
    this.#previewStrip.setAttribute("part", "previews");
    this.#previewStrip.setAttribute("aria-hidden", "true");
    this.#previewStrip.hidden = true;
    this.#buildPreviews();

    this.#surface.hidden = true;
    root.append(this.#surface, this.#error, fields, this.#previewStrip);

    this.#surface.addEventListener("pointerdown", (event) => this.#onPointerDown(event));
    this.#surface.addEventListener("pointermove", (event) => this.#onPointerMove(event));
    this.#surface.addEventListener("pointerup", (event) => this.#onPointerEnd(event));
    this.#surface.addEventListener("pointercancel", (event) => this.#onPointerEnd(event));
    this.#image.addEventListener("load", () => this.#showImage(true));
    this.#image.addEventListener("error", () => this.#showImage(false));

    for (const [input, axis] of [
      [this.#x.input, "x"],
      [this.#y.input, "y"],
    ] as const) {
      // A native `input` event is composed and would escape the shadow root as an event without a detail;
      // this element's own `input` means a drag.
      input.addEventListener("input", (event) => event.stopPropagation());
      input.addEventListener("change", () => this.#commitEntry(axis));
      input.addEventListener("blur", () => this.#syncInputs());
    }
  }

  /** The chosen point, or `null` for none. A copy: changing it does not change the picker. */
  get value(): FocalPoint | null {
    return this.#value === null ? null : { ...this.#value };
  }

  /** Sets the point, clamped into 0 to 1 and rounded to 3 decimals. Emits no event, as with a native input. */
  set value(point: FocalPoint | null) {
    this.#value = point === null ? null : roundPoint(point);
    this.#render();
  }

  /**
   * The crop shapes to preview, as `[width, height]` pairs (`[16, 9]`). Pairs rather than "16:9" strings
   * so there is nothing to parse and no format to get wrong; the caption is built from the pair. A list
   * that is empty, or holds anything but two positive finite numbers, is replaced by the default
   * (16:9, 1:1, 4:5, 9:16) with one `console.warn` per assignment. The getter returns a copy.
   */
  get ratios(): [number, number][] {
    return this.#ratios.map(([w, h]) => [w, h]);
  }

  set ratios(list: [number, number][]) {
    if (isRatioList(list)) {
      this.#ratios = list.map(([w, h]) => [w, h]);
    } else {
      // biome-ignore lint/suspicious/noConsole: a rejected option is reported to the developer, once.
      console.warn(
        "dynjandi-focal-picker: ratios must be a non-empty list of [width, height] pairs of positive finite numbers; using the default 16:9, 1:1, 4:5, 9:16.",
      );
      this.#ratios = DEFAULT_RATIOS.map(([w, h]) => [w, h]);
    }
    this.#buildPreviews();
    this.#renderPreviews();
  }

  /** The image to show as a `File` or `Blob`. It wins over `src`. The picker revokes its object URL. */
  get file(): Blob | null {
    return this.#file;
  }

  set file(file: Blob | null) {
    if (file !== null && !(file instanceof Blob)) {
      throw new TypeError("file must be a File, a Blob or null");
    }
    this.#file = file;
    this.#releaseObjectUrl();
    this.#syncImage();
  }

  /** The image to show as a URL; mirrors the `src` attribute. */
  get src(): string | null {
    return this.getAttribute("src");
  }

  set src(url: string | null) {
    if (url === null) this.removeAttribute("src");
    else this.setAttribute("src", url);
  }

  connectedCallback(): void {
    this.#syncImage();
  }

  disconnectedCallback(): void {
    this.#releaseObjectUrl();
    this.#setSource(null);
  }

  attributeChangedCallback(): void {
    this.#syncImage();
  }

  #releaseObjectUrl(): void {
    if (this.#objectUrl === null) return;
    URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
  }

  /** Points the <img> at the file's object URL (made on demand) or at `src`. Does nothing while detached. */
  #syncImage(): void {
    if (!this.isConnected) return;
    let source: string | null = this.getAttribute("src");
    if (this.#file !== null) {
      this.#objectUrl ??= URL.createObjectURL(this.#file);
      source = this.#objectUrl;
    }
    if (source === null || source === "") {
      this.#setSource(null);
      this.#surface.hidden = true;
      this.#previewStrip.hidden = true;
      this.#error.hidden = true;
      return;
    }
    this.#setSource(source);
  }

  /** Points the surface image and every preview image at one URL, or at nothing. */
  #setSource(source: string | null): void {
    if (source === this.#source) return;
    this.#source = source;
    if (source === null) this.#natural = null;
    for (const image of [this.#image, ...this.#previews.map((preview) => preview.image)]) {
      if (source === null) image.removeAttribute("src");
      else image.src = source;
    }
  }

  #showImage(loaded: boolean): void {
    this.#natural = loaded
      ? { width: this.#image.naturalWidth, height: this.#image.naturalHeight }
      : null;
    // A loaded image with no size (an SVG without one) has no geometry to preview.
    if (this.#natural !== null && !(this.#natural.width > 0 && this.#natural.height > 0)) {
      this.#natural = null;
    }
    this.#surface.hidden = !loaded;
    this.#previewStrip.hidden = this.#natural === null;
    this.#error.hidden = loaded;
    this.#renderPreviews();
  }

  /** Makes one box per ratio. Runs when the ratios change, never while a point moves. */
  #buildPreviews(): void {
    this.#previews = this.#ratios.map(([width, height]) => {
      const figure = document.createElement("figure");
      figure.className = "preview";
      figure.setAttribute("part", "preview");
      const box = document.createElement("div");
      box.className = "preview-box";
      box.setAttribute("part", "preview-box");
      box.style.aspectRatio = `${width} / ${height}`;
      const image = document.createElement("img");
      image.className = "preview-image";
      image.setAttribute("part", "preview-image");
      image.alt = "";
      image.draggable = false;
      if (this.#source !== null) image.src = this.#source;
      box.append(image);
      const caption = document.createElement("figcaption");
      caption.className = "preview-caption";
      caption.setAttribute("part", "preview-caption");
      figure.append(box, caption);
      return { figure, ratio: width / height, label: `${width}:${height}`, image, caption };
    });
    this.#previewStrip.replaceChildren(...this.#previews.map((preview) => preview.figure));
  }

  /**
   * Positions each preview's image from `cropWindow`. The box has the ratio's shape, so an image sized
   * 1 / crop-width of the box's width and 1 / crop-height of its height keeps its proportions, and
   * pulling it left and up by crop-left / crop-width (and top / height) of the box shows the window.
   * Only style values and a caption string change here: this runs for every pointer move.
   */
  #renderPreviews(): void {
    const natural = this.#natural;
    if (natural === null) return;
    const point = this.#value ?? { x: 0.5, y: 0.5 };
    const note = this.#value === null ? ", centre crop (no point chosen)" : "";
    for (const preview of this.#previews) {
      const crop = cropWindow(natural, preview.ratio, point);
      const style = preview.image.style;
      style.width = `${100 / crop.width}%`;
      style.height = `${100 / crop.height}%`;
      style.left = `${(-crop.left / crop.width) * 100}%`;
      style.top = `${(-crop.top / crop.height) * 100}%`;
      const text = preview.label + note;
      if (preview.caption.textContent !== text) preview.caption.textContent = text;
    }
  }

  #render(): void {
    const point = this.#value;
    this.#marker.hidden = point === null;
    if (point !== null) {
      this.#marker.style.left = `${point.x * 100}%`;
      this.#marker.style.top = `${point.y * 100}%`;
    }
    this.#syncInputs();
    this.#renderPreviews();
  }

  /** Shows the point in the inputs, which also restores the last good value after a rejected entry. */
  #syncInputs(): void {
    this.#x.input.value = this.#value === null ? "" : toPercent(this.#value.x);
    this.#y.input.value = this.#value === null ? "" : toPercent(this.#value.y);
  }

  #emit(type: "input" | "change", point: FocalPoint): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail: { ...point }, bubbles: true, composed: true }),
    );
  }

  #commitEntry(axis: "x" | "y"): void {
    const typed = fromPercent((axis === "x" ? this.#x : this.#y).input.value);
    if (typed === null) {
      this.#syncInputs();
      return;
    }
    // With no point yet, the other axis starts at the centre, where the service crops without one.
    const next = roundPoint({ ...(this.#value ?? { x: 0.5, y: 0.5 }), [axis]: typed });
    const changed = this.#value === null || next.x !== this.#value.x || next.y !== this.#value.y;
    this.#value = next;
    this.#render();
    if (changed) this.#emit("change", next);
  }

  #pointAt(event: PointerEvent): FocalPoint {
    // The displayed image's rectangle, not this element's box, which holds padding and the inputs.
    return roundPoint(
      pointFromRect(event.clientX, event.clientY, this.#image.getBoundingClientRect()),
    );
  }

  #moveTo(event: PointerEvent): void {
    const next = this.#pointAt(event);
    if (this.#value !== null && next.x === this.#value.x && next.y === this.#value.y) return;
    this.#value = next;
    this.#render();
    this.#emit("input", next);
  }

  #onPointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || this.#dragStart !== null) return;
    event.preventDefault();
    this.#surface.setPointerCapture(event.pointerId);
    this.#dragStart = { pointerId: event.pointerId, from: this.value };
    this.#moveTo(event);
  }

  #onPointerMove(event: PointerEvent): void {
    if (this.#dragStart?.pointerId === event.pointerId) this.#moveTo(event);
  }

  #onPointerEnd(event: PointerEvent): void {
    const drag = this.#dragStart;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    this.#dragStart = null;
    const now = this.#value;
    const moved =
      now !== null && (drag.from === null || now.x !== drag.from.x || now.y !== drag.from.y);
    if (moved) this.#emit("change", now);
  }
}

// Safe to import twice, including two copies of a bundle: a second define would throw.
if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, DynjandiFocalPicker);

declare global {
  interface HTMLElementTagNameMap {
    [TAG_NAME]: DynjandiFocalPicker;
  }
}
