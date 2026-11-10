import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { startServer } from "../src/dev/server.js";

// Expected values come from the plan: GET /health is 200 {"ok":true} (section 4.2); an unknown path is 404
// {"error":"Not found"}; OPTIONS and every method but POST /upload and GET are 405 {"error":"Method not allowed"}
// (D8; POST /upload is not built in this phase, so it is a 405 here too); one stderr line per request holding
// method, path and status (D12); the server binds 127.0.0.1 only (D7); API answers carry Cache-Control: no-store
// and a JSON content type (section 4.2).

// Uploads and files are tested in api.test.ts; these tests only need somewhere to keep them.
const DATA_DIR = mkdtempSync(join(tmpdir(), "dynjandi-server-"));
const SERVER = { dataDir: DATA_DIR, projectKey: "dynjandi-local", maxFileSize: 1000 };

describe("startServer", () => {
  let logs: string[];
  let running: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    logs = [];
    running = await startServer({ port: 0, ...SERVER, log: (line) => void logs.push(line) });
  });

  afterEach(async () => {
    await running.close();
  });

  it("returns a loopback URL with the port it took", () => {
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(new URL(running.url).port).not.toBe("0");
  });

  it("answers GET /health with 200 {ok: true}", async () => {
    const response = await fetch(`${running.url}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("answers an unknown path with 404 Not found", async () => {
    const response = await fetch(`${running.url}/nothing/here`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "answers %s with 405 Method not allowed",
    async (method) => {
      const response = await fetch(`${running.url}/health`, { method });
      expect(response.status).toBe(405);
      expect(await response.json()).toEqual({ error: "Method not allowed" });
    },
  );

  it("sends no CORS headers", async () => {
    const response = await fetch(`${running.url}/health`, {
      headers: { Origin: "http://app.test" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("logs one line per request with method, path and status, and no header", async () => {
    await fetch(`${running.url}/health`, { headers: { "X-Project-Key": "secret-value" } });
    await fetch(`${running.url}/missing`);
    await fetch(`${running.url}/health`, { method: "DELETE" });
    expect(logs).toEqual(["GET /health 200", "GET /missing 404", "DELETE /health 405"]);
  });

  it("stops listening when closed", async () => {
    await running.close();
    await expect(fetch(`${running.url}/health`)).rejects.toThrow();
    running = await startServer({ port: 0, ...SERVER });
  });
});

describe("startServer when the port is taken", () => {
  it("rejects with a message naming the port", async () => {
    const blocker = createServer();
    await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      await expect(startServer({ port, ...SERVER })).rejects.toThrow(String(port));
      await expect(startServer({ port, ...SERVER })).rejects.toThrow("--port 0 for a free one");
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });
});

describe("main dev", () => {
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

  async function waitForReadyLine(out: string[]): Promise<string> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (out.length > 0) return out.join("");
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error("the ready line never appeared");
  }

  // D12: stdout holds the ready line (origin, the key if default, the data directory, the renderer);
  // --port 0 prints the port actually taken; SIGTERM and SIGINT exit 0.
  it.each(["SIGTERM", "SIGINT"] as const)(
    "prints the ready line and exits 0 on %s",
    async (signal) => {
      const { out, err, io } = capture();
      const exit = main(
        ["dev", "--port", "0", "--no-renderer", "--data-dir", `${DATA_DIR}/ready`],
        io,
      );
      const ready = await waitForReadyLine(out);

      const origin = /http:\/\/127\.0\.0\.1:(\d+)/.exec(ready);
      expect(origin).not.toBeNull();
      expect(Number(origin?.[1])).toBeGreaterThan(0);
      expect(ready.trimEnd().split("\n")).toHaveLength(1);
      expect(ready).toContain("dynjandi-local");
      expect(ready).toContain(`${DATA_DIR}/ready`);
      expect(ready).toContain("none");

      const response = await fetch(`${origin?.[0]}/health`);
      expect(await response.json()).toEqual({ ok: true });
      expect(err.join("")).toContain("GET /health 200");

      process.emit(signal, signal);
      expect(await exit).toBe(0);
      await expect(fetch(`${origin?.[0]}/health`)).rejects.toThrow();
    },
  );

  it("never prints a --project-key value", async () => {
    const { out, err, io } = capture();
    const exit = main(
      [
        "dev",
        "--port",
        "0",
        "--no-renderer",
        "--data-dir",
        DATA_DIR,
        "--project-key",
        "very-secret",
      ],
      io,
    );
    await waitForReadyLine(out);
    process.emit("SIGTERM", "SIGTERM");
    await exit;
    expect(out.join("") + err.join("")).not.toContain("very-secret");
  });

  it("exits 1 with the reason on stderr and empty stdout when the port is taken", async () => {
    const blocker = createServer();
    await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      const { out, err, io } = capture();
      expect(
        await main(["dev", "--port", String(port), "--no-renderer", "--data-dir", DATA_DIR], io),
      ).toBe(1);
      expect(out).toEqual([]);
      expect(err.join("")).toContain(String(port));
      expect(err.join("")).toContain("choose another with --port <n>");
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });
});
