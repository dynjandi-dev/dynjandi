import { crc32, deflateSync } from "node:zlib";

// The PNG signature: W3C PNG specification, section 5.2.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(new TextEncoder().encode(type), 0);
  typeAndData.set(data, 4);
  const out = new Uint8Array(4 + typeAndData.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeAndData, 4);
  view.setUint32(4 + typeAndData.length, crc32(typeAndData));
  return out;
}

/**
 * A valid 8-bit RGB PNG of the given size, built with `node:zlib` so no binary fixture is tracked. Red rises
 * with x and green with y, so the picture is not flat. The bytes follow the PNG specification: the signature,
 * an IHDR chunk (width, height, bit depth 8, colour type 2), one IDAT chunk of zlib-compressed scanlines each
 * led by filter type 0, and IEND; each chunk ends with the CRC-32 of its type and data.
 */
export function buildPng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const scanlines = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      scanlines[row + 1 + x * 3] = Math.floor((x * 255) / Math.max(1, width - 1));
      scanlines[row + 2 + x * 3] = Math.floor((y * 255) / Math.max(1, height - 1));
      scanlines[row + 3 + x * 3] = 128;
    }
  }

  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(scanlines))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/**
 * Width and height from the IHDR chunk: big-endian uint32s at bytes 16-19 and 20-23, after the 8-byte
 * signature and the chunk's length and type fields (W3C PNG specification, IHDR). Throws, naming the problem,
 * when the bytes are not a PNG.
 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error("the body does not start with the PNG signature");
  }
  if (ascii(bytes, 12, 16) !== "IHDR") throw new Error("the first PNG chunk is not IHDR");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A WebP file opens with `RIFF`, a 4-byte size, then `WEBP` (Google's WebP container specification). */
export function isWebp(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
