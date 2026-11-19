export interface FencedBlock {
  /** The info string after the opening fence, such as `sh` or `ts`. */
  language: string;
  /** The text between the fences, with its final newline. */
  body: string;
}

const FENCE = /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;

export function fencedBlocks(markdown: string): FencedBlock[] {
  return [...markdown.matchAll(FENCE)].map((match) => ({
    language: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
}

export function withoutFencedBlocks(markdown: string): string {
  return markdown.replace(FENCE, "");
}

/**
 * The anchor GitHub gives a heading: lower-cased, anything but letters, digits, spaces, hyphens and
 * underscores removed, each space a hyphen. A second heading with the same text gets `-1`, a third `-2`.
 */
export function headingAnchors(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const line of withoutFencedBlocks(markdown).split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1] === undefined) continue;
    const base = match[1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replaceAll(" ", "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}
