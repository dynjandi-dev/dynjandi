import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { SetupFailure } from "../errors.js";
import {
  createManagementClient,
  isValidProjectId,
  isValidProjectName,
  type ManagementClient,
  ManagementError,
  type Project,
  printable,
} from "./api.js";
import { pickEnvFile, planEnvChange, readProjectId, writeEnvFile } from "./env-file.js";
import { applyGit, type GitPlan, type GitRunner, planGit } from "./git.js";
import { parseSetupOptions, SETUP_HELP, type SetupOptions } from "./options.js";
import { parseApiKey, redact, type Secret } from "./secret.js";

/** Not options: what tests replace so no run reaches the network, the real environment or the real `git`. */
export interface SetupSettings {
  /** The management client's `fetch`. Default: the global one. */
  fetch?: typeof fetch | undefined;
  /** Default: `process.env`. */
  env?: Record<string, string | undefined> | undefined;
  /** Default: `process.cwd()`. */
  cwd?: string | undefined;
  /** Runs `git`. Default: the real one. */
  git?: GitRunner | undefined;
}

export interface SetupIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** D12's summary object. It never holds a credential. */
export interface SetupSummary {
  dryRun: boolean;
  project: { id: string | null; name: string; action: "create" | "use" };
  envFile: { path: string; action: "write" | "none" };
  gitignore: "add" | "none" | "no-repo";
}

// What D5 settled, before anything is written: a project that exists (with its key), or a name to create.
type Settled =
  | { action: "use"; project: Project; requestedName: string | undefined }
  | { action: "create"; name: string };

const KEY_WORDS = "DYNJANDI_PROJECT_KEY and DYNJANDI_PROJECT_ID";
// A key that cannot match a real one: the pre-check of a create only asks whether the file would refuse.
const NEW_PROJECT_PLACEHOLDER = { key: "0".repeat(64), id: "new-project" };

/**
 * `dynjandi setup` (D10) and the exit code: 0 done, 1 failure, 3 no usable credential (D13). A usage error is
 * thrown, for `main` to report with the command's name.
 */
export async function runSetup(
  args: string[],
  io: SetupIo,
  settings: SetupSettings = {},
): Promise<number> {
  const command = parseSetupOptions(args);
  if (command.kind === "help") {
    io.stdout(SETUP_HELP);
    return 0;
  }
  try {
    const { summary, notes } = await perform(command.options, settings);
    for (const note of notes) io.stderr(`${redact(note)}\n`);
    // The summary holds no credential by construction; the server's stored name is the one free-form field.
    io.stdout(`${redact(command.options.json ? JSON.stringify(summary) : sentence(summary))}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`dynjandi setup: ${redact(printable(message))}\n`);
    if (error instanceof SetupFailure) return error.kind === "auth" ? 3 : 1;
    if (error instanceof ManagementError) return error.kind === "auth" ? 3 : 1;
    return 1;
  }
}

async function perform(
  options: SetupOptions,
  settings: SetupSettings,
): Promise<{ summary: SetupSummary; notes: string[] }> {
  const cwd = settings.cwd ?? process.cwd();
  const env = settings.env ?? process.env;
  const git = settings.git === undefined ? {} : { run: settings.git };
  const notes: string[] = [];

  // D10 step 2: the env file and what Git needs, read only. A person is never asked to approve a run that fails here.
  const path = await pickEnvFile(cwd, options.envFile);
  const shownPath = display(path, cwd);
  const gitPlan = await planGit(path, cwd, git);
  if (gitPlan.kind === "refuse") fail(`${gitPlan.reason}. Next: ${gitPlan.fix}`);
  const content = await readText(path);
  const fileId = readProjectId(content);

  // Step 3.
  const credential = readCredential(env);
  const client = createManagementClient({ fetch: settings.fetch ?? fetch, credential });

  // Step 4: read-only calls.
  const settled = await settle(client, options, {
    fileId: fileId !== undefined && isValidProjectId(fileId) ? fileId : undefined,
    shownPath,
    cwd,
  });
  const precheck = planEnvChange(
    content,
    settled.action === "use"
      ? { key: settled.project.projectKey.reveal(), id: settled.project.id }
      : NEW_PROJECT_PLACEHOLDER,
    { force: options.force },
  );
  if (precheck.kind === "refuse") fail(precheck.reason);

  const summary: SetupSummary = {
    dryRun: options.dryRun,
    project:
      settled.action === "use"
        ? { id: settled.project.id, name: settled.project.name, action: "use" }
        : { id: null, name: settled.name, action: "create" },
    envFile: { path: shownPath, action: precheck.kind === "unchanged" ? "none" : "write" },
    gitignore: gitPlan.kind === "add" ? "add" : gitPlan.kind === "no-repo" ? "no-repo" : "none",
  };
  if (settled.action === "use" && settled.requestedName !== undefined) {
    if (settled.requestedName !== settled.project.name) {
      notes.push(
        `The name "${settled.requestedName}" matches the project "${settled.project.name}".`,
      );
    }
  }
  notes.push(...gitNotes(gitPlan, { shownPath, cwd, dryRun: options.dryRun }));

  // Step 5.
  if (options.dryRun) return { summary, notes };

  // Step 6: the entry that keeps the key out of Git exists before the key does.
  const applied = await applyGit(gitPlan, path, cwd, git);
  if (applied.kind === "refuse") fail(`${applied.reason}. Next: ${applied.fix}`);

  // Step 7.
  const project = await ensureProject(client, settled);
  summary.project = {
    id: project.id,
    name: project.name,
    action: project.created ? "create" : "use",
  };

  // Step 8: from a fresh read, so a change since step 2 is kept.
  const fresh = await readText(path);
  const plan = planEnvChange(
    fresh,
    { key: project.projectKey.reveal(), id: project.id },
    { force: options.force },
  );
  if (plan.kind === "refuse") fail(plan.reason);
  if (plan.kind === "unchanged") {
    summary.envFile.action = "none";
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeEnvFile(path, plan.content);
    summary.envFile.action = "write";
  }
  return { summary, notes };
}

function fail(message: string): never {
  throw new SetupFailure("failure", message);
}

function display(path: string, cwd: string): string {
  const shown = relative(cwd, path);
  return shown === "" || shown.startsWith("..") ? path : shown;
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    fail(`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// D3. Until browser approval (D18) lands, the key is the only credential, and its absence exits 3.
function readCredential(env: Record<string, string | undefined>): Secret {
  const read = (name: string) => env[name];
  const raw = read("DYNJANDI_API_KEY");
  if (raw === undefined || raw === "") {
    const ci = (read("CI") ?? "") !== "";
    throw new SetupFailure(
      "auth",
      ci
        ? "DYNJANDI_API_KEY is not set, and a CI job has no person to approve a setup: set it to a workspace API key from the API keys page of the dashboard"
        : "DYNJANDI_API_KEY is not set: set it to a workspace API key from the API keys page of the dashboard, then run again",
    );
  }
  const key = parseApiKey(raw);
  if (key === undefined) {
    throw new SetupFailure(
      "auth",
      "DYNJANDI_API_KEY is not usable: it must be a workspace API key from the API keys page of the dashboard, with no spaces or control characters",
    );
  }
  return key;
}

// The server compares names trimmed and ignoring the case of A-Z only (core#384), and so does D5.
function normalise(name: string): string {
  return name.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** D5, with read-only calls. */
async function settle(
  client: ManagementClient,
  options: SetupOptions,
  context: { fileId: string | undefined; shownPath: string; cwd: string },
): Promise<Settled> {
  const { fileId, shownPath } = context;
  const mismatch = (what: string) =>
    `${what} is not the project DYNJANDI_PROJECT_ID names in ${shownPath} (${fileId}); pass --force to replace it`;

  // 1. --project.
  if (options.project !== undefined) {
    if (fileId !== undefined && fileId !== options.project && !options.force) {
      fail(mismatch(`--project ${options.project}`));
    }
    return {
      action: "use",
      project: await readProject(client, options.project),
      requestedName: undefined,
    };
  }
  // 2. --name.
  if (options.name !== undefined) {
    return settleByName(client, options.name, {
      explicitAgainst: fileId,
      force: options.force,
      mismatch,
    });
  }
  // 3. The id the env file already holds, so a plain re-run reconnects.
  if (fileId !== undefined) {
    return { action: "use", project: await readProject(client, fileId), requestedName: undefined };
  }
  // 4. package.json's name, else the directory's.
  return settleByName(client, await derivedName(context.cwd), {
    explicitAgainst: undefined,
    force: options.force,
    mismatch,
  });
}

async function readProject(client: ManagementClient, id: string): Promise<Project> {
  try {
    return await client.getProject(id);
  } catch (error) {
    if (error instanceof ManagementError && error.status === 404) {
      fail(
        `no project with the id ${id} in this workspace: check it, or pass --name to find or create one`,
      );
    }
    throw error;
  }
}

async function settleByName(
  client: ManagementClient,
  name: string,
  rule: {
    explicitAgainst: string | undefined;
    force: boolean;
    mismatch: (what: string) => string;
  },
): Promise<Settled> {
  const wanted = normalise(name);
  const matches = (await client.listProjects()).filter(
    (project) => normalise(project.name) === wanted,
  );
  const [only, ...others] = matches;
  if (only !== undefined && others.length > 0) {
    const ids = matches.map((project) => project.id).join(", ");
    fail(`more than one project is named "${name}" (${ids}): pick one with --project <id>`);
  }
  const explicitDisagrees = (id: string | undefined) =>
    rule.explicitAgainst !== undefined && !rule.force && id !== rule.explicitAgainst;
  if (only === undefined) {
    if (explicitDisagrees(undefined)) fail(rule.mismatch(`a new project named "${name}"`));
    return { action: "create", name };
  }
  if (explicitDisagrees(only.id)) fail(rule.mismatch(`--name "${name}" (${only.id})`));
  return { action: "use", project: await readProject(client, only.id), requestedName: name };
}

// D5 step 4: package.json's "name", else the directory's name.
async function derivedName(cwd: string): Promise<string> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    const name =
      typeof manifest === "object" && manifest !== null && "name" in manifest
        ? manifest.name
        : undefined;
    if (typeof name === "string" && isValidProjectName(name.trim())) return name.trim();
  } catch {
    // No package.json, or one that is not JSON: the directory's name is next.
  }
  const directory = basename(cwd).trim();
  if (!isValidProjectName(directory)) {
    fail("there is no name to give the project: pass --name <name>");
  }
  return directory;
}

// D10 step 7. A create that answers `409 NAME_TAKEN` uses the project it names and does not retry (D5).
async function ensureProject(
  client: ManagementClient,
  settled: Settled,
): Promise<Project & { created: boolean }> {
  if (settled.action === "use") return { ...settled.project, created: false };
  try {
    return { ...(await client.createProject(settled.name)), created: true };
  } catch (error) {
    if (error instanceof ManagementError && error.status === 409 && error.nameTaken !== undefined) {
      return { ...(await readProject(client, error.nameTaken.projectId)), created: false };
    }
    throw error;
  }
}

function gitNotes(
  plan: GitPlan,
  where: { shownPath: string; cwd: string; dryRun: boolean },
): string[] {
  if (plan.kind === "add") {
    const verb = where.dryRun ? "Would add" : "Added";
    return [`${verb} ${plan.entry} to ${display(plan.gitignorePath, where.cwd)}.`];
  }
  if (plan.kind === "no-repo") {
    return [
      `${where.shownPath} is not in a Git repository: a repository created later must ignore it.`,
    ];
  }
  return [];
}

function sentence(summary: SetupSummary): string {
  const { project, envFile, dryRun } = summary;
  const label = `${printable(project.name)}${project.id === null ? "" : ` (${project.id})`}`;
  if (dryRun) {
    if (project.action === "create") {
      return `Dry run, nothing changed: would create the project ${label} and write ${KEY_WORDS} to ${envFile.path}.`;
    }
    return envFile.action === "none"
      ? `Dry run, nothing changed: ${label} is already set up in ${envFile.path}.`
      : `Dry run, nothing changed: would use the existing project ${label} and write ${KEY_WORDS} to ${envFile.path}.`;
  }
  if (project.action === "create") {
    return `Created the project ${label} and wrote ${KEY_WORDS} to ${envFile.path}.`;
  }
  return envFile.action === "none"
    ? `${label} is already set up in ${envFile.path}; nothing changed.`
    : `Using the existing project ${label}; wrote ${KEY_WORDS} to ${envFile.path}.`;
}
