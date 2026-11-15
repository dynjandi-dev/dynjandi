import { inspect } from "node:util";

const MARKER = "[redacted]";

// Every credential this process has held, so that one `redact()` can scrub any string on its way out (D12).
const known = new Set<string>();

/**
 * A credential: an API key, an approval token, a project key. It prints `[redacted]` through `toString`,
 * `toJSON` and `util.inspect`; the value comes out only through `reveal()`, at the one place that needs it.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    if (value === "") throw new Error("a secret cannot be empty");
    this.#value = value;
    known.add(value);
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return MARKER;
  }

  toJSON(): string {
    return MARKER;
  }

  [inspect.custom](): string {
    return MARKER;
  }
}

/** Replaces every credential a `Secret` has held with `[redacted]`. Longest first, so a prefix cannot leave a tail. */
export function redact(text: string): string {
  let result = text;
  for (const value of [...known].sort((a, b) => b.length - a.length)) {
    result = result.replaceAll(value, MARKER);
  }
  return result;
}

// Whitespace and control characters (C0, DEL, C1): the key goes into a header (D3).
function isUnsafeInHeader(raw: string): boolean {
  return (
    /\s/u.test(raw) ||
    Array.from(raw).some((char) => char <= "\u001f" || (char >= "\u007f" && char <= "\u009f"))
  );
}

/**
 * The API key from `DYNJANDI_API_KEY` (D3): non-empty and free of whitespace and control characters. The `dyn_`
 * prefix is not checked, because the document only calls it a `bearerFormat` hint. `undefined` when unusable.
 */
export function parseApiKey(raw: string | undefined): Secret | undefined {
  if (raw === undefined || raw === "" || isUnsafeInHeader(raw)) return undefined;
  return new Secret(raw);
}
