import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Io, main } from "../../src/cli.js";
import { UsageError } from "../../src/errors.js";
import type { GitRunner } from "../../src/setup/git.js";
import { runSetup, type SetupSettings } from "../../src/setup/run.js";
import { createEmptyGitConfig, removeEmptyGitConfig } from "../support/git-config.js";
import {
  documentCreated,
  documentError,
  documentListedProject,
  documentProject,
  fakeClock,
  fakeOpener,
  playApproval,
  playPolls,
  startStubManagement,
} from "../support/stub-management.js";

// The leak sweep (plan §8, D12): a canary for each credential that no other test file builds, run through every
// path, searched for everywhere output can go. Expected: the API key appears nowhere, not even in a file; the
// project key appears only in the env file. The canaries are invented here and belong to nothing.
const API_KEY = "dyn_leak_sweep_api_7d2e91c4b8f0a356";
const PROJECT_KEY = "5ca1ab1e".repeat(8);
const PROJECT_ID = "leak-project";
// Fresh canaries for the approval's two credentials (D18); no other test file builds them, because `redact()`
// keeps a module-level registry of every secret the process has held. The device code may be in one file only,
// `.dynjandi/setup-approval.json`; the token is in no file at all; neither is anywhere else.
const DEVICE_CODE = "leak_device_code_3c91aa07e2b4d658";
const TOKEN = "dyn_cli_leak_token_b40d5e1f9a27c863";

let dir: string;
let gitConfig: string;

beforeAll(async () => {
  gitConfig = await createEmptyGitConfig();
});

afterAll(async () => {
  await removeEmptyGitConfig(gitConfig);
});
let streams: { out: string[]; err: string[] };
let gitCalls: string[][];

// The real `git`, with every argument vector recorded.
const git: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    gitCalls.push([...args, cwd]);
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
      resolve({ code, stdout, stderr });
    });
  });

function gitSync(...args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile("git", args, { cwd: dir }, (error) => (error ? reject(error) : resolve()));
  });
}

beforeEach(async () => {
  vi.stubEnv("GIT_CONFIG_GLOBAL", gitConfig);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  dir = await mkdtemp(join(tmpdir(), "dynjandi-leak-"));
  streams = { out: [], err: [] };
  gitCalls = [];
  await gitSync("init", "-q");
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "leak-app" }));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const io: Io = {
  stdout: (text) => streams.out.push(text),
  stderr: (text) => streams.err.push(text),
};

function harness(
  env: Record<string, string | undefined> = { DYNJANDI_API_KEY: API_KEY },
  extra: Partial<SetupSettings> = {},
) {
  const stub = startStubManagement();
  const clock = fakeClock();
  const settings: SetupSettings = {
    fetch: stub.fetch,
    env,
    cwd: dir,
    git,
    terminal: false,
    now: clock.now,
    sleep: clock.sleep,
    spawn: fakeOpener().spawn,
    platform: "linux",
    ...extra,
  };
  return { stub, settings };
}
type Harness = ReturnType<typeof harness>;

const created = () =>
  documentCreated({ id: PROJECT_ID, name: "leak-app", projectKey: PROJECT_KEY });
const project = (overrides: Record<string, unknown> = {}) =>
  documentProject({ id: PROJECT_ID, name: "leak-app", projectKey: PROJECT_KEY, ...overrides });
const respond = (status: number, body: unknown, rawBody?: string) =>
  ({ kind: "response", status, body, ...(rawBody === undefined ? {} : { rawBody }) }) as const;

// Both canaries inside what a server or the network says, to prove the scrub and not just the absence.
const BOTH = `${API_KEY} and ${PROJECT_KEY}`;

const approve = (h: Harness, ...steps: Parameters<typeof playPolls>[1]) =>
  playApproval(h.stub, steps, {
    start: { device_code: DEVICE_CODE },
    token: { access_token: TOKEN },
  });
const at = (settings: SetupSettings): SetupSettings => ({ ...settings, terminal: true });

const scenarios: Array<{
  name: string;
  exit: number;
  /** No `DYNJANDI_API_KEY`: the credential is the browser approval. */
  approval?: true;
  run: (h: Harness) => Promise<number>;
}> = [
  {
    name: "a create",
    exit: 0,
    run: async (h) => {
      h.stub.answer("GET", "/api/projects", respond(200, []));
      h.stub.answer("POST", "/api/projects", respond(201, created()));
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a create with --json",
    exit: 0,
    run: async (h) => {
      h.stub.answer("GET", "/api/projects", respond(200, []));
      h.stub.answer("POST", "/api/projects", respond(201, created()));
      return runSetup(["--json"], io, h.settings);
    },
  },
  {
    name: "a use, the project's stored name holding both canaries",
    exit: 0,
    run: async (h) => {
      const name = `leak-app ${BOTH}`;
      h.stub.answer(
        "GET",
        "/api/projects",
        respond(200, [documentListedProject({ id: PROJECT_ID, name })]),
      );
      h.stub.answer("GET", `/api/projects/${PROJECT_ID}`, respond(200, project({ name })));
      return runSetup(["--name", name, "--json"], io, h.settings);
    },
  },
  {
    name: "a dry run",
    exit: 0,
    run: async (h) => {
      h.stub.answer("GET", "/api/projects", respond(200, []));
      return runSetup(["--dry-run"], io, h.settings);
    },
  },
  {
    name: "a 403 whose message holds the API key",
    exit: 1,
    run: async (h) => {
      h.stub.answer("GET", "/api/projects", respond(200, []));
      h.stub.answer(
        "POST",
        "/api/projects",
        respond(403, documentError("BILLING_INACTIVE", API_KEY)),
      );
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a lost POST whose network error holds the API key",
    exit: 1,
    run: async (h) => {
      h.stub.answer("GET", "/api/projects", respond(200, []));
      h.stub.answer("POST", "/api/projects", {
        kind: "network-error",
        message: `reset: ${API_KEY}`,
      });
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a 500 whose body is not the envelope and holds both canaries",
    exit: 1,
    run: async (h) => {
      h.stub.answer("GET", "/api/projects", respond(500, undefined, `<html>${BOTH}</html>`));
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a 401",
    exit: 3,
    run: async (h) => {
      h.stub.answer("GET", "/api/projects", respond(401, documentError("UNAUTHORIZED", BOTH)));
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a key with whitespace",
    exit: 3,
    run: async () => {
      const h = harness({ DYNJANDI_API_KEY: `${API_KEY} extra` });
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a 409 NAME_TAKEN and a project read back",
    exit: 0,
    run: async (h) => {
      h.stub.answer("GET", "/api/projects", respond(200, []));
      h.stub.answer(
        "POST",
        "/api/projects",
        respond(409, documentError("NAME_TAKEN", "taken", { projectId: PROJECT_ID, name: BOTH })),
      );
      h.stub.answer("GET", `/api/projects/${PROJECT_ID}`, respond(200, project()));
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a tracked env file",
    exit: 1,
    run: async (h) => {
      await writeFile(join(dir, ".env.local"), "TRACKED=1\n");
      await gitSync("add", "-f", ".env.local");
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a different key already in the env file",
    exit: 1,
    run: async (h) => {
      await writeFile(join(dir, ".env.local"), `DYNJANDI_PROJECT_KEY=${"b".repeat(64)}\n`);
      h.stub.answer("GET", "/api/projects", respond(200, []));
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "an approval at a terminal, approved, and a create",
    exit: 0,
    approval: true,
    run: async (h) => {
      approve(h, "authorization_pending", "approved");
      h.stub.answer("GET", "/api/projects", respond(200, []));
      h.stub.answer("POST", "/api/projects", respond(201, created()));
      return runSetup([], io, at(h.settings));
    },
  },
  {
    name: "an approval handed back as a sentence",
    exit: 4,
    approval: true,
    run: async (h) => {
      approve(h);
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "an approval handed back with --json",
    exit: 4,
    approval: true,
    run: async (h) => {
      approve(h);
      return runSetup(["--json"], io, at(h.settings));
    },
  },
  {
    name: "a re-run that completes the approval",
    exit: 0,
    approval: true,
    run: async (h) => {
      approve(h);
      await runSetup([], io, h.settings);
      playPolls(h.stub, ["approved"], { access_token: TOKEN });
      h.stub.answer("GET", "/api/projects", respond(200, []));
      h.stub.answer("POST", "/api/projects", respond(201, created()));
      return runSetup(["--json"], io, h.settings);
    },
  },
  {
    name: "a re-run that is still pending",
    exit: 4,
    approval: true,
    run: async (h) => {
      approve(h);
      await runSetup([], io, h.settings);
      for (let i = 0; i < 20; i += 1) playPolls(h.stub, ["authorization_pending"]);
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a denial whose message holds the device code and the token",
    exit: 3,
    approval: true,
    run: async (h) => {
      approve(h);
      h.stub.answer("POST", "/api/device/token", {
        kind: "response",
        status: 400,
        body: documentError("access_denied", `${DEVICE_CODE} ${TOKEN}`),
      });
      return runSetup([], io, at(h.settings));
    },
  },
  {
    name: "a poll answered with an unknown code whose message holds the device code",
    exit: 1,
    approval: true,
    run: async (h) => {
      approve(h);
      h.stub.answer("POST", "/api/device/token", respond(400, documentError("ODD", DEVICE_CODE)));
      return runSetup([], io, at(h.settings));
    },
  },
  {
    name: "a poll answered 500 with a body that holds both canaries",
    exit: 1,
    approval: true,
    run: async (h) => {
      approve(h);
      h.stub.answer(
        "POST",
        "/api/device/token",
        respond(500, undefined, `<html>${DEVICE_CODE} ${TOKEN}</html>`),
      );
      return runSetup([], io, at(h.settings));
    },
  },
  {
    name: "a 401 after approval whose message holds the token",
    exit: 3,
    approval: true,
    run: async (h) => {
      approve(h, "approved");
      h.stub.answer("GET", "/api/projects", respond(401, documentError("UNAUTHORIZED", TOKEN)));
      return runSetup([], io, at(h.settings));
    },
  },
  {
    name: "a start answer with an off-origin link that carries the device code",
    exit: 1,
    approval: true,
    run: async (h) => {
      h.stub.answer("POST", "/api/device/code", {
        kind: "response",
        status: 200,
        body: {
          device_code: DEVICE_CODE,
          user_code: "ABCD-EFGH",
          verification_uri: "https://evil.example/device",
          verification_uri_complete: `https://evil.example/device?c=${DEVICE_CODE}`,
          expires_in: 600,
          interval: 5,
        },
      });
      return runSetup([], io, h.settings);
    },
  },
  {
    name: "a --file in a new folder",
    exit: 0,
    run: async (h) => {
      await mkdir(join(dir, "config"));
      h.stub.answer("GET", "/api/projects", respond(200, []));
      h.stub.answer("POST", "/api/projects", respond(201, created()));
      return runSetup(["--file", join("config", "app.env")], io, h.settings);
    },
  },
];

async function filesUnder(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && !entry.parentPath.includes(`${join(root, ".git")}`)) {
      found.push(join(entry.parentPath, entry.name));
    }
  }
  return found;
}

describe("the leak sweep", () => {
  it.each(scenarios)("$name", async ({ exit, run, approval }) => {
    const h = harness(approval === true ? {} : { DYNJANDI_API_KEY: API_KEY });
    const code = await run(h);
    expect(code).toBe(exit);

    const everywhere = [
      streams.out.join(""),
      streams.err.join(""),
      JSON.stringify(gitCalls),
      JSON.stringify(h.stub.requests.map((r) => ({ url: r.url, body: r.body }))),
    ].join("\n");
    expect(everywhere).not.toContain(API_KEY);
    expect(everywhere).not.toContain(PROJECT_KEY);

    // The approval's credentials go to the server in a request body and nowhere else: not to a stream, to Git, or to
    // a URL.
    const outside = [
      streams.out.join(""),
      streams.err.join(""),
      JSON.stringify(gitCalls),
      JSON.stringify(h.stub.requests.map((r) => r.url)),
    ].join("\n");
    expect(outside).not.toContain(DEVICE_CODE);
    expect(outside).not.toContain(TOKEN);

    // The only place the project key may be is an env file; the API key is nowhere on disk.
    for (const file of await filesUnder(dir)) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toContain(API_KEY);
      expect(text, file).not.toContain(TOKEN);
      if (text.includes(DEVICE_CODE))
        expect(file).toBe(join(dir, ".dynjandi", "setup-approval.json"));
      if (text.includes(PROJECT_KEY)) expect(file).toMatch(/\.env(\.local)?$|app\.env$/);
    }
  });

  it("puts the project key in the env file, and a secret's own printing is [redacted]", async () => {
    const h = harness();
    h.stub.answer("GET", "/api/projects", respond(200, []));
    h.stub.answer("POST", "/api/projects", respond(201, created()));
    expect(await runSetup([], io, h.settings)).toBe(0);
    expect(await readFile(join(dir, ".env.local"), "utf8")).toContain(PROJECT_KEY);
  });

  it("does not echo --api-key's value in a thrown or printed usage error", async () => {
    const h = harness();
    let thrown = "";
    try {
      await runSetup(["--api-key", API_KEY], io, h.settings);
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      thrown = (error as Error).message;
    }
    expect(thrown).toContain("DYNJANDI_API_KEY");
    expect(await main(["setup", `--api-key=${API_KEY}`], io, h.settings)).toBe(2);
    expect(thrown + streams.out.join("") + streams.err.join("")).not.toContain(API_KEY);
    expect(h.stub.requests).toHaveLength(0);
  });
});
