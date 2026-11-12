import { isIP } from "node:net";

// A DNS name as a hostname: dot-separated labels of letters, digits and hyphens, none starting or ending with a
// hyphen, each at most 63 characters (RFC 1123 section 2.1), the whole at most 253 (RFC 1035 section 2.3.4).
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_DNS_NAME = 253;
// Enough to read a refused host in the log; a header can be 16 KiB.
const MAX_LOGGED_HOST = 200;

/** The status a refused `Host` gets: RFC 9110 section 15.5.20. */
export const HOST_NOT_ALLOWED_STATUS = 421;
export const HOST_NOT_ALLOWED_MESSAGE = "Host not allowed";

/**
 * The host of a `Host` header value, lower-cased (RFC 9110 section 4.2.3: the host is case-insensitive) with
 * the port removed (section 7.2: `Host = uri-host [ ":" port ]`), or `undefined` when the value is not that
 * shape. An IPv6 literal comes back without its brackets. A trailing dot, the fully qualified form, is dropped.
 */
export function hostOf(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const lower = header.toLowerCase();
  if (lower.startsWith("[")) {
    const end = lower.indexOf("]");
    if (end === -1 || !/^(?::\d*)?$/.test(lower.slice(end + 1))) return undefined;
    return lower.slice(1, end);
  }
  const match = /^([^:]*)(?::\d*)?$/.exec(lower);
  const name = match?.[1]?.replace(/\.$/, "");
  return name === undefined || name === "" ? undefined : name;
}

/**
 * Whether the server answers to this `Host` (plan #43, D5): an IP literal, `localhost` or a name under
 * `.localhost`, `host.docker.internal`, or a name in `allowed`, which `--allow-host` supplies. Binding loopback
 * keeps other machines out, but not a page that DNS rebinding has made same-origin with the server under its own
 * name; the default key is documented, so that page could upload and read. An IP literal is never produced by
 * rebinding, and `.localhost` and `.internal` are reserved names no one can serve a page from.
 */
export function isAllowedHost(
  header: string | undefined,
  allowed: readonly string[] = [],
): boolean {
  const name = hostOf(header);
  if (name === undefined) return false;
  return (
    isIP(name) !== 0 ||
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "host.docker.internal" ||
    allowed.includes(name)
  );
}

/**
 * The one stderr line for a refusal: the refused host, JSON-quoted so a hostile value cannot forge a line, and
 * the flag that admits it.
 */
export function refusalLine(header: string | undefined): string {
  const shown = header === undefined ? "(none)" : header.slice(0, MAX_LOGGED_HOST);
  return `refused Host ${JSON.stringify(shown)}: to serve that name, start dynjandi dev with --allow-host <name>`;
}

/**
 * Checks a `--allow-host` value: an exact DNS name, so an IP (always allowed), a port, a wildcard or an empty
 * value is a mistake. Returns the name lower-cased, or the reason it is not one.
 */
export function parseAllowHost(text: string): { name: string } | { problem: string } {
  const name = text.toLowerCase();
  if (name === "") return { problem: "must not be empty" };
  if (name.includes("*")) return { problem: "takes an exact name, not a wildcard" };
  if (name.includes(":")) return { problem: "takes a name without a port" };
  if (isIP(name) !== 0)
    return { problem: "takes a name, not an IP address (those are always allowed)" };
  if (name.length > MAX_DNS_NAME || !name.split(".").every((label) => DNS_LABEL.test(label))) {
    return { problem: "must be a DNS name such as dev.test" };
  }
  return { name };
}
