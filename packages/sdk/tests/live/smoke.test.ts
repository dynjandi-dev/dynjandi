/// <reference types="node" />

import { describe, expect, test } from "vitest";
import { createClient } from "../../src/index";

// Live smoke test: real network, real service, a dedicated test project. It is NOT part of `pnpm test`
// (see `test` and `test:live` in package.json). See context/verify.md, "Not run by Gate 1".

const KEY_VARIABLE = "DYNJANDI_SMOKE_PUBLIC_KEY";

// A valid 1x1 PNG, so no binary fixture is tracked.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// A variant is rendered on first request, so a fresh upload can answer 404 or 5xx for a moment.
// Retry only those, a few times; any other status is a real failure and fails immediately.
const VARIANT_ATTEMPTS = 4;
const VARIANT_RETRY_DELAY_MS = 1000;

function requirePublicKey(): string {
  const key = process.env[KEY_VARIABLE];
  if (key === undefined || key === "") {
    // A skipped smoke test would be a false green, so an unset key fails the run.
    throw new Error(
      `${KEY_VARIABLE} is not set. Locally, load it from .env (see context/verify.md); in CI it is an Actions secret.`,
    );
  }
  return key;
}

function isRetryable(status: number): boolean {
  return status === 404 || status >= 500;
}

async function fetchVariant(url: string): Promise<Response> {
  let response = await fetch(url);
  for (let attempt = 1; attempt < VARIANT_ATTEMPTS && isRetryable(response.status); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, VARIANT_RETRY_DELAY_MS));
    response = await fetch(url);
  }
  return response;
}

describe("live service", () => {
  test("uploads an image, reads its record back and serves variants of it", {
    timeout: 30_000,
  }, async () => {
    const client = createClient({ publicKey: requirePublicKey() });
    const png = Uint8Array.from(atob(PNG_1X1_BASE64), (char) => char.charCodeAt(0));

    const uploaded = await client.upload(new File([png], "smoke.png", { type: "image/png" }), {
      focal: { x: 0.5, y: 0.5 },
    });

    expect(uploaded.file).toBe(uploaded.id);
    expect(uploaded.url).toBe(`https://cdn.dynjandi.dev/${uploaded.id}`);
    expect(uploaded.focalX).toBe(0.5);
    expect(uploaded.focalY).toBe(0.5);

    const variantUrl = client.url(uploaded.id, { width: 16, format: "webp" });
    const response = await fetchVariant(variantUrl);

    expect(response.status, `GET ${variantUrl}`).toBe(200);
    expect(response.headers.get("content-type") ?? "").toMatch(/^image\//);

    // The record read back carries the point the upload stored.
    const record = await client.getFile(uploaded.id);

    expect(record.id).toBe(uploaded.id);
    expect(record.focalX).toBe(0.5);
    expect(record.focalY).toBe(0.5);

    // A crop that names neither `focal` nor `position` uses the record's stored point.
    const focalUrl = client.url(record, { crop: { width: 16, height: 16 } });

    expect(focalUrl).toMatch(/focal\/0\.5x0\.5\/$/);

    const focalResponse = await fetchVariant(focalUrl);

    expect(focalResponse.status, `GET ${focalUrl}`).toBe(200);
    expect(focalResponse.headers.get("content-type") ?? "").toMatch(/^image\//);
  });
});
