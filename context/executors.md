# Executors

How this project dispatches a **coder** and a **reviewer**, and how it creates a **branch or worktree**.
Hand-written prose, read fresh at dispatch time — the exact parallel to [`verify.md`](verify.md), and for
the same reason: a skill that hardcodes an invocation bakes one machine's setup into a tool that ships
everywhere.

The coder and the reviewer each have three answers: **in-host** directly, **in-host but isolated** in a
subagent, or **offloaded** to an external executor, a CLI or a tool. The middle one is described in terms
of what it does, never by naming a runtime's primitive — a host that has no subagent mechanism reads it
and falls back to the first. *Branch and worktree* is not one of those three: it is a command or it is
nothing.

Run `/onboard` to fill this in.

What each section takes, and the alternative answers written out, are in
[`executors.notes.md`](executors.notes.md). `/onboard` reads that file when it fills this one.

## Coder

**A subagent, briefed with [`roles/coder.md`](roles/coder.md), on `sonnet` where this runtime lets you
choose a subagent's model — otherwise implement in-host.** The phase's implementation runs in its own
context and returns that file's output contract; the ledger and the gates stay with the caller. A runtime
with no subagent mechanism reads this answer, implements in-host, and says so.

## Reviewer

**A reviewer subagent, where this runtime provides one — otherwise the host reviews the diff against the
plan's review checklist, and says so.** An independent reader that never saw the implementation being
written is the cheapest real independence available. `/onboard` finds what this host installs or offers;
where this tool wrote a reviewer into a host-specific directory, that is what this answer means.

Here that is [`.claude/agents/reviewer.agent.md`](../.claude/agents/reviewer.agent.md) under Claude Code —
read-only tools, `opus` at high effort. A host that does not load that directory falls back as above.

## Branch and worktree

**A worktree is created by `worktree branch --github <n> --assign`**, run from the main checkout, removed by
`worktree remove <branch>`, and the live-session probe is `worktree list --agents`.

`worktree` is [`@northguild/worktree`](https://github.com/northguild/worktree), installed globally on this
machine (1.8.0). From an issue number it names the branch `feature/<n>-<slug>` and puts the tree at
`../dynjandi.worktrees/feature/<n>-<slug>` beside the main checkout.

**`--assign` assigns the issue to whoever runs it**, and under [`tracking.md`](tracking.md)'s answer an
assignee is the claim that a feature is being worked — so the issue reads as claimed from the moment its
tree exists, before it has a plan. `/feature-implement`'s claim step accepts an issue already assigned to
the same account and holds one assigned to anybody else.

The probe was run by `/onboard` on 2026-09-30 and reported the session in `feature/1-sdk-ecosystem`. The
create and remove commands were not run by `/onboard` — they make and delete real trees — and are recorded
from the user's answer and the shape of the tree `feature/1-sdk-ecosystem` was created as.

### This section is the only way one gets made

**Never run a bare `git worktree add`, `git branch` or `git checkout -b` because this section is empty.**
An empty section means the workflow makes neither — not that it should improvise one. A worktree made by
hand skips whatever the recorded command does around it: the env files it copies, the naming it enforces,
the place it puts the directory, the editor or agent it hands the tree to. The result looks like a worktree
and is missing the half that made the answer worth choosing.

The same holds for removing one. Nothing in this workflow removes a worktree at all — but where a person
asks for it, the command here is what runs.

## The contract, whatever is configured

A review happens, it returns a verdict, and every item in it is marked blocking or not. A `FAIL` is looped
back on, and a gate at its cap leaves the phase `blocked` with the reason in its ledger row.

## Standing rules for any external executor

- **Exit code alone proves nothing.** A CLI can exit 0 after hitting a usage limit mid-run, having
  completed most but not provably all of a brief. Grep the captured output for exhaustion and error
  markers before trusting a summary, and on a hit check `git status` and each acceptance criterion
  individually.
- **Take the model from the CLI's own config**, not from a flag written here. A hardcoded model flag is one
  more place to update when models turn over, and a rejected model can still exit 0 having written nothing.
  **A subagent is the exception**: it has no config of its own, so its tier is written in the Coder answer
  above — as an alias the runtime resolves, never a dated model id.
- **No blanket permission-bypass flag.** Scope permissions in the CLI's own config instead. A standing
  bypass-everything instruction in a committed file is persistent privilege escalation.
- **Assume the executor can read this repository** unless you have tested otherwise. Briefs cite paths;
  they do not paste file contents. If an executor genuinely has no filesystem access, say so here — that is
  the one case where a brief has to carry content inline.
