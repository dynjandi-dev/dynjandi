# API Security

## Core Rules

- Validate all input (see [validation.md](validation.md))
- Authenticate all protected routes
- Authorize every resource access
- Return minimal, appropriate HTTP status codes
- Rate limit public and sensitive endpoints
- Never expose internal error details to clients

## HTTP Status Codes

Use precise status codes:

| Code | When |
|---|---|
| `200` | Successful GET, PATCH, PUT |
| `201` | Successful POST (resource created) |
| `204` | Successful DELETE (no content) |
| `400` | Malformed request (bad JSON, missing required field) |
| `401` | Not authenticated |
| `403` | Authenticated but not authorized |
| `404` | Resource not found |
| `409` | Conflict (duplicate, optimistic lock failure) |
| `422` | Validation error (well-formed but invalid data) |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

## Error Responses

Return structured errors. Never expose stack traces or internal details:

```ts
// BAD — exposes internals
res.status(500).json({ error: error.stack });

// GOOD — structured, safe
res.status(422).json({
  error: "Validation failed",
  fields: result.error.flatten().fieldErrors,
});
```

## Rate Limiting

Apply rate limiting to all public APIs:

```ts
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, "1 m"), // 100 req/min
});

export async function middleware(req: NextRequest) {
  const ip = req.ip ?? "unknown";
  const { success, limit, remaining } = await ratelimit.limit(ip);

  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, {
      status: 429,
      headers: {
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
      },
    });
  }
}
```

## CORS

Configure CORS explicitly. Do not allow all origins in production:

```ts
const corsOptions = {
  origin: process.env.NODE_ENV === "production"
    ? ["https://app.example.com"]
    : ["http://localhost:3000"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true,
};
```

## SQL Injection Prevention

Use parameterized queries. Prisma handles this automatically:

```ts
// SAFE — Prisma parameterizes automatically
const user = await db.user.findUnique({ where: { email } });

// DANGEROUS — never concatenate user input into raw SQL
const user = await db.$queryRawUnsafe(`SELECT * FROM users WHERE email = '${email}'`);

// SAFE — use $queryRaw with tagged template (automatically parameterized)
const user = await db.$queryRaw`SELECT * FROM users WHERE email = ${email}`;
```

## SSRF — URLs the Server Fetches

A URL that came from outside and is then fetched by the server is a trust boundary. Webhook
registration, import-by-URL, link previews, avatar fetching and OIDC discovery all have this
shape, and the server's network position is the attacker's: cloud metadata endpoints, internal
admin panels and the database are reachable from it and not from the client.

- Allowlist the host wherever the set is knowable — validate only when it is not
- Accept `https:` only, never `file:`, `data:` or a scheme that was not listed
- Resolve the hostname and reject every address it resolves to — private, loopback or link-local
- Follow redirects manually and check each hop — a public URL can redirect to `127.0.0.1`
- Cap the timeout and the response size, and never return the fetched body or error to the client

```ts
import { lookup } from "node:dns/promises";
import net from "node:net";

const privateRanges = new net.BlockList();
privateRanges.addSubnet("10.0.0.0", 8);
privateRanges.addSubnet("172.16.0.0", 12);
privateRanges.addSubnet("192.168.0.0", 16);
privateRanges.addSubnet("127.0.0.0", 8); // loopback
privateRanges.addSubnet("169.254.0.0", 16); // link-local — cloud metadata lives at 169.254.169.254
privateRanges.addSubnet("::1", 128, "ipv6");
privateRanges.addSubnet("fc00::", 7, "ipv6"); // unique local
privateRanges.addSubnet("fe80::", 10, "ipv6"); // link-local

async function assertPublicUrl(raw: string) {
  const url = new URL(raw); // throws on a malformed URL
  if (url.protocol !== "https:") throw new ValidationError("Only https URLs are allowed");

  for (const { address, family } of await lookup(url.hostname, { all: true })) {
    // `::ffff:127.0.0.1` matches an IPv4 range only when it is checked as ipv6
    if (privateRanges.check(address, family === 6 ? "ipv6" : "ipv4")) {
      throw new ValidationError("URL resolves to a private address");
    }
  }
  return url;
}

// Each redirect is a hop the check above never saw, so take them one at a time
async function fetchExternal(raw: string, hops = 3): Promise<Response> {
  const url = await assertPublicUrl(raw);
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
  const location = res.headers.get("location");
  if (!location) return res;
  if (hops === 0) throw new ValidationError("Too many redirects");
  return fetchExternal(new URL(location, url).href, hops - 1);
}
```

**Resolve-then-connect is not airtight.** `fetch` resolves the hostname again, and a DNS record
that changes between the two lookups (rebinding) passes the check and connects elsewhere. Where
that matters, pin the connection to the checked address with a custom agent, or route the fetch
through an egress proxy that enforces the allowlist. That is why the allowlist is first.

## Content Security Policy

Set a Content Security Policy header to mitigate XSS:

```ts
// Next.js — next.config.ts
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // tighten after audit
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
    ].join("; "),
  },
];
```

## DO NOT

- Expose database errors or stack traces to the client
- Trust user-supplied IDs for authorization
- Fetch a URL supplied by a user without checking where its hostname resolves
- Use `*` for CORS `Access-Control-Allow-Origin` in production
- Accept file uploads without size and MIME type validation
- Log request bodies that may contain passwords or payment data

## See Also

- [`validation.md`](validation.md) — input validation patterns
- [`auth.md`](auth.md) — authentication and authorization
- [`../typescript/error-handling.md`](../typescript/error-handling.md) — structured error responses
- [`../architecture/api-design.md`](../architecture/api-design.md) — error shape conventions
