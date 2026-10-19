# AI Engineering Standards

Personal AI-native engineering standards for TypeScript and React projects. Optimized for AI agent consumption while remaining readable for humans.

**Where this lives:** `@baldurpan/create-ai-workflow` ships this tree and installs it into `context/standards/`. There is no upstream to sync from. Editing any file here makes the whole tree yours, and `update` stops replacing it. To use a different set, run `npx @baldurpan/create-ai-workflow standards add <git-url>`.

**Primary stack:** TypeScript on Node.js, React on the frontend. All standards in `philosophy/`, `typescript/`, `react/`, `architecture/`, `tooling/`, and `security/` apply to this stack.

**Secondary stack:** PHP, supported in [`php/`](php/), only when the task is explicitly PHP. Do not suggest PHP for a new project, a Node-friendly task, or a TypeScript codebase.

---

## For Humans

Nothing to set up. The workflow's block in your `AGENTS.md` already sends agents here, and each phase of a plan names the files it is reviewed against.

[`templates/`](templates/) holds drop-in starter files for a new project — `tsconfig.json`, `biome-example.json`, `eslint.config.js` and the rest. Copy what you need.

Everything below this line is for the AI agent.

---

## For AI Agents — Standards Index

You are working inside a project that keeps these standards in `context/standards/`. Load only the sections relevant to the current task. All paths below are relative to this file.

### Conditional Loading

| If the task involves… | Load… |
|---|---|
| Any task (always) | [`philosophy/ai-agent-behavior.md`](philosophy/ai-agent-behavior.md), [`philosophy/core-principles.md`](philosophy/core-principles.md) |
| TypeScript code | [`typescript/rules.md`](typescript/rules.md), [`typescript/anti-patterns.md`](typescript/anti-patterns.md) |
| Validation / schemas | [`typescript/validation.md`](typescript/validation.md), [`security/validation.md`](security/validation.md), [`tooling/dates.md`](tooling/dates.md) |
| Naming | [`typescript/naming.md`](typescript/naming.md) |
| Errors | [`typescript/error-handling.md`](typescript/error-handling.md) |
| React components or hooks | [`react/component-design.md`](react/component-design.md), [`react/hooks.md`](react/hooks.md), [`react/use-effect.md`](react/use-effect.md) |
| State management | [`react/state-management.md`](react/state-management.md) |
| Forms | [`react/forms.md`](react/forms.md), [`tooling/dates.md`](tooling/dates.md) |
| Accessibility | [`react/accessibility.md`](react/accessibility.md) |
| Performance / memoization | [`react/memoization.md`](react/memoization.md) |
| Error boundaries / Suspense / loading states | [`react/error-boundaries.md`](react/error-boundaries.md) |
| Testing | [`react/testing.md`](react/testing.md) |
| Refactoring | [`architecture/refactoring.md`](architecture/refactoring.md), [`philosophy/incremental-abstraction.md`](philosophy/incremental-abstraction.md) |
| Folder structure / new module | [`architecture/feature-driven.md`](architecture/feature-driven.md), [`architecture/folder-structure.md`](architecture/folder-structure.md), [`architecture/dependency-boundaries.md`](architecture/dependency-boundaries.md) |
| Shared code decisions | [`architecture/shared-code.md`](architecture/shared-code.md) |
| Monorepo work | [`architecture/monorepos.md`](architecture/monorepos.md) |
| API client / contract design | [`architecture/api-design.md`](architecture/api-design.md) |
| Date / time / timezone handling, or any `Date` | [`tooling/dates.md`](tooling/dates.md) |
| Internationalization / translations / locales | [`tooling/i18n.md`](tooling/i18n.md) |
| Tooling — TanStack (overview) | [`tooling/tanstack.md`](tooling/tanstack.md) |
| Tooling — TanStack Router (deep) | [`tooling/tanstack-router.md`](tooling/tanstack-router.md) |
| Tooling — TanStack Query (deep) | [`tooling/tanstack-query.md`](tooling/tanstack-query.md) |
| Tooling — Vite | [`tooling/vite.md`](tooling/vite.md) |
| Tooling — Biome | [`tooling/biome.md`](tooling/biome.md) |
| Tooling — Tailwind | [`tooling/tailwind.md`](tooling/tailwind.md) |
| Tooling — shadcn/ui | [`tooling/shadcn.md`](tooling/shadcn.md) |
| Tooling — Prisma | [`tooling/prisma.md`](tooling/prisma.md) |
| Tooling — Nx | [`tooling/nx.md`](tooling/nx.md) |
| Adding a dependency | [`tooling/dependencies.md`](tooling/dependencies.md) |
| CI / PRs / merge strategy | [`tooling/ci.md`](tooling/ci.md) |
| Logging, metrics, error monitoring | [`tooling/observability.md`](tooling/observability.md) |
| Security — auth | [`security/auth.md`](security/auth.md) |
| Security — secrets | [`security/secrets.md`](security/secrets.md) |
| Security — API design | [`security/api-security.md`](security/api-security.md) |
| Concrete examples | [`examples/good/`](examples/good/), [`examples/bad/`](examples/bad/) |
| **Task is explicitly PHP** | [`php/README.md`](php/README.md) (load first — it has its own conditional table) |

### Repository Map

| Directory | Purpose |
|---|---|
| [`philosophy/`](philosophy/) | Core principles and AI agent behavior rules |
| [`typescript/`](typescript/) | TypeScript rules, anti-patterns, validation, naming, error handling |
| [`typescript/tsconfig/`](typescript/tsconfig/) | Reference tsconfig presets (base, React, Next.js) |
| [`react/`](react/) | Component design, hooks, state, forms, a11y, testing |
| [`architecture/`](architecture/) | Feature-driven structure, monorepos, refactoring, dependency rules |
| [`tooling/`](tooling/) | TanStack, Nx, Vite, Biome, Tailwind, shadcn, Prisma, i18n |
| [`security/`](security/) | Validation, secrets, auth, API security |
| [`examples/`](examples/) | Concrete good and bad code examples |
| [`templates/`](templates/) | Drop-in starter files — `CLAUDE.md`, `AGENTS.md`, `tsconfig.json`, `biome-example.json`, `eslint.config.js`, `.gitignore`, `.editorconfig`, `.nvmrc`, project README, PR template |
| [`php/`](php/) | **Secondary stack.** PHP standards — only when the task is explicitly PHP |

### Core Philosophy

> Prefer explicit, composable, feature-oriented architecture over generalized abstractions and centralized complexity.

See [`philosophy/core-principles.md`](philosophy/core-principles.md) for the full architectural values.

### Documentation Style

All docs are directive and concise. Expect:
- `## DO` / `## DO NOT` / `## PRIORITY` sections
- Side-by-side good and bad code examples
- Hierarchical headings, no prose essays
- Cross-references via relative links
