import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { startStubRenderer } from "./support/stub-renderer.js";

// Expected values come from the plan and from POSIX, never from the code under test:
// - D18: the command gets DYNJANDI_ORIGIN (`http://127.0.0.1:<port>`) and DYNJANDI_PROJECT_KEY (the key `dev`
//   accepts); `dev` exits with the command's code, or 128 + n for signal n; SIGINT/SIGTERM sent to `dev` reach
//   the command; under `--` the port is a free one, stdout holds only the command's output (so the ready line
//   is on stderr) and there is no per-request line.
// - 128 + n is the POSIX shell convention (SIGKILL is 9, so 137; SIGTERM is 15, so 143; signal numbers per
//   signal(7)).
// - D19: --json is one parseable object {origin, projectKey (only when default), dataDir, renderer}, where
//   renderer is {kind:"none"} or {kind:"url", url}; a --project-key value is in no output (D1, D12).
// - D20: GET /health answers 200 {ok:true, service:"dynjandi-dev", ...}.
// The command is `node -e <script>`: the arguments are an array, so no shell reads them.
const NODE = process.execPath;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dynjandi-run-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (text: string) => void out.push(text),
      stderr: (text: string) => void err.push(text),
    },
  };
}

function dev(...extra: string[]): string[] {
  const renderer = extra.includes("--renderer-url") ? [] : ["--no-renderer"];
  return ["dev", ...renderer, "--data-dir", join(dir, "data"), ...extra];
}

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((done) => setTimeout(done, 10));
    }
  }
  throw new Error(`${path} never appeared`);
}

// Writes the two variables and what GET <origin>/health answers to the file named by argv[1].
const REPORT = `
const { writeFileSync } = require("node:fs");
(async () => {
  const origin = process.env.DYNJANDI_ORIGIN;
  const health = await fetch(origin + "/health");
  writeFileSync(process.argv[1], JSON.stringify({
    origin, key: process.env.DYNJANDI_PROJECT_KEY, status: health.status, body: await health.json(),
  }));
})();
`;

describe("dev -- <command>", () => {
  it("gives the command both variables, and the origin answers /health", async () => {
    const report = join(dir, "report.json");
    const { out, err, io } = capture();
    const exit = await main(dev("--", NODE, "-e", REPORT, report), io);

    const seen = JSON.parse(await readFile(report, "utf8")) as {
      origin: string;
      key: string;
      status: number;
      body: { ok: boolean; service: string };
    };
    expect(exit).toBe(0);
    expect(seen.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(seen.key).toBe("dynjandi-local"); // D1's default key
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ ok: true, service: "dynjandi-dev" });
    // Port 0 under `--` (D18): the origin names a port that is not the 4600 default.
    expect(new URL(seen.origin).port).not.toBe("4600");
    // D18: stdout is the command's alone, so `dev` wrote nothing there; the ready line is on stderr, and the
    // /health request the command made left no per-request line.
    expect(out).toEqual([]);
    expect(err.join("")).toContain(`Dynjandi dev server ready at ${seen.origin}`);
    expect(err.join("")).not.toContain("GET /health");
    // The server is stopped once the command has exited.
    await expect(fetch(`${seen.origin}/health`)).rejects.toThrow();
  });

  it("passes a --project-key value to the command and prints it nowhere", async () => {
    const report = join(dir, "report.json");
    const { out, err, io } = capture();
    expect(
      await main(dev("--project-key", "very-secret", "--", NODE, "-e", REPORT, report), io),
    ).toBe(0);
    expect(JSON.parse(await readFile(report, "utf8")).key).toBe("very-secret");
    expect(out.join("") + err.join("")).not.toContain("very-secret");
  });

  it.each([0, 3, 42])("exits with the command's code %i", async (code) => {
    const { io } = capture();
    expect(await main(dev("--", NODE, "-e", `process.exit(${code})`), io)).toBe(code);
  });

  // POSIX: a command ended by signal n makes the shell report 128 + n.
  it.each([
    ["SIGKILL", 137],
    ["SIGTERM", 143],
  ])("exits 128 + n when the command is killed by %s", async (signal, expected) => {
    const { io } = capture();
    expect(await main(dev("--", NODE, "-e", `process.kill(process.pid, "${signal}")`), io)).toBe(
      expected,
    );
  });

  // D18: outside a terminal, SIGINT and SIGTERM sent to dev both reach the command.
  it.each(["SIGINT", "SIGTERM"] as const)(
    "reaches the command with %s sent to dev outside a terminal, and stops the server",
    async (signal) => {
      const marker = join(dir, "marker");
      const got = join(dir, "got");
      // Writes its origin, then waits; on the signal it records that and exits 5 (its own choice, which dev passes on).
      const script = `
      const { writeFileSync } = require("node:fs");
      process.on(${JSON.stringify(signal)}, () => { writeFileSync(${JSON.stringify(got)}, ${JSON.stringify(signal)}); process.exit(5); });
      writeFileSync(${JSON.stringify(marker)}, process.env.DYNJANDI_ORIGIN);
      setInterval(() => {}, 1000);
    `;
      const { io } = capture();
      const exit = main(dev("--", NODE, "-e", script), io, { terminal: false });
      const origin = await waitForFile(marker);
      expect((await fetch(`${origin}/health`)).status).toBe(200);

      process.emit(signal, signal);

      expect(await exit).toBe(5);
      expect(await readFile(got, "utf8")).toBe(signal);
      await expect(fetch(`${origin}/health`)).rejects.toThrow();
    },
  );

  // In a terminal, a Ctrl-C's SIGINT reaches the command from the terminal itself (POSIX: the terminal signals
  // its whole foreground process group), so dev sending it again would deliver it twice. dev does not forward
  // it, and stays up until the command exits; SIGTERM is still forwarded.
  it("in a terminal, does not send SIGINT on to the command, and still forwards SIGTERM", async () => {
    const marker = join(dir, "marker");
    const got = join(dir, "got");
    // Appends each signal it receives; exits 6 on SIGTERM.
    const script = `
      const { appendFileSync, writeFileSync } = require("node:fs");
      process.on("SIGINT", () => appendFileSync(${JSON.stringify(got)}, "SIGINT "));
      process.on("SIGTERM", () => { appendFileSync(${JSON.stringify(got)}, "SIGTERM "); process.exit(6); });
      writeFileSync(${JSON.stringify(marker)}, process.env.DYNJANDI_ORIGIN);
      setInterval(() => {}, 1000);
    `;
    const { io } = capture();
    const exit = main(dev("--", NODE, "-e", script), io, { terminal: true });
    const origin = await waitForFile(marker);

    process.emit("SIGINT", "SIGINT");
    await new Promise((done) => setTimeout(done, 200));
    // dev is still up, serving the command, and the command was not sent the SIGINT.
    expect((await fetch(`${origin}/health`)).status).toBe(200);

    process.emit("SIGTERM", "SIGTERM");

    expect(await exit).toBe(6);
    expect(await readFile(got, "utf8")).toBe("SIGTERM ");
    await expect(fetch(`${origin}/health`)).rejects.toThrow();
  });

  it("exits 1 when the command cannot be started", async () => {
    const { err, io } = capture();
    expect(await main(dev("--", join(dir, "no-such-command")), io)).toBe(1);
    expect(err.join("")).toContain("no-such-command");
    expect(err.join("")).toContain("installed and on PATH");
  });

  it("exits 2 with no command after --", async () => {
    const { out, err, io } = capture();
    expect(await main(dev("--"), io)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("")).toContain("must be followed by the command");
  });

  // No shell reads the arguments: ";", "$HOME" and spaces arrive as one literal argument (D18, "no shell").
  it("passes arguments verbatim, with no shell", async () => {
    const report = join(dir, "argv.json");
    const { io } = capture();
    const script = `require("node:fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))`;
    expect(await main(dev("--", NODE, "-e", script, report, "a;b $HOME", "*"), io)).toBe(0);
    expect(JSON.parse(await readFile(report, "utf8"))).toEqual(["a;b $HOME", "*"]);
  });
});

describe("dev --json", () => {
  async function runJson(...extra: string[]) {
    const { out, err, io } = capture();
    const exit = main(dev("--port", "0", "--json", ...extra), io);
    for (let attempt = 0; attempt < 500 && out.length === 0; attempt += 1) {
      await new Promise((done) => setTimeout(done, 10));
    }
    process.emit("SIGTERM", "SIGTERM");
    await exit;
    return { out: out.join(""), err: err.join("") };
  }

  it("prints one JSON object with D19's fields and the default key", async () => {
    const { out } = await runJson();
    expect(out.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({
      origin: expect.stringMatching(/^http:\/\/127\.0\.0\.1:[1-9]\d*$/),
      projectKey: "dynjandi-local",
      dataDir: join(dir, "data"),
      renderer: { kind: "none" },
    });
  });

  it("names a renderer URL, and omits and never prints a --project-key value", async () => {
    const stub = await startStubRenderer();
    const { out, err } = await runJson("--renderer-url", stub.url, "--project-key", "very-secret");
    await stub.close();
    const parsed = JSON.parse(out);
    expect(parsed.renderer).toEqual({ kind: "url", url: stub.url });
    expect("projectKey" in parsed).toBe(false);
    expect(out + err).not.toContain("very-secret");
  });

  it("goes to stderr under --, leaving stdout empty", async () => {
    const { out, err, io } = capture();
    await writeFile(join(dir, "noop.js"), "");
    expect(await main(dev("--json", "--", NODE, join(dir, "noop.js")), io)).toBe(0);
    expect(out).toEqual([]);
    expect(JSON.parse(err.join("")).renderer).toEqual({ kind: "none" });
  });
});
