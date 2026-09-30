# Release

What a change here announces, and to whom. **Every command that lands code reads this file before it closes
out** — the exact parallel to [`verify.md`](verify.md) for commands, [`executors.md`](executors.md) for
dispatch, [`git.md`](git.md) for git etiquette and [`tracking.md`](tracking.md) for workflow state, and for
the same reason: what deserves a note differs per repository, and a skill that assumes one project's answer
ships one project's habits everywhere.

**This file holds an answer, not a procedure.** Which paths announce, what records a note, and how often —
those are this project's choices. *When* a note is written relative to the gates, and which command writes
it, are not choices; they live in the skills, so a defect in one can be fixed by an update.

**An answer here has to be true.** [`verify.md`](verify.md) can say *no lint step* and be accurate — a
project without a linter chose that. This file cannot: *a change is announced by writing a note* is **false**
in a repository where nothing records one, and a false answer here is the same defect as a `done` row whose
**Files:** do not exist. Run `/onboard` to set it — that command either writes the true answer or makes it
true, and it refuses to write a mechanism that is not on disk.

**A note is not a release, and a merge is not a deploy.** Nothing in this workflow bumps a version, tags,
publishes, releases or deploys. What does — and the **one event** that fires it, for a published package and
a deployed app alike — is the last answer in this file: *What a release ships, and on what event*. That
answer also records what the event **leaves behind**, which is a tag and a release for every path it ships.

What each section takes, and the alternative answers written out, are in
[`release.notes.md`](release.notes.md). `/onboard` reads that file when it fills this one.

## What announces a change, and to whom

**Nothing here announces a change.** No path is recorded below, so no change owes a note and every command
reads this section and moves on. **That is a statement about what is written down here, not a claim that
this project publishes nothing** — which is what makes it the one answer that is true of every repository
before anyone has looked at it.

**A path with no row is not the same as a path whose row says nothing.** A change touching a path this table
does not cover is **named in the report, given no note, and left alone** — this file is missing an answer,
which is `/onboard`'s work and not something to guess at mid-change. Never invent a row, and never refuse
ordinary work over a gap in a configuration file.

**One change can touch two paths with different answers.** The unit is the path, not the change: a change
touching two of the paths above owes whatever each of their rows says, which may be two notes, one, or
none.

## What records a note

**Nothing records a note here.** There is no notes directory and no changelog section this workflow writes
to.

**This is a gap in a repository that is about to publish.** Issue #1 (`sdk-ecosystem`) plans to publish
`@dynjandi/sdk` to npm and the OpenAPI spec at a stable URL, so *nothing announces a change* above records
that no answer has been set yet — not that this project has nothing to announce. Once a `package.json`
exists, `npx @baldurpan/create-ai-workflow release-init` sets up a note mechanism (it writes nothing into
this file); re-run `/onboard` afterwards to write the per-path answer here.

## At what granularity

**Once per feature.** The note is written by `/feature-close`, before the commit that retires the feature,
so it rides whatever that command hands over. No phase writes one.

**This is one answer for the project, not a column in the table above.** The table asks *does this path
deserve a note*; this section asks *what leaves this repository as a unit*, and that is a property of the
repository rather than of the path a change happened to touch.

**Granularity governs the plan flow, and `/orchestrate` has neither value.** That command has no entry, no
plan and no ledger, so *per phase* and *once per feature* are both unreadable there: **the change is the
unit.** It still consults the table above, so a docs typo gets no note because column three says so.

**The bump level is confirmed where the note leaves this machine, not where it is written.** A note is a
tracked file that publishes nothing until a version moves, so the level is cheap to correct right up to the
release. `/feature-close` shows the notes a feature carries and confirms their levels — writing them under
*once per feature*, reading what the phases wrote under *per phase* — and [`git.md`](git.md)'s
*Push and pull request* answer decides whether that is the last moment before a push or before a handover.

## What a release ships, and on what event

**Nothing in this workflow bumps a version, creates a tag, publishes an artifact, or deploys anything, and
nothing here ships on a merge.** Recording a note and cutting a release are two acts; only the first is in
scope, and what performs the second is not written down here yet.

As of 2026-09-30, one line each:

- **Bumps a version** — nothing yet.
- **Tags** — nothing yet. The repository has no tags.
- **Cuts a GitHub release** — nothing yet.
- **Publishes** — nothing yet. `@dynjandi/sdk` to npm and the spec at a stable URL are planned in issue #1.
- **Deploys** — nothing yet. Whether serving the spec is a deploy depends on where its stable URL lives, which
  issue #1 leaves open.

**The release job is the gap, and it is one gap.** Versioning, tagging, cutting a release and publishing
hang off one event — the merge where notes are consumed and versions move — and the job that performs it,
with its npm credentials, is not written. Its tag and GitHub release are part of the same job and named
with it, so a first publish does not leave an empty releases page behind.

## The rules that hold either way

- **A note is part of the change, and shares its fate.** It lands with the code it describes, under
  whichever answer [`git.md`](git.md) gives about who commits. A change that is abandoned takes its note
  with it.
- **Re-entering the work does not write a second note.** A resumed phase and a review loopback both come
  back through the same step. Update the note that is already there — two files describing one change do
  not conflict and are both counted, which is the one case where doing the right thing twice is the
  failure.
- **Landing a change is not shipping it.** A merged feature carries a note and nothing else; the change
  reaches users on the event above, which is somebody's deliberate act. Never report work as released,
  deployed or live because it landed — say what it is waiting for.
- **A dropped feature announces nothing, and its landed phases keep their notes.** A note belongs to the
  change that landed, not to the outcome the feature was later given.
- **Saying nothing is not the same as answering *no*.** Where a change owes no note, name the paths that
  were checked and why none of them deserved one — the rule a plan's §7 Documentation already follows.
  An empty report reads as "nobody looked".
- **A missing entry is skipped, never faked** — the same rule [`verify.md`](verify.md) states about an empty
  section, applied to a path with no row.
- **A note that describes nothing is never written to satisfy a check.** Mechanisms that gate on notes
  commonly offer a placeholder note carrying no change, for the case of a change that genuinely announces
  nothing — and it is the obvious way past a check that has gone red on a commit which owes nothing, a
  release most of all. **Reaching for it is the signal that the check is asking the wrong question**, so
  the work is to fix the check and to say in the report that it was wrong. Writing the placeholder instead
  trains everyone who sees the commit that notes are what you feed a gate, and a gate that a lie satisfies
  has stopped being one — which is paid for later, by whoever reads a changelog missing an entry for code
  it shipped.
- **This file is unaffected by [`tracking.md`](tracking.md).** A note is an artifact of the change, so it is
  a file in this repository under both of that file's answers. There is no *Under the tracker answer*
  section here, and its absence is deliberate.
- **If this file is missing, the answer is the first one in every section.** An install from before it
  existed has no policy written down: treat it as *nothing here announces a change*, say so once, and name
  `/onboard`.
