# Dates, Times, and Timezones

## Core Rules

- **Never use the `Date` object.** Not for construction, not for arithmetic, not for comparison, not for "just this once" — see [Enforcement](#enforcement)
- Use [`@northguild/gmt`](https://github.com/northguild/gmt) for all date/time work
- **Install the lint plugin for the project's linter.** The ban is not a convention to remember; it is a rule the linter enforces — see [Enforcement](#enforcement)
- ISO 8601 strings are the application's currency — in and out of every helper
- Store timestamps as UTC (`timestamptz`); convert to the user's timezone only at display time
- Keep plain and zoned apart: a calendar date has no timezone, an instant has no wall-clock reading
- Never assume the server and client share a timezone
- Never reach for `moment`, `dayjs`, `luxon`, `date-fns`, or `spacetime` — all of them still carry `Date` internally

## Preferred Library

Use [`@northguild/gmt`](https://github.com/northguild/gmt) — a Temporal-first library over `@js-temporal/polyfill`, with no `Date` in its API at any point.

Its contract is narrow on purpose:

- **ISO 8601 strings in, normalized strings (or numbers, booleans, arrays) out.** Helpers do not hand back objects you then have to keep straight.
- **No fuzzy parsing.** It will not guess at an ambiguous format. Canonicalize outside the library, then call in.
- **No throwing.** Invalid input returns a typed fallback — `""` for string helpers, `null` for numbers, `false` for booleans, `[]` for arrays. **This is the one thing to design around**: a bad input is a quiet empty string, not an exception, so validate at the boundary rather than trusting a return value downstream.
- **`plain/*` is timezone-free, `zoned/*` is timezone-aware**, and the split is enforced by the API rather than by discipline.

`Temporal` itself is re-exported for the cases the helpers do not cover. Prefer the helpers; reach for `Temporal` when you need something they do not express, not as the default.

## Enforcement

**A rule a human has to remember is not a rule.** `@northguild/gmt` ships three lint packages that ban every `Date` API. Install the one matching the project's linter — this is not optional, and which one you install is decided by what the project already runs, not by preference.

| The project lints with | Install | Peer requirement |
|---|---|---|
| ESLint | `@northguild/gmt-eslint` | `eslint ^9`, `@typescript-eslint/parser ^8` |
| oxlint | `@northguild/gmt-oxlint` | `oxlint >=1` |
| Biome | `@northguild/gmt-biome` | `@biomejs/biome >=2` |

Note the scope: all three are `@northguild/*` packages. The bare names `gmt-eslint`, `gmt-oxlint` and `gmt-biome` are not published.

**ESLint** — a flat config to spread:

```js
// eslint.config.mjs
import gmtEslintConfig from "@northguild/gmt-eslint";

export default [...gmtEslintConfig];
```

**oxlint** — a JS plugin plus its recommended rules:

```ts
// oxlint.config.ts
import { defineConfig } from "oxlint";
import { recommendedConfig } from "@northguild/gmt-oxlint";

export default defineConfig(recommendedConfig);
```

**Biome** — GritQL plugins, referenced by filesystem path. Biome does not resolve npm specifiers in `plugins`, and `extends` cannot distribute plugins, so the `./node_modules/` path and the `.grit` extension are both required:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.11/schema.json",
  "plugins": ["./node_modules/@northguild/gmt-biome/plugins/all.grit"]
}
```

All three ban the same set:

| Banned | Use instead |
|---|---|
| `Date` as a global reference | `getNow()`, `getUtcNow()`, `getUnixNow()`, `getZonedNow(timezone)` |
| `new Date(...)` | `getUtcNow()`, `getNow()`, `getZonedNow(timezone)` |
| `Date.now()` | `getUnixNow({ epochUnit: "milliseconds" \| "seconds" })` |
| `Date.parse(...)` | `convertZonedToUnix(value)` |
| `Date.UTC(...)` | `convertUtcToUnix(value, { epochUnit })` |
| `date.getTimezoneOffset()` | `getZonedNow(timezone)`, `convertZonedToUnix(value)` |
| importing `moment`, `moment-timezone`, `dayjs`, `luxon`, `date-fns`, `date-fns-tz`, `spacetime` | `@northguild/gmt` |

**`@js-joda/core` is deliberately allowed.** It has its own value types and touches `Date` only at the boundary, so it does not carry the ambient-timezone and DST problems the ban targets. It is permitted, not recommended — new code uses gmt.

## Choosing the Right Concept

The question is never "which date type" but "which of these four things am I holding":

| Concept | Namespace | Shape | Use for |
|---|---|---|---|
| A calendar date, no time, no zone | `plain/*` | `"2026-03-15"` | Birthdays, holidays, due dates, invoice dates |
| Wall-clock time, no date | `plain/*` | `"14:30:45"` | Opening hours, daily schedules |
| An exact moment, in UTC | `utc/*` | `"2026-03-15T14:30:45Z"` | Server timestamps, audit logs, `createdAt` |
| A moment as read in a zone | `zoned/*` | `"2026-03-15T10:30:45-04:00[America/New_York]"` | Scheduled local meetings, recurring events |
| An exact moment, as an epoch | `unix/*` | `1773844245000` | Transport, cache keys, foreign-system bridges |

Picking right prevents whole categories of bug. A birthday stored as an instant displays as the wrong day for half the world; an event stored as a calendar date cannot say when it happened.

```ts
import { getToday, getUtcNow, getZonedNow, addUtc, isAfterDate } from "@northguild/gmt";

getToday();                          // "2026-03-15" — a calendar date
getUtcNow();                         // "2026-03-15T14:30:45.961393958Z" — nanosecond precision
getZonedNow("Atlantic/Reykjavik");   // "2026-03-15T14:30:45.962+00:00[Atlantic/Reykjavik]"

addUtc("2026-03-15T14:30:45Z", { days: 30 });   // "2026-04-14T14:30:45Z"
isAfterDate("2026-03-15", getToday());          // false
```

**Note the precision difference**: `getUtcNow()` carries nanoseconds, while `getZonedNow()` truncates to milliseconds by default (`smallestUnit` is the only option it reads). Verified against `@northguild/gmt@1.18.0` — do not assert on a fixed fractional width in a test.

Arithmetic and comparison go through the helpers — `addUtc`, `addZoned`, `addDate`, `isAfterUtc`, `isBeforeDate`, `isBetweenDateTime`. Never compare with `<` / `>`, and never do millisecond maths: both are what break on DST.

## Validation

**Validate at the boundary**, because a bad value does not throw — it becomes `""` and travels.

**Use Zod's native ISO formats.** `z.iso.*` (Zod 4+) validates the shape and keeps the inferred type as
`string`, which is exactly what this policy wants. It is not a regex: it rejects `2026-02-30`, is leap-year
aware, and rejects leap seconds.

```ts
import { z } from "zod";

export const createInvoiceSchema = z.object({
  title: z.string().min(1).max(200),
  amount: z.number().positive(),
  dueDate: z.iso.date(),        // "2026-03-15" — a calendar date
  createdAt: z.iso.datetime(),  // "2026-03-15T14:30:45Z" — a UTC instant
});

export type CreateInvoice = z.infer<typeof createInvoiceSchema>;
// CreateInvoice["dueDate"] is string — not Date
```

| The field holds | Use | Notes |
|---|---|---|
| A calendar date | `z.iso.date()` | Requires zero-padding; `2026-3-15` is rejected |
| A UTC instant | `z.iso.datetime()` | `Z` only by default, which is the storage rule anyway |
| An instant with any offset | `z.iso.datetime({ offset: true })` | Accepts `+02:00`; still rejects a bracketed zone |
| A local date-time, no zone | `z.iso.datetime({ local: true })` | The `<input type="datetime-local">` shape |
| A wall-clock time | `z.iso.time()` | |
| A duration | `z.iso.duration()` | ISO 8601 `P…` |

**Reach for a gmt predicate only where Zod has no format for it.** Three real cases:

```ts
import { getToday, isAfterDate, isValidTimeZone, isValidZonedDateTime } from "@northguild/gmt";
import { z } from "zod";

export const bookingSchema = z.object({
  // 1. A business rule. Zod validates the shape; only gmt can compare two dates.
  date: z.iso.date().refine((date) => isAfterDate(date, getToday()), "Must be in the future"),

  // 2. The RFC 9557 bracketed-zone form that zoned/* emits — no z.iso.* format matches it
  startsAt: z.string().refine(isValidZonedDateTime, "Must be a zoned ISO 8601 datetime"),

  // 3. An IANA timezone identifier
  timezone: z.string().refine(isValidTimeZone, "Must be an IANA timezone"),
});
```

`z.iso.datetime()` and `z.iso.datetime({ offset: true })` both **reject**
`"2026-03-15T10:30:45-04:00[America/New_York]"`, so anything round-tripping a zoned value needs
`isValidZonedDateTime`. Verified against `zod@4.6.5`.

`z.iso.*` is the Zod 4 spelling. The Zod 3 forms — `z.string().date()`, `.datetime()`, `.time()`,
`.duration()` — still work on Zod 4, so an older codebase needs no migration for this; prefer `z.iso.*` in
new code. Either way the inferred type is `string`.

**Never use `z.coerce.date()`.** It is the single most common way a `Date` gets into a codebase that meant
to ban one: it makes `Date` the inferred type, so every consumer of the schema now holds one, and
`.min(new Date())` compounds it with a banned constructor. `z.date()` is the same problem stated directly.
There is no case for either — `z.iso.date()` costs the same to write and gives you a string.

The other predicates are `isValidDate`, `isValidDateTime`, `isValidTime`, `isValidUtc` and
`isValidDateRange`, for validating outside a schema. The `regex/*` namespace exports the underlying
patterns where something wants one directly.

## Storage

Store UTC. The column should be:

- PostgreSQL: `TIMESTAMP WITH TIME ZONE` (`timestamptz`)
- MySQL: `DATETIME`, UTC by convention
- Prisma: `DateTime` — maps to `timestamptz` on Postgres

For a calendar date with no time, use a `DATE` column so the database agrees with the concept:

```prisma
model User {
  birthday DateTime @db.Date  // a date, not a timestamp
}
```

## Boundaries — the one place `Date` appears

**Some boundaries traffic in `Date` and you do not get a vote**: Prisma returns one for a `DateTime` column, and a few Web APIs hand one over. The rule is containment, not exemption.

Convert **in the repository layer**, and let nothing past it hold a `Date`:

```ts
// features/invoices/invoice.repository.ts — the only file that sees a Date
export async function findInvoice(id: string) {
  const row = await db.invoice.findUniqueOrThrow({ where: { id } });
  return {
    ...row,
    // .toISOString() on a value the ORM handed us: no Date is constructed here
    dueDate: row.dueDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
```

Reading `.toISOString()` off a value you did not construct is not what the lint rules catch — they ban the `Date` global, `new Date`, and the `Date` statics. **Writing back is the harder direction**, because Prisma wants a `Date` for a `DateTime` column and building one means `new Date(iso)`, which is banned outright. Two honest options, in order:

1. **Keep the conversion in one adapter module** and disable the rule in that file alone, with a comment saying why. One suppressed line in one file is a boundary; a suppression anywhere else is the ban failing.
2. **Hand the database a string** via a raw cast where the driver accepts one, so no `Date` is constructed at all.

What is not an option is letting the ORM's type leak upward. Inside the application, a date is an ISO string.

## Display

Format at the edge, in the component — never in storage or transport. Locale-aware formatting is the helpers' job, not a template literal's:

```tsx
import { convertUtcToZoned, formatZonedDateTime, formatRelativeUtc } from "@northguild/gmt";

interface InvoiceDateProps {
  /** ISO 8601 UTC instant */
  createdAt: string;
  timezone: string;
  locale: string;
}

export function InvoiceDate({ createdAt, timezone, locale }: InvoiceDateProps) {
  const zoned = convertUtcToZoned(createdAt, timezone);
  return (
    <time dateTime={createdAt} title={formatRelativeUtc(createdAt, locale)}>
      {formatZonedDateTime(zoned, locale, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}
```

`formatRelativeUtc` / `formatRelativeDate` / `formatRelativeZoned` cover "2 hours ago" without hand-rolled unit maths. `formatDate`, `formatDateTime`, `formatZonedDateTime` and the `*ToParts` variants cover absolute display, and `formatDateRange` covers a span.

## Detecting User Timezone

```ts
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// "Atlantic/Reykjavik", "America/New_York", …
```

Store the user's preferred timezone on their profile if they may travel; fall back to the browser-detected one. Validate it with `isValidTimeZone` before using it — an invalid zone makes every zoned helper return `""`.

## DO NOT

- **Use `Date` in any form** — `new Date()`, `Date.now()`, `Date.parse()`, `Date.UTC()`, `getTimezoneOffset()`, or `Date` as a type
- **Use `z.coerce.date()` or `z.date()`** — they put a `Date` in the inferred type of every schema consumer
- Ship the standard without the lint plugin — an unenforced ban is a comment
- Add `moment`, `dayjs`, `luxon`, `date-fns` or `spacetime`, including transitively for "just formatting"
- Compare with `<` / `>` — use `isAfterUtc`, `isBeforeDate`, `isBetweenDateTime`
- Do millisecond arithmetic — use `addUtc`, `addZoned`, `addDate`, `diffUtc`
- Trust a helper's return value without validating the input — invalid input is `""`, `null`, `false` or `[]`, never a throw
- Let an ORM's `Date` past the repository layer
- Use an instant where a calendar date belongs, or a calendar date where an instant belongs
- Parse ambiguous formats with gmt — canonicalize first, then call in
- Trust a client-supplied timestamp for anything security-critical — derive it on the server

## PRIORITY

```
Lint-enforced ban > documented ban
gmt helpers > re-exported Temporal > anything else
ISO strings as the app's currency > date objects of any kind
Validate at the boundary > trust a return value
Right concept for the thing > generic timestamp
Display at the edge > display everywhere
```

## See Also

- [`../typescript/validation.md`](../typescript/validation.md) — Zod schemas at boundaries
- [`../security/validation.md`](../security/validation.md) — validating untrusted input
- [`../react/forms.md`](../react/forms.md) — shared schemas between form and API
- [`prisma.md`](prisma.md) — date columns and the ORM boundary
- [`i18n.md`](i18n.md) — locale-aware formatting alongside translated copy
- [`dependencies.md`](dependencies.md) — when to prefer native APIs
