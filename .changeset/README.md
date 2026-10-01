# Release notes, one file per change

Each file here is one note: YAML front matter naming the packages and their bump levels, then a markdown
summary that becomes the changelog entry.

```md
---
"some-package": minor
---

What changed, written for whoever reads the release.
```

**One or two sentences.** A note is read by someone deciding whether this affects them, not reviewing the
diff — so it says what changed for them and stops.

**Filenames are random on purpose.** Two differently-named files never conflict when two branches merge —
which is why a re-entered phase updates its existing note rather than writing a second one.

**A feature's merge ships nothing.** Its note lands here and waits. What ships is the merge of the pull
request where `changeset:prepare-release` was run — the notes consumed, the versions moved, the changelogs
written — and that one merge is the event for a published package and a deployed app alike. The condition for
either is **that path's own version moving in it**: a release that bumped only a package must not deploy the
app.

**Every path that merge ships leaves a tag and a release behind**, whichever of the two it got. The tag says
which commit went live; the release is where this note is finally read by the person it was written for. A
deployed app earns both exactly as a published package does — the record belongs to the event, not to the
kind of artifact.

The answers that govern what gets a note here — which paths announce, to whom, how often, and what that merge
publishes or deploys — live in [`../context/release.md`](../context/release.md), not in
this file.
