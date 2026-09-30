# Tracking

Where this project's workflow state lives — the backlog, the plans, and the phase ledgers. **Every command
that reads or writes workflow state reads this file first** — the exact parallel to [`verify.md`](verify.md)
for commands, [`executors.md`](executors.md) for dispatch and [`git.md`](git.md) for git etiquette, and for
the same reason: a skill that assumes one project's answer ships one project's habits everywhere.

**This file holds an answer, not a procedure.** Which substrate, which labels, which remote — those are
this project's choices. *How* a phase is claimed, when a heartbeat is written, and in what order a plan and
its phases are created are not choices; they live in the skills, so a defect in one can be fixed by an
update. Run `/onboard` to set the answer below, or edit it here.

**Setting the answer is not moving the work.** `/onboard` writes the answer; `/tracking-migrate` carries
whatever already exists in the tree onto it. Where the two disagree — this file naming a tracker while
`roadmap.md` still holds entries — every command reads an **empty backlog**, so the migration is a task
rather than an option. If that split exists here, it is named in this file.

What each section takes, and the alternative answers written out, are in
[`tracking.notes.md`](tracking.notes.md). `/onboard` reads that file when it fills this one.

## Where tracking lives

**In an issue tracker.** A feature is an issue, its plan is that issue's body, and the phase ledger is a
table inside that body. The tracker is the shared home every working tree can reach — chosen here because
[`git.md`](git.md) puts each feature in its own worktree, several at once, and pushes each branch, and this
is the only thing outside every worktree that all of them can write to.

**Set on 2026-09-30 with nothing to migrate.** `roadmap.md`, `history.md`, `drafts/`, `plans/` and
`archive/` held no entries, rows or documents when this answer was written, so no `/tracking-migrate` is
owed.

### Under the tracker answer

**Nothing in the workflow names GitHub. This table is where it is named**, so that a different tracker is a
rewrite of this section rather than of the skills. A command asks for the *fact*; this says how to read it.

| To know | Read |
|---|---|
| the backlog | open issues labelled `workflow:feature` |
| whether a feature has a plan | whether the issue body holds a phase ledger |
| whether a feature is being worked | whether the issue has an assignee |
| which phases exist, in what order, depending on what | the issue body's phase ledger |
| where a phase stands | that ledger row's Status column |
| what a retired feature's outcome was | the closed issue — *completed* is shipped, *not planned* is dropped |
| what kind of work it is | the issue's type — set by the workflow, read by nothing in it |
| what gets planned next | the issue body's `Priority:` line |
| which features have to land before this one | the issue's **blocked by** relationships |
| how much a plan may hold | the issue body's size limit — **65,536 characters** |
| how a change closes one | `Closes #<n>`, in the pull request body where there is one and in the commit message otherwise |

**The ledger is one table, and it is the same one a plan document carries** — `#`, `Phase`, `Depends on`,
`Status`, `Note`, with a `Files:` line in each phase's own section. Nothing about its shape changes between
the two answers, which is why the commands below say *unchanged* far more often than they say *becomes*.

**A closing row names the commit that carried the phase.** Under the working-tree answer the row travels
inside the commit, so it cannot disagree with the code. A body edit cannot ride a commit, so evidence
replaces that atomicity: a `done` row whose sha is in the branch is checkable, and a `done` row with no sha
is a disagreement to stop on.

**Repository:** `dynjandi-dev/dynjandi`
**Backlog label:** `workflow:feature`
**Planned label:** `workflow:planned`

**`feature` is this workflow's word, not a claim about kind.** [`workflow.md`](workflow.md) defines a
feature as work you would want a history row for — so a bug large enough to plan is a feature, and the
label says nothing about whether it is one. It is namespaced for exactly this reason, and so that it cannot
collide with an `enhancement` or `feature` label this repository already uses.

**This project's own labels are untouched.** An issue keeps everything it already carries; the workflow
adds two bits and reads one of them.

### The planned label — the backlog, legible from the list

**The backlog label says an issue is in the loop. The planned label says it has a plan**, and it exists
for one reader: a person scanning the issues list, who cannot open every issue to find out which bodies
hold a ledger. Both chips render on the row, so three states are readable without a click — the backlog
label alone is an idea, both labels is planned and unstarted, and both plus an assignee is being worked.

**The ledger in the body is still the fact. The label is a rendering of it, and nothing reads it.**

> **No ranking, refusal, selection, gate or report may branch on the planned label.** *Whether a feature
> has a plan* is answered by the body, in the table above, by every command, every time. The workflow
> would behave identically if every planned label in this repository were deleted tonight.

That clause is what keeps this a second *view* rather than a second *answer*, and it is the same standing
this file already gives the issue's type — set by the workflow, read by nothing in it. `Priority:` is the
near miss that shows the line is real: it **is** read, by one ranking, and it had to be argued for
separately.

**Who writes it, and when:**

| Command | Does |
|---|---|
| `/feature-plan` | **applies it**, in the same run that writes the plan into the body |
| `/tracking-migrate` | applies it to a migrated feature that arrives with a plan already written |
| `/roadmap` | **never** — an entry it opens is an idea, and an issue it adopts is somebody's report |
| `/feature-implement`, `/feature-close`, `/feature-status`, `/orchestrate` | nothing. It is not removed on the way out, because a closed issue has left the list the label is read from |

**A label that disagrees with the body is a stop, and the body wins.** The write lands immediately after
the body write rather than inside it, so the window is real and is the same one the ledger's own closing
row lives with. Two disagreements, both for `/feature-status` to report and neither for it to resolve:

- **A ledger in the body with no planned label** — an interrupted `/feature-plan`, or a plan somebody wrote
  by hand. The feature is planned; the sticker is missing.
- **A planned label on a body with no ledger** — a label applied by hand. The feature is not planned,
  whatever the row says.

**Applying it is best-effort, exactly as the type and `blocked by` are**, and for once that is the same
sentence rather than a similar one: applying an existing label needs **triage** on the repository, which is
the identical bar `blocked by` names above. Where the write is refused, say so once and carry on.

**Creating the label needs more than applying it, which is why only `/onboard` creates one.** Creating,
editing and deleting labels need **write** access, and applying one to an issue does not create it — the
write is refused outright when the name does not exist. So both labels are created once, by the command
that runs before any work, and every command after it only ever applies what it finds.

On GitHub that is `gh issue edit --add-label` and `--remove-label` to apply, `gh label create` to make one
and `gh label list` to see what this repository already uses. **A name that does not exist fails before the
issue is touched** — `'<name>' not found`, resolved client-side ahead of the mutation — so a failed apply
never leaves a half-labelled issue. Matching is case-insensitive.

### The issue's type

**The workflow sets it and never reads it.** `/roadmap` guesses from the one or two lines it has when it
opens the issue; `/feature-plan` corrects it once the research exists. Nothing else touches it, and **no
refusal, no ranking and no report may branch on it.** The moment one does, this stops being metadata for
your tracker and becomes a second vocabulary laid across the one in [`workflow.md`](workflow.md).

**Types:** `Task`, `Bug`, `Feature` — set at the `dynjandi-dev` organisation.

**`Task` here is not [`workflow.md`](workflow.md)'s task.** That file uses *task* for work too small for
the loop, handled by `/orchestrate`. An issue typed `Task` is still a workflow **feature**: it is in the
loop and it will get a history row. The two words are unrelated, and inside the tracker the tracker's wins.

**Best-effort in both directions.** A project with no types configured gets nothing. Setting a type needs
push access and GitHub drops it silently without one, so it is never assumed to have landed. Neither case
is worth a refusal — it is metadata, not a gate — and both are worth saying once.

**An existing type is never overwritten.** An adopted issue keeps whatever its reporter set.

### Priority

**`Priority:` is a line in the issue body**, one of `Urgent`, `High`, `Medium`, `Low`. An issue without one
ranks as `Medium`.

It replaces something the working-tree answer gets structurally: **an issues list has no manual order.** In
`roadmap.md` importance is expressed by moving a line, and `/feature-plan`'s ranking ends with *backlog
order*. Here the issue number is creation order and nothing else is available, so the fact needs somewhere
to live.

**`/feature-plan` reads it, above every other ranking key.** Overriding the default order is the whole
point of marking something urgent; a field that only broke ties between equally-prepared entries would not
do the job it was added for.

**Size and priority are different questions.** Size is effort and feeds a later ranking key; priority is
importance and leads. Both are body lines and neither substitutes for the other.

**Projects and milestones are yours.** Nothing here creates, reads or writes either one. Assign a milestone
by asking for it, group issues on a board if you want one — the workflow will not notice and will not
interfere.

### Blocked by — the order between features

**A dependency between two features is the tracker's own `blocked by` relationship**, set on the issue that
has to wait and naming the issue it waits for. One write, and it is visible from both ends — the waiting
issue reads *blocked by*, the one it waits for reads *blocking* — so nothing has to record the other
direction and nothing can record it differently. On GitHub that is `gh issue edit --add-blocked-by` and
`--remove-blocked-by`, `gh issue create --blocked-by`, and `blockedBy` as a JSON field on both `gh issue
view` and `gh issue list` — **the whole backlog's order in one query.**

**This is the one fact the working-tree answer has nowhere to keep.** There, order between features is read
out of [`history.md`](history.md): a feature is unblocked once the thing beneath it has shipped, which is
only ever knowable after the fact. A relationship states it while both are still pending, which is what
turns *what should I pick up next* into something the backlog answers rather than something a person
reconstructs from titles.

**Never a body line and never a comment.** A sentence saying *needs the export API first* is a second home
for a fact the tracker already holds, and the two go out of step the moment one issue closes. The
relationship is the record; prose about it is not.

**Between features only.** Phases are rows in the ledger, in one body — they are not issues and they have
no relationships. A phase's `Depends on` column and a feature's `blocked by` answer the same question at
two scopes that never meet, and joining them would put the ledger back into separate objects.

**Closing the blocker is the whole of clearing it.** A closed issue no longer blocks, so nothing in this
workflow removes a relationship on the way out. The exception is a feature closed as *not planned*:
whatever it was blocking has just been unblocked by something nobody is going to build, and the only thing
that says so is the close reason.

**Best-effort, like the type.** Creating one needs triage permission on the repository, and it is available
on GitHub Free, Pro, Team and Enterprise Cloud. Where the write is refused or the feature is absent, say so
once and carry on — the relationship is how the backlog is read, not a gate anything passes.

### The body has a ceiling, and it measures scope

**An issue body holds 65,536 characters.** That is the one hard limit in this substrate, and this is the
only place the number belongs — a command asks whether the plan fits, and this section says what fitting
means.

**A plan that does not fit is not a formatting problem. It is a feature that is several features.** A
filled plan is a few thousand characters; reaching sixty-five thousand means the design, the phases and the
risks of more than one piece of work were written into one document. The working-tree answer has no such
ceiling and that is not an advantage — a plan document that would overflow a body is over the same line,
and nothing there says so. The limit is a check this substrate gives for free.

**The plan needs room left over, because the body is written into for the feature's whole life.** Every
phase row moves through `in progress` to `done` and gains a commit sha and a note as it closes, and those
edits land in the same body. A plan that only just fits has already failed — by the last phase it would
not.

**Three workarounds are refused:** trimming the plan until it fits, moving sections into comments, and
linking out to a gist or a file. The first throws away the research the plan exists to hold; the other
two give one plan two homes, which is what putting the ledger in the body settled. **The answer is to split
the feature into separate issues**, each with its own plan and its own ledger — `/feature-plan` proposes
the split along phase boundaries and asks, and `/tracking-migrate` refuses rather than guessing at one.

## What this file does not decide

**How a phase is claimed, and how staleness is noticed.** Optimistic claiming and the phase-boundary
heartbeat are mechanisms, not preferences, and they live in the skills so an update can repair them.

**Whether work is pushed.** That is [`git.md`](git.md). This file only records that the tracker answer
depends on the pushing one.

**Which features are in flight across the repository.** Under the tracker answer that is the set of
assigned issues; under the working-tree answer with worktrees it is `git worktree list`. Neither is
written down anywhere, and a file that tracked it would be a cache of something already true elsewhere.

## The rules that hold either way

- **A feature never states its own status.** There is no `**Status:**` line in a plan document and none in
  an issue body. *Whether a feature is being worked* is read off the structure — a marker under one answer,
  an assignee under the other — so there is never a second copy to go stale. An issue body holds the
  problem before planning and the plan after, and never a claim about where the work stands.
- **A phase does state its status, in its ledger row, under both answers.** That is not the rule above
  bending: the ledger is the single home for phase status, and the four values are written rather than
  observed because no structure expresses `blocked`.
- **The ledger row lands with the work, or names it.** Under the working-tree answer the row and the code
  it describes are one commit. A body edit cannot be, so under the tracker answer the closing row carries
  the commit's sha and is checkable against the branch instead.
- **`done` is a verdict about the gates**, not about git and not about the tracker.
- **`notes.md` is a file in the working tree under both answers**, written by a phase's review and deleted
  whole by `/feature-close`. Nothing reads it, so there is no fact in it for a substrate to hold, and it is
  not a thing this file has an answer about.
- **A bug is not a backlog entry**, under either answer. The backlog holds **features** — work you would
  want a `history.md` row for. A defect goes wherever this project already files bugs, keeping this
  project's own labels, and nothing in the workflow reads it, ranks it or carries it. The **backlog**
  label above is the bit that puts an issue in the loop, and a bug is outside it — which is also why that
  label is `/roadmap`'s to apply and no gate's. The planned label follows it and never leads: an issue that
  is not in the backlog cannot be planned, so nothing applies the second without the first.
- **Neither `history.md` nor `archive/` is ever converted, in either direction.** Fabricating closed
  issues for features shipped months ago produces wrong dates, empty threads and an audit trail that looks
  real and is not. Under the tracker answer they stay as the frozen record of the era before the switch —
  new closures become closed issues, the old ones stay where they happened. Two eras, not two homes.
- **If this file is missing, the answer is the first one in every section.** An install from before it
  existed has no policy written down: treat it as *in the working tree*, say so once, and name `/onboard`.
