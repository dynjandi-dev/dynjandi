import { describe, expect, it } from "vitest";
import { hostOf, isAllowedHost, parseAllowHost, refusalLine } from "../src/dev/host-check.js";

// Expected values come from plan #43 D5 (which hosts are served), RFC 9110 sections 4.2.3 and 7.2 (the host is
// case-insensitive; `Host = uri-host [ ":" port ]`), RFC 3986 section 3.2.2 (an IPv6 literal is bracketed) and
// RFC 1123 section 2.1 (the shape of a hostname). The end-to-end 421 is asserted in api.test.ts.
describe("hostOf", () => {
  it.each([
    ["127.0.0.1:4600", "127.0.0.1"],
    ["[::1]:4600", "::1"],
    ["[::1]", "::1"],
    ["LOCALHOST:4600", "localhost"],
    ["localhost", "localhost"],
    ["localhost.:4600", "localhost"],
    ["Dev.Test:", "dev.test"],
  ])("reads %s as %s", (header, host) => {
    expect(hostOf(header)).toBe(host);
  });

  it.each([undefined, "", ":4600", "[::1", "[::1]x", "a:b", "a:1:2"])("rejects %j", (header) => {
    expect(hostOf(header)).toBeUndefined();
  });
});

describe("isAllowedHost", () => {
  it.each([
    "127.0.0.1:4600",
    "[::1]:4600",
    "localhost",
    "LOCALHOST:4600",
    "app.localhost",
    "host.docker.internal:4600",
    "172.17.0.1:4600",
  ])("serves %s", (header) => {
    expect(isAllowedHost(header)).toBe(true);
  });

  it.each([
    "evil.example",
    "127.0.0.1.nip.io",
    "localhost.evil.example",
    "notlocalhost",
    "other.internal",
    "host.docker.internal.evil.example",
    "127.0.0.1@evil.example",
    undefined,
  ])("refuses %s", (header) => {
    expect(isAllowedHost(header)).toBe(false);
  });

  it("serves an added name with or without a port, in any case, and only that name", () => {
    expect(isAllowedHost("dev.test:4600", ["dev.test"])).toBe(true);
    expect(isAllowedHost("DEV.TEST", ["dev.test"])).toBe(true);
    expect(isAllowedHost("sub.dev.test", ["dev.test"])).toBe(false);
  });
});

describe("parseAllowHost", () => {
  it("accepts a DNS name and lower-cases it", () => {
    expect(parseAllowHost("Dev.Test")).toEqual({ name: "dev.test" });
    expect(parseAllowHost("my-app")).toEqual({ name: "my-app" });
  });

  it.each([
    "",
    "10.0.0.1",
    "::1",
    "a:1",
    "*.test",
    "*",
    "a b",
    "-a.test",
    "a..test",
    ".test",
    "a_b.test",
    "dev.test.",
  ])("rejects %j", (text) => {
    expect("problem" in parseAllowHost(text)).toBe(true);
  });

  it("rejects a name over 253 characters", () => {
    expect("problem" in parseAllowHost(`${"a".repeat(60)}.`.repeat(5))).toBe(true);
  });
});

describe("refusalLine", () => {
  it("quotes the host as JSON and names the flag", () => {
    const line = refusalLine('evil"\nhost');
    expect(line).toContain('"evil\\"\\nhost"');
    expect(line).not.toContain("\n");
    expect(line).toContain("--allow-host");
  });

  it("cuts a very long host", () => {
    expect(refusalLine("a".repeat(5000)).length).toBeLessThan(400);
  });
});
