# PHP Engineering Standards

> **When to load these standards:** Only when the task is explicitly PHP. This repository's primary stack is TypeScript on Node.js. PHP is supported as a secondary track for the rare case where it's the right tool — typically internal tooling, CMS integrations, queue-driven workflows, or PHP-first ecosystems (Laravel/Symfony/Slim projects).
>
> **Do not suggest PHP** for a new project, a Node-friendly task, or a TypeScript codebase. If the user wants PHP, they will say so explicitly.

---

## Philosophy

Modern PHP is not "sprinkle PHP into HTML templates." A modern PHP codebase is:

- Strongly typed wherever possible
- Layered with clear domain boundaries
- Framework-agnostic at the domain layer
- Built around dependency injection
- Free of global state and magic-heavy abstractions
- Testable by design
- Explicit over convenient

Treat PHP like C#, Kotlin, Java, or TypeScript backends — structured, typed, layered, observable.

## Baseline for New PHP Projects

- PHP 8.3+
- `declare(strict_types=1);` in every file
- PHPStan at level max
- Pint or PHP-CS-Fixer for formatting
- Pest or PHPUnit for tests
- Dockerized dev environment
- PostgreSQL (MySQL acceptable)
- Redis (for cache + queues)
- Structured logging
- CI/CD from day one

## Conditional Loading

| If the task involves… | Load… |
|---|---|
| Any PHP task | [`rules.md`](rules.md), [`anti-patterns.md`](anti-patterns.md) |
| Architecture / new module | [`architecture.md`](architecture.md) |
| Testing | [`testing.md`](testing.md) |
| Security | [`security.md`](security.md) |
| Tooling setup (Composer, PHPStan, Pint, Pest, Rector) | [`tooling.md`](tooling.md) |
| Framework choice or framework-specific patterns | [`frameworks.md`](frameworks.md) |

## Cross-Cutting Topics (Reuse Main Repo)

These concepts apply across languages — use the main repo's docs:

| Topic | Doc |
|---|---|
| Logging, error monitoring, observability | [`../tooling/observability.md`](../tooling/observability.md) |
| CI gating, PR sizing, squash merges | [`../tooling/ci.md`](../tooling/ci.md) |
| API design (REST, errors, pagination) | [`../architecture/api-design.md`](../architecture/api-design.md) |
| Refactoring discipline | [`../architecture/refactoring.md`](../architecture/refactoring.md) |
| Date/time handling | [`../tooling/dates.md`](../tooling/dates.md) — use the PHP equivalent (`DateTimeImmutable`, Carbon, or Brick\DateTime) |
| Dependency boundaries (in a modular monolith) | [`../architecture/dependency-boundaries.md`](../architecture/dependency-boundaries.md) |

## Documentation Style

Same as the rest of this repo: directive, concise, hierarchical, example-heavy. `## DO` / `## DO NOT` / `## PRIORITY` sections. No prose essays.
