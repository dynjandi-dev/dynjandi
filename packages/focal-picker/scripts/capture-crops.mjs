// Phase 2 of the focal picker: measures where the live service puts a `crop/<w>x<h>/focal/<x>x<y>/` window.
//
// It builds gradient PNGs in memory (red rises with x, green with y, so every output pixel names the source
// position it came from), uploads them to the dedicated test project, fetches focal-crop variants as PNG,
// decodes them and writes the window each one showed, as fractions of the source, to
// tests/fixtures/service-crops.json. That fixture, not the working hypothesis, is what the picker's
// geometry follows.
//
// NOT part of Gate 1 (context/verify.md, "Not run by Gate 1"): it needs the test project's key and the network,
// and spends a fixed number of requests against the project's cap. Run it from the repository root with the
// key loaded for that one command only:
//
//   (set -a; . ./.env; set +a; pnpm --filter @dynjandi/focal-picker run capture:crops)
//
// Options (after `--`): `--check` compares a fresh run with the committed fixture instead of writing it;
// `--every <n>` keeps every nth grid row (a cheap re-run); `--out <path>` writes elsewhere.
//
// The key is read from the environment and goes only to the SDK, which sends it as a header. It is never
// printed, and the variant URLs printed here do not contain it.

import { readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { createClient } from "@dynjandi/sdk";

const KEY_VARIABLE = "DYNJANDI_SMOKE_PUBLIC_KEY";
const DEFAULT_OUT = new URL("../tests/fixtures/service-crops.json", import.meta.url);

// 2:1 landscape and its portrait transpose. 255 is the number of steps an 8-bit channel can take, so a
// source 510 wide has two pixels per red level and the gradient's resolution is 1/255 of the source.
const LANDSCAPE = { width: 510, height: 255 };
const PORTRAIT = { width: 255, height: 510 };
const LEVELS = 255;

// Output sizes sit near the source's scale so the service neither shrinks nor stretches them much.
const RATIOS = {
  "1:1": { width: 200, height: 200 },
  "16:9": { width: 320, height: 180 },
  "9:16": { width: 180, height: 320 },
};

const POINTS = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
  { x: 0.5, y: 0.5 },
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.42, y: 0.18 },
];

// The grid: every ratio and point on the landscape source, and the wide ratio on the portrait source,
// where it is the height that is cropped. Kept small: each variant counts against the project's cap.
const GRID = [
  ...Object.keys(RATIOS).flatMap((ratio) =>
    POINTS.map((point) => ({ source: LANDSCAPE, ratio, point })),
  ),
  ...[
    { x: 0.42, y: 0.18 },
    { x: 0.9, y: 0.9 },
  ].map((point) => ({ source: PORTRAIT, ratio: "16:9", point })),
];

const VARIANT_ATTEMPTS = 4;
const RETRY_DELAY_MS = 1000;

let requests = 0;

function out(text) {
  process.stdout.write(`${text}\n`);
}

function readOptions(argv) {
  const options = { check: false, every: 1, out: DEFAULT_OUT };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--every") {
      options.every = Number(argv[++index]);
      if (!Number.isInteger(options.every) || options.every < 1) {
        throw new Error("--every needs a positive integer.");
      }
    } else if (argument === "--out") {
      options.out = argv[++index];
      if (options.out === undefined) {
        throw new Error("--out needs a path.");
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

// ---- PNG encoding and decoding (8-bit only, no dependency) ----

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, crc]);
}

/** Red at column x is 255 * (x + 0.5) / width, green likewise by row, so value / 255 is the pixel centre as a fraction. */
function gradientPng({ width, height }) {
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride; // the filter byte stays 0 (None)
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = Math.round((LEVELS * (x + 0.5)) / width);
      raw[row + 2 + x * 3] = Math.round((LEVELS * (y + 0.5)) / height);
      raw[row + 3 + x * 3] = 128;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
    return left;
  }
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

/** Decodes an 8-bit RGB or RGBA PNG to `{ width, height, channels, pixels }` (rows of unfiltered bytes). */
function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("The response is not a PNG.");
  }
  let header;
  const data = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = body;
    } else if (type === "IDAT") {
      data.push(body);
    }
    offset += 12 + length;
  }
  if (header === undefined) {
    throw new Error("The PNG has no IHDR chunk.");
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [bitDepth, colourType, , , interlace] = header.subarray(8, 13);
  const channels = colourType === 2 ? 3 : colourType === 6 ? 4 : 0;
  if (bitDepth !== 8 || channels === 0 || interlace !== 0) {
    throw new Error(
      `Unsupported PNG: bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace}.`,
    );
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i];
      const left = i >= channels ? pixels[y * stride + i - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      const predictors = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)];
      if (filter > 4) {
        throw new Error(`Unknown PNG filter ${filter}.`);
      }
      pixels[y * stride + i] = (value + predictors[filter]) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

// ---- measuring the window ----

/** Least-squares line through (xs, ys): returns its slope and intercept. */
function fitLine(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (xs[i] - meanX) * (ys[i] - meanY);
    variance += (xs[i] - meanX) ** 2;
  }
  const slope = covariance / variance;
  return { slope, intercept: meanY - slope * meanX };
}

/**
 * The window the output shows, as fractions of the source. Pixel centre c of an output n pixels across sits
 * at t = (c + 0.5) / n of the window, so channel / 255 = start + t * extent; the line fitted through the
 * channel's mean per column (red) or per row (green) gives both numbers and averages out quantisation.
 */
function observeWindow({ width, height, channels, pixels }) {
  const stride = width * channels;
  const meanRed = Array.from({ length: width }, (_, x) => {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      sum += pixels[y * stride + x * channels];
    }
    return sum / height / LEVELS;
  });
  const meanGreen = Array.from({ length: height }, (_, y) => {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += pixels[y * stride + x * channels + 1];
    }
    return sum / width / LEVELS;
  });
  const horizontal = fitLine(
    meanRed.map((_, x) => (x + 0.5) / width),
    meanRed,
  );
  const vertical = fitLine(
    meanGreen.map((_, y) => (y + 0.5) / height),
    meanGreen,
  );
  return {
    left: horizontal.intercept,
    top: vertical.intercept,
    width: horizontal.slope,
    height: vertical.slope,
  };
}

/**
 * Half a gradient level either way (1/255 together with the fit's rounding) plus one pixel of the cover-scaled
 * image, because the service places an integer crop offset on the scaled image.
 */
function toleranceFor(source, output) {
  const scale = Math.max(output.width / source.width, output.height / source.height);
  const scaledSmallest = Math.min(source.width, source.height) * scale;
  return 1 / LEVELS + 1 / scaledSmallest;
}

// ---- the live service ----

async function fetchVariant(url) {
  let response;
  for (let attempt = 1; attempt <= VARIANT_ATTEMPTS; attempt++) {
    requests++;
    response = await fetch(url);
    // A variant is rendered on first request, so a fresh upload can answer 404 or 5xx for a moment.
    if (response.status !== 404 && response.status < 500) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  return response;
}

function versionHeaderOf(response) {
  for (const [name, value] of response.headers) {
    if (name.toLowerCase().includes("version")) {
      return { name, value };
    }
  }
  return undefined;
}

async function upload(client, source, name) {
  requests++;
  const png = gradientPng(source);
  return client.upload(new File([png], name, { type: "image/png" }));
}

async function capture(rows) {
  const publicKey = process.env[KEY_VARIABLE];
  if (publicKey === undefined || publicKey === "") {
    throw new Error(`${KEY_VARIABLE} is not set. Load it from .env as context/verify.md shows.`);
  }
  const client = createClient({ publicKey });

  const uploads = new Map();
  let version;
  let headerNames;
  const captured = [];
  for (const { source, ratio, point } of rows) {
    const key = `${source.width}x${source.height}`;
    if (!uploads.has(key)) {
      uploads.set(key, await upload(client, source, `gradient-${key}.png`));
    }
    const output = RATIOS[ratio];
    const url = client.url(uploads.get(key), {
      crop: { width: output.width, height: output.height, focal: point },
      format: "png",
    });
    const response = await fetchVariant(url);
    if (!response.ok) {
      throw new Error(`${response.status} for ${new URL(url).pathname}`);
    }
    headerNames ??= [...response.headers.keys()];
    version ??= versionHeaderOf(response);
    const image = decodePng(Buffer.from(await response.arrayBuffer()));
    if (image.width !== output.width || image.height !== output.height) {
      throw new Error(
        `Asked for ${output.width}x${output.height}, got ${image.width}x${image.height}.`,
      );
    }
    const window = observeWindow(image);
    captured.push({
      source,
      ratio,
      output,
      point,
      observed: Object.fromEntries(
        Object.entries(window).map(([name, value]) => [name, Number(value.toFixed(4))]),
      ),
      tolerance: Number(toleranceFor(source, output).toFixed(4)),
    });
    out(
      `${key} ${ratio} focal ${point.x}x${point.y}: left ${window.left.toFixed(3)} top ${window.top.toFixed(3)} ` +
        `width ${window.width.toFixed(3)} height ${window.height.toFixed(3)}`,
    );
  }
  out(`Response header names on the first variant: ${headerNames.join(", ")}`);
  return { version, rows: captured };
}

// ---- main ----

function rowKey(row) {
  return `${row.source.width}x${row.source.height} ${row.ratio} ${row.point.x}x${row.point.y}`;
}

function compareWithFixture(fresh, path) {
  const committed = JSON.parse(readFileSync(path, "utf8"));
  const byKey = new Map(committed.rows.map((row) => [rowKey(row), row]));
  let failures = 0;
  for (const row of fresh) {
    const before = byKey.get(rowKey(row));
    if (before === undefined) {
      out(`MISSING from the fixture: ${rowKey(row)}`);
      failures++;
      continue;
    }
    const tolerance = Math.max(row.tolerance, before.tolerance);
    const worst = Math.max(
      ...Object.keys(row.observed).map((name) =>
        Math.abs(row.observed[name] - before.observed[name]),
      ),
    );
    const verdict = worst <= tolerance ? "ok" : "DIFFERS";
    out(
      `${verdict} ${rowKey(row)}: largest difference ${worst.toFixed(4)} (tolerance ${tolerance})`,
    );
    if (worst > tolerance) {
      failures++;
    }
  }
  return failures;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const rows = GRID.filter((_, index) => index % options.every === 0);
  const { version, rows: captured } = await capture(rows);

  if (options.check) {
    const failures = compareWithFixture(captured, DEFAULT_OUT);
    out(
      `${requests} requests made. ${failures === 0 ? "Matches the fixture." : `${failures} rows differ.`}`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
    return;
  }

  const fixture = {
    description:
      "Where the live service puts a crop/<w>x<h>/focal/<x>x<y>/ window, as fractions of the source image. " +
      "Captured by scripts/capture-crops.mjs from gradient PNGs (red rises with x, green with y). " +
      "A row's observed values are within its tolerance of what the service did.",
    capturedOn: new Date().toISOString().slice(0, 10),
    gradientLevels: LEVELS,
    sources: [LANDSCAPE, PORTRAIT],
    serviceVersion: version === undefined ? null : `${version.name}: ${version.value}`,
    rows: captured,
  };
  writeFileSync(options.out, `${JSON.stringify(fixture, null, 2)}\n`);
  out(`${requests} requests made. Wrote ${captured.length} rows.`);
}

main().catch((error) => {
  process.stderr.write(
    `capture-crops failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
