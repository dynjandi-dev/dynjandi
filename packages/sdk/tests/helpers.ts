import { vi } from "vitest";

export const PUBLIC_KEY = "pk_test_0123456789abcdef";

export const UPLOAD_BODY = {
  file: "00000000-0000-4000-8000-000000000000",
  id: "00000000-0000-4000-8000-000000000000",
  url: "/00000000-0000-4000-8000-000000000000",
  focalX: null,
  focalY: null,
};

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** An injected `fetch` that answers every call with `respond()`. */
export function fakeFetch(respond: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async () => respond());
}

/** The request a fake fetch received on its first call, taken apart for assertions. */
export function firstRequest(fetchMock: ReturnType<typeof fakeFetch>) {
  const [input, init] = fetchMock.mock.calls[0] ?? [];
  if (typeof input !== "string" || init === undefined || !(init.body instanceof FormData)) {
    throw new Error("Expected fetch(url: string, { body: FormData })");
  }
  return { url: input, method: init.method, headers: new Headers(init.headers), form: init.body };
}

export function aFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
}

export const FILE_ID = "00000000-0000-4000-8000-000000000000";

export const FILE_BODY = {
  id: FILE_ID,
  contentType: "image/png",
  bytes: 70,
  originalFilename: "photo.png",
  source: "upload",
  focalX: 0.42,
  focalY: 0.18,
  createdAt: "2026-10-04T12:00:00.000Z",
};

/** The request a fake fetch received on its first call, for calls that carry no body. */
export function firstGetRequest(fetchMock: ReturnType<typeof fakeFetch>) {
  const [input, init] = fetchMock.mock.calls[0] ?? [];
  if (typeof input !== "string" || init === undefined) {
    throw new Error("Expected fetch(url: string, init)");
  }
  return { url: input, method: init.method, headers: new Headers(init.headers), body: init.body };
}
