import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, request, Server } from "node:http";
import { isIPv6 } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { containerOrigin, planContainerAccess } from "../src/dev/containers.js";
import { startServer } from "../src/dev/server.js";

// Expected values come from the plan (#43), not from the code under test:
// - D2: the second listener is the default bridge's gateway, only when `os.networkInterfaces()` lists it; the
//   fixture is Docker 29.9.2's `docker network inspect bridge` output on 2026-11-12:
//   [{"Subnet":"172.17.0.0/16","Gateway":"172.17.0.1"}]. Never 0.0.0.0 or ::, which reach the LAN.
// - D3: the container origin is http://<gateway>:<port> where the gateway is bound, and
//   http://host.docker.internal:<port> otherwise (Docker Desktop, where no interface holds 172.17.0.1).
//   An IPv6 gateway is bracketed, as in a URL (RFC 3986 section 3.2.2).
// - D2: one port on both listeners; `--port 0` takes the loopback one first.
// - D5: every listener answers through the same Host check (421 for an unknown name).
// - 192.0.2.1 is TEST-NET-1 (RFC 5737): no host holds it, so the Desktop case is the same on every machine.
// - SECOND is the "second local address" the second-listener tests bind for real, so it must be one
//   os.networkInterfaces() lists: `::1` where IPv6 is on (macOS and GitHub's Ubuntu runners, checked
//   2026-11-12), otherwise this machine's first non-internal IPv4 address. A machine with neither fails the
//   Linux Engine tests on their first assertion rather than skipping them (context/verify.md).
const BRIDGE = '[{"Subnet":"172.17.0.0/16","Gateway":"172.17.0.1"}]';
const LOOPBACK = "127.0.0.1";
const NOT_LOCAL = "192.0.2.1";
const LISTED = Object.values(networkInterfaces()).flatMap((entries) => entries ?? []);
const SECOND =
  LISTED.find((entry) => entry.address === "::1")?.address ??
  LISTED.find((entry) => entry.family === "IPv4" && !entry.internal)?.address ??
  "::1";
// SECOND as a URL's host: an IPv6 address is bracketed (RFC 3986 section 3.2.2).
const SECOND_HOST = isIPv6(SECOND) ? `[${SECOND}]` : SECOND;

function gatewayOutput(gateway: string): string {
  return JSON.stringify([{ Subnet: "x", Gateway: gateway }]);
}

describe("planContainerAccess", () => {
  it("adds the gateway when this host holds it, and names it as the container origin", () => {
    const plan = planContainerAccess(BRIDGE, [LOOPBACK, "172.17.0.1", "192.168.1.5"]);
    expect(plan.addresses).toEqual([LOOPBACK, "172.17.0.1"]);
    expect(containerOrigin(plan, 4600)).toBe("http://172.17.0.1:4600");
  });

  it("listens on loopback only when the gateway is not a host address (Docker Desktop)", () => {
    const plan = planContainerAccess(BRIDGE, [LOOPBACK, "::1", "192.168.1.5"]);
    expect(plan.addresses).toEqual([LOOPBACK]);
    expect(containerOrigin(plan, 4600)).toBe("http://host.docker.internal:4600");
  });

  it("brackets an IPv6 gateway in the origin", () => {
    const plan = planContainerAccess(gatewayOutput("fd00::1"), [LOOPBACK, "fd00::1"]);
    expect(plan.addresses).toEqual([LOOPBACK, "fd00::1"]);
    expect(containerOrigin(plan, 5000)).toBe("http://[fd00::1]:5000");
  });

  it("recognises an IPv6 gateway written another way as the same address", () => {
    const plan = planContainerAccess(gatewayOutput("FD00:0:0:0:0:0:0:1"), [LOOPBACK, "fd00::1"]);
    expect(plan.addresses).toHaveLength(2);
  });

  it("skips entries without a gateway and takes the first that has one", () => {
    const output = JSON.stringify([{ Subnet: "10.0.0.0/8" }, { Gateway: "172.17.0.1" }]);
    expect(planContainerAccess(output, [LOOPBACK, "172.17.0.1"]).addresses).toEqual([
      LOOPBACK,
      "172.17.0.1",
    ]);
  });

  // An unspecified address reaches every network the machine is on, the exposure D1 and D2 rule out.
  it.each(["0.0.0.0", "::", "::0", "0:0:0:0:0:0:0:0", "::ffff:0.0.0.0"])(
    "refuses the unspecified address %s even when the host lists it",
    (gateway) => {
      expect(() =>
        planContainerAccess(gatewayOutput(gateway), [LOOPBACK, gateway, "0.0.0.0", "::"]),
      ).toThrow(/--containers.*unspecified/);
    },
  );

  it.each([
    ["a hostname", gatewayOutput("host.docker.internal")],
    ["a CIDR", gatewayOutput("172.17.0.1/16")],
    ["an empty gateway", gatewayOutput("")],
    ["a zone id", gatewayOutput("fe80::1%eth0")],
    ["a number", JSON.stringify([{ Gateway: 1 }])],
    ["no entry with a gateway", JSON.stringify([{ Subnet: "172.17.0.0/16" }])],
    ["null (no IPAM config)", "null"],
    ["an empty list", "[]"],
    ["not JSON", "garbage"],
    ["empty output", ""],
    ["a JSON object", '{"Gateway":"172.17.0.1"}'],
  ])("refuses %s with one line that names --containers", (_name, output) => {
    let message = "";
    try {
      planContainerAccess(output, [LOOPBACK, "172.17.0.1"]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("--containers");
    expect(message).not.toContain("\n");
  });
});

// The rest runs `dev` against tests/support/fake-docker.mjs, first on PATH, so no daemon is touched.
const FAKE_DOCKER = fileURLToPath(new URL("./support/fake-docker.mjs", import.meta.url));
const savedEnv = { ...process.env };
const savedPath = Object.entries(savedEnv).find(([name]) => name === "PATH")?.[1] ?? "";
let work: string;
let dockerLog: string;

// A variable key: the compiler wants bracket access for env names, and the linter wants dots for literals.
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

function dockerCalls(): string[][] {
  if (!existsSync(dockerLog)) return [];
  return readFileSync(dockerLog, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as string[]);
}

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

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(`never happened: ${what}`);
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dynjandi-containers-"));
  const bin = join(work, "bin");
  mkdirSync(bin);
  const wrapper = join(bin, "docker");
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_DOCKER}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  dockerLog = join(work, "docker.log");
  setEnv("PATH", `${bin}${delimiter}${savedPath}`);
  setEnv("FAKE_DOCKER_LOG", dockerLog);
  setEnv("FAKE_DOCKER_SCENARIO", "ok");
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(work, { recursive: true, force: true });
});

function dev(extra: string[]) {
  const captured = capture();
  const exit = main(
    ["dev", "--port", "0", "--no-renderer", "--data-dir", join(work, "data"), ...extra],
    captured.io,
  );
  return { ...captured, exit };
}

interface Ready {
  origin: string;
  containerOrigin?: string;
  [key: string]: unknown;
}

async function runUntilReady(extra: string[]) {
  const run = dev(["--json", ...extra]);
  await waitFor(() => run.out.length > 0, "the ready line");
  const ready = JSON.parse(run.out.join("")) as Ready;
  const stop = async () => {
    process.emit("SIGTERM", "SIGTERM");
    expect(await run.exit).toBe(0);
  };
  return { ...run, ready, stop };
}

function getWithHost(address: string, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: address, port, path: "/health", headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.once("error", reject);
    req.end();
  });
}

describe("dynjandi dev without --containers", () => {
  it("runs no docker command, listens on 127.0.0.1 only, and prints no container field", async () => {
    setEnv("FAKE_DOCKER_NETWORK", gatewayOutput(SECOND));
    const run = await runUntilReady([]);
    expect(dockerCalls()).toEqual([]);
    expect(run.ready.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect("containerOrigin" in run.ready).toBe(false);
    const port = Number(new URL(run.ready.origin).port);
    await expect(fetch(`http://${SECOND_HOST}:${port}/health`)).rejects.toThrow();
    await run.stop();

    const text = dev([]);
    await waitFor(() => text.out.length > 0, "the ready line");
    expect(text.out.join("")).not.toContain("containers: ");
    process.emit("SIGTERM", "SIGTERM");
    await text.exit;
  });
});

describe("dynjandi dev --containers on Docker Desktop (the gateway is not a host address)", () => {
  beforeEach(() => setEnv("FAKE_DOCKER_NETWORK", gatewayOutput(NOT_LOCAL)));

  it("asks docker once for the bridge's IPAM config, with an argument array", async () => {
    const run = await runUntilReady(["--containers"]);
    expect(dockerCalls()).toEqual([
      ["network", "inspect", "bridge", "--format", "{{json .IPAM.Config}}"],
    ]);
    await run.stop();
  });

  it("names host.docker.internal on the loopback port, and listens on loopback only", async () => {
    const run = await runUntilReady(["--containers"]);
    const port = new URL(run.ready.origin).port;
    expect(run.ready.containerOrigin).toBe(`http://host.docker.internal:${port}`);
    await expect(fetch(`http://${SECOND_HOST}:${port}/health`)).rejects.toThrow();
    await run.stop();
  });

  it("puts `containers: <origin>` first in the ready line's parentheses", async () => {
    const run = dev(["--containers"]);
    await waitFor(() => run.out.length > 0, "the ready line");
    const line = run.out.join("");
    expect(line).toMatch(
      /^Dynjandi dev server ready at http:\/\/127\.0\.0\.1:(\d+) \(containers: http:\/\/host\.docker\.internal:\1, project key: dynjandi-local, data: /,
    );
    process.emit("SIGTERM", "SIGTERM");
    await run.exit;
  });

  it("prints no --project-key value anywhere, the line and the JSON included", async () => {
    for (const json of [[], ["--json"]]) {
      const run = dev(["--containers", "--project-key", "very-secret", ...json]);
      await waitFor(() => run.out.length > 0, "the ready line");
      process.emit("SIGTERM", "SIGTERM");
      await run.exit;
      expect(run.out.join("") + run.err.join("")).not.toContain("very-secret");
    }
  });
});

describe("dynjandi dev --containers on Linux Engine (this host holds the gateway)", () => {
  // The gateway is an address this machine really lists, so the second listener is a real bind.
  it("serves the same port on loopback and on the gateway, and names the gateway as the origin", async () => {
    expect(
      LISTED.map((entry) => entry.address),
      "this machine lists neither ::1 nor a non-internal IPv4 address; see context/verify.md",
    ).toContain(SECOND);
    setEnv("FAKE_DOCKER_NETWORK", gatewayOutput(SECOND));
    const run = await runUntilReady(["--containers"]);
    const port = Number(new URL(run.ready.origin).port);
    expect(run.ready.containerOrigin).toBe(`http://${SECOND_HOST}:${port}`);

    for (const base of [run.ready.origin, run.ready.containerOrigin ?? ""]) {
      const response = await fetch(`${base}/health`);
      expect(response.status).toBe(200);
    }
    // D5: the second listener is behind the same Host check.
    expect(await getWithHost(SECOND, port, "evil.example")).toBe(421);
    expect(await getWithHost(LOOPBACK, port, "evil.example")).toBe(421);

    await run.stop();
    await expect(fetch(`${run.ready.origin}/health`)).rejects.toThrow();
    await expect(fetch(`http://${SECOND_HOST}:${port}/health`)).rejects.toThrow();
  });

  it("stops both listeners when startServer's close is called", async () => {
    setEnv("FAKE_DOCKER_NETWORK", gatewayOutput(SECOND));
    const running = await startServer({
      port: 0,
      dataDir: join(work, "data"),
      projectKey: "dynjandi-local",
      maxFileSize: 1000,
      renderer: { kind: "none" },
      containers: true,
    });
    const port = new URL(running.url).port;
    expect(running.containerOrigin).toBe(`http://${SECOND_HOST}:${port}`);
    await running.close();
    await expect(fetch(`http://${LOOPBACK}:${port}/health`)).rejects.toThrow();
    await expect(fetch(`http://${SECOND_HOST}:${port}/health`)).rejects.toThrow();
  });

  it("fails naming the port, and leaves nothing listening, when the gateway's port is taken", async () => {
    setEnv("FAKE_DOCKER_NETWORK", gatewayOutput(SECOND));
    const blocker = createServer();
    await new Promise<void>((done) => blocker.listen(0, SECOND, done));
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      await expect(
        startServer({
          port,
          dataDir: join(work, "data"),
          projectKey: "dynjandi-local",
          maxFileSize: 1000,
          renderer: { kind: "none" },
          containers: true,
        }),
      ).rejects.toThrow(new RegExp(`${port}.*--port`));
      await expect(fetch(`http://${LOOPBACK}:${port}/health`)).rejects.toThrow();
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });

  // Under `--port 0` the port is loopback's pick, free there and perhaps taken on the gateway; which one the OS
  // picks cannot be arranged, so the gateway's `listen` is made to refuse (EADDRINUSE) the first `refusals`
  // ports it is offered, and passes the rest through to the real one.
  async function withGatewayRefusing<T>(
    refusals: number,
    run: (offered: number[]) => Promise<T>,
  ): Promise<T> {
    const offered: number[] = [];
    const real = Server.prototype.listen;
    Server.prototype.listen = function (this: Server, ...args: unknown[]) {
      if (args[1] === SECOND && offered.length < refusals) {
        offered.push(args[0] as number);
        const error = Object.assign(new Error(`listen EADDRINUSE ${SECOND}`), {
          code: "EADDRINUSE",
        });
        process.nextTick(() => this.emit("error", error));
        return this;
      }
      return real.apply(this, args as Parameters<typeof real>);
    } as typeof real;
    try {
      return await run(offered);
    } finally {
      Server.prototype.listen = real;
    }
  }

  function startOnPortZero() {
    return startServer({
      port: 0,
      dataDir: join(work, "data"),
      projectKey: "dynjandi-local",
      maxFileSize: 1000,
      renderer: { kind: "none" },
      containers: true,
    });
  }

  it("under --port 0, picks another port when the gateway's is taken", async () => {
    setEnv("FAKE_DOCKER_NETWORK", gatewayOutput(SECOND));
    await withGatewayRefusing(1, async (offered) => {
      const running = await startOnPortZero();
      const port = Number(new URL(running.url).port);
      expect(offered).toHaveLength(1);
      expect(running.containerOrigin).toBe(`http://${SECOND_HOST}:${port}`);
      for (const base of [running.url, running.containerOrigin ?? ""]) {
        expect((await fetch(`${base}/health`)).status).toBe(200);
      }
      // The refused try's loopback listener is closed, unless the OS handed the same port out again.
      if (offered[0] !== port) {
        await expect(fetch(`http://${LOOPBACK}:${offered[0]}/health`)).rejects.toThrow();
      }
      await running.close();
    });
  });

  it("under --port 0, gives up after five tries without suggesting --port 0, and leaves nothing listening", async () => {
    setEnv("FAKE_DOCKER_NETWORK", gatewayOutput(SECOND));
    await withGatewayRefusing(Number.POSITIVE_INFINITY, async (offered) => {
      let message = "";
      try {
        await startOnPortZero();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(
        `no port was free on both ${LOOPBACK} and ${SECOND} in 5 tries of --port 0; choose one with --port <n>`,
      );
      expect(offered).toHaveLength(5);
      for (const port of offered) {
        await expect(fetch(`http://${LOOPBACK}:${port}/health`)).rejects.toThrow();
      }
    });
  });
});

describe("dynjandi dev --containers failures", () => {
  async function failure(extra: string[]) {
    const run = dev(["--containers", ...extra]);
    const exit = await run.exit;
    expect(exit).toBe(1);
    expect(run.out).toEqual([]);
    const lines = run.err.join("").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    return lines[0] ?? "";
  }

  it.each(["0.0.0.0", "::"])("exits 1 when the gateway is %s", async (gateway) => {
    setEnv("FAKE_DOCKER_NETWORK", gatewayOutput(gateway));
    expect(await failure([])).toContain("unspecified");
  });

  it("exits 1 when the gateway is not an IP address", async () => {
    setEnv("FAKE_DOCKER_NETWORK", gatewayOutput("not-an-ip"));
    expect(await failure([])).toContain("--containers");
  });

  it("exits 1 when docker network inspect fails, quoting docker's first line", async () => {
    setEnv("FAKE_DOCKER_SCENARIO", "network-fails");
    const line = await failure([]);
    expect(line).toContain("Cannot connect to the Docker daemon");
    expect(line).toContain("--containers");
  });

  it("exits 1 when docker is missing, naming the way round", async () => {
    const empty = join(work, "empty");
    mkdirSync(empty);
    setEnv("PATH", empty);
    const line = await failure([]);
    expect(line).toContain("docker was not found on PATH");
    expect(line).toContain("--containers");
  });

  // A `docker` that is found but cannot be run: spawn fails with EACCES, not ENOENT. The renderer's ways round
  // (--renderer-url, --no-renderer) do not help --containers, so the line must not offer them.
  it("exits 1 when docker cannot be run, quoting the spawn error and no renderer flag", async () => {
    const unrunnable = join(work, "unrunnable");
    mkdirSync(unrunnable);
    writeFileSync(join(unrunnable, "docker"), "#!/bin/sh\n");
    chmodSync(join(unrunnable, "docker"), 0o644);
    setEnv("PATH", unrunnable);
    const line = await failure([]);
    expect(line).toContain("EACCES");
    expect(line).toContain("--containers");
    expect(line).not.toContain("--renderer-url");
    expect(line).not.toContain("--no-renderer");
  });

  it("exits 1 and runs no renderer when the plan fails", async () => {
    setEnv("FAKE_DOCKER_NETWORK", gatewayOutput("0.0.0.0"));
    const captured = capture();
    const exit = await main(
      ["dev", "--port", "0", "--containers", "--data-dir", join(work, "data")],
      captured.io,
    );
    expect(exit).toBe(1);
    expect(dockerCalls().map((call) => call[0])).toEqual(["network"]);
  });
});
