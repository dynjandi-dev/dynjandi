import { describe, expect, it, vi } from "vitest";
import {
  createManagementClient,
  isValidProjectId,
  isValidProjectName,
  ManagementError,
} from "../../src/setup/api.js";
import { redact, Secret } from "../../src/setup/secret.js";
import {
  documentCreated,
  documentError,
  documentListedProject,
  documentProject,
  PROJECT_KEY,
  startStubManagement,
} from "../support/stub-management.js";

// Expected values come from the management API's published document, version 0.6.0 (read 2026-11-15,
// `https://app.dynjandi.dev/api/openapi.json`), and from the plan's D2 to D5 and D12, not from the code under test:
// - paths, methods and the request body: `listProjects`, `createProject` (body `{ name }`, no workspace field since
//   0.6.0 resolves the workspace from the key) and `getProject`; D4 says `setup` sends `Authorization: Bearer` and
//   `Accept: application/json`;
// - the status codes and their `code`s: the `Unauthorized`, `InvalidRequest`, `Forbidden`, `NameTaken`, `NotFound`,
//   `RateLimited` (with `Retry-After`) and `UpstreamError` responses; `details` of `NameTaken` is `{ projectId, name }`;
// - D12: only `error.code` and `error.message` of a server error are printed, any other body is
//   "unexpected response (status N)", and nothing holds a credential;
// - D5: `POST` is never retried and has a timeout; a create that gets no response says the project may exist.
// The key below is invented for these tests and belongs to nothing.
const CANARY = "dyn_canary_5d19e8a3c70b42f6";

function setup(options: { timeoutMs?: number } = {}) {
  const stub = startStubManagement();
  const client = createManagementClient({
    fetch: stub.fetch,
    credential: new Secret(CANARY),
    ...options,
  });
  return { stub, client };
}

async function failureOf(call: Promise<unknown>): Promise<ManagementError> {
  const error = await call.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ManagementError);
  return error as ManagementError;
}

describe("requests", () => {
  it("lists with GET /api/projects on the fixed origin, bearing the credential and asking for JSON", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", { kind: "response", status: 200, body: [] });

    await client.listProjects();

    const [request] = stub.requests;
    expect(stub.requests).toHaveLength(1);
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://app.dynjandi.dev/api/projects");
    expect(request?.headers.get("Authorization")).toBe(`Bearer ${CANARY}`);
    expect(request?.headers.get("Accept")).toBe("application/json");
    // A redirect would carry the bearer credential elsewhere: it is an error, never followed.
    expect(request?.redirect).toBe("error");
  });

  it("creates with POST /api/projects and the body { name } only", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 201,
      body: documentCreated(),
    });

    await client.createProject("my-app");

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://app.dynjandi.dev/api/projects");
    expect(request?.headers.get("Content-Type")).toBe("application/json");
    expect(request?.headers.get("Authorization")).toBe(`Bearer ${CANARY}`);
    // No workspace field: the key's scope picks the workspace (D4). `JSON.parse` so key order cannot matter.
    expect(JSON.parse(request?.body ?? "")).toEqual({ name: "my-app" });
  });

  it("reads one project with GET /api/projects/{id}", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects/my-app", {
      kind: "response",
      status: 200,
      body: documentProject(),
    });

    await client.getProject("my-app");

    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.url).toBe("https://app.dynjandi.dev/api/projects/my-app");
  });
});

describe("responses", () => {
  it("reads id and name from each listed project, and ignores the rest", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", {
      kind: "response",
      status: 200,
      body: [
        documentListedProject(),
        documentListedProject({ id: "shop", name: "Shop", futureField: { added: "later" } }),
      ],
    });

    expect(await client.listProjects()).toEqual([
      { id: "my-app", name: "my-app" },
      { id: "shop", name: "Shop" },
    ]);
  });

  it("reads id, name and the project key of a created project from the 201 body's project", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 201,
      body: documentCreated({ id: "shop", name: "Shop" }),
    });

    const project = await client.createProject("Shop");

    expect(project.id).toBe("shop");
    expect(project.name).toBe("Shop");
    expect(project.projectKey.reveal()).toBe(PROJECT_KEY);
  });

  it("reads a project from getProject's bare body", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects/my-app", {
      kind: "response",
      status: 200,
      body: documentProject(),
    });

    const project = await client.getProject("my-app");

    expect(project.id).toBe("my-app");
    expect(project.projectKey.reveal()).toBe(PROJECT_KEY);
  });

  it("holds the project key as a Secret that prints [redacted] and is scrubbed by redact()", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects/my-app", {
      kind: "response",
      status: 200,
      body: documentProject(),
    });

    const project = await client.getProject("my-app");

    expect(JSON.stringify(project)).not.toContain(PROJECT_KEY);
    expect(redact(`key ${PROJECT_KEY}`)).toBe("key [redacted]");
  });

  it.each([
    ["an id with a capital letter", { id: "My-App" }],
    ["an id that is not a string", { id: 7 }],
    ["a name that is not a string", { name: null }],
    ["a key that is not 64 lowercase hex characters", { projectKey: "abc" }],
    ["a key in upper case", { projectKey: PROJECT_KEY.toUpperCase() }],
    ["no key", { projectKey: undefined }],
  ])("refuses a project with %s as an unexpected response", async (_name, overrides) => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects/my-app", {
      kind: "response",
      status: 200,
      body: documentProject(overrides),
    });

    const failure = await failureOf(client.getProject("my-app"));

    expect(failure.kind).toBe("failure");
    expect(failure.message).toBe("unexpected response (status 200)");
    expect(failure.message).not.toContain(PROJECT_KEY);
  });

  it.each([
    ["not an array", { projects: [] }],
    ["an array holding a project with no name", [{ id: "my-app" }]],
  ])("refuses a list that is %s as an unexpected response", async (_name, body) => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", { kind: "response", status: 200, body });

    const failure = await failureOf(client.listProjects());

    expect(failure.message).toBe("unexpected response (status 200)");
  });

  it("refuses a 201 whose body is not the { project } wrapper", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 201,
      body: documentProject(),
    });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.message).toMatch(/^unexpected response \(status 201\)/);
  });
});

describe("failures", () => {
  it("maps 401 to an auth failure that asks for a workspace API key, whatever the body says", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", {
      kind: "response",
      status: 401,
      body: documentError("UNAUTHORIZED", `the key ${CANARY} is not valid`),
    });

    const failure = await failureOf(client.listProjects());

    expect(failure.kind).toBe("auth");
    expect(failure.status).toBe(401);
    expect(failure.message).toMatch(/workspace API key/);
    expect(failure.message).toMatch(/not a project key/);
    // The server's words are not printed for a 401: it "does not say which" reason, and D3 words the message.
    expect(failure.message).not.toContain("is not valid");
  });

  it("maps a 401 whose body is not the envelope to an auth failure too", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", {
      kind: "response",
      status: 401,
      rawBody: "<html>nope</html>",
    });

    expect((await failureOf(client.listProjects())).kind).toBe("auth");
  });

  it("maps 400 to a failure carrying only error.code and error.message", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 400,
      body: documentError("VALIDATION_FAILED", "Invalid request body", {
        formErrors: [],
        fieldErrors: { name: ["too long"] },
      }),
    });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.kind).toBe("failure");
    expect(failure.status).toBe(400);
    expect(failure.code).toBe("VALIDATION_FAILED");
    expect(failure.message).toBe("VALIDATION_FAILED: Invalid request body");
    expect(failure.outcomeUnknown).toBe(false);
  });

  it("maps 403 FORBIDDEN to a failure with its code and message", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 403,
      body: documentError("FORBIDDEN", "A key may not set storageQuota"),
    });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.status).toBe(403);
    expect(failure.code).toBe("FORBIDDEN");
    expect(failure.message).toBe("FORBIDDEN: A key may not set storageQuota");
  });

  it("maps 403 BILLING_INACTIVE to a failure with that code", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 403,
      body: documentError("BILLING_INACTIVE", "The workspace's plan is not active"),
    });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.code).toBe("BILLING_INACTIVE");
    expect(failure.maxProjects).toBeUndefined();
  });

  it("maps 403 PROJECT_LIMIT_REACHED to a failure that carries details.maxProjects", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 403,
      body: documentError("PROJECT_LIMIT_REACHED", "The workspace is at its project limit", {
        maxProjects: 3,
      }),
    });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.code).toBe("PROJECT_LIMIT_REACHED");
    expect(failure.maxProjects).toBe(3);
    expect(failure.message).toBe("PROJECT_LIMIT_REACHED: The workspace is at its project limit");
  });

  it("ignores a maxProjects that is not a number", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 403,
      body: documentError("PROJECT_LIMIT_REACHED", "At the limit", { maxProjects: "three" }),
    });

    expect((await failureOf(client.createProject("my-app"))).maxProjects).toBeUndefined();
  });

  it("maps 404 on a read to a failure with that code", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects/ghost", {
      kind: "response",
      status: 404,
      body: documentError("NOT_FOUND", "Project not found"),
    });

    const failure = await failureOf(client.getProject("ghost"));

    expect(failure.status).toBe(404);
    expect(failure.code).toBe("NOT_FOUND");
  });

  it("maps 409 NAME_TAKEN on create to a failure carrying details.projectId and details.name", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 409,
      body: documentError("NAME_TAKEN", "A project with this name exists", {
        projectId: "my-app",
        name: "My-App",
      }),
    });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.status).toBe(409);
    expect(failure.code).toBe("NAME_TAKEN");
    expect(failure.nameTaken).toEqual({ projectId: "my-app", name: "My-App" });
    // The create is not retried (D5): the caller reads the project named in details instead.
    expect(stub.requests).toHaveLength(1);
  });

  it("leaves nameTaken out when 409's details are not { projectId, name }", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 409,
      body: documentError("NAME_TAKEN", "Taken", { projectId: "Not A Slug", name: "x" }),
    });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.code).toBe("NAME_TAKEN");
    expect(failure.nameTaken).toBeUndefined();
  });

  it("maps 429 to a failure that names Retry-After", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", {
      kind: "response",
      status: 429,
      headers: { "Retry-After": "17" },
      body: documentError("RATE_LIMITED", "Too many requests"),
    });

    const failure = await failureOf(client.listProjects());

    expect(failure.status).toBe(429);
    expect(failure.code).toBe("RATE_LIMITED");
    expect(failure.retryAfterSeconds).toBe(17);
    expect(failure.message).toBe("RATE_LIMITED: Too many requests (retry after 17 s)");
  });

  it("maps 429 with no usable Retry-After to a failure without one", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", {
      kind: "response",
      status: 429,
      headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
      body: documentError("RATE_LIMITED", "Too many requests"),
    });

    const failure = await failureOf(client.listProjects());

    expect(failure.retryAfterSeconds).toBeUndefined();
    expect(failure.message).toBe("RATE_LIMITED: Too many requests");
  });

  it("maps 502 UPSTREAM_ERROR to a failure with that code", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", {
      kind: "response",
      status: 502,
      body: documentError("UPSTREAM_ERROR", "The image service could not be reached"),
    });

    const failure = await failureOf(client.listProjects());

    expect(failure.status).toBe(502);
    expect(failure.code).toBe("UPSTREAM_ERROR");
  });

  it.each([
    ["html", "<html>Bad gateway</html>"],
    ["plain text", "boom"],
    ["JSON that is not the envelope", JSON.stringify({ message: "boom", token: CANARY })],
    ["an envelope with no message", JSON.stringify({ error: { code: "X" } })],
    ["an empty body", ""],
  ])(
    "maps a non-401 error with a body that is %s to 'unexpected response (status N)'",
    async (_name, rawBody) => {
      const { stub, client } = setup();
      stub.answer("GET", "/api/projects", { kind: "response", status: 502, rawBody });

      const failure = await failureOf(client.listProjects());

      expect(failure.kind).toBe("failure");
      expect(failure.message).toBe("unexpected response (status 502)");
      expect(failure.code).toBeUndefined();
    },
  );

  it("keeps control characters out of a server's message, so it cannot drive the terminal", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", {
      kind: "response",
      status: 502,
      body: documentError("UPSTREAM_ERROR", "line\u001b[2Jone\ntwo"),
    });

    const failure = await failureOf(client.listProjects());

    expect(failure.message).toBe("UPSTREAM_ERROR: line [2Jone two");
  });
});

describe("a create that gets no usable answer", () => {
  it("says the project may exist and that the same command finds it by name, when the response is lost", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", { kind: "network-error", message: "fetch failed" });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.kind).toBe("failure");
    expect(failure.status).toBeUndefined();
    expect(failure.outcomeUnknown).toBe(true);
    expect(failure.message).toMatch(/project may exist/);
    expect(failure.message).toMatch(/running the same command again will find it by name/);
    // Never retried (D5).
    expect(stub.requests).toHaveLength(1);
  });

  it("gives up on a POST that never answers, after the timeout, and does not retry", async () => {
    const { stub, client } = setup({ timeoutMs: 20 });
    stub.answer("POST", "/api/projects", { kind: "hang" });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.outcomeUnknown).toBe(true);
    expect(failure.message).toMatch(/no response within/);
    expect(stub.requests).toHaveLength(1);
  });

  it("treats a 201 whose body cannot be read as an unknown outcome too", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", { kind: "response", status: 201, rawBody: "not json" });

    const failure = await failureOf(client.createProject("my-app"));

    expect(failure.outcomeUnknown).toBe(true);
    expect(failure.message).toMatch(/^unexpected response \(status 201\)/);
    expect(failure.message).toMatch(/project may exist/);
  });

  it("gives a POST a 30 s timeout by default (D5)", async () => {
    const { stub, client } = setup();
    stub.answer("POST", "/api/projects", {
      kind: "response",
      status: 201,
      body: documentCreated(),
    });
    const timeout = vi.spyOn(AbortSignal, "timeout");

    try {
      await client.createProject("my-app");
      expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
    } finally {
      timeout.mockRestore();
    }
    expect(stub.requests[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a lost read as a failure that is not an unknown outcome", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", { kind: "network-error", message: "fetch failed" });

    const failure = await failureOf(client.listProjects());

    expect(failure.outcomeUnknown).toBe(false);
    expect(failure.message).toMatch(/could not reach https:\/\/app\.dynjandi\.dev/);
  });
});

describe("the credential never leaves in a message", () => {
  it.each([
    ["a 400 that echoes the key", 400, "VALIDATION_FAILED"],
    ["a 403 that echoes the key", 403, "FORBIDDEN"],
    ["a 404 that echoes the key", 404, "NOT_FOUND"],
    ["a 429 that echoes the key", 429, "RATE_LIMITED"],
    ["a 502 that echoes the key", 502, "UPSTREAM_ERROR"],
  ])("for %s", async (_name, status, code) => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", {
      kind: "response",
      status,
      body: documentError(code, `bad credential ${CANARY} and project key ${PROJECT_KEY}`),
    });

    const failure = await failureOf(client.listProjects());

    expect(failure.message).not.toContain(CANARY);
    expect(failure.message).toContain("[redacted]");
    expect(JSON.stringify(failure)).not.toContain(CANARY);
    expect(String(failure.stack)).not.toContain(CANARY);
  });

  it("for a network error that echoes the key", async () => {
    const { stub, client } = setup();
    stub.answer("GET", "/api/projects", {
      kind: "network-error",
      message: `connect failed for ${CANARY}`,
    });

    const failure = await failureOf(client.listProjects());

    expect(failure.message).not.toContain(CANARY);
  });
});

describe("inputs", () => {
  it.each([
    ["one character", "a", true],
    ["200 characters", "a".repeat(200), true],
    ["empty", "", false],
    ["201 characters", "a".repeat(201), false],
  ])("a name of %s is valid: %s", (_label, name, valid) => {
    // The document: `name` has minLength 1 and maxLength 200.
    expect(isValidProjectName(name)).toBe(valid);
  });

  it.each([
    ["a slug", "my-app", true],
    ["a digit first", "1app", true],
    ["63 characters", `a${"b".repeat(62)}`, true],
    ["64 characters", `a${"b".repeat(63)}`, false],
    ["a hyphen first", "-app", false],
    ["a capital", "My-App", false],
    ["a slash", "a/b", false],
    ["empty", "", false],
  ])("an id of %s is valid: %s", (_label, id, valid) => {
    // The document: id pattern `^[a-z0-9][a-z0-9-]{0,62}$`.
    expect(isValidProjectId(id)).toBe(valid);
  });

  it("makes no request for a name outside 1 to 200 characters", async () => {
    const { stub, client } = setup();

    const failure = await failureOf(client.createProject("a".repeat(201)));

    expect(failure.message).toMatch(/1 to 200 characters/);
    expect(stub.requests).toHaveLength(0);
  });

  it("makes no request for an id that could change the path", async () => {
    const { stub, client } = setup();

    const failure = await failureOf(client.getProject("../workspace"));

    expect(failure.message).toMatch(/project id/);
    expect(stub.requests).toHaveLength(0);
  });
});
