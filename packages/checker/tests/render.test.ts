// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from "vitest";
import { checkUploadcareUrl } from "../src/check.js";
import { renderResult } from "../src/render.js";

const ID = "5c4e2f3a-0b1d-4e6f-8a9b-1c2d3e4f5a6b";
const ORIGIN = "https://cdn.dynjandi.dev/";

let section: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  section = document.createElement("section");
  document.body.append(section);
});

function render(path: string): void {
  renderResult(section, checkUploadcareUrl(`https://ucarecdn.com/${ID}/${path}`));
}

describe("untrusted text (plan Constraint 3, security/validation.md)", () => {
  test("a pasted <img onerror> shows as text and creates no element", () => {
    render("-/<img src=x onerror=alert(1)>/");
    expect(section.querySelector("img")).toBeNull();
    expect(section.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(section.querySelector("[onerror]")).toBeNull();
  });

  test("markup beside a supported operation stays text, and the only link is the Dynjandi URL", () => {
    render("-/format/webp/-/<script>alert(1)</script>/");
    expect(section.querySelector("script")).toBeNull();
    expect(section.textContent).toContain("<script>alert(1)</script>");
    const links = [...section.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")?.startsWith(ORIGIN)).toBe(true);
  });

  test("a refusal reason is text and carries no link", () => {
    renderResult(section, checkUploadcareUrl("javascript:alert(1)"));
    expect(section.querySelectorAll("a")).toHaveLength(0);
    expect(section.textContent).toContain("Only http and https");
  });
});

describe("what a person sees (plan D6, D8)", () => {
  test("a supported URL shows the Dynjandi URL and a status word, not colour alone", () => {
    render("-/format/webp/");
    expect(section.querySelector("a")?.getAttribute("href")).toBe(`${ORIGIN}${ID}/-/format/webp/`);
    expect(section.textContent).toContain("Supported");
    expect(section.textContent).toContain("Canonical form: -/format/webp/");
  });

  test("a partly supported URL labels the second URL as not equivalent", () => {
    render("-/resize/800x600/-/blur/20/");
    expect(section.textContent).toContain("Not supported");
    expect(section.textContent).toContain("Not equivalent");
    expect(section.querySelector("a")?.getAttribute("href")).toBe(
      `${ORIGIN}${ID}/-/resize/800x600/`,
    );
  });

  test("an invalid operation says so in words", () => {
    render("-/format/auto/");
    expect(section.textContent).toContain("Invalid arguments");
    expect(section.querySelectorAll("a")).toHaveLength(0);
  });

  test("rendering again replaces the previous result", () => {
    render("-/format/webp/");
    render("-/blur/20/");
    expect(section.querySelectorAll("h2")).toHaveLength(1);
    expect(section.textContent).not.toContain("Canonical form");
  });

  test("a percent-encoded name is shown decoded", () => {
    render("-/<b>/");
    expect(section.textContent).not.toContain("%3C");
  });
});
