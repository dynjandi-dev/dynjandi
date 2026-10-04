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

// Each new variant counts against the test project's cap, so the responsive checks below create exactly
// three (a 320w png, a 320w avif and the placeholder) on top of the 16w webp above. Keep it at three.
const CANDIDATE_WIDTH = 320;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Width is the big-endian uint32 at bytes 16-19: after the 8-byte signature and the IHDR chunk's length
// and type fields.
function readPngWidth(bytes: Uint8Array): number {
  expect(Array.from(bytes.slice(0, 8)), "PNG signature").toEqual(PNG_SIGNATURE);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16);
}

// ISOBMFF: bytes 0-3 are the ftyp box size (big-endian), 4-7 the type "ftyp", 8-11 the major brand, 12-15
// the minor version, then compatible brands (4 bytes each) up to the box size.
function expectAvifFtyp(bytes: Uint8Array): void {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  expect(ascii(4, 8), "ISOBMFF box type").toBe("ftyp");
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const majorBrand = ascii(8, 12);
  const brands = [majorBrand];
  for (let offset = 16; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
    brands.push(ascii(offset, offset + 4));
  }
  const isAvif = majorBrand === "avif" || majorBrand === "avis" || brands.includes("avif");
  expect(isAvif, `ftyp brands: ${brands.join(",")}`).toBe(true);
}

describe("live service", () => {
  const client = createClient({ publicKey: requirePublicKey() });
  let fileId: string;

  test("uploads an image and serves a variant of it", { timeout: 30_000 }, async () => {
    const png = Uint8Array.from(atob(PNG_1X1_BASE64), (char) => char.charCodeAt(0));

    const uploaded = await client.upload(new File([png], "smoke.png", { type: "image/png" }), {
      focal: { x: 0.5, y: 0.5 },
    });
    fileId = uploaded.id;

    expect(uploaded.file).toBe(uploaded.id);
    expect(uploaded.url).toBe(`https://cdn.dynjandi.dev/${uploaded.id}`);
    expect(uploaded.focalX).toBe(0.5);
    expect(uploaded.focalY).toBe(0.5);

    const variantUrl = client.url(uploaded.id, { width: 16, format: "webp" });
    const response = await fetchVariant(variantUrl);

    expect(response.status, `GET ${variantUrl}`).toBe(200);
    expect(response.headers.get("content-type") ?? "").toMatch(/^image\//);
  });

  // The tests below reuse the file the first test uploaded, so they run after it, in order.

  test("serves a srcset candidate and shows whether a resize upscales", {
    timeout: 30_000,
  }, async () => {
    const attribute = client.srcset(fileId, { widths: [CANDIDATE_WIDTH], format: "png" });
    // One candidate: "<url> 320w". Take the URL the helper built rather than rebuilding it.
    const parts = attribute.split(" ");
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe(`${CANDIDATE_WIDTH}w`);
    const candidateUrl = parts[0] ?? "";

    const response = await fetchVariant(candidateUrl);
    expect(response.status, `GET ${candidateUrl}`).toBe(200);
    expect(response.headers.get("content-type") ?? "").toMatch(/^image\//);

    // The original is 1x1, so the width served for a 320w request shows whether the service upscales.
    // Observed, not asserted: the service's behaviour is not ours to pin, and the run output records it.
    const servedWidth = readPngWidth(new Uint8Array(await response.arrayBuffer()));
    // Written to stdout directly, not console.info: Vitest's agent reporter (auto-selected when it detects an
    // AI agent) drops console output from passing tests, and its default reporter drops annotations unless
    // the test fails. Raw stdout appears under both, so the plain `test:live` run shows the observation.
    process.stdout.write(
      `UPSCALING OBSERVATION: ${CANDIDATE_WIDTH}w resize of a 1x1 original served a ${servedWidth}px-wide PNG ` +
        `(${servedWidth > 1 ? "upscaled" : "not upscaled"})\n`,
    );
  });

  test("serves an avif picture source", { timeout: 30_000 }, async () => {
    const [source, ...others] = client.pictureSources(fileId, {
      formats: ["avif"],
      widths: [CANDIDATE_WIDTH],
    });
    expect(others).toEqual([]);
    expect(source?.type).toBe("image/avif");

    const candidateUrl = (source?.srcset ?? "").split(" ")[0] ?? "";
    const response = await fetchVariant(candidateUrl);
    expect(response.status, `GET ${candidateUrl}`).toBe(200);
    // The service currently labels AVIF as image/heif, a service defect (dynjandi-core#98). The test
    // accepts that label but proves the format from the body: an ISOBMFF ftyp box with an avif brand.
    expect(response.headers.get("content-type") ?? "").toMatch(/^image\/(avif|heif)$/);
    expectAvifFtyp(new Uint8Array(await response.arrayBuffer()));
  });

  test("serves the placeholder", { timeout: 30_000 }, async () => {
    const placeholderUrl = client.placeholder(fileId);
    const response = await fetchVariant(placeholderUrl);

    expect(response.status, `GET ${placeholderUrl}`).toBe(200);
    expect(response.headers.get("content-type") ?? "").toMatch(/^image\//);
  });
});
