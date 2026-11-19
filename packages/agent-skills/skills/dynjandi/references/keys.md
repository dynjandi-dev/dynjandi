# Keys and `dynjandi setup`

Read this when an app needs a project key it does not have yet, or a CI job has to set one up.

## Which key

| | Variable | Authorises | Where it lives |
|---|---|---|---|
| Project key | `DYNJANDI_PROJECT_KEY` | uploads and file reads for one project | the server's environment, or a Git-ignored env file |
| Workspace API key | `DYNJANDI_API_KEY` | `dynjandi setup` | a CI secret, only for that job |

Both are credentials. Do not print either, do not put either in browser code or in a `VITE_` or
`NEXT_PUBLIC_` variable, and do not commit an env file
([CLI, the credential](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#the-credential)).
Vite exposes only `VITE_` variables to client code and Next.js only `NEXT_PUBLIC_` ones, so a variable named
`DYNJANDI_PROJECT_KEY` stays out of a browser bundle unless someone passes it on deliberately
([CLI, run a command against the server](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#run-a-command-against-the-server)).

## Get the CLI

Run `npm view @dynjandi/cli version`.

- A version printed: use `npx @dynjandi/cli@<that version>` where `dynjandi` is written below.
- A 404 from `npm view`: there is no release yet. Build it from a checkout of
  `https://github.com/dynjandi-dev/dynjandi` and use `node packages/cli/dist/cli.js` where `dynjandi` is
  written ([CLI, run it from a checkout](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#run-it-from-a-checkout)).

## Set up a project key

Run it from the app's directory. `--json` makes it print one object. The first run does not wait: it exits
`4` at once with a link for the person to approve. Run the same command again once they have; that run can
take up to 60 seconds to finish, so give it that long before treating it as stuck
([CLI, the credential](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#the-credential)):

```sh
dynjandi setup --json
```

To see what it would do first:

```sh
dynjandi setup --dry-run
```

It finds the Dynjandi project for the directory, or creates it, and writes `DYNJANDI_PROJECT_KEY` and
`DYNJANDI_PROJECT_ID` to an env file Git ignores. It never prints the key
([CLI, `dynjandi setup`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#dynjandi-setup)).

| Exit code | Meaning | What to do |
|---|---|---|
| `0` | done | read the key from the environment, as `SKILL.md` shows |
| `2` | a usage error | read the one line on standard error |
| `3` | no usable credential: no key in CI, a malformed or refused key, or an approval that was denied or has expired | in CI, set `DYNJANDI_API_KEY`; after a denied or expired approval, run it again |
| `4` | waiting for approval | show the person the link it printed, then run the same command again |

([CLI, the credential](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#the-credential),
[the result](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#the-result).)

Choosing the project or the file: `--project <id>`, `--name <name>` and `--file <path>`
([options](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#options)). For a different
env file use `--file`, never `--env-file`, which Node reads itself.

```sh
dynjandi setup --name my-app --file config/app.env
```

## A key in CI

A CI job has no one to approve anything. Set `DYNJANDI_API_KEY` to a workspace API key from a CI secret, and
never pass it as an option: there is no option for it, and `--api-key` is a usage error.

## What this does not stop

`setup` keeps a key out of a transcript, a commit and a log. It does not stop a compromised agent with shell
access from reading the env file
([CLI, platforms and limits](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/cli/README.md#platforms-and-limits)).
