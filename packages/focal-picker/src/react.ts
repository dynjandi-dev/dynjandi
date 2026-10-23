import {
  createElement,
  type ForwardedRef,
  forwardRef,
  type ReactElement,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { type DynjandiFocalPicker, TAG_NAME } from "./element.js";
import type { FocalPoint } from "./point.js";

export interface FocalPickerProps {
  /** The image to show, as a `File` or `Blob`. Wins over `src`. */
  file?: Blob | null;
  /** The image to show, as a URL. */
  src?: string;
  /**
   * The point, `{ x, y }` (each 0 to 1) or `null` for none. Giving it, `null` included, makes the picker
   * controlled: it shows this value, and a change the person makes is reported to `onChange` but not kept
   * unless the parent passes the new value back.
   */
  value?: FocalPoint | null;
  /** The starting point of an uncontrolled picker. Read when the picker is mounted. */
  defaultValue?: FocalPoint | null;
  /** The crop shapes to preview, as `[width, height]` pairs. */
  ratios?: [number, number][];
  /** Once per committed change: a drag ending, or a typed entry committed. */
  onChange?: (point: FocalPoint) => void;
  /** While a drag moves the point. */
  onInput?: (point: FocalPoint) => void;
}

function isPoint(detail: unknown): detail is FocalPoint {
  return (
    typeof detail === "object" &&
    detail !== null &&
    "x" in detail &&
    typeof detail.x === "number" &&
    "y" in detail &&
    typeof detail.y === "number"
  );
}

/** The controlled value the coordinates stand for: both present, or none. */
function pointFrom(x: number | undefined, y: number | undefined): FocalPoint | null {
  return x === undefined || y === undefined ? null : { x, y };
}

/** The point an event carries, or null for an event that is not the element's own. */
function pointOf(event: Event): FocalPoint | null {
  return event instanceof CustomEvent && isPoint(event.detail)
    ? { x: event.detail.x, y: event.detail.y }
    : null;
}

/**
 * `<dynjandi-focal-picker>` for React. Importing this module registers the element, so it needs a DOM:
 * load it from client code only.
 *
 * React 19 would set properties and listen to custom events on the element itself; the wrapper does both
 * in effects instead, so a controlled `value` can be put back after a change the parent did not accept.
 */
export const FocalPicker = forwardRef(function FocalPicker(
  { file, src, value, defaultValue, ratios, onChange, onInput }: FocalPickerProps,
  ref: ForwardedRef<DynjandiFocalPicker>,
): ReactElement {
  const element = useRef<DynjandiFocalPicker | null>(null);
  useImperativeHandle(ref, () => {
    if (element.current === null) throw new Error("FocalPicker: the element is not mounted");
    return element.current;
  }, []);

  // Primitives, so a parent that builds a new object each render does not re-apply the value mid-drag.
  const controlled = value !== undefined;
  const pointX = value?.x;
  const pointY = value?.y;
  // The same for the shapes: an inline `ratios` array is a new one each render, and assigning it rebuilds
  // the previews.
  const ratiosKey = ratios === undefined ? undefined : JSON.stringify(ratios);

  useEffect(() => {
    if (element.current !== null) element.current.file = file ?? null;
  }, [file]);

  useEffect(() => {
    if (element.current !== null && ratiosKey !== undefined) {
      element.current.ratios = JSON.parse(ratiosKey) as [number, number][];
    }
  }, [ratiosKey]);

  // Mounted once with the default; after that the element owns the point until `value` is given.
  const initial = useRef(defaultValue);
  useEffect(() => {
    if (element.current !== null && initial.current !== undefined) {
      element.current.value = initial.current;
    }
  }, []);

  useEffect(() => {
    if (element.current === null || !controlled) return;
    element.current.value = pointFrom(pointX, pointY);
  }, [controlled, pointX, pointY]);

  useEffect(() => {
    const picker = element.current;
    if (picker === null) return;
    const handleInput = (event: Event) => {
      const point = pointOf(event);
      if (point !== null) onInput?.(point);
    };
    const handleChange = (event: Event) => {
      const point = pointOf(event);
      if (point === null) return;
      onChange?.(point);
      // The parent has had its say. If it did not pass a new value back, the render that follows puts
      // nothing, so the picker goes back to the value it was given.
      if (controlled) {
        picker.value = pointFrom(pointX, pointY);
      }
    };
    picker.addEventListener("input", handleInput);
    picker.addEventListener("change", handleChange);
    return () => {
      picker.removeEventListener("input", handleInput);
      picker.removeEventListener("change", handleChange);
    };
  }, [controlled, pointX, pointY, onChange, onInput]);

  return createElement(TAG_NAME, { ref: element, src });
});
