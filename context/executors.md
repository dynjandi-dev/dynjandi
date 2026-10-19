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

**At most 3 phases of one plan run at once.** `/feature-implement` forms a round out of phases that depend
on nothing unfinished and share no file, and dispatches a coder for each; this number is the ceiling on how
many. **1 turns that off** and every phase runs on its own. It is a fact about this machine and this
account, so it is kept whichever of the three answers above is this project's.

## Reviewer

**A reviewer subagent, where this runtime provides one — otherwise the host reviews the diff against the
plan's review checklist, and says so.** An independent reader that never saw the implementation being
written is the cheapest real independence available. `/onboard` finds what this host installs or offers;
where this tool wrote a reviewer into a host-specific directory, that is what this answer means.

Here that is [`.claude/agents/reviewer.agent.md`](../.claude/agents/reviewer.agent.md) under Claude Code —
read-only tools, `opus` at high effort. A host that does not load that directory falls back as above.

## Branch and worktree

**A feature's worktree is created by `worktree branch --github <n> --assign`**, run from the main
checkout, removed by `worktree remove <branch>`, and the live-session probe is `worktree list --agents`.

**A branch with no issue — `/release`'s — is created by
`worktree branch release/<name> --source origin/main --no-open --install`**, removed by
`worktree remove release/<name> --force`. It makes the tree at `../dynjandi.worktrees/release/<name>`,
copies `.env`, runs `pnpm install --frozen-lockfile` so the changesets CLI is there, and opens no editor
and starts no agent: the session that typed `/release` works inside it. `--source origin/main` is required
— the CLI will not choose between a local `main` and its remote without prompting — so pull `main` before
`/release`, or its Gate 1 runs on a different commit from the one the branch starts at.

`worktree` is [`@northguild/worktree`](https://github.com/northguild/worktree), installed globally on this
machine (2.1.2). From an issue number it names the branch `feature/<n>-<slug>` and puts the tree at
`../dynjandi.worktrees/feature/<n>-<slug>` beside the main checkout.

**`--assign` assigns the issue to whoever runs it**, and under [`tracking.md`](tracking.md)'s answer an
assignee is the claim that a feature is being worked — so the issue reads as claimed from the moment its
tree exists, before it has a plan. `/feature-implement`'s claim step accepts an issue already assigned to
the same account and holds one assigned to anybody else.

The probe was run by `/onboard` on 2026-09-30 and again on 2026-10-19 (2.1.2), reporting the session in
every tree. The issue form's create and remove commands were not run by `/onboard` — they assign a real
issue — and are recorded from the user's answer and the shape of the tree `feature/1-sdk-ecosystem` was
created as. The release form's were run by `/onboard` on 2026-10-19, with the user's agreement, as
`release/onboard-probe` from `origin/main`: created, checked clean with the pending notes and the
changesets CLI in place, and removed, branch included. Nothing was pushed.

### This section is the only way one gets made

**Never run a bare `git worktree add`, `git branch` or `git checkout -b` because this section is empty.**
An empty section means the workflow makes neither — not that it should improvise one. A worktree made by
hand skips whatever the recorded command does around it: the env files it copies, the naming it enforces,
the place it puts the directory, the editor or agent it hands the tree to. The result looks like a worktree
and is missing the half that made the answer worth choosing.

The same holds for removing one. Nothing in this workflow removes a worktree made here — but where a person
asks for it, the command here is what runs. The scratch checkouts `/feature-implement` makes for a round of
phases are not these: no branch, nobody looks at them, and this invocation does not make them.

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
