import { redact, Secret } from "./secret.js";

/** The one origin the client talks to (D2). There is no option for another: a bearer credential goes nowhere else. */
export const MANAGEMENT_ORIGIN = "https://app.dynjandi.dev";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_LENGTH = 500;
const PROJECT_KEY_PATTERN = /^[0-9a-f]{64}$/;

// The document's limits (version 0.6.0): `name` minLength 1, maxLength 200; `id` pattern below.
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_NAME_LENGTH = 200;

export function isValidProjectName(name: string): boolean {
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH;
}

export function isValidProjectId(id: string): boolean {
  return PROJECT_ID_PATTERN.test(id);
}

/** What the lists give back: all `setup` reads of a listed project. */
export interface ProjectSummary {
  id: string;
  name: string;
}

/** A project as `createProject` and `getProject` answer it. The key is a credential, so it is a `Secret`. */
export interface Project extends ProjectSummary {
  projectKey: Secret;
}

export interface ManagementClient {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<Project>;
  getProject(id: string): Promise<Project>;
}

export interface ManagementClientOptions {
  fetch: typeof fetch;
  credential: Secret;
  /** Per call, in milliseconds. Default 30 000 (D5). */
  timeoutMs?: number;
}

/**
 * A call that did not succeed. `kind` is `auth` for a `401` (D3: exit 3) and `failure` for everything else.
 * `message` is safe to print: it holds at most the server's `error.code` and `error.message`, scrubbed of control
 * characters and of every credential (D12). `outcomeUnknown` is true only for a create that may have taken effect.
 */
export class ManagementError extends Error {
  readonly kind: "auth" | "failure";
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly outcomeUnknown: boolean;
  /** `PROJECT_LIMIT_REACHED`'s `details.maxProjects`. */
  readonly maxProjects: number | undefined;
  /** `NAME_TAKEN`'s `details`: the existing project's id and stored name. */
  readonly nameTaken: { projectId: string; name: string } | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    kind: "auth" | "failure",
    message: string,
    fields: {
      status?: number | undefined;
      code?: string | undefined;
      outcomeUnknown?: boolean | undefined;
      maxProjects?: number | undefined;
      nameTaken?: { projectId: string; name: string } | undefined;
      retryAfterSeconds?: number | undefined;
    } = {},
  ) {
    super(redact(message));
    this.name = "ManagementError";
    this.kind = kind;
    this.status = fields.status;
    this.code = fields.code;
    this.outcomeUnknown = fields.outcomeUnknown ?? false;
    this.maxProjects = fields.maxProjects;
    this.nameTaken = fields.nameTaken;
    this.retryAfterSeconds = fields.retryAfterSeconds;
  }
}

const MAY_EXIST = " The project may exist; running the same command again will find it by name.";

// `noPropertyAccessFromIndexSignature` wants brackets and Biome wants dots for a literal key, so the key is a variable.
function field(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A server's words reach a terminal: control characters (escape sequences, newlines) become spaces.
export function printable(text: string): string {
  return Array.from(text.slice(0, MAX_MESSAGE_LENGTH), (char) =>
    isControl(char) ? " " : char,
  ).join("");
}

function isControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function parseSummary(value: unknown): ProjectSummary | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name } = value;
  if (typeof id !== "string" || !isValidProjectId(id)) return undefined;
  if (typeof name !== "string" || name === "") return undefined;
  return { id, name };
}

function parseProject(value: unknown): Project | undefined {
  const summary = parseSummary(value);
  if (summary === undefined || !isRecord(value)) return undefined;
  const { projectKey } = value;
  if (typeof projectKey !== "string" || !PROJECT_KEY_PATTERN.test(projectKey)) return undefined;
  return { ...summary, projectKey: new Secret(projectKey) };
}

function parseEnvelope(
  value: unknown,
): { code: string; message: string; details: Record<string, unknown> } | undefined {
  if (!isRecord(value) || !isRecord(field(value, "error"))) return undefined;
  const { code, message, details } = field(value, "error") as Record<string, unknown>;
  if (typeof code !== "string" || typeof message !== "string") return undefined;
  return { code, message, details: isRecord(details) ? details : {} };
}

function parseRetryAfter(header: string | null): number | undefined {
  return header !== null && /^\d{1,9}$/.test(header) ? Number(header) : undefined;
}

function parseNameTaken(
  details: Record<string, unknown>,
): { projectId: string; name: string } | undefined {
  const { projectId, name } = details;
  if (typeof projectId !== "string" || !isValidProjectId(projectId) || typeof name !== "string")
    return undefined;
  return { projectId, name };
}

/**
 * The three project calls of the management API (document version 0.6.0) over an injected `fetch`. No workspace
 * field is sent: the credential's scope picks the workspace. Responses are read narrowly: a field `setup` does not
 * use is ignored, so an additive API change does not break it (D4).
 */
export function createManagementClient(options: ManagementClientOptions): ManagementClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // `mutating` is a POST: it is never retried, and a lost or unreadable answer may still have taken effect (D5).
  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const mutating = method === "POST";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.credential.reveal()}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let status: number;
    let retryAfter: string | null;
    let text: string;
    try {
      const response = await options.fetch(`${MANAGEMENT_ORIGIN}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // A redirect would send the bearer credential to wherever it points.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      retryAfter = response.headers.get("Retry-After");
      text = await response.text();
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      const what = timedOut
        ? `no response within ${Math.round(timeoutMs / 1000)} s from ${MANAGEMENT_ORIGIN}`
        : `could not reach ${MANAGEMENT_ORIGIN} (${printable(cause instanceof Error ? cause.message : String(cause))})`;
      throw new ManagementError("failure", what + (mutating ? MAY_EXIST : ""), {
        outcomeUnknown: mutating,
      });
    }

    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }

    if (status === 401) {
      throw new ManagementError(
        "auth",
        "the API key was refused (401): a workspace API key is needed, created on the API keys page of the dashboard, not a project key",
        { status },
      );
    }
    if (status < 200 || status >= 300) {
      const envelope = parseEnvelope(json);
      if (envelope === undefined) {
        throw new ManagementError("failure", `unexpected response (status ${status})`, {
          status,
          outcomeUnknown: mutating && status >= 500,
        });
      }
      const retryAfterSeconds = status === 429 ? parseRetryAfter(retryAfter) : undefined;
      const suffix = retryAfterSeconds === undefined ? "" : ` (retry after ${retryAfterSeconds} s)`;
      const { maxProjects } = envelope.details;
      throw new ManagementError(
        "failure",
        printable(`${envelope.code}: ${envelope.message}`) + suffix,
        {
          status,
          code: printable(envelope.code),
          outcomeUnknown: mutating && status >= 500,
          retryAfterSeconds,
          maxProjects: typeof maxProjects === "number" ? maxProjects : undefined,
          nameTaken: envelope.code === "NAME_TAKEN" ? parseNameTaken(envelope.details) : undefined,
        },
      );
    }
    return { status, json };
  }

  function unexpected(status: number, mutating: boolean): ManagementError {
    return new ManagementError(
      "failure",
      `unexpected response (status ${status})${mutating ? MAY_EXIST : ""}`,
      {
        status,
        outcomeUnknown: mutating,
      },
    );
  }

  function checkedId(id: string): void {
    if (!isValidProjectId(id)) {
      throw new ManagementError(
        "failure",
        "a project id is lowercase letters, digits and hyphens, 1 to 63 characters",
      );
    }
  }

  return {
    async listProjects() {
      const { status, json } = await call("GET", "/api/projects");
      const projects = Array.isArray(json) ? json.map(parseSummary) : undefined;
      if (projects === undefined || projects.some((project) => project === undefined))
        throw unexpected(status, false);
      return projects as ProjectSummary[];
    },

    async createProject(name) {
      if (!isValidProjectName(name)) {
        throw new ManagementError("failure", "a project name is 1 to 200 characters");
      }
      const { status, json } = await call("POST", "/api/projects", { name });
      const project = isRecord(json) ? parseProject(field(json, "project")) : undefined;
      if (project === undefined) throw unexpected(status, true);
      return project;
    },

    async getProject(id) {
      checkedId(id);
      const { status, json } = await call("GET", `/api/projects/${id}`);
      const project = parseProject(json);
      if (project === undefined) throw unexpected(status, false);
      return project;
    },
  };
}
