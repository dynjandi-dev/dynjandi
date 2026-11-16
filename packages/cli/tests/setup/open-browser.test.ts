import { describe, expect, it } from "vitest";
import { openBrowser, openerCommand } from "../../src/setup/open-browser.js";
import { fakeOpener } from "../support/stub-management.js";

// D18 step 2 names the three commands: `open <url>` on macOS, `rundll32 url.dll,FileProtocolHandler <url>` on
// Windows, `xdg-open <url>` elsewhere. Each runs through `spawn` with an argument array, no shell, detached and silent.

const URL_OK = "https://app.dynjandi.dev/device?user_code=ABCD-EFGH";

describe("the opener's argument vector", () => {
  it.each([
    ["darwin", "open", [URL_OK]],
    ["win32", "rundll32", ["url.dll,FileProtocolHandler", URL_OK]],
    ["linux", "xdg-open", [URL_OK]],
    ["freebsd", "xdg-open", [URL_OK]],
  ] as const)("on %s runs %s", (platform, command, args) => {
    const opener = fakeOpener();
    expect(openBrowser(URL_OK, { spawn: opener.spawn, platform })).toBe(true);
    expect(opener.calls).toEqual([
      { command, args, options: { stdio: "ignore", detached: true, windowsHide: true } },
    ]);
    expect(opener.state.unrefs).toBe(1);
  });

  it("is a pure function of the URL and the system", () => {
    expect(openerCommand(URL_OK, "darwin")).toEqual({ command: "open", args: [URL_OK] });
  });

  it("never asks for a shell", () => {
    const opener = fakeOpener();
    openBrowser(URL_OK, { spawn: opener.spawn, platform: "linux" });
    expect(JSON.stringify(opener.calls[0]?.options)).not.toContain("shell");
  });
});

describe("an opener that fails changes nothing", () => {
  it("swallows a spawn that throws", () => {
    const opener = fakeOpener("throws");
    expect(openBrowser(URL_OK, { spawn: opener.spawn, platform: "linux" })).toBe(false);
  });

  it("swallows an error the child reports later, as a missing xdg-open does", () => {
    const opener = fakeOpener("error-event");
    expect(openBrowser(URL_OK, { spawn: opener.spawn, platform: "linux" })).toBe(true);
    expect(opener.state.errorListeners).toBe(1);
  });
});

describe("an address that is not on the management origin is refused (D18)", () => {
  it.each([
    "https://evil.example/device",
    "http://app.dynjandi.dev/device",
    "https://app.dynjandi.dev@evil.example/",
    "https://user:pw@app.dynjandi.dev/device",
    "https://app.dynjandi.dev.evil.example/",
    "https://app.dynjandi.dev:8443/device",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "-a Calculator",
    "",
  ])("%j: nothing is opened", (url) => {
    const opener = fakeOpener();
    expect(openBrowser(url, { spawn: opener.spawn, platform: "darwin" })).toBe(false);
    expect(opener.calls).toEqual([]);
  });
});
