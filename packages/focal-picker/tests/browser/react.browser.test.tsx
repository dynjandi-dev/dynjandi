import { createRef, type ReactElement, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DynjandiFocalPicker } from "../../src/element.js";
import type { FocalPoint } from "../../src/point.js";
import { FocalPicker } from "../../src/react.js";
import { part, pngFile, shown } from "./support.js";

// The wrapper is rendered with React in Chromium, and clicks and drags go through Playwright's mouse, as in
// element.browser.test.ts. Every expected point is arithmetic on the displayed image's measured rectangle (a
// position clicked, in pixels from its top-left, over its measured size), never a number read from the
// element. The 200 by 100 test image is shown 400 by 200 wide in a 400 px box.

const WIDTH = 400;

afterEach(() => {
  vi.restoreAllMocks();
});

/** A 400 px box, so the 200 by 100 image shows at 400 by 200 and a pixel offset is easy to turn into a fraction. */
function Box({ children }: { children: ReactElement }): ReactElement {
  return <div style={{ width: `${WIDTH}px` }}>{children}</div>;
}

async function loaded(picker: DynjandiFocalPicker): Promise<HTMLImageElement> {
  await shown(picker);
  const image = part(picker, "image") as HTMLImageElement;
  expect(image.naturalWidth).toBe(200);
  return image;
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

/** Renders a picker showing the test image and hands back the element through the forwarded ref. */
async function show(
  props: Partial<React.ComponentProps<typeof FocalPicker>>,
): Promise<DynjandiFocalPicker> {
  const ref = createRef<DynjandiFocalPicker>();
  const file = await pngFile(200, 100);
  await render(
    <Box>
      <FocalPicker ref={ref} file={file} {...props} />
    </Box>,
  );
  if (ref.current === null) throw new Error("the ref did not reach the element");
  await loaded(ref.current);
  return ref.current;
}

describe("FocalPicker", () => {
  test("the ref reaches the <dynjandi-focal-picker> element", async () => {
    const picker = await show({});
    expect(picker.localName).toBe("dynjandi-focal-picker");
    expect(picker.isConnected).toBe(true);
  });

  test("a click on the image calls onChange with the clicked point", async () => {
    const onChange = vi.fn();
    const picker = await show({ onChange });

    // 100 px of 400 is 0.25 across; 150 px of 200 is 0.75 down.
    await userEvent.click(part(picker, "image"), { position: { x: 100, y: 150 } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ x: 0.25, y: 0.75 });
  });

  test("onInput fires while a drag moves the point, then onChange once at the end", async () => {
    const onInput = vi.fn();
    const onChange = vi.fn();
    const picker = await show({ onInput, onChange });
    const image = part(picker, "image");

    await userEvent.dragAndDrop(image, image, {
      sourcePosition: { x: 100, y: 150 },
      targetPosition: { x: 300, y: 50 },
    });

    // The drag starts at 100/400 and 150/200 and ends at 300/400 and 50/200.
    expect(onInput.mock.calls.length).toBeGreaterThan(1);
    expect(onInput.mock.calls[0]).toEqual([{ x: 0.25, y: 0.75 }]);
    expect(onInput.mock.calls.at(-1)).toEqual([{ x: 0.75, y: 0.25 }]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ x: 0.75, y: 0.25 });
  });

  test("defaultValue is where an uncontrolled picker starts, and the picker keeps what a click sets", async () => {
    const picker = await show({ defaultValue: { x: 0.25, y: 0.75 } });
    expect(markerFraction(picker).x).toBeCloseTo(0.25, 2);
    expect(markerFraction(picker).y).toBeCloseTo(0.75, 2);

    // 300 of 400 is 0.75; 50 of 200 is 0.25.
    await userEvent.click(part(picker, "image"), { position: { x: 300, y: 50 } });

    expect(markerFraction(picker).x).toBeCloseTo(0.75, 2);
    expect(markerFraction(picker).y).toBeCloseTo(0.25, 2);
  });

  test("ratios gives the picker one preview per shape", async () => {
    const picker = await show({
      ratios: [
        [3, 2],
        [1, 1],
      ],
    });
    const captions = [...(picker.shadowRoot?.querySelectorAll('[part~="preview-caption"]') ?? [])];
    expect(captions.map((caption) => caption.textContent)).toEqual([
      "3:2, centre crop (no point chosen)",
      "1:1, centre crop (no point chosen)",
    ]);
  });

  test("src shows the image at that URL", async () => {
    const file = await pngFile(200, 100);
    const url = URL.createObjectURL(file);
    const ref = createRef<DynjandiFocalPicker>();
    await render(
      <Box>
        <FocalPicker ref={ref} src={url} />
      </Box>,
    );
    if (ref.current === null) throw new Error("the ref did not reach the element");
    expect(ref.current.src).toBe(url);
    await loaded(ref.current);
    URL.revokeObjectURL(url);
  });

  test('taking src away leaves the element with no src, not the URL "undefined"', async () => {
    const file = await pngFile(200, 100);
    const url = URL.createObjectURL(file);
    const ref = createRef<DynjandiFocalPicker>();
    const screen = await render(
      <Box>
        <FocalPicker ref={ref} src={url} />
      </Box>,
    );
    const picker = ref.current;
    if (picker === null) throw new Error("the ref did not reach the element");
    await loaded(picker);

    await screen.rerender(
      <Box>
        <FocalPicker ref={ref} />
      </Box>,
    );

    expect(picker.hasAttribute("src")).toBe(false);
    expect(part(picker, "error").checkVisibility()).toBe(false);
    URL.revokeObjectURL(url);
  });

  test("an inline ratios array with the same shapes keeps the previews; new shapes rebuild them", async () => {
    const ref = createRef<DynjandiFocalPicker>();
    const file = await pngFile(200, 100);
    const view = (ratios: [number, number][]) => (
      <Box>
        <FocalPicker ref={ref} file={file} ratios={ratios} />
      </Box>
    );
    const screen = await render(
      view([
        [3, 2],
        [1, 1],
      ]),
    );
    const picker = ref.current;
    if (picker === null) throw new Error("the ref did not reach the element");
    const previews = () => [...(picker.shadowRoot?.querySelectorAll('[part~="preview"]') ?? [])];
    const before = previews();
    expect(before).toHaveLength(2);

    // A parent re-rendering on every onInput hands over a new array each time.
    await screen.rerender(
      view([
        [3, 2],
        [1, 1],
      ]),
    );
    expect(previews()).toEqual(before);
    previews().forEach((preview, index) => {
      expect(preview).toBe(before[index]);
    });

    await screen.rerender(view([[16, 9]]));
    expect(previews()).toHaveLength(1);
  });

  test("unmounting revokes the object URL the element made for the file", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const created = vi.spyOn(URL, "createObjectURL");
    const file = await pngFile(200, 100);
    const screen = await render(
      <Box>
        <FocalPicker file={file} />
      </Box>,
    );
    await expect.poll(() => created.mock.results.length).toBe(1);
    const url = created.mock.results[0]?.value;
    expect(revoke).not.toHaveBeenCalled();

    await screen.unmount();

    expect(revoke).toHaveBeenCalledWith(url);
  });
});

describe("FocalPicker, controlled", () => {
  test("a value moves the marker, and a new value moves it again", async () => {
    const ref = createRef<DynjandiFocalPicker>();
    const file = await pngFile(200, 100);
    const screen = await render(
      <Box>
        <FocalPicker ref={ref} file={file} value={{ x: 0.25, y: 0.75 }} />
      </Box>,
    );
    const picker = ref.current;
    if (picker === null) throw new Error("the ref did not reach the element");
    await loaded(picker);
    expect(markerFraction(picker).x).toBeCloseTo(0.25, 2);
    expect(markerFraction(picker).y).toBeCloseTo(0.75, 2);

    await screen.rerender(
      <Box>
        <FocalPicker ref={ref} file={file} value={{ x: 0.5, y: 0.1 }} />
      </Box>,
    );

    expect(markerFraction(picker).x).toBeCloseTo(0.5, 2);
    expect(markerFraction(picker).y).toBeCloseTo(0.1, 2);

    // A controlled null clears a chosen point (the hand-off calls setFocal(null) when a new file is picked).
    await screen.rerender(
      <Box>
        <FocalPicker ref={ref} file={file} value={null} />
      </Box>,
    );

    expect(part(picker, "marker").checkVisibility()).toBe(false);
    expect(picker.value).toBeNull();
  });

  test("a null value shows no marker", async () => {
    const picker = await show({ value: null });
    expect(part(picker, "marker").checkVisibility()).toBe(false);
  });

  test("when the parent does not accept a change, the picker goes back to its value", async () => {
    const onChange = vi.fn();
    const picker = await show({ value: { x: 0.25, y: 0.75 }, onChange });

    // 300 of 400 is 0.75; 50 of 200 is 0.25.
    await userEvent.click(part(picker, "image"), { position: { x: 300, y: 50 } });

    expect(onChange).toHaveBeenCalledWith({ x: 0.75, y: 0.25 });
    expect(markerFraction(picker).x).toBeCloseTo(0.25, 2);
    expect(markerFraction(picker).y).toBeCloseTo(0.75, 2);
    expect(picker.value).toEqual({ x: 0.25, y: 0.75 });
  });

  test("when the parent passes the change back, the picker keeps it", async () => {
    const seen: FocalPoint[] = [];
    const file = await pngFile(200, 100);
    function Parent(): ReactElement {
      const [point, setPoint] = useState<FocalPoint | null>(null);
      return (
        <Box>
          <FocalPicker
            ref={ref}
            file={file}
            value={point}
            onChange={(next) => {
              seen.push(next);
              setPoint(next);
            }}
          />
        </Box>
      );
    }
    const ref = createRef<DynjandiFocalPicker>();
    await render(<Parent />);
    const picker = ref.current;
    if (picker === null) throw new Error("the ref did not reach the element");
    await loaded(picker);

    // 200 of 400 is 0.5; 50 of 200 is 0.25.
    await userEvent.click(part(picker, "image"), { position: { x: 200, y: 50 } });

    expect(seen).toEqual([{ x: 0.5, y: 0.25 }]);
    await expect.poll(() => markerFraction(picker).x).toBeCloseTo(0.5, 2);
    expect(markerFraction(picker).y).toBeCloseTo(0.25, 2);
  });
});
