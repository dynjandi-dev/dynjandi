import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { parseDevOptions } from "../src/dev/options.js";

// Expected values come from the plan's decisions, not from the code under test:
// D7 port 4600 and 26,214,400 bytes (the renderer's MAX_INPUT_BYTES default), D1 the key `dynjandi-local`,
// D5 the data directory `.dynjandi` in the working directory, D2 Docker is the default renderer.
// The port range is a TCP port's 16 bits (RFC 9293 section 3.1): 0 asks the OS for one, 65535 is the highest.
const CWD = "/work/app";

function parse(...args: string[]) {
  return parseDevOptions(args, CWD);
}

describe("parseDevOptions --allow-host (D5)", () => {
  it("collects repeated names, lower-cased, and leaves allowHosts out without the flag", () => {
    const command = parse("--allow-host", "dev.test", "--allow-host", "App.Example");
    expect(command.kind === "run" && command.options.allowHosts).toEqual([
      "dev.test",
      "app.example",
    ]);
    const none = parse();
    expect(none.kind === "run" && "allowHosts" in none.options).toBe(false);
  });
});

describe("parseDevOptions defaults", () => {
  it("uses the decided defaults when no option is given", () => {
    expect(parse()).toEqual({
      kind: "run",
      options: {
        port: 4600,
        dataDir: resolve(CWD, ".dynjandi"),
        projectKey: "dynjandi-local",
        isDefaultProjectKey: true,
        renderer: { kind: "docker" },
        maxFileSize: 26_214_400,
        json: false,
        command: undefined,
      },
    });
  });
});

// D18: the first `--` ends the options and the rest is the command, untouched; under `--` the port is 0.
describe("parseDevOptions after --", () => {
  it("takes everything after the first -- as the command, even words that look like options", () => {
    expect(parse("--no-renderer", "--", "pnpm", "test", "--port", "1", "--", "x")).toMatchObject({
      options: { command: ["pnpm", "test", "--port", "1", "--", "x"], renderer: { kind: "none" } },
    });
  });

  it("defaults --port to 0 under -- and still honours an explicit one", () => {
    expect(parse("--", "cmd")).toMatchObject({ options: { port: 0 } });
    expect(parse("--port", "4601", "--", "cmd")).toMatchObject({ options: { port: 4601 } });
  });

  it("reads --json", () => {
    expect(parse("--json")).toMatchObject({ options: { json: true } });
  });
});

describe("parseDevOptions accepted values", () => {
  it("reads --port, including 0 and 65535", () => {
    expect(parse("--port", "0")).toMatchObject({ options: { port: 0 } });
    expect(parse("--port", "65535")).toMatchObject({ options: { port: 65535 } });
    expect(parse("--port=4601")).toMatchObject({ options: { port: 4601 } });
  });

  it("resolves --data-dir against the working directory", () => {
    expect(parse("--data-dir", "images")).toMatchObject({
      options: { dataDir: resolve(CWD, "images") },
    });
    expect(parse("--data-dir", "/var/images")).toMatchObject({
      options: { dataDir: "/var/images" },
    });
  });

  it("reads --project-key and marks it as not the default", () => {
    expect(parse("--project-key", "my-key")).toMatchObject({
      options: { projectKey: "my-key", isDefaultProjectKey: false },
    });
  });

  it("reads --max-file-size", () => {
    expect(parse("--max-file-size", "1024")).toMatchObject({ options: { maxFileSize: 1024 } });
  });

  it("reads --renderer-url for http and https", () => {
    expect(parse("--renderer-url", "http://localhost:8080")).toMatchObject({
      options: { renderer: { kind: "url", url: "http://localhost:8080" } },
    });
    expect(parse("--renderer-url", "https://render.example.test")).toMatchObject({
      options: { renderer: { kind: "url", url: "https://render.example.test" } },
    });
  });

  it("reads --no-renderer", () => {
    expect(parse("--no-renderer")).toMatchObject({ options: { renderer: { kind: "none" } } });
  });

  it("answers --help with the help kind and nothing else", () => {
    expect(parse("--help")).toEqual({ kind: "help" });
  });
});

describe("parseDevOptions rejections", () => {
  // Each row is a usage error; the message must name the option so the person can fix it.
  const bad: [string[], RegExp][] = [
    [["--port", "65536"], /--port/],
    [["--port", "-1"], /--port/],
    [["--port", "1.5"], /--port/],
    [["--port", "abc"], /--port/],
    [["--port", ""], /--port/],
    [["--port"], /--port/],
    [["--max-file-size", "0"], /--max-file-size/],
    [["--max-file-size", "-5"], /--max-file-size/],
    [["--max-file-size", "1e3"], /--max-file-size/],
    [["--max-file-size", "ten"], /--max-file-size/],
    [["--project-key", ""], /--project-key/],
    [["--data-dir", ""], /--data-dir/],
    [["--renderer-url", "localhost:8080"], /--renderer-url/],
    [["--renderer-url", "ftp://example.test"], /--renderer-url/],
    [["--renderer-url", "not a url"], /--renderer-url/],
    [["--renderer-url", "http://localhost:8080", "--no-renderer"], /--no-renderer/],
    [["--host", "0.0.0.0"], /--host/],
    [["--bogus"], /--bogus/],
    [["unexpected"], /unexpected/],
  ];

  it.each(bad)("rejects %j", (args, message) => {
    expect(() => parse(...args)).toThrowError(message);
  });
});

describe("main usage errors", () => {
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

  // D12: a usage error is exit 2, the message on stderr, stdout empty.
  it.each([
    [["dev", "--bogus"]],
    [["dev", "--port", "99999"]],
    [["dev", "--renderer-url", "http://a.test", "--no-renderer"]],
    // D18: `--` with nothing after it has no command to run.
    [["dev", "--"]],
    [["dev", "--no-renderer", "--"]],
    // D5: --allow-host takes an exact DNS name.
    [["dev", "--allow-host", ""]],
    [["dev", "--allow-host", "10.0.0.1"]],
    [["dev", "--allow-host", "a:1"]],
    [["dev", "--allow-host", "*.test"]],
    [["dev", "--allow-host"]],
    [["nonsense"]],
    [[]],
  ])("exits 2 with stderr and empty stdout for %j", async (argv) => {
    const { out, err, io } = capture();
    expect(await main(argv, io)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("")).not.toBe("");
  });

  it("names the offending --allow-host value on stderr", async () => {
    const { err, io } = capture();
    await main(["dev", "--allow-host", "*.test"], io);
    expect(err.join("")).toContain(
      '--allow-host takes an exact name, not a wildcard, got "*.test"',
    );
  });

  it("lists --allow-host in the help", async () => {
    const { out, io } = capture();
    await main(["dev", "--help"], io);
    expect(out.join("")).toContain("--allow-host <name>");
  });

  it("prints dev's help on stdout and exits 0", async () => {
    const { out, err, io } = capture();
    expect(await main(["dev", "--help"], io)).toBe(0);
    expect(out.join("")).toContain("--max-file-size");
    expect(err).toEqual([]);
  });

  // D21 / the README quick start: the same three steps, written out here rather than read from DEV_HELP.
  it("prints the examples from the quick start", async () => {
    const { out, io } = capture();
    expect(await main(["dev", "--help"], io)).toBe(0);
    const help = out.join("");
    expect(help).toContain("Examples:");
    expect(help).toContain("dynjandi dev  ");
    expect(help).toContain("dynjandi dev -- pnpm test");
    expect(help).toContain(
      "createClient({ projectKey: process.env.DYNJANDI_PROJECT_KEY, origin: process.env.DYNJANDI_ORIGIN })",
    );
  });

  it("prints the top-level help on stdout and exits 0", async () => {
    const { out, io } = capture();
    expect(await main(["--help"], io)).toBe(0);
    expect(out.join("")).toContain("dev");
  });
});
