// A stand-in for the `docker` command, put first on PATH by docker.test.ts. It never touches a daemon or a
// network: it appends its arguments to FAKE_DOCKER_LOG (one JSON array per line) and plays the scenario in
// FAKE_DOCKER_SCENARIO:
//   ok            every command succeeds; `run` stays up until `stop` is called
//   no-daemon     `version` fails the way a stopped daemon does
//   pull-denied   `pull` fails with two stderr lines, the first being Docker's own
//   never-healthy `run` stays up, but `port` names FAKE_DOCKER_PORT, where nothing answers
//   slow-pull     like ok, but `pull` takes 1500 ms
//   crashes       `run` prints a line and exits 1
// FAKE_DOCKER_PORT is the host port `docker port` reports.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const log = process.env.FAKE_DOCKER_LOG;
const scenario = process.env.FAKE_DOCKER_SCENARIO ?? "ok";
const stopMarker = `${log}.stopped`;
appendFileSync(log, `${JSON.stringify(args)}\n`);

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
  case "pull":
    if (scenario === "pull-denied") {
      process.stderr.write("Error response from daemon: error from registry: denied\n");
      process.stderr.write("a second line that must not be quoted\n");
      process.exit(1);
    }
    if (scenario === "slow-pull") await new Promise((done) => setTimeout(done, 1500));
    process.stdout.write("Pulling from dynjandi-dev/renderer\nDigest: sha256:fake\n");
    break;
  case "run":
    process.stdout.write("renderer log one\n");
    process.stderr.write("renderer log two\n");
    if (scenario === "crashes") {
      process.stdout.write("boom\n");
      process.exit(1);
    }
    // Stay up, as an attached container does, until `docker stop` leaves its marker.
    setInterval(() => {
      if (existsSync(stopMarker)) process.exit(0);
    }, 10);
    break;
  case "port":
    process.stdout.write(`127.0.0.1:${process.env.FAKE_DOCKER_PORT}\n`);
    break;
  case "stop":
    writeFileSync(stopMarker, "");
    process.stdout.write(`${args.at(-1)}\n`);
    break;
  default:
    process.stderr.write(`fake docker: unexpected command ${args.join(" ")}\n`);
    process.exit(2);
}
