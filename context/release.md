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

**This is a gap in a repository that publishes.** `publish.yml` (below) publishes `@dynjandi/sdk` to npm and
the OpenAPI spec has a stable URL, so *nothing announces a change* above records that no answer has been
set yet — not that this project has nothing to announce. Once a `package.json`
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

**One event ships anything: a push to `main` that changes `packages/sdk/package.json`'s `version` to one npm
does not hold.** What fires on it is [`publish.yml`](../.github/workflows/publish.yml), not this workflow's
skills, which still bump nothing, tag nothing and publish nothing. A merge that does not move the version
ships nothing, and landing a change is still not shipping it.

As of 2026-10-01, one line each:

- **Bumps a version** — a person, by editing `version` in `packages/sdk/package.json` (plain `x.y.z`; the
  workflow refuses anything else) in the change that should ship. Nothing bumps it automatically.
- **Tags** — `publish.yml`, after a successful publish: `sdk-v<version>` on the commit the run is for. The
  name has no `/` so it is safe inside a `raw.githubusercontent.com` URL. The repository has no tags until
  the first run that publishes.
- **Cuts a GitHub release** — `publish.yml`, in the same job as the tag. It is idempotent: a tag or release
  that already exists for the version is a notice, not a failure.
- **Publishes** — `publish.yml`, on a push to `main` when the version is not on npm, after the live smoke
  test passes. `@dynjandi/sdk` goes to npm; **the spec is not published by anything**: its stable URL is the
  raw GitHub one on `main`, and a release makes `sdk-v<version>` addressable as a snapshot of it (below).
- **Deploys** — nothing. Nothing is deployed from this repository.

### How the SDK is published

| Question | Answer |
|---|---|
| Event | a **push to `main` that touches `packages/sdk/**`, `pnpm-lock.yaml`, `LICENSE` or `publish.yml`**. That only starts the run; whether anything publishes is the next row. There is no `workflow_dispatch`, so nothing can start it by hand |
| Gate | **the registry.** `check` reads `version` from `packages/sdk/package.json` and runs `npm view "@dynjandi/sdk@<version>" version`. On npm already: a notice and a green stop (so a re-run, an unbumped change and a run after a half-failed publish all stop green). Not on npm: smoke, build, publish, release. `publish` asks again, in case the registry moved |
| Precondition | the live smoke test, `smoke.yml` called with the Actions secret `DYNJANDI_SMOKE_PUBLIC_KEY`, **only when there is a version to publish**. A smoke failure (drift between the spec and the service, or an outage) blocks the publish; fix the cause and re-run the failed workflow, or push again |
| Jobs | `check` (`contents: read`) → `smoke` → `build` (`contents: read`: install, build, `pnpm test`, `pnpm check:package`, `pnpm pack`, upload the tarball) → `publish` (`id-token: write`, **no checkout, no install, no cache**: downloads the tarball, `npm publish`) → `release` (`contents: write`, runs only `gh`). So no dependency's code runs in a job that can request an npm OIDC token, and the job that can write the repository runs no dependency code either. Every job refuses any ref but `refs/heads/main`, because npm trusts any run of this file; that stops accidental runs, not someone with push access, since it is only as strong as the copy of the file being run |
| Authentication | npm **trusted publishing** (OIDC). **No npm token exists**, in the repository, in secrets or anywhere. It needs npm >= 11.5.1 and Node >= 22.14.0; the job uses Node 24 and fails if `npm --version` is older |
| Provenance | **yes, for every version the workflow publishes.** npm generates it automatically for a trusted publish from a public repository of a public package ([docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers), "Automatic provenance generation"); the workflow also passes `--provenance`, so a publish that could not produce it fails. `repository.url` in `package.json` must match this repository. **`0.1.0` has none**: it is published from a person's machine |
| Pack and publish | `pnpm pack` from `packages/sdk` (its `prepack` rebuilds `dist/` and copies the root `LICENSE` in; the SDK has no `workspace:` dependency, so nothing is rewritten), then `npm publish <tarball> --access public --provenance` |
| Dry run | `pnpm check:package` in [`verify.md`](verify.md) and `ci.yml`: asserts the tarball's contents and runs `npm publish --dry-run`, which npm refuses over a version it already holds, so it is skipped then and the real dry run is seen on the change that bumps the version |

### The first publish is by hand, and the trusted publisher names `publish.yml`

A trusted publisher can only be configured on npmjs.com **for a package that already exists**, so CI cannot
publish `0.1.0`. **The first publish of `@dynjandi/sdk` is a person's, and it is permanent**: a published
version can be neither changed nor reused. Do it before the change that adds `publish.yml` merges to `main`,
from the commit that will merge. If the merge comes first, the run finds `0.1.0` absent, runs the smoke
test and then fails at `npm publish`, because no publisher is configured yet (nothing is published, and the
tag and release are not created). To recover, do steps 1–4 below from `main`. The failed run can be left
alone; no run follows on its own. Re-running all jobs stops green at `check`. Re-running only the failed
job lets `publish` find `0.1.0` and exit 0, and `release` then tags `sdk-v0.1.0` on the merge commit.

1. `pnpm install --frozen-lockfile`, then `pnpm build && pnpm test && pnpm check:package`.
2. From `packages/sdk`: `pnpm pack --pack-destination "$(mktemp -d)"` (note the directory it prints), which
   runs `prepack`. A bare `npm publish` from the package directory would also run `prepack`, but publish the
   tarball so that it is the one that was inspected.
3. `npm login` (the account must belong to the `@dynjandi` organisation; 2FA applies), then
   `npm publish <dir>/dynjandi-sdk-0.1.0.tgz --access public`, then `npm view @dynjandi/sdk version`.
4. On npmjs.com, **the package's Settings, Trusted publishing, GitHub Actions**: Organization or user
   **`dynjandi-dev`**, Repository **`dynjandi`**, Workflow filename **`publish.yml`**, Environment **empty**.
   **Allowed actions: tick `npm publish`** (a publisher created now allows only `npm stage publish` by
   default, which would refuse the workflow's `npm publish`). Each field is
   case-sensitive and cannot be edited afterwards, only deleted and re-created, which is why publishing lives
   in its own file: **renaming or moving `publish.yml` breaks publishing**, and so does moving the job into
   `ci.yml`.
5. Optionally, the package's **Publishing access**: "Require two-factor authentication and disallow tokens".
   Trusted publishing keeps working; it only closes the token route.
6. Merge. The run finds `0.1.0` held and stops green, so **no tag or release exists for `0.1.0`**. To give it
   one, by hand, once: `gh release create sdk-v0.1.0 --target <the commit on main the merge produced> --title
   "@dynjandi/sdk 0.1.0" --notes "..."` (with a squash merge, the commit `0.1.0` was packed from is not on
   `main`; the merged commit holds the same tree). Without it, the spec has no versioned URL until `0.1.1`.

7. Once `npm view` returns it, delete the "not on npm until" / "until the first version has been published"
   wording in `README.md` and `packages/sdk/README.md`, which is true today and stops being true then; and if
   step 6's tag was made, the "No such tag exists yet" sentence in `packages/spec/README.md`.

The Actions secret `DYNJANDI_SMOKE_PUBLIC_KEY` must exist for the smoke test to pass (phase 5 set it).

### How a release is cut

1. In the change that should ship, bump `version` in `packages/sdk/package.json` (plain `x.y.z`).
2. Merge it to `main`. `publish.yml` finds the version absent from npm, runs the smoke test, builds, publishes
   with provenance, then tags `sdk-v<version>` and cuts the GitHub release.
3. The spec at that version is
   `https://raw.githubusercontent.com/dynjandi-dev/dynjandi/sdk-v<version>/packages/spec/openapi.yaml`.

**A published version is permanent.** The gate means a version is never published twice, and never
overwritten: fix forward with a new one.

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
