import { pointFromRect } from "./geometry.js";
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
.error { margin: 0; padding: 0.75em 1em; border: 1px solid currentColor; }
.error[hidden] { display: none; }
.fields { display: flex; flex-wrap: wrap; gap: 0.75em 1.5em; margin-top: 0.75em; }
.field { display: flex; flex-direction: column; gap: 0.25em; }
.field input { width: 8em; font: inherit; }
`;

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

  readonly #surface = document.createElement("div");
  readonly #image = document.createElement("img");
  readonly #marker = document.createElement("div");
  readonly #error = document.createElement("p");
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

    this.#surface.hidden = true;
    root.append(this.#surface, this.#error, fields);

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
    this.#image.removeAttribute("src");
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
      this.#image.removeAttribute("src");
      this.#surface.hidden = true;
      this.#error.hidden = true;
      return;
    }
    this.#image.src = source;
  }

  #showImage(loaded: boolean): void {
    this.#surface.hidden = !loaded;
    this.#error.hidden = loaded;
  }

  #render(): void {
    const point = this.#value;
    this.#marker.hidden = point === null;
    if (point !== null) {
      this.#marker.style.left = `${point.x * 100}%`;
      this.#marker.style.top = `${point.y * 100}%`;
    }
    this.#syncInputs();
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
