// A stand-in for the `docker` command, put first on PATH by docker.test.ts. It never touches a daemon or a
// network: it appends its arguments to FAKE_DOCKER_LOG (one JSON array per line) and plays the scenario in
// FAKE_DOCKER_SCENARIO:
//   ok            every command succeeds; `run` stays up until `stop` is called
//   no-daemon     `version` fails the way a stopped daemon does
//   pull-denied   `pull` fails with two stderr lines, the first being Docker's own
//   never-healthy `run` stays up, but `port` names FAKE_DOCKER_PORT, where nothing answers
//   slow-pull     like ok, but `pull` prints its first line at once, then takes 1500 ms to print the rest and
//                 to leave the `${log}.pulled` marker (so a test can tell a line arrived before the pull ended)
//   crashes       `run` prints a line and exits 1
//   network-fails `network inspect` fails the way a stopped daemon does
// FAKE_DOCKER_NETWORK is what `network inspect bridge` prints on stdout (the default is Docker 29.9.2's own
// `--format '{{json .IPAM.Config}}'` output for the default bridge); it is checked that the call asks for
// exactly that format.
// FAKE_DOCKER_PORT is the host port `docker port` reports.
// FAKE_DOCKER_IMAGE is `present` or `absent` (the default): `image inspect` exits 0 or 1, as Docker 29.9.2
// does for a `tag@digest` reference (plan section 8).
// FAKE_DOCKER_PS is a JSON array of {name, owner} for `ps`, which prints `<name>\t<owner label>` per entry,
// as the CLI's --format asks; it does not apply the --filter, the test reads that from the log.
// Like the real `docker port`, it fails (exit 1, "No public port" on stderr) until the container is running,
// that is until `run` has logged its arguments and left the `${log}.running` marker. A refused `port` attempt
// is not appended to the log, so the log only ever holds the one attempt that answered, and `run` is always
// logged before it.
// `run` also gives up on its own after RUN_LIFETIME_MS (two minutes: the longest legitimate test waits
// 30 s on the health check), so a red or killed test run cannot leave it behind under PID 1.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const log = process.env.FAKE_DOCKER_LOG;
const scenario = process.env.FAKE_DOCKER_SCENARIO ?? "ok";
const stopMarker = `${log}.stopped`;
const runningMarker = `${log}.running`;
// Read once, so that logging and answering a `port` always agree on whether the container is running.
const running = existsSync(runningMarker);
const RUN_LIFETIME_MS = 120_000;
// A refused `port` is not logged: only the attempt that answers is.
if (!(args[0] === "port" && !running)) appendFileSync(log, `${JSON.stringify(args)}\n`);

switch (args[0]) {
  case "version":
    if (scenario === "no-daemon") {
      process.stderr.write(
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n",
      );
      process.exit(1);
    }
    process.stdout.write("99.88.77\n");
    break;
  case "image":
    // Only `image inspect` is played.
    if (args[1] !== "inspect") {
      process.stderr.write(`fake docker: unexpected command ${args.join(" ")}\n`);
      process.exit(2);
    }
    if ((process.env.FAKE_DOCKER_IMAGE ?? "absent") === "present") {
      process.stdout.write("[{}]\n");
    } else {
      process.stderr.write(`Error response from daemon: no such image: ${args[2]}\n`);
      process.exit(1);
    }
    break;
  case "network":
    if (
      args.length !== 5 ||
      args[1] !== "inspect" ||
      args[2] !== "bridge" ||
      args[3] !== "--format" ||
      args[4] !== "{{json .IPAM.Config}}"
    ) {
      process.stderr.write(`fake docker: unexpected command ${args.join(" ")}\n`);
      process.exit(2);
    }
    if (scenario === "network-fails") {
      process.stderr.write(
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n",
      );
      process.exit(1);
    }
    process.stdout.write(
      `${process.env.FAKE_DOCKER_NETWORK ?? '[{"Subnet":"172.17.0.0/16","Gateway":"172.17.0.1"}]'}\n`,
    );
    break;
  case "ps":
    for (const entry of JSON.parse(process.env.FAKE_DOCKER_PS ?? "[]")) {
      process.stdout.write(`${entry.name}\t${entry.owner}\n`);
    }
    break;
  case "pull":
    if (scenario === "pull-denied") {
      process.stderr.write("Error response from daemon: error from registry: denied\n");
      process.stderr.write("a second line that must not be quoted\n");
      process.exit(1);
    }
    process.stdout.write("Pulling from dynjandi-dev/renderer\n");
    if (scenario === "slow-pull") await new Promise((done) => setTimeout(done, 1500));
    process.stdout.write("Digest: sha256:fake\n");
    writeFileSync(`${log}.pulled`, "");
    break;
  case "run":
    process.stdout.write("renderer log one\n");
    process.stderr.write("renderer log two\n");
    if (scenario === "crashes") {
      process.stdout.write("boom\n");
      process.exit(1);
    }
    writeFileSync(runningMarker, "");
    // Stay up, as an attached container does, until `docker stop` leaves its marker or the lifetime is spent.
    {
      const startedAt = Date.now();
      setInterval(() => {
        if (existsSync(stopMarker) || Date.now() - startedAt > RUN_LIFETIME_MS) process.exit(0);
      }, 10);
    }
    break;
  case "port":
    if (!running) {
      process.stderr.write(`Error: No public port '${args[2]}' published for ${args[1]}\n`);
      process.exit(1);
    }
    process.stdout.write(`127.0.0.1:${process.env.FAKE_DOCKER_PORT}\n`);
    break;
  case "stop":
    // Stopping a container from `ps` is another container, not the one `run` plays.
    if (
      !JSON.parse(process.env.FAKE_DOCKER_PS ?? "[]").some((entry) => entry.name === args.at(-1))
    ) {
      writeFileSync(stopMarker, "");
    }
    process.stdout.write(`${args.at(-1)}\n`);
    break;
  default:
    process.stderr.write(`fake docker: unexpected command ${args.join(" ")}\n`);
    process.exit(2);
}
