import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Io, main } from "../../src/cli.js";
import type { GitRunner } from "../../src/setup/git.js";
import { runSetup, type SetupSettings } from "../../src/setup/run.js";
import { createEmptyGitConfig, removeEmptyGitConfig } from "../support/git-config.js";
import {
  APPROVAL_URL,
  CLI_TOKEN,
  DEVICE_CODE,
  documentCreated,
  documentError,
  documentListedProject,
  documentProject,
  fakeClock,
  fakeOpener,
  PROJECT_KEY,
  playApproval,
  playPolls,
  startStubManagement,
  USER_CODE,
} from "../support/stub-management.js";

// Expected values come from the plan, not from the code under test:
// - D5: the order (--project, --name, the env file's id, package.json's name, the directory's name); a name is
//   matched trimmed and ignoring the case of A-Z only; one match is used, none is created, two are refused with
//   their ids; a `409 NAME_TAKEN` uses the project in `details` and never retries the create; an explicit
//   --project/--name that disagrees with the env file's id is refused unless --force;
// - D8/D9: the env file gets DYNJANDI_PROJECT_KEY then DYNJANDI_PROJECT_ID, and a re-run writes nothing;
// - D10: a refusal before step 6 has sent no request the stub can see and touched no file;
// - D11: --dry-run makes no POST and no write; D12: the summary object; D13: exit 3 is "no usable credential".
const API_KEY = "dyn_run_test_key_90b1";
const PROJECT_ID = "3f2a9c";

let dir: string;
let gitConfig: string;

beforeAll(async () => {
  gitConfig = await createEmptyGitConfig();
});

afterAll(async () => {
  await removeEmptyGitConfig(gitConfig);
});

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

async function initRepository(): Promise<void> {
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
}

beforeEach(async () => {
  // The machine's own Git configuration (a global ignore file) would change which files count as ignored.
  vi.stubEnv("GIT_CONFIG_GLOBAL", gitConfig);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  dir = await mkdtemp(join(tmpdir(), "dynjandi-run-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

function setup(
  env: Record<string, string | undefined> = { DYNJANDI_API_KEY: API_KEY },
  extra: Partial<SetupSettings> = {},
) {
  const stub = startStubManagement();
  const clock = fakeClock();
  const opener = fakeOpener();
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { stdout: (text) => out.push(text), stderr: (text) => err.push(text) };
  // No run waits a real second, opens a real browser or depends on whether the tests run in a terminal.
  const settings: SetupSettings = {
    fetch: stub.fetch,
    env,
    cwd: dir,
    terminal: false,
    now: clock.now,
    sleep: clock.sleep,
    spawn: opener.spawn,
    platform: "linux",
    ...extra,
  };
  return {
    stub,
    clock,
    opener,
    out,
    err,
    run: (...args: string[]) => runSetup(args, io, settings),
    main: (...args: string[]) => main(args, io, settings),
  };
}

type Setup = ReturnType<typeof setup>;

const ok = (body: unknown) => ({ kind: "response", status: 200, body }) as const;

function answerList(h: Setup, ...projects: Record<string, unknown>[]) {
  h.stub.answer("GET", "/api/projects", ok(projects.map((p) => documentListedProject(p))));
}
function answerGet(h: Setup, overrides: Record<string, unknown> = {}) {
  const { id = PROJECT_ID } = overrides;
  h.stub.answer(
    "GET",
    `/api/projects/${id}`,
    ok(documentProject({ id, name: "my-app", ...overrides })),
  );
}
function answerCreate(h: Setup, overrides: Record<string, unknown> = {}) {
  h.stub.answer("POST", "/api/projects", {
    kind: "response",
    status: 201,
    body: documentCreated({ id: PROJECT_ID, name: "my-app", ...overrides }),
  });
}
const requestsOf = (h: Setup) =>
  h.stub.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);
const read = (name: string) => readFile(join(dir, name), "utf8");
const exists = (name: string) =>
  stat(join(dir, name)).then(
    () => true,
    () => false,
  );

async function named(name: string): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ name }));
}

const ENV_FILE = `DYNJANDI_PROJECT_KEY=${PROJECT_KEY}\nDYNJANDI_PROJECT_ID=${PROJECT_ID}\n`;

describe("runSetup: the sequence (D10)", () => {
  it("with no options in a fresh repository, creates the project and writes the env file", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    answerList(h);
    answerCreate(h);

    expect(await h.run()).toBe(0);

    expect(requestsOf(h)).toEqual(["GET /api/projects", "POST /api/projects"]);
    expect(h.stub.requests[1]?.body).toBe(JSON.stringify({ name: "my-app" }));
    for (const request of h.stub.requests) {
      expect(request.headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
    }
    expect(await read(".env.local")).toBe(ENV_FILE);
    expect(await read(".gitignore")).toBe("/.env.local\n/.env.local.*.tmp\n");
    expect(h.out.join("")).toBe(
      `Created the project my-app (${PROJECT_ID}) and wrote DYNJANDI_PROJECT_KEY and DYNJANDI_PROJECT_ID to .env.local.\n`,
    );
    expect(h.err.join("")).toContain("Added /.env.local and /.env.local.*.tmp to .gitignore");
    expect(h.out.join("") + h.err.join("")).not.toContain(PROJECT_KEY);
  });

  it("adds only the temporary file's entry when .gitignore already covers the file", async () => {
    await initRepository();
    await named("my-app");
    await writeFile(join(dir, ".gitignore"), "*.local\n");
    const h = setup();
    answerList(h);
    answerCreate(h);

    expect(await h.run("--json")).toBe(0);

    expect(await read(".gitignore")).toBe("*.local\n/.env.local.*.tmp\n");
    expect(JSON.parse(h.out.join(""))).toEqual({
      dryRun: false,
      project: { id: PROJECT_ID, name: "my-app", action: "create" },
      envFile: { path: ".env.local", action: "write" },
      gitignore: "add",
    });
  });

  it("names the project after the directory when there is no package.json", async () => {
    await initRepository();
    const h = setup();
    answerList(h);
    answerCreate(h, { name: basename(dir) });

    expect(await h.run()).toBe(0);

    expect(h.stub.requests[1]?.body).toBe(JSON.stringify({ name: basename(dir) }));
  });

  it("writes nothing to .gitignore and says so once when there is no repository", async () => {
    await named("my-app");
    const h = setup();
    answerList(h);
    answerCreate(h);

    expect(await h.run("--json")).toBe(0);

    expect(await exists(".gitignore")).toBe(false);
    expect(await read(".env.local")).toBe(ENV_FILE);
    expect(JSON.parse(h.out.join("")).gitignore).toBe("no-repo");
    expect(h.err.join("")).toContain("not in a Git repository");
  });

  it("creates the folder of a --file that does not exist yet", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    answerList(h);
    answerCreate(h);

    expect(await h.run("--file", join("config", "app.env"))).toBe(0);

    expect(await read(join("config", "app.env"))).toBe(ENV_FILE);
    expect(await read(join("config", ".gitignore"))).toBe("/app.env\n/app.env.*.tmp\n");
  });

  it("on a re-run uses the project the env file names, and writes nothing", async () => {
    await initRepository();
    await named("my-app");
    const first = setup();
    answerList(first);
    answerCreate(first);
    await first.run();
    const before = await stat(join(dir, ".env.local"));

    const again = setup();
    answerGet(again);
    expect(await again.run("--json")).toBe(0);

    expect(requestsOf(again)).toEqual([`GET /api/projects/${PROJECT_ID}`]);
    expect(JSON.parse(again.out.join(""))).toMatchObject({
      project: { id: PROJECT_ID, action: "use" },
      envFile: { action: "none" },
    });
    const after = await stat(join(dir, ".env.local"));
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await read(".env.local")).toBe(ENV_FILE);
    expect(again.out.join("")).not.toContain(PROJECT_KEY);
  });

  it("uses the one existing project with the name", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    answerList(h, { id: PROJECT_ID, name: "my-app" }, { id: "other", name: "other-app" });
    answerGet(h);

    expect(await h.run()).toBe(0);

    expect(requestsOf(h)).toEqual(["GET /api/projects", `GET /api/projects/${PROJECT_ID}`]);
    expect(await read(".env.local")).toBe(ENV_FILE);
    expect(h.out.join("")).toBe(
      `Using the existing project my-app (${PROJECT_ID}); wrote DYNJANDI_PROJECT_KEY and DYNJANDI_PROJECT_ID to .env.local.\n`,
    );
  });

  it("matches a name that differs only in the case of A-Z, and reports the stored name", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    answerList(h, { id: PROJECT_ID, name: "My-App" });
    answerGet(h, { name: "My-App" });

    expect(await h.run("--json")).toBe(0);

    expect(JSON.parse(h.out.join(""))).toMatchObject({
      project: { id: PROJECT_ID, name: "My-App", action: "use" },
    });
    expect(requestsOf(h)).not.toContain("POST /api/projects");
    expect(h.err.join("")).toContain('"my-app" matches the project "My-App"');
  });

  it("scrubs control characters out of the names in that note, so the stored name cannot drive the terminal", async () => {
    await initRepository();
    await named("my\u001b[2Japp");
    const h = setup();
    answerList(h, { id: PROJECT_ID, name: "MY\u001b[2JAPP" });
    answerGet(h, { name: "MY\u001b[2JAPP" });

    expect(await h.run()).toBe(0);

    expect(h.err.join("")).toContain('The name "my [2Japp" matches the project "MY [2JAPP".');
    expect(h.err.join("")).not.toContain("\u001b");
  });

  it("matches a name with surrounding spaces, trimmed on both sides", async () => {
    await initRepository();
    const h = setup();
    answerList(h, { id: PROJECT_ID, name: " my-app " });
    answerGet(h, { name: " my-app " });

    expect(await h.run("--name", "  my-app  ")).toBe(0);

    expect(requestsOf(h)).not.toContain("POST /api/projects");
    expect(await read(".env.local")).toBe(ENV_FILE);
  });

  it("does not fold the case of non-ASCII letters", async () => {
    await initRepository();
    const h = setup();
    answerList(h, { id: "other", name: "ÄPP" });
    answerCreate(h, { name: "äpp" });

    expect(await h.run("--name", "äpp")).toBe(0);

    expect(requestsOf(h)).toContain("POST /api/projects");
  });

  it("on a 409 NAME_TAKEN uses the project in details, with no second create", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    answerList(h);
    h.stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 409,
      body: documentError("NAME_TAKEN", "A project with this name exists", {
        projectId: PROJECT_ID,
        name: "My-App",
      }),
    });
    answerGet(h, { name: "My-App" });

    expect(await h.run("--json")).toBe(0);

    expect(requestsOf(h)).toEqual([
      "GET /api/projects",
      "POST /api/projects",
      `GET /api/projects/${PROJECT_ID}`,
    ]);
    expect(JSON.parse(h.out.join(""))).toMatchObject({
      project: { id: PROJECT_ID, name: "My-App", action: "use" },
    });
    expect(await read(".env.local")).toBe(ENV_FILE);
  });

  it("refuses two projects with the name, listing their ids", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    // core#384 forbids this, so only the stub can produce it.
    answerList(h, { id: "first", name: "my-app" }, { id: "second", name: "My-App" });

    expect(await h.run()).toBe(1);

    expect(requestsOf(h)).toEqual(["GET /api/projects"]);
    expect(h.err.join("")).toMatch(/first, second.*--project <id>/);
    expect(await exists(".env.local")).toBe(false);
    expect(await exists(".gitignore")).toBe(false);
  });

  it("uses --project, and reports a 404 as no such project in this workspace", async () => {
    await initRepository();
    const found = setup();
    answerGet(found);
    expect(await found.run("--project", PROJECT_ID)).toBe(0);
    expect(requestsOf(found)).toEqual([`GET /api/projects/${PROJECT_ID}`]);

    await rm(join(dir, ".env.local"));
    const missing = setup();
    missing.stub.answer("GET", "/api/projects/nope", {
      kind: "response",
      status: 404,
      body: documentError("NOT_FOUND", "Project not found"),
    });
    expect(await missing.run("--project", "nope")).toBe(1);
    expect(missing.err.join("")).toContain("no project with the id nope in this workspace");
  });
});

describe("runSetup: an explicit option against the env file's id (D5)", () => {
  async function fileNamingAnotherProject(): Promise<string> {
    await initRepository();
    const content = `DYNJANDI_PROJECT_KEY=${"b".repeat(64)}\nDYNJANDI_PROJECT_ID=another\n`;
    await writeFile(join(dir, ".env.local"), content);
    await writeFile(join(dir, ".gitignore"), "*.local\n");
    return content;
  }

  it("refuses --name that finds a different project, and allows it with --force", async () => {
    const before = await fileNamingAnotherProject();
    const refused = setup();
    answerList(refused, { id: PROJECT_ID, name: "my-app" });
    expect(await refused.run("--name", "my-app")).toBe(1);
    expect(refused.err.join("")).toContain("--force");
    expect(requestsOf(refused)).toEqual(["GET /api/projects"]);
    expect(await read(".env.local")).toBe(before);

    const forced = setup();
    answerList(forced, { id: PROJECT_ID, name: "my-app" });
    answerGet(forced);
    expect(await forced.run("--name", "my-app", "--force")).toBe(0);
    expect(await read(".env.local")).toBe(ENV_FILE);
  });

  it("refuses --name for a new project before creating it, and --project too", async () => {
    const before = await fileNamingAnotherProject();
    const create = setup();
    answerList(create);
    expect(await create.run("--name", "brand-new")).toBe(1);
    expect(requestsOf(create)).toEqual(["GET /api/projects"]);

    const project = setup();
    expect(await project.run("--project", PROJECT_ID)).toBe(1);
    expect(project.stub.requests).toHaveLength(0);
    expect(await read(".env.local")).toBe(before);
  });

  it("allows --name that finds the project the file already names", async () => {
    await initRepository();
    await writeFile(join(dir, ".env.local"), ENV_FILE);
    await writeFile(join(dir, ".gitignore"), "*.local\n");
    const h = setup();
    answerList(h, { id: PROJECT_ID, name: "my-app" });
    answerGet(h);
    expect(await h.run("--name", "my-app")).toBe(0);
  });

  it("refuses a create when the file holds a different key, before the POST", async () => {
    await initRepository();
    await named("my-app");
    await writeFile(join(dir, ".env.local"), `DYNJANDI_PROJECT_KEY=${"b".repeat(64)}\n`);
    await writeFile(join(dir, ".gitignore"), "*.local\n");
    const h = setup();
    answerList(h);

    expect(await h.run()).toBe(1);

    expect(requestsOf(h)).toEqual(["GET /api/projects"]);
    expect(h.err.join("")).toContain("--force");
  });
});

describe("runSetup: credentials (D3, D13)", () => {
  it("exits 3 in CI with no key, saying a job has no person to approve, and starts no approval", async () => {
    await initRepository();
    for (const ci of ["1", "true"]) {
      const h = setup({ CI: ci });
      expect(await h.run()).toBe(3);
      expect(h.err.join("")).toMatch(
        /DYNJANDI_API_KEY.*CI job.*set it to a workspace API key from the API keys page/,
      );
      expect(h.out.join("")).toBe("");
      expect(h.stub.requests).toHaveLength(0);
      expect(h.opener.calls).toEqual([]);
      expect(await exists(".dynjandi")).toBe(false);
    }
  });

  it("with DYNJANDI_API_KEY set, nothing about approval runs, even with no terminal and no CI", async () => {
    await initRepository();
    await named("my-app");
    const h = setup({ DYNJANDI_API_KEY: API_KEY }, { terminal: true });
    answerList(h, { id: PROJECT_ID, name: "my-app" });
    answerGet(h);
    expect(await h.run()).toBe(0);
    expect(requestsOf(h)).toEqual(["GET /api/projects", `GET /api/projects/${PROJECT_ID}`]);
    expect(h.stub.requests[0]?.headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
    expect(h.opener.calls).toEqual([]);
    expect(await exists(".dynjandi")).toBe(false);
  });

  it("exits 3 for a key with whitespace, without printing it", async () => {
    const h = setup({ DYNJANDI_API_KEY: "dyn_has space" });
    expect(await h.run()).toBe(3);
    expect(h.err.join("")).not.toContain("dyn_has");
    expect(h.stub.requests).toHaveLength(0);
  });

  it("exits 3 for a key with a character above U+00FF, which could not go into a header (#58)", async () => {
    const h = setup({ DYNJANDI_API_KEY: "dyn_€" });
    expect(await h.run()).toBe(3);
    expect(h.err.join("")).toContain("DYNJANDI_API_KEY is not usable");
    expect(h.err.join("")).not.toContain("could not reach");
    expect(h.stub.requests).toHaveLength(0);
  });

  it("exits 3 when the API answers 401, and says a workspace API key is needed", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    h.stub.answer("GET", "/api/projects", {
      kind: "response",
      status: 401,
      body: documentError("UNAUTHORIZED", "Invalid API key"),
    });
    expect(await h.run()).toBe(3);
    expect(h.err.join("")).toContain("workspace API key");
    expect(await exists(".env.local")).toBe(false);
  });

  it("exits 1 for any other refusal by the API", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    answerList(h);
    h.stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 403,
      body: documentError("PROJECT_LIMIT_REACHED", "Project limit reached", { maxProjects: 3 }),
    });
    expect(await h.run()).toBe(1);
    expect(h.err.join("")).toContain("PROJECT_LIMIT_REACHED");
    expect(await exists(".env.local")).toBe(false);
    // Step 6 ran before the create was refused: the entry it wrote is reported, not left silent.
    expect(await read(".gitignore")).toBe("/.env.local\n/.env.local.*.tmp\n");
    expect(h.err.join("")).toContain("Added /.env.local and /.env.local.*.tmp to .gitignore.");
  });

  it("reports the .gitignore entry when Git still does not ignore the file after it", async () => {
    await named("my-app");
    // Answers as git would for a rule no appended entry can beat: not tracked, not ignored before or after.
    const stubborn: GitRunner = async (args) => {
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "check-ignore" && args.includes("-v")) {
        return { code: 0, stdout: "/elsewhere/.gitignore:1:!.env.local\t.env.local\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    };
    const h = setup(undefined, { git: stubborn });
    answerList(h);

    expect(await h.run()).toBe(1);

    expect(await read(".gitignore")).toBe("/.env.local\n/.env.local.*.tmp\n");
    expect(h.err.join("")).toMatch(
      /^Added \/\.env\.local and \/\.env\.local\.\*\.tmp to \.gitignore\.\ndynjandi setup: Git still does not ignore \.env\.local/,
    );
    expect(requestsOf(h)).not.toContain("POST /api/projects");
  });
});

describe("runSetup: a refusal before step 6 changes nothing (D10)", () => {
  it("refuses a tracked env file before any request, and touches no file", async () => {
    await initRepository();
    await named("my-app");
    await writeFile(join(dir, ".env.local"), "TRACKED=1\n");
    git("add", "-f", ".env.local");
    git("commit", "-q", "-m", "track it");
    const h = setup({});

    // No key either: the file is checked first, so the exit is 1 and not 3.
    expect(await h.run()).toBe(1);

    expect(h.stub.requests).toHaveLength(0);
    expect(h.err.join("")).toContain("git rm --cached .env.local");
    expect(await read(".env.local")).toBe("TRACKED=1\n");
    expect(await exists(".gitignore")).toBe(false);
  });

  it("refuses an env file that is a directory without touching anything", async () => {
    await mkdir(join(dir, ".env.local"));
    const h = setup();
    expect(await h.run()).toBe(1);
    expect(h.stub.requests).toHaveLength(0);
    expect(await readdir(dir)).toEqual([".env.local"]);
  });
});

describe("runSetup: --dry-run (D11)", () => {
  it("makes no POST and no write, and says what a real run would do", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    answerList(h);

    expect(await h.run("--dry-run", "--json")).toBe(0);

    expect(requestsOf(h)).toEqual(["GET /api/projects"]);
    expect(JSON.parse(h.out.join(""))).toEqual({
      dryRun: true,
      project: { id: null, name: "my-app", action: "create" },
      envFile: { path: ".env.local", action: "write" },
      gitignore: "add",
    });
    expect(await exists(".env.local")).toBe(false);
    expect(await exists(".gitignore")).toBe(false);
    expect(h.err.join("")).toContain("Would add /.env.local");
  });

  it("for an existing project reports use, and still writes nothing", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    answerList(h, { id: PROJECT_ID, name: "my-app" });
    answerGet(h);

    expect(await h.run("--dry-run")).toBe(0);

    expect(h.out.join("")).toBe(
      `Dry run, nothing changed: would use the existing project my-app (${PROJECT_ID}) and write DYNJANDI_PROJECT_KEY and DYNJANDI_PROJECT_ID to .env.local.\n`,
    );
    expect(await exists(".env.local")).toBe(false);
  });

  it("exits with the real run's code when it would not go ahead", async () => {
    const h = setup({ CI: "1" });
    expect(await h.run("--dry-run")).toBe(3);
    const refused = setup();
    await initRepository();
    await writeFile(join(dir, ".env.local"), `DYNJANDI_PROJECT_KEY=${"b".repeat(64)}\n`);
    await writeFile(join(dir, ".gitignore"), "*.local\n");
    answerList(refused);
    await named("my-app");
    expect(await refused.run("--dry-run")).toBe(1);
  });
});

describe("runSetup: a lost POST response (D5)", () => {
  it("keeps the may-exist hint after a 5xx whose message fills the 500 characters", async () => {
    await initRepository();
    await named("my-app");
    const h = setup();
    answerList(h);
    h.stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 502,
      body: documentError("UPSTREAM_ERROR", "x".repeat(600)),
    });

    expect(await h.run()).toBe(1);

    // The server's text is cut at 500 characters where it enters; what follows it is printed whole.
    const serverText = `UPSTREAM_ERROR: ${"x".repeat(600)}`.slice(0, 500);
    expect(h.err.join("").split("\n")).toContain(
      `dynjandi setup: ${serverText} The project may exist; running the same command again will find it by name.`,
    );
  });

  it("says the project may exist, and a re-run finds it by name", async () => {
    await initRepository();
    await named("my-app");
    const lost = setup();
    answerList(lost);
    lost.stub.answer("POST", "/api/projects", { kind: "network-error", message: "socket hang up" });

    expect(await lost.run()).toBe(1);

    expect(lost.err.join("")).toMatch(/may exist.*same command again/);
    expect(await exists(".env.local")).toBe(false);
    // D10 step 6 before step 7: the entry exists although the POST never answered, and the run says so, first.
    expect(await read(".gitignore")).toBe("/.env.local\n/.env.local.*.tmp\n");
    expect(lost.err.join("")).toMatch(
      /^Added \/\.env\.local and \/\.env\.local\.\*\.tmp to \.gitignore\.\ndynjandi setup: .*may exist/,
    );
    expect(lost.stub.requests.filter((r) => r.method === "POST")).toHaveLength(1);

    const again = setup();
    answerList(again, { id: PROJECT_ID, name: "my-app" });
    answerGet(again);
    expect(await again.run()).toBe(0);
    expect(await read(".env.local")).toBe(ENV_FILE);
    expect(requestsOf(again)).not.toContain("POST /api/projects");
  });
});

describe("main: the setup branch (D1, D13)", () => {
  it("lists setup in dynjandi --help", async () => {
    const h = setup();
    expect(await h.main("--help")).toBe(0);
    expect(h.out.join("")).toMatch(/^ {2}setup /m);
  });

  it("prints setup's help for dynjandi setup --help", async () => {
    const h = setup();
    expect(await h.main("setup", "--help")).toBe(0);
    expect(h.out.join("")).toContain("Usage: dynjandi setup");
  });

  it("names the command that failed in the usage hint, and exits 2", async () => {
    const h = setup();
    expect(await h.main("setup", "--api-key", "x")).toBe(2);
    expect(h.err.join("")).toContain('Run "dynjandi setup --help"');
    expect(h.out.join("")).toBe("");

    const dev = setup();
    expect(await dev.main("dev", "--nope")).toBe(2);
    expect(dev.err.join("")).toContain('Run "dynjandi dev --help"');
  });

  it("refuses --project together with --name", async () => {
    const h = setup();
    expect(await h.main("setup", "--project", "a", "--name", "b")).toBe(2);
  });
});

describe("runSetup: browser approval (D3, D13, D18)", () => {
  const PENDING_FILE = join(".dynjandi", "setup-approval.json");
  const SENTENCE = `Open ${APPROVAL_URL} and approve code ${USER_CODE}, then run this command again. The link expires in 10 minutes.\n`;

  it("with a terminal: approved, continues with the token as the credential, and saves nothing", async () => {
    await initRepository();
    await named("my-app");
    const h = setup({}, { terminal: true });
    playApproval(h.stub, ["authorization_pending", "approved"]);
    h.stub.answer("GET", "/api/projects", ok([]));
    answerCreate(h);

    expect(await h.run()).toBe(0);

    expect(requestsOf(h)).toEqual([
      "POST /api/device/code",
      "POST /api/device/token",
      "POST /api/device/token",
      "GET /api/projects",
      "POST /api/projects",
    ]);
    for (const request of h.stub.requests.slice(3)) {
      expect(request.headers.get("Authorization")).toBe(`Bearer ${CLI_TOKEN}`);
    }
    expect(h.err.join("")).toContain(
      `Approve this setup at ${APPROVAL_URL}. The page shows the code ${USER_CODE}.`,
    );
    expect(h.opener.calls[0]?.args).toEqual([APPROVAL_URL]);
    expect(await read(".env.local")).toBe(ENV_FILE);
    expect(await exists(PENDING_FILE)).toBe(false);
  });

  it.each([
    ["access_denied", /approval denied/],
    ["expired_token", /link expired/],
  ] as const)("with a terminal: %s exits 3 and changes nothing", async (step, message) => {
    await initRepository();
    const h = setup({}, { terminal: true });
    playApproval(h.stub, [step]);
    expect(await h.run()).toBe(3);
    expect(h.err.join("")).toMatch(message);
    expect(h.out.join("")).toBe("");
    expect(requestsOf(h)).not.toContain("GET /api/projects");
    expect(await exists(".env.local")).toBe(false);
    expect(await exists(PENDING_FILE)).toBe(false);
  });

  it("with a terminal, slow_down lengthens the wait before the next poll", async () => {
    await initRepository();
    await named("my-app");
    const h = setup({}, { terminal: true });
    playApproval(h.stub, ["slow_down", "approved"]);
    h.stub.answer("GET", "/api/projects", ok([]));
    answerCreate(h);
    expect(await h.run()).toBe(0);
    expect(h.clock.sleeps).toEqual([5000, 10_000]);
  });

  it("without a terminal: exits 4 at once with the link on stdout, and the pending file", async () => {
    await initRepository();
    await named("my-app");
    const h = setup({});
    playApproval(h.stub, []);

    expect(await h.run()).toBe(4);

    expect(h.out.join("")).toBe(SENTENCE);
    expect(h.err.join("")).toBe("");
    expect(requestsOf(h)).toEqual(["POST /api/device/code"]);
    expect(JSON.parse(await read(PENDING_FILE)).deviceCode).toBe(DEVICE_CODE);
    expect(await exists(".env.local")).toBe(false);
    if (process.platform !== "win32") {
      expect((await stat(join(dir, PENDING_FILE))).mode & 0o777).toBe(0o600);
    }
  });

  it("with --json, even at a terminal: the link as one object, exit 4", async () => {
    await initRepository();
    const h = setup({}, { terminal: true });
    playApproval(h.stub, []);

    expect(await h.run("--json")).toBe(4);

    const lines = h.out.join("").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      status: "approval-pending",
      approval: {
        url: APPROVAL_URL,
        code: USER_CODE,
        expiresAt: new Date(h.clock.start + 600_000).toISOString(),
      },
    });
    expect(h.err.join("")).toBe("");
    expect(await exists(PENDING_FILE)).toBe(true);
  });

  it("a re-run completes, uses the token, and deletes the file", async () => {
    await initRepository();
    await named("my-app");
    const first = setup({});
    playApproval(first.stub, []);
    expect(await first.run()).toBe(4);

    const second = setup({});
    playPolls(second.stub, ["approved"]);
    second.stub.answer("GET", "/api/projects", ok([]));
    answerCreate(second);
    expect(await second.run()).toBe(0);

    expect(requestsOf(second)).toEqual([
      "POST /api/device/token",
      "GET /api/projects",
      "POST /api/projects",
    ]);
    expect(second.stub.requests[1]?.headers.get("Authorization")).toBe(`Bearer ${CLI_TOKEN}`);
    expect(await read(".env.local")).toBe(ENV_FILE);
    expect(await exists(PENDING_FILE)).toBe(false);
  });

  it("a re-run that is still pending exits 4 with the same link and keeps the file", async () => {
    await initRepository();
    const first = setup({});
    playApproval(first.stub, []);
    await first.run();

    const second = setup({});
    for (let i = 0; i < 20; i += 1) playPolls(second.stub, ["authorization_pending"]);
    expect(await second.run()).toBe(4);
    expect(second.out.join("")).toMatch(
      new RegExp(
        `^Open ${APPROVAL_URL.replace(/[.?]/g, "\\$&")} and approve code ${USER_CODE}, then run this command again\\. The link expires in \\d+ minutes?\\.\n$`,
      ),
    );
    expect(await exists(PENDING_FILE)).toBe(true);
    expect(await exists(".env.local")).toBe(false);
  });

  it("a re-run whose code is dead exits 3 and deletes the file", async () => {
    await initRepository();
    const first = setup({});
    playApproval(first.stub, []);
    await first.run();

    const second = setup({});
    playPolls(second.stub, ["invalid_grant"]);
    expect(await second.run()).toBe(3);
    expect(second.err.join("")).toMatch(/no longer valid/);
    expect(await exists(PENDING_FILE)).toBe(false);
  });

  it("a 401 after approval says the approval expired, not that a workspace key is needed", async () => {
    await initRepository();
    await named("my-app");
    const h = setup({}, { terminal: true });
    playApproval(h.stub, ["approved"]);
    h.stub.answer("GET", "/api/projects", {
      kind: "response",
      status: 401,
      body: documentError("UNAUTHORIZED", "expired"),
    });
    expect(await h.run()).toBe(3);
    expect(h.err.join("")).toContain("the approval expired");
    expect(h.err.join("")).not.toContain("workspace API key");
  });

  it("is asked for after the local checks: a tracked env file refuses before any approval starts (D10)", async () => {
    await initRepository();
    await writeFile(join(dir, ".env.local"), "TRACKED=1\n");
    git("add", ".env.local");
    const h = setup({});
    expect(await h.run()).toBe(1);
    expect(h.stub.requests).toHaveLength(0);
    expect(await exists(".dynjandi")).toBe(false);
  });

  it("a dry run asks for the approval too, and exits with the real run's code", async () => {
    await initRepository();
    const h = setup({});
    playApproval(h.stub, []);
    expect(await h.run("--dry-run")).toBe(4);
    expect(await exists(".env.local")).toBe(false);
  });
});

describe("the README's commands", () => {
  // Every line of a ```sh block in packages/cli/README.md that starts `npx @dynjandi/cli setup` is run as
  // written, in a fresh repository named my-app, against a stub that holds one project, my-project.
  const README = fileURLToPath(new URL("../../README.md", import.meta.url));
  const PREFIX = "npx @dynjandi/cli setup";

  async function readmeCommands(): Promise<string[][]> {
    const text = await readFile(README, "utf8");
    const blocks = [...text.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
    return blocks
      .flatMap((block) => block.split("\n"))
      .map((line) => line.replace(/\s+#.*$/, "").trim())
      .filter((line) => line === PREFIX || line.startsWith(`${PREFIX} `))
      .map((line) => line.slice(PREFIX.length).split(/\s+/).filter(Boolean));
  }

  it("finds the commands the README shows", async () => {
    const commands = (await readmeCommands()).map((args) => args.join(" "));
    expect(commands).toEqual(
      expect.arrayContaining([
        "",
        "--json",
        "--dry-run",
        "--project my-project",
        "--name my-app",
        "--file config/app.env",
        "--force",
      ]),
    );
  });

  it("runs every one against the stub, exiting 0", async () => {
    for (const args of await readmeCommands()) {
      await rm(dir, { recursive: true, force: true });
      dir = await mkdtemp(join(tmpdir(), "dynjandi-readme-"));
      await initRepository();
      await named("my-app");
      const h = setup();
      for (let round = 0; round < 2; round += 1) {
        answerList(h, { id: "my-project", name: "my-app" });
        answerGet(h, { id: "my-project", name: "my-app" });
      }
      expect(await h.main("setup", ...args), `npx @dynjandi/cli setup ${args.join(" ")}`).toBe(0);
      expect(h.err.join("")).not.toContain("dynjandi setup:");
    }
  });
});
