import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SetupFailure } from "../../src/errors.js";
import { createDeviceClient } from "../../src/setup/api.js";
import { ApprovalPending, type ApprovalSeams, approve } from "../../src/setup/approval.js";
import { openBrowser } from "../../src/setup/open-browser.js";
import {
  APPROVAL_URL,
  CLI_TOKEN,
  DEVICE_CODE,
  documentDeviceCode,
  fakeClock,
  fakeOpener,
  playApproval,
  playPolls,
  startStubManagement,
  USER_CODE,
} from "../support/stub-management.js";

// Expected values come from D18 and the document at version 0.6.0 (`POST /api/device/code`, `POST /api/device/token`),
// worked out by hand, not read off the code under test:
// - the poll waits `interval` (5 s) first, and 5 s longer after each `slow_down` (RFC 8628 section 3.5);
// - a run that finds the pending file polls at once and waits up to 60 s (D18 step 4); at a terminal it waits as a
//   fresh run does (step 3), until the stored link expires, and shows the link once there is a wait;
// - the device code lives `expires_in` = 600 s; the file is mode 0600 and holds the only copy of the code;
// - `access_denied` and `expired_token` end the run with exit 3; `invalid_grant` is a dead code, also 3.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dynjandi-approval-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PENDING = () => join(dir, ".dynjandi", "setup-approval.json");
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

function harness(wait: boolean, start?: number) {
  const stub = startStubManagement();
  const clock = fakeClock(start);
  const opener = fakeOpener();
  const said: string[] = [];
  const seams: ApprovalSeams = {
    client: createDeviceClient({ fetch: stub.fetch }),
    cwd: dir,
    wait,
    now: clock.now,
    sleep: clock.sleep,
    open: (url) => void openBrowser(url, { spawn: opener.spawn, platform: "linux" }),
    say: (text) => said.push(text),
  };
  return { stub, clock, opener, said, seams };
}

const requestsOf = (h: ReturnType<typeof harness>) =>
  h.stub.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the approval to fail");
}

describe("approve with a person at the terminal (D18 step 3)", () => {
  it("shows the link and the code on stderr, opens the browser, and returns the token once approved", async () => {
    const h = harness(true);
    playApproval(h.stub, ["authorization_pending", "authorization_pending", "approved"]);

    const token = await approve(h.seams);

    expect(token.reveal()).toBe(CLI_TOKEN);
    expect(h.said[0]).toBe(
      `Approve this setup at ${APPROVAL_URL}. The page shows the code ${USER_CODE}.\n`,
    );
    expect(h.opener.calls).toEqual([
      expect.objectContaining({ command: "xdg-open", args: [APPROVAL_URL] }),
    ]);
    expect(h.clock.sleeps).toEqual([5000, 5000, 5000]);
    expect(await exists(PENDING())).toBe(false);
  });

  it("sends the client id, and no credential, on both calls", async () => {
    const h = harness(true);
    playApproval(h.stub, ["approved"]);
    await approve(h.seams);

    expect(requestsOf(h)).toEqual(["POST /api/device/code", "POST /api/device/token"]);
    const [start, poll] = h.stub.requests;
    expect(JSON.parse(start?.body ?? "")).toEqual({ client_id: "dynjandi-cli" });
    expect(JSON.parse(poll?.body ?? "")).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: DEVICE_CODE,
      client_id: "dynjandi-cli",
    });
    expect(start?.headers.get("Authorization")).toBeNull();
    expect(poll?.headers.get("Authorization")).toBeNull();
  });

  it("lengthens the wait by 5 s on each slow_down", async () => {
    const h = harness(true);
    playApproval(h.stub, ["slow_down", "slow_down", "authorization_pending", "approved"]);
    await approve(h.seams);
    // 5 s, then each slow_down adds 5 s (10 s, 15 s: doubling would give 20 s); pending leaves it at 15 s.
    expect(h.clock.sleeps).toEqual([5000, 10_000, 15_000, 15_000]);
  });

  it("follows the interval the server gives", async () => {
    const h = harness(true);
    playApproval(h.stub, ["approved"], { start: { interval: 2 } });
    await approve(h.seams);
    expect(h.clock.sleeps).toEqual([2000]);
  });

  it.each([
    ["access_denied", /approval denied/],
    ["expired_token", /link expired/],
    ["invalid_grant", /no longer valid/],
  ] as const)("%s ends the run as an auth failure", async (step, message) => {
    const h = harness(true);
    playApproval(h.stub, [step]);
    const error = await failureOf(approve(h.seams));
    expect(error).toBeInstanceOf(SetupFailure);
    expect((error as SetupFailure).kind).toBe("auth");
    expect((error as SetupFailure).message).toMatch(message);
    expect(await exists(PENDING())).toBe(false);
  });

  it("gives up as expired when the link's 600 s pass without an answer", async () => {
    const h = harness(true);
    playApproval(h.stub, []);
    for (let i = 0; i < 130; i += 1) playPolls(h.stub, ["authorization_pending"]);
    const error = await failureOf(approve(h.seams));
    expect((error as SetupFailure).kind).toBe("auth");
    expect((error as SetupFailure).message).toMatch(/link expired/);
    // 120 waits of 5 s reach 600 s; the next 5 s would pass the deadline.
    expect(h.clock.elapsed()).toBe(600_000);
  });
});

describe("approve with nobody at the terminal (D18 step 4)", () => {
  it("saves the device code at mode 0600 and exits pending without polling", async () => {
    const h = harness(false);
    playApproval(h.stub, []);

    const error = await failureOf(approve(h.seams));

    expect(error).toBeInstanceOf(ApprovalPending);
    const pending = error as ApprovalPending;
    expect(pending.kind).toBe("pending");
    expect(pending.approval).toEqual({
      url: APPROVAL_URL,
      code: USER_CODE,
      expiresAt: new Date(h.clock.start + 600_000).toISOString(),
    });
    expect(pending.message).toBe(
      `Open ${APPROVAL_URL} and approve code ${USER_CODE}, then run this command again. The link expires in 10 minutes.`,
    );
    expect(requestsOf(h)).toEqual(["POST /api/device/code"]);
    expect(h.said).toEqual([]);
    expect(h.opener.calls).toHaveLength(1);

    expect(JSON.parse(await readFile(PENDING(), "utf8"))).toMatchObject({
      deviceCode: DEVICE_CODE,
    });
    if (process.platform !== "win32") {
      expect((await stat(PENDING())).mode & 0o777).toBe(0o600);
    }
    // `.dynjandi/` ignores itself, as `dev`'s data directory does.
    expect(await readFile(join(dir, ".dynjandi", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("keeps a .gitignore that is already in .dynjandi", async () => {
    const h = harness(false);
    playApproval(h.stub, []);
    await failureOf(approve(h.seams)); // creates .dynjandi
    await writeFile(join(dir, ".dynjandi", ".gitignore"), "mine\n");
    playApproval(h.stub, []);
    await rm(PENDING());
    await failureOf(approve(h.seams));
    expect(await readFile(join(dir, ".dynjandi", ".gitignore"), "utf8")).toBe("mine\n");
  });

  it("a re-run polls at once, returns the token, and deletes the file", async () => {
    const first = harness(false);
    playApproval(first.stub, []);
    await failureOf(approve(first.seams));

    const second = harness(false);
    playPolls(second.stub, ["approved"]);
    const token = await approve(second.seams);

    expect(token.reveal()).toBe(CLI_TOKEN);
    expect(requestsOf(second)).toEqual(["POST /api/device/token"]);
    expect(JSON.parse(second.stub.requests[0]?.body ?? "").device_code).toBe(DEVICE_CODE);
    expect(second.clock.sleeps).toEqual([]);
    expect(second.opener.calls).toEqual([]);
    expect(await exists(PENDING())).toBe(false);
  });

  it("a re-run that is still pending waits 60 s, then hands back the same link and keeps the file", async () => {
    const first = harness(false);
    playApproval(first.stub, []);
    await failureOf(approve(first.seams));

    const second = harness(false);
    for (let i = 0; i < 20; i += 1) playPolls(second.stub, ["authorization_pending"]);
    const error = await failureOf(approve(second.seams));

    expect(error).toBeInstanceOf(ApprovalPending);
    expect((error as ApprovalPending).approval.url).toBe(APPROVAL_URL);
    expect((error as ApprovalPending).approval.code).toBe(USER_CODE);
    // Polls at 0, 5, ..., 60 s: 13 of them, and 12 waits of 5 s; a 13th wait would pass 60 s.
    expect(second.stub.requests).toHaveLength(13);
    expect(second.clock.elapsed()).toBe(60_000);
    expect(await exists(PENDING())).toBe(true);
  });

  it.each([
    ["access_denied", /approval denied/],
    ["expired_token", /link expired/],
    ["invalid_grant", /no longer valid/],
  ] as const)(
    "a re-run answered %s exits as an auth failure and deletes the file",
    async (step, message) => {
      const first = harness(false);
      playApproval(first.stub, []);
      await failureOf(approve(first.seams));

      const second = harness(false);
      playPolls(second.stub, [step]);
      const error = await failureOf(approve(second.seams));

      expect((error as SetupFailure).kind).toBe("auth");
      expect((error as SetupFailure).message).toMatch(message);
      expect(await exists(PENDING())).toBe(false);
    },
  );

  it("a file that is not an approval is replaced by a new one", async () => {
    const seed = harness(false);
    playApproval(seed.stub, []);
    await failureOf(approve(seed.seams));
    await writeFile(PENDING(), "not json");

    const h = harness(false);
    playApproval(h.stub, []);
    const error = await failureOf(approve(h.seams));

    expect(error).toBeInstanceOf(ApprovalPending);
    expect(requestsOf(h)).toEqual(["POST /api/device/code"]);
    expect(JSON.parse(await readFile(PENDING(), "utf8"))).toMatchObject({
      deviceCode: DEVICE_CODE,
    });
  });

  it.each([
    ["a code with a control character", { code: "AB\u001b[31mCD" }],
    ["a code with a bell", { code: "ABCD\u0007" }],
    ["a code of the wrong shape", { code: "AB CD" }],
    ["a code that is too long", { code: "A".repeat(33) }],
    ["an empty code", { code: "" }],
    ["a link off the approval origin", { url: "https://example.com/device" }],
    ["an expiry with a control character", { expiresAt: "Sat Nov 21 2099 (\u009b31m)" }],
    ["an expiry that is not an ISO time", { expiresAt: "Sat Nov 21 2099" }],
  ])("a pending file with %s is replaced by a new approval", async (_name, tamper) => {
    const seed = harness(false);
    playApproval(seed.stub, []);
    await failureOf(approve(seed.seams));
    const stored = JSON.parse(await readFile(PENDING(), "utf8"));
    await writeFile(PENDING(), JSON.stringify({ ...stored, ...tamper }));

    const h = harness(false);
    playApproval(h.stub, []);
    const error = await failureOf(approve(h.seams));

    expect(error).toBeInstanceOf(ApprovalPending);
    expect(requestsOf(h)).toEqual(["POST /api/device/code"]);
    expect((error as ApprovalPending).approval).toMatchObject({
      url: APPROVAL_URL,
      code: USER_CODE,
    });
  });

  it("prints the normalised link of a stored one, not the raw string", async () => {
    const seed = harness(false);
    playApproval(seed.stub, []);
    await failureOf(approve(seed.seams));
    const stored = JSON.parse(await readFile(PENDING(), "utf8"));
    // A tab and a newline inside the link are dropped by URL parsing; the raw text would carry them to the terminal.
    await writeFile(
      PENDING(),
      JSON.stringify({ ...stored, url: "https://app.dynjandi.dev/dev\nice?user_code=\tABCD-EFGH" }),
    );

    const h = harness(false);
    for (let i = 0; i < 20; i += 1) playPolls(h.stub, ["authorization_pending"]);
    const error = await failureOf(approve(h.seams));

    expect(error).toBeInstanceOf(ApprovalPending);
    const { url } = (error as ApprovalPending).approval;
    expect(url).toBe("https://app.dynjandi.dev/device?user_code=ABCD-EFGH");
    expect([...(error as ApprovalPending).message].some((c) => c.charCodeAt(0) < 0x20)).toBe(false);
  });
});

describe("approve, resumed at a terminal (D18 step 3 for a run that finds the file)", () => {
  it("a re-run at a terminal that finds it approved says nothing and returns the token", async () => {
    const first = harness(false);
    playApproval(first.stub, []);
    await failureOf(approve(first.seams));

    const second = harness(true);
    playPolls(second.stub, ["approved"]);
    const token = await approve(second.seams);

    expect(token.reveal()).toBe(CLI_TOKEN);
    expect(second.said).toEqual([]);
    expect(second.clock.sleeps).toEqual([]);
    expect(await exists(PENDING())).toBe(false);
  });

  it("a re-run at a terminal that is still pending shows the link once and waits for the person", async () => {
    const first = harness(false);
    playApproval(first.stub, []);
    await failureOf(approve(first.seams));

    // Past the 60 s a re-run without a terminal would wait.
    const second = harness(true);
    for (let i = 0; i < 30; i += 1) playPolls(second.stub, ["authorization_pending"]);
    playPolls(second.stub, ["approved"]);
    const token = await approve(second.seams);

    expect(token.reveal()).toBe(CLI_TOKEN);
    expect(second.said).toEqual([
      `Approve this setup at ${APPROVAL_URL}. The page shows the code ${USER_CODE}.\n`,
      "Waiting for approval; press Ctrl-C to stop.\n",
    ]);
    // A poll at once, then 30 waits of 5 s: 150 s.
    expect(second.clock.elapsed()).toBe(150_000);
    expect(second.opener.calls).toEqual([]);
    expect(await exists(PENDING())).toBe(false);
  });

  it("a re-run at a terminal waits until the stored link expires, then exits as expired and deletes the file", async () => {
    const first = harness(false);
    playApproval(first.stub, []);
    await failureOf(approve(first.seams));

    // Two minutes after the link was made: 480 s of its 600 are left.
    const second = harness(true, first.clock.start + 120_000);
    for (let i = 0; i < 100; i += 1) playPolls(second.stub, ["authorization_pending"]);
    const error = await failureOf(approve(second.seams));

    expect(error).not.toBeInstanceOf(ApprovalPending);
    expect((error as SetupFailure).kind).toBe("auth");
    expect((error as SetupFailure).message).toMatch(/link expired/);
    // A poll at once, then 96 waits of 5 s reach 480 s; the next would pass the link's expiry.
    expect(second.stub.requests).toHaveLength(97);
    expect(second.clock.elapsed()).toBe(480_000);
    expect(await exists(PENDING())).toBe(false);
  });
});

describe("approve and an answer that is not the document's", () => {
  it.each([
    ["an address on another host", "https://evil.example/device?user_code=ABCD-EFGH"],
    ["a plain http address", "http://app.dynjandi.dev/device"],
    ["an address with credentials in it", "https://app.dynjandi.dev@evil.example/device"],
    ["a look-alike host", "https://app.dynjandi.dev.evil.example/device"],
    ["a script", "javascript:alert(1)"],
  ])("refuses %s: nothing is opened, saved or shown", async (_name, uri) => {
    for (const wait of [true, false]) {
      const h = harness(wait);
      playApproval(h.stub, [], { start: { verification_uri_complete: uri } });
      const error = await failureOf(approve(h.seams));
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("unexpected response (status 200)");
      expect(h.opener.calls).toEqual([]);
      expect(h.said).toEqual([]);
      expect(await readdir(dir)).toEqual([]);
    }
  });

  it("refuses a user code that could carry control characters", async () => {
    const h = harness(true);
    playApproval(h.stub, [], { start: { user_code: "AB\u001b[2JCD" } });
    const error = await failureOf(approve(h.seams));
    expect((error as Error).message).toBe("unexpected response (status 200)");
  });

  it("refuses a token answer that is not a Bearer credential", async () => {
    const h = harness(true);
    playApproval(h.stub, ["approved"], { token: { token_type: "mac" } });
    const error = await failureOf(approve(h.seams));
    expect((error as Error).message).toBe("unexpected response (status 200)");
  });

  it("does not take a document that is missing a field", async () => {
    const h = harness(true);
    const { interval: _interval, ...partial } = documentDeviceCode();
    h.stub.answer("POST", "/api/device/code", { kind: "response", status: 200, body: partial });
    const error = await failureOf(approve(h.seams));
    expect((error as Error).message).toBe("unexpected response (status 200)");
  });
});
