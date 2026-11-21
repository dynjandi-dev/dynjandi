import { describe, expect, test } from "vitest";

// D16: the management API's published document, fetched with no key, still has what `dynjandi setup` uses:
// the three project calls, the fields `src/setup/api.ts` reads from their answers, the error envelope, and the two
// device-authorization calls of the browser approval (D18) with the credential they hand out.
// NOT part of `pnpm test` (see `test` and `test:management` in package.json): it needs the network and can go
// red with nothing in the diff, which is its job. `.github/workflows/management-api.yml` runs it daily.
//
// Expected values come from `src/setup/api.ts`'s reading of each answer (D4: only `id`, `name` and `projectKey`
// are read; the approval reads the six fields of the start answer and the three of the token answer) and from the
// document at version 0.6.0 (read 2026-11-15 and 2026-11-16), not from running the client.

const DOCUMENT_URL = "https://app.dynjandi.dev/api/openapi.json";
// The document's id pattern; `isValidProjectId` in src/setup/api.ts must accept what it accepts.
const ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,62}$";

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isJson(current)) return undefined;
    current = current[key];
  }
  return current;
}

const document: Json = await (async () => {
  const response = await fetch(DOCUMENT_URL, { signal: AbortSignal.timeout(30_000) });
  if (response.status !== 200) throw new Error(`${DOCUMENT_URL} answered ${response.status}`);
  const body: unknown = await response.json();
  if (!isJson(body)) throw new Error(`${DOCUMENT_URL} did not answer a JSON object`);
  return body;
})();

// Follows a local `$ref` such as `#/components/responses/NameTaken`.
function resolve(value: unknown): unknown {
  const ref = at(value, "$ref");
  if (typeof ref !== "string") return value;
  expect(ref.startsWith("#/"), `a $ref this test does not follow: ${ref}`).toBe(true);
  return resolve(at(document, ...ref.slice(2).split("/")));
}

function operation(path: string, method: "get" | "post"): unknown {
  return at(document, "paths", path, method);
}

function jsonSchema(content: unknown): unknown {
  return resolve(at(resolve(content), "content", "application/json", "schema"));
}

function responseSchema(op: unknown, status: string): unknown {
  return jsonSchema(at(op, "responses", status));
}

/** `schema.properties.<name>` of an object schema, which must also list it as required. */
function requiredProperty(schema: unknown, name: string): unknown {
  const required = at(schema, "required");
  expect(Array.isArray(required) && required.includes(name), `${name} is required`).toBe(true);
  const property = resolve(at(schema, "properties", name));
  expect(property, `${name} is a property`).toBeDefined();
  return property;
}

function expectString(schema: unknown): void {
  expect(at(schema, "type")).toBe("string");
}

function expectBearer(op: unknown): void {
  const security = at(op, "security") ?? at(document, "security");
  expect(Array.isArray(security)).toBe(true);
  expect((security as Json[]).some((requirement) => "bearerAuth" in requirement)).toBe(true);
}

const LIST = "/api/projects";
const ONE = "/api/projects/{id}";

describe("the management API's document", () => {
  test("is an OpenAPI 3 document on the origin setup talks to", () => {
    expect(String(at(document, "openapi"))).toMatch(/^3\./);
    expect(at(document, "servers")).toEqual([{ url: "https://app.dynjandi.dev" }]);
  });

  test("a workspace API key is a bearer credential", () => {
    expect(at(document, "components", "securitySchemes", "bearerAuth", "type")).toBe("http");
    expect(at(document, "components", "securitySchemes", "bearerAuth", "scheme")).toBe("bearer");
  });

  test("GET /api/projects lists projects with an id and a name", () => {
    const op = operation(LIST, "get");
    expect(op).toBeDefined();
    expectBearer(op);
    const schema = responseSchema(op, "200");
    expect(at(schema, "type")).toBe("array");
    const item = resolve(at(schema, "items"));
    const id = requiredProperty(item, "id");
    expectString(id);
    expect(at(id, "pattern")).toBe(ID_PATTERN);
    expectString(requiredProperty(item, "name"));
    expect(at(op, "responses", "401")).toBeDefined();
  });

  test("POST /api/projects takes a name of 1 to 200 characters and answers 201 with the project and its key", () => {
    const op = operation(LIST, "post");
    expect(op).toBeDefined();
    expectBearer(op);

    const body = jsonSchema(at(op, "requestBody"));
    // `setup` creates a project with `{ name }` only (D4), so a second required field would break its create.
    expect(at(body, "required")).toEqual(["name"]);
    const name = requiredProperty(body, "name");
    expectString(name);
    expect(at(name, "minLength")).toBe(1);
    expect(at(name, "maxLength")).toBe(200);

    const project = resolve(requiredProperty(responseSchema(op, "201"), "project"));
    expectString(requiredProperty(project, "id"));
    expectString(requiredProperty(project, "name"));
    expectString(requiredProperty(project, "projectKey"));
    expect(at(op, "responses", "401")).toBeDefined();
  });

  test("POST /api/projects answers 409 NAME_TAKEN with the existing project's id and stored name", () => {
    const schema = responseSchema(operation(LIST, "post"), "409");
    const error = resolve(requiredProperty(schema, "error"));
    expect(at(requiredProperty(error, "code"), "const")).toBe("NAME_TAKEN");
    const details = resolve(requiredProperty(error, "details"));
    expectString(requiredProperty(details, "projectId"));
    expectString(requiredProperty(details, "name"));
  });

  test("GET /api/projects/{id} answers 200 with the id, name and key, and 404 for another project", () => {
    const op = operation(ONE, "get");
    expect(op).toBeDefined();
    expectBearer(op);
    const parameters = at(op, "parameters");
    expect(Array.isArray(parameters)).toBe(true);
    const idParameter = (parameters as Json[]).map(resolve).find((p) => at(p, "name") === "id");
    expect(at(idParameter, "in")).toBe("path");
    expect(at(idParameter, "schema", "pattern")).toBe(ID_PATTERN);

    const schema = responseSchema(op, "200");
    expectString(requiredProperty(schema, "id"));
    expectString(requiredProperty(schema, "name"));
    expectString(requiredProperty(schema, "projectKey"));
    expect(at(op, "responses", "404")).toBeDefined();
    expect(at(op, "responses", "401")).toBeDefined();
  });

  test("an error is { error: { code, message } } with an optional details object", () => {
    const schema = resolve(at(document, "components", "schemas", "Error"));
    const error = resolve(requiredProperty(schema, "error"));
    expectString(requiredProperty(error, "code"));
    expectString(requiredProperty(error, "message"));
    expect(at(error, "properties", "details", "type")).toBe("object");
  });

  test("a 429 carries Retry-After as whole seconds", () => {
    const response = resolve(at(operation(LIST, "post"), "responses", "429"));
    expect(at(response, "headers", "Retry-After", "schema", "type")).toBe("integer");
  });
});

const DEVICE_CODE = "/api/device/code";
const DEVICE_TOKEN = "/api/device/token";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

function expectNoSecurity(op: unknown): void {
  expect(at(op, "security")).toEqual([]);
}

describe("the management API's document: browser approval (D18)", () => {
  test("the CLI credential is a bearer scheme, and the three project calls accept it", () => {
    expect(at(document, "components", "securitySchemes", "cliToken", "type")).toBe("http");
    expect(at(document, "components", "securitySchemes", "cliToken", "scheme")).toBe("bearer");
    for (const [path, method] of [
      [LIST, "get"],
      [LIST, "post"],
      [ONE, "get"],
    ] as const) {
      const security = at(operation(path, method), "security");
      expect(Array.isArray(security), `${method} ${path} has a security list`).toBe(true);
      expect((security as Json[]).some((requirement) => "cliToken" in requirement)).toBe(true);
    }
  });

  test("POST /api/device/code is public, takes a client_id, and answers the six fields setup reads", () => {
    const op = operation(DEVICE_CODE, "post");
    expect(op).toBeDefined();
    expectNoSecurity(op);
    expectString(requiredProperty(jsonSchema(at(op, "requestBody")), "client_id"));

    const schema = responseSchema(op, "200");
    for (const name of [
      "device_code",
      "user_code",
      "verification_uri",
      "verification_uri_complete",
    ]) {
      expectString(requiredProperty(schema, name));
    }
    expect(at(requiredProperty(schema, "expires_in"), "type")).toBe("integer");
    expect(at(requiredProperty(schema, "interval"), "type")).toBe("integer");
    expect(at(op, "responses", "429")).toBeDefined();
  });

  test("POST /api/device/token is public, takes the grant, and answers access_token, token_type Bearer, expires_in", () => {
    const op = operation(DEVICE_TOKEN, "post");
    expect(op).toBeDefined();
    expectNoSecurity(op);

    const body = jsonSchema(at(op, "requestBody"));
    expect(at(requiredProperty(body, "grant_type"), "const")).toBe(DEVICE_GRANT);
    expectString(requiredProperty(body, "device_code"));
    expectString(requiredProperty(body, "client_id"));

    const schema = responseSchema(op, "200");
    expectString(requiredProperty(schema, "access_token"));
    expect(at(requiredProperty(schema, "token_type"), "const")).toBe("Bearer");
    expect(at(requiredProperty(schema, "expires_in"), "type")).toBe("integer");
  });

  test("an approval's outcomes are 400s in the error envelope, with RFC 8628's strings as the code", () => {
    const error = resolve(
      requiredProperty(responseSchema(operation(DEVICE_TOKEN, "post"), "400"), "error"),
    );
    const codes = at(requiredProperty(error, "code"), "enum");
    expect(Array.isArray(codes)).toBe(true);
    for (const code of [
      "authorization_pending",
      "slow_down",
      "access_denied",
      "expired_token",
      "invalid_grant",
    ]) {
      expect(codes, code).toContain(code);
    }
  });
});
