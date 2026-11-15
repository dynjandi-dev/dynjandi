import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { parseApiKey, redact, Secret } from "../../src/setup/secret.js";

// Expected values come from the plan, not from the code under test:
// - D12: a `Secret` prints `[redacted]` through `toString`, `toJSON` and `util.inspect`, and `redact()` replaces
//   every credential in a string with the same marker;
// - D3: a key is non-empty and free of whitespace and control characters (it goes into a header); the `dyn_`
//   prefix is not enforced.
// The canary values below are invented for these tests and belong to nothing.
const CANARY = "dyn_canary_8f3a91c2d7e54b60";
const OTHER = "dyn_cli_canary_0b7e22aa91";

describe("Secret", () => {
  it("prints [redacted] through toString, template strings, JSON and util.inspect", () => {
    const secret = new Secret(CANARY);
    expect(String(secret)).toBe("[redacted]");
    expect(`${secret}`).toBe("[redacted]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[redacted]"}');
    expect(inspect(secret)).toBe("[redacted]");
    expect(inspect({ nested: { secret } }, { depth: 5 })).not.toContain(CANARY);
  });

  it("hands the value back only through reveal()", () => {
    expect(new Secret(CANARY).reveal()).toBe(CANARY);
  });

  it("refuses an empty value, which redact() could not replace", () => {
    expect(() => new Secret("")).toThrow(/empty/);
  });
});

describe("redact", () => {
  it("replaces every occurrence of every secret made so far", () => {
    const first = new Secret(CANARY);
    const second = new Secret(OTHER);
    const text = `a ${first.reveal()} b ${second.reveal()} c ${first.reveal()}`;
    expect(redact(text)).toBe("a [redacted] b [redacted] c [redacted]");
  });

  it("replaces a longer secret whole when a shorter one is its prefix", () => {
    const short = new Secret("dyn_prefixpart");
    const long = new Secret("dyn_prefixpart_and_more");
    expect(redact(`key ${long.reveal()} and ${short.reveal()}`)).toBe(
      "key [redacted] and [redacted]",
    );
  });

  it("leaves text that holds no secret as it is", () => {
    new Secret(CANARY);
    expect(redact("nothing to hide")).toBe("nothing to hide");
  });
});

describe("parseApiKey", () => {
  it("accepts a key as a Secret, without enforcing the dyn_ prefix", () => {
    expect(parseApiKey(CANARY)?.reveal()).toBe(CANARY);
    expect(parseApiKey("not-prefixed")?.reveal()).toBe("not-prefixed");
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["a space inside", "dyn_a b"],
    ["a trailing newline", "dyn_abc\n"],
    ["a tab", "dyn_\tabc"],
    ["a NUL", "dyn_\u0000abc"],
    ["a DEL", "dyn_\u007fabc"],
  ])("rejects a key with %s", (_name, value) => {
    expect(parseApiKey(value)).toBeUndefined();
  });
});
