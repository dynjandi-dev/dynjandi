# Stack

What this project is, and what an agent has to know before touching it. Run `/onboard` to fill it in.

What each section takes is in [`stack.notes.md`](stack.notes.md). `/onboard` reads that file when it fills
this one.

The public integration surface for Dynjandi, an image CDN at `cdn.dynjandi.dev`: an OpenAPI spec and a
TypeScript SDK (`@dynjandi/sdk`). The service itself lives in a separate private repository; this one was
split out of it on 2026-09-30 so the spec and SDK can be public and permissively licensed.

**Nothing is built here yet.** On 2026-09-30 the tree held an empty `README.md` and the workflow overlay.
The cells below and the layout stay empty until the work that creates them lands, and that work fills
them — the design lives in issue #1 (`sdk-ecosystem`), not here.

| Concern | Target |
|---|---|
| Runtime | |
| Package manager | |
| Database | |
| Storage | |
| Hosting | |

## Layout

```
context/   workflow state and project answers (verify, git, tracking, release, executors, standards)
```

## Conventions

None recorded yet.

## Documentation

- `README.md` — the repository's front page, for anyone arriving from GitHub or npm. **Empty.** Whatever
  first gives this repository something to install or read owes it a first version.

Nothing is published outside this repository. The private service repository describes the upload
contract and URL grammar for its own maintainers, but it is not a surface a change here has to reach.

## Also in `context/`

Verification commands are in [`verify.md`](verify.md), not here. Executor dispatch is in
[`executors.md`](executors.md), who commits is in [`git.md`](git.md), and what a change announces is in
[`release.md`](release.md).
