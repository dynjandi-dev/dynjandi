import { afterEach, expect, test } from "vitest";

// Proves the browser project measures real layout, which happy-dom and jsdom cannot: they return a
// zero-sized rectangle for every element. The expected size is the one written into the style below.

afterEach(() => {
  document.body.replaceChildren();
});

test("measures an element at the size its style gives it", () => {
  const box = document.createElement("div");
  box.style.cssText = "position: absolute; left: 10px; top: 20px; width: 123px; height: 45px;";
  document.body.append(box);

  const rect = box.getBoundingClientRect();

  expect(rect.width).toBe(123);
  expect(rect.height).toBe(45);
  expect(rect.left).toBe(10);
  expect(rect.top).toBe(20);
});

test("lays an unsized block out against its container", () => {
  const container = document.createElement("div");
  container.style.cssText = "position: absolute; left: 0; top: 0; width: 200px;";
  const child = document.createElement("div");
  child.style.height = "30px";
  container.append(child);
  document.body.append(container);

  const rect = child.getBoundingClientRect();

  expect(rect.width).toBe(200);
  expect(rect.height).toBe(30);
});
