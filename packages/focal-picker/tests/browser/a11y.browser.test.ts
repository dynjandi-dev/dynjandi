import axe from "axe-core";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import type { DynjandiFocalPicker } from "../../src/element.js";
import { mount, part } from "./support.js";

// "No violations" is axe's own verdict, an external reference: nothing here derives an expectation from the
// element. Every state is run against axe's WCAG 2.0/2.1/2.2 A and AA rule tags plus its best practices.

afterEach(() => {
  document.body.replaceChildren();
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** Axe over one element, shadow DOM included, reported as one readable string per violation. */
async function violations(picker: DynjandiFocalPicker): Promise<string[]> {
  const results = await axe.run(picker, { runOnly: { type: "tag", values: TAGS } });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" >> ")).join(", ")})`,
  );
}

test("axe looks inside the shadow root: it checks both inputs' labels", async () => {
  const picker = await mount({ width: 400, image: [800, 400] });
  const results = await axe.run(picker, { runOnly: { type: "rule", values: ["label"] } });
  const checked = results.passes.flatMap((pass) => pass.nodes.map((node) => node.html));
  expect(checked).toHaveLength(2);
  expect(checked.every((html) => html.startsWith("<input"))).toBe(true);
});

describe("axe-core finds no violations", () => {
  test("empty: no image, no point", async () => {
    const picker = await mount({ width: 400 });
    expect(await violations(picker)).toEqual([]);
  });

  test("with a point: image loaded, previews shown", async () => {
    const picker = await mount({ width: 400, image: [800, 400] });
    picker.value = { x: 0.3, y: 0.6 };
    expect(part(picker, "previews").hidden).toBe(false);
    expect(await violations(picker)).toEqual([]);
  });

  test("with an image and no point yet", async () => {
    const picker = await mount({ width: 400, image: [800, 400] });
    expect(await violations(picker)).toEqual([]);
  });

  test("with an error: the image cannot be read", async () => {
    const picker = await mount({ width: 400 });
    picker.file = new Blob(["this is not an image"], { type: "image/png" });
    await expect.poll(() => part(picker, "error").hidden).toBe(false);
    expect(await violations(picker)).toEqual([]);
  });

  test("at a narrow viewport", async () => {
    await page.viewport(320, 640);
    try {
      const picker = await mount({ image: [800, 400] });
      picker.value = { x: 0.9, y: 0.1 };
      expect(await violations(picker)).toEqual([]);
    } finally {
      await page.viewport(414, 896);
    }
  });
});
