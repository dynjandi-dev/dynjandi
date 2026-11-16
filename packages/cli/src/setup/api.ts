import { parseApiKey, redact, Secret } from "./secret.js";

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
  /** What a `401` says, where the default (a workspace API key is needed) would be wrong: an approval that timed out (D18). */
  unauthorizedMessage?: string;
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
export function scrub(text: string): string {
  return Array.from(text, (char) => (isControl(char) ? " " : char)).join("");
}

/** `scrub`, and at most 500 characters, so one answer cannot flood the terminal. For a server's own text. */
export function printable(text: string): string {
  return scrub(text.slice(0, MAX_MESSAGE_LENGTH));
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

interface SendOptions {
  fetch: typeof fetch;
  timeoutMs: number;
  /** Sent as the bearer credential; the device calls (D18) have none. */
  credential?: Secret | undefined;
  unauthorizedMessage?: string | undefined;
}

const WORKSPACE_KEY_NEEDED =
  "the API key was refused (401): a workspace API key is needed, created on the API keys page of the dashboard, not a project key";

function unexpectedResponse(status: number, mayHaveCreated: boolean): ManagementError {
  return new ManagementError(
    "failure",
    `unexpected response (status ${status})${mayHaveCreated ? MAY_EXIST : ""}`,
    { status, outcomeUnknown: mayHaveCreated },
  );
}

// `mayHaveCreated` is a POST that creates a project: it is never retried, and a lost or unreadable answer may still
// have taken effect (D5).
async function send(
  options: SendOptions,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  mayHaveCreated: boolean,
): Promise<{ status: number; json: unknown }> {
  const mutating = mayHaveCreated;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.credential !== undefined) {
    headers["Authorization"] = `Bearer ${options.credential.reveal()}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const { timeoutMs } = options;

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
    throw new ManagementError("auth", options.unauthorizedMessage ?? WORKSPACE_KEY_NEEDED, {
      status,
    });
  }
  if (status < 200 || status >= 300) {
    // A 5xx to a create may come from a proxy after the server committed it: the answer is lost, as in D5.
    const outcomeUnknown = mutating && status >= 500;
    const envelope = parseEnvelope(json);
    if (envelope === undefined) throw unexpectedResponse(status, outcomeUnknown);
    const retryAfterSeconds = status === 429 ? parseRetryAfter(retryAfter) : undefined;
    const suffix = retryAfterSeconds === undefined ? "" : ` (retry after ${retryAfterSeconds} s)`;
    const { maxProjects } = envelope.details;
    throw new ManagementError(
      "failure",
      printable(`${envelope.code}: ${envelope.message}`) +
        suffix +
        (outcomeUnknown ? MAY_EXIST : ""),
      {
        status,
        code: printable(envelope.code),
        outcomeUnknown,
        retryAfterSeconds,
        maxProjects: typeof maxProjects === "number" ? maxProjects : undefined,
        nameTaken: envelope.code === "NAME_TAKEN" ? parseNameTaken(envelope.details) : undefined,
      },
    );
  }
  return { status, json };
}

/**
 * The three project calls of the management API (document version 0.6.0) over an injected `fetch`. No workspace
 * field is sent: the credential's scope picks the workspace. Responses are read narrowly: a field `setup` does not
 * use is ignored, so an additive API change does not break it (D4).
 */
export function createManagementClient(options: ManagementClientOptions): ManagementClient {
  const settings: SendOptions = {
    fetch: options.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    credential: options.credential,
    unauthorizedMessage: options.unauthorizedMessage,
  };
  const call = (method: "GET" | "POST", path: string, body?: unknown) =>
    send(settings, method, path, body, method === "POST");
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
        throw unexpectedResponse(status, false);
      return projects as ProjectSummary[];
    },

    async createProject(name) {
      if (!isValidProjectName(name)) {
        throw new ManagementError("failure", "a project name is 1 to 200 characters");
      }
      const { status, json } = await call("POST", "/api/projects", { name });
      const project = isRecord(json) ? parseProject(field(json, "project")) : undefined;
      if (project === undefined) throw unexpectedResponse(status, true);
      return project;
    },

    async getProject(id) {
      checkedId(id);
      const { status, json } = await call("GET", `/api/projects/${id}`);
      const project = parseProject(json);
      if (project === undefined) throw unexpectedResponse(status, false);
      return project;
    },
  };
}

// ---- Browser approval: the device-authorization grant (RFC 8628), document version 0.6.0 (D18) ----

const CLIENT_ID = "dynjandi-cli";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const USER_CODE_PATTERN = /^[A-Za-z0-9-]{1,32}$/;

/**
 * The address to approve at, only when it is an `https://app.dynjandi.dev/` one with no credentials in it (D18):
 * anything else is never shown as a link and never opened. Returns the normalised address.
 */
export function approvalUrl(text: string): string | undefined {
  try {
    const url = new URL(text);
    const ok =
      url.protocol === "https:" &&
      url.origin === MANAGEMENT_ORIGIN &&
      url.username === "" &&
      url.password === "";
    return ok ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** What starting an approval answers. The device code is a credential, so it is a `Secret`. */
export interface DeviceAuthorization {
  deviceCode: Secret;
  userCode: string;
  /** `verification_uri_complete`, already checked to be on the management origin. */
  url: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

/** One poll's answer. `dead` is `invalid_grant`: an unknown or used code, or an approver who no longer qualifies. */
export type DevicePoll =
  | { kind: "approved"; token: Secret }
  | { kind: "pending" }
  | { kind: "slow-down" }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "dead" };

export interface DeviceClient {
  start(): Promise<DeviceAuthorization>;
  poll(deviceCode: Secret): Promise<DevicePoll>;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseDeviceAuthorization(value: unknown): DeviceAuthorization | undefined {
  if (!isRecord(value)) return undefined;
  const deviceCode = field(value, "device_code");
  const userCode = field(value, "user_code");
  const uri = field(value, "verification_uri_complete");
  const expiresIn = field(value, "expires_in");
  const interval = field(value, "interval");
  if (typeof deviceCode !== "string" || deviceCode === "") return undefined;
  if (typeof userCode !== "string" || !USER_CODE_PATTERN.test(userCode)) return undefined;
  const url = typeof uri === "string" ? approvalUrl(uri) : undefined;
  if (url === undefined || !positiveInteger(expiresIn) || !positiveInteger(interval)) {
    return undefined;
  }
  return {
    deviceCode: new Secret(deviceCode),
    userCode,
    url,
    expiresInSeconds: expiresIn,
    intervalSeconds: interval,
  };
}

const POLL_OUTCOMES = new Map<string, DevicePoll>([
  ["authorization_pending", { kind: "pending" }],
  ["slow_down", { kind: "slow-down" }],
  ["access_denied", { kind: "denied" }],
  ["expired_token", { kind: "expired" }],
  ["invalid_grant", { kind: "dead" }],
]);

/**
 * The two device calls over an injected `fetch`. They are public: no credential is sent. Protocol outcomes are `400`
 * in the dashboard's error envelope, with RFC 8628's strings as `error.code`, not RFC 8628's flat body.
 */
export function createDeviceClient(options: {
  fetch: typeof fetch;
  timeoutMs?: number;
}): DeviceClient {
  const settings: SendOptions = {
    fetch: options.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  return {
    async start() {
      const { status, json } = await send(
        settings,
        "POST",
        "/api/device/code",
        { client_id: CLIENT_ID },
        false,
      );
      const authorization = parseDeviceAuthorization(json);
      if (authorization === undefined) throw unexpectedResponse(status, false);
      return authorization;
    },

    async poll(deviceCode) {
      try {
        const { status, json } = await send(
          settings,
          "POST",
          "/api/device/token",
          {
            grant_type: DEVICE_GRANT,
            device_code: deviceCode.reveal(),
            client_id: CLIENT_ID,
          },
          false,
        );
        const accessToken = isRecord(json) ? field(json, "access_token") : undefined;
        const tokenType = isRecord(json) ? field(json, "token_type") : undefined;
        const token = typeof accessToken === "string" ? parseApiKey(accessToken) : undefined;
        if (token === undefined || tokenType !== "Bearer") throw unexpectedResponse(status, false);
        return { kind: "approved", token };
      } catch (error) {
        if (error instanceof ManagementError && error.status === 400 && error.code !== undefined) {
          const outcome = POLL_OUTCOMES.get(error.code);
          if (outcome !== undefined) return outcome;
        }
        throw error;
      }
    },
  };
}
