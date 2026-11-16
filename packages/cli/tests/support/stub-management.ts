/** What the stub was sent. */
export interface RecordedManagementRequest {
  method: string;
  url: string;
  headers: Headers;
  body: string | undefined;
  signal: AbortSignal | null | undefined;
  redirect: RequestRedirect | undefined;
}

/** One scripted answer: a response, or a failure to get one. */
export type ManagementAnswer =
  | {
      kind: "response";
      status: number;
      body?: unknown;
      rawBody?: string;
      headers?: Record<string, string>;
    }
  /** `fetch` rejects, as when the connection drops or the host cannot be reached. */
  | { kind: "network-error"; message: string }
  /** Never answers, until the request's signal aborts (the client's timeout): then rejects as `fetch` does. */
  | { kind: "hang" };

export interface StubManagement {
  /** Pass this as the client's `fetch`. */
  fetch: typeof fetch;
  requests: RecordedManagementRequest[];
  /** Queues the answer for the next request to `METHOD /path`; a request with nothing queued fails the test. */
  answer: (method: string, path: string, answer: ManagementAnswer) => void;
}

/**
 * A stand-in for the dashboard's management API (`https://app.dynjandi.dev/api`, document version 0.6.0). It is a
 * `fetch`, so no port is opened. It records what it received and answers as told; it checks nothing itself.
 */
export function startStubManagement(): StubManagement {
  const requests: RecordedManagementRequest[] = [];
  const queued = new Map<string, ManagementAnswer[]>();

  const stubFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({
      method,
      url: url.href,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
      signal: init?.signal,
      redirect: init?.redirect,
    });

    const key = `${method} ${url.origin}${url.pathname}`;
    const answer = queued.get(key)?.shift();
    if (answer === undefined) throw new Error(`stub-management: nothing queued for ${key}`);

    if (answer.kind === "network-error") throw new TypeError(answer.message);
    if (answer.kind === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }
    const body = answer.rawBody ?? (answer.body === undefined ? "" : JSON.stringify(answer.body));
    return new Response(body, {
      status: answer.status,
      headers: { "Content-Type": "application/json", ...answer.headers },
    });
  };

  return {
    fetch: stubFetch as typeof fetch,
    requests,
    answer: (method, path, answer) => {
      const key = `${method} https://app.dynjandi.dev${path}`;
      queued.set(key, [...(queued.get(key) ?? []), answer]);
    },
  };
}

// The shapes below are copied from the document `https://app.dynjandi.dev/api/openapi.json`, version 0.6.0, read
// 2026-11-15: `listProjects` 200, `createProject` 201 and `getProject` 200, and the `Error` envelope and the
// `NameTaken` response. Every property the document marks required is present, including the ones `setup` ignores.

export const PROJECT_KEY = "a".repeat(32) + "0123456789abcdef".repeat(2);

/** A project as the document's `getProject` 200 answers it (`usage` has `fileCount`); `listProjects` adds the limits. */
export function documentProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "my-app",
    name: "my-app",
    workspaceId: "acme",
    tenantId: "acme",
    projectKey: PROJECT_KEY,
    publicKey: PROJECT_KEY,
    storageQuota: 1073741824,
    originPullEnabled: false,
    customHostname: null,
    maxFileSize: 10485760,
    createdAt: "2026-11-15T09:30:00.000Z",
    usage: { fileCount: 0, bytesUsed: 0 },
    ...overrides,
  };
}

/** A project as the document's `listProjects` 200 answers it: `usage` is `bytesUsed` only, plus the two limits. */
export function documentListedProject(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return documentProject({
    usage: { bytesUsed: 0 },
    storageLimitBytes: 1073741824,
    storageLimitSource: "project",
    ...overrides,
  });
}

/** A project as the document's `createProject` 201 answers it: wrapped in `project`, with no `usage`. */
export function documentCreated(overrides: Record<string, unknown> = {}): {
  project: Record<string, unknown>;
} {
  const { usage: _usage, ...project } = documentProject(overrides);
  return { project };
}

/** The document's `Error` envelope: `{ error: { code, message, details? } }`. */
export function documentError(
  code: string,
  message: string,
  details?: unknown,
): { error: Record<string, unknown> } {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

// ---- Browser approval (D18) ----
// The shapes below are copied from the same document, version 0.6.0: `startDeviceAuthorization` 200 (the six
// fields it marks required), `pollDeviceToken` 200 (`access_token`, `token_type: "Bearer"`, `expires_in`), and the
// `400` outcomes, which are in the `Error` envelope with `error.code` set to RFC 8628's string.

export const DEVICE_CODE = `dc_${"9f".repeat(20)}`;
export const USER_CODE = "ABCD-EFGH";
export const APPROVAL_URL = "https://app.dynjandi.dev/device?user_code=ABCD-EFGH";
export const CLI_TOKEN = `dyn_cli_${"7e".repeat(16)}`;

export function documentDeviceCode(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    device_code: DEVICE_CODE,
    user_code: USER_CODE,
    verification_uri: "https://app.dynjandi.dev/device",
    verification_uri_complete: APPROVAL_URL,
    expires_in: 600,
    interval: 5,
    ...overrides,
  };
}

export function documentDeviceToken(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { access_token: CLI_TOKEN, token_type: "Bearer", expires_in: 300, ...overrides };
}

/** One answer of `POST /api/device/token`: still waiting, told to slow down, decided, or approved. */
export type ApprovalStep =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "invalid_grant"
  | "approved";

/** Queues `POST /api/device/code`'s answer and then one `POST /api/device/token` answer per step, in order. */
export function playApproval(
  stub: StubManagement,
  steps: ApprovalStep[],
  options: { start?: Record<string, unknown> | null; token?: Record<string, unknown> } = {},
): void {
  if (options.start !== null) {
    stub.answer("POST", "/api/device/code", {
      kind: "response",
      status: 200,
      body: documentDeviceCode(options.start ?? {}),
    });
  }
  playPolls(stub, steps, options.token);
}

/** Queues only the token answers, for a run that resumes from the pending file. */
export function playPolls(
  stub: StubManagement,
  steps: ApprovalStep[],
  token: Record<string, unknown> = {},
): void {
  for (const step of steps) {
    stub.answer(
      "POST",
      "/api/device/token",
      step === "approved"
        ? { kind: "response", status: 200, body: documentDeviceToken(token) }
        : { kind: "response", status: 400, body: documentError(step, `the ${step} outcome`) },
    );
  }
}

/** A clock that only moves when something sleeps, so a test never waits a real second. */
export function fakeClock(start = Date.UTC(2026, 10, 16, 12, 0, 0)) {
  let time = start;
  const sleeps: number[] = [];
  return {
    start,
    sleeps,
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    elapsed: () => time - start,
  };
}

export interface OpenerCall {
  command: string;
  args: string[];
  options: unknown;
}

/**
 * A `spawn` that records what it was asked to run and starts nothing. `behaviour`: `ok`, `throws` (the call itself
 * fails) or `error-event` (the child reports ENOENT later, as a missing `xdg-open` does).
 */
export function fakeOpener(behaviour: "ok" | "throws" | "error-event" = "ok") {
  const calls: OpenerCall[] = [];
  const state = { unrefs: 0, errorListeners: 0 };
  const spawn = (command: string, args: string[], options: unknown) => {
    calls.push({ command, args, options });
    if (behaviour === "throws") throw new Error("spawn xdg-open ENOENT");
    return {
      on: (_event: "error", listener: () => void) => {
        state.errorListeners += 1;
        if (behaviour === "error-event") listener();
      },
      unref: () => {
        state.unrefs += 1;
      },
    };
  };
  return { calls, state, spawn };
}
