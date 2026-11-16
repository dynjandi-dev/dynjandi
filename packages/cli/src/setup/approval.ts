import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SetupFailure } from "../errors.js";
import { approvalUrl, type DeviceClient, type DevicePoll } from "./api.js";
import { Secret } from "./secret.js";

// D18. Browser approval: show the link, open it, then either wait for the person (a terminal) or hand the link back
// and exit 4 (an agent, or --json), keeping the device code in `.dynjandi/setup-approval.json` for the next run.

const PENDING_DIRECTORY = ".dynjandi";
const PENDING_FILE = "setup-approval.json";
/** How long a run that finds the file waits for the person (D18 step 4). */
export const RESUME_WAIT_MS = 60_000;
/** Added to the wait on each `slow_down` (RFC 8628 section 3.5). */
export const SLOW_DOWN_STEP_MS = 5_000;

/** What the person needs to finish the approval. `expiresAt` is an ISO 8601 time. */
export interface PendingApproval {
  url: string;
  code: string;
  expiresAt: string;
}

/** The run stopped to let the person approve (exit 4). `approval` is what `run.ts` prints as the result. */
export class ApprovalPending extends SetupFailure {
  readonly approval: PendingApproval;

  constructor(approval: PendingApproval, secondsLeft: number) {
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
    super(
      "pending",
      `Open ${approval.url} and approve code ${approval.code}, then run this command again. The link expires in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
    this.name = "ApprovalPending";
    this.approval = approval;
  }
}

export interface ApprovalSeams {
  client: DeviceClient;
  cwd: string;
  /** A person is at the terminal: standard input and standard error are terminals, and `--json` is not given. */
  wait: boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Opens the browser; its outcome is not needed. */
  open: (url: string) => void;
  /** Standard error. */
  say: (text: string) => void;
}

interface StoredApproval extends PendingApproval {
  deviceCode: string;
  intervalSeconds: number;
}

function pendingPath(cwd: string): string {
  return join(cwd, PENDING_DIRECTORY, PENDING_FILE);
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function parseStored(text: string): StoredApproval | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { deviceCode, url, code, expiresAt, intervalSeconds } = value as Record<string, unknown>;
  if (typeof deviceCode !== "string" || deviceCode === "") return undefined;
  if (typeof url !== "string" || approvalUrl(url) === undefined) return undefined;
  if (typeof code !== "string" || typeof expiresAt !== "string") return undefined;
  if (Number.isNaN(Date.parse(expiresAt))) return undefined;
  if (typeof intervalSeconds !== "number" || !(intervalSeconds > 0)) return undefined;
  return { deviceCode, url, code, expiresAt, intervalSeconds };
}

async function readStored(cwd: string): Promise<StoredApproval | undefined> {
  let text: string;
  try {
    text = await readFile(pendingPath(cwd), "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw new SetupFailure(
      "failure",
      `could not read ${PENDING_DIRECTORY}/${PENDING_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const stored = parseStored(text);
  // A file that is not ours is no approval to resume: a new one starts, and replaces it.
  if (stored === undefined) await deleteStored(cwd);
  return stored;
}

async function deleteStored(cwd: string): Promise<void> {
  await rm(pendingPath(cwd), { force: true });
}

// `.dynjandi/` is the directory `dev` keeps out of Git with its own `.gitignore`; it is created the same way.
async function saveStored(cwd: string, stored: StoredApproval): Promise<void> {
  const directory = join(cwd, PENDING_DIRECTORY);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, ".gitignore"), "*\n", { flag: "wx" });
  } catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
  }
  await deleteStored(cwd);
  // 0600 where the system has modes: the device code is a credential until it is used.
  await writeFile(pendingPath(cwd), `${JSON.stringify(stored)}\n`, { flag: "wx", mode: 0o600 });
}

type Outcome =
  | { kind: "approved"; token: Secret }
  | { kind: "ended"; why: "timeout" | DevicePollEnd };
type DevicePollEnd = Exclude<DevicePoll["kind"], "approved" | "pending" | "slow-down">;

// Polls at `intervalSeconds`, 5 s longer after each `slow_down`, until the deadline. `immediate`: the first poll
// goes at once (a resumed run, where the person has probably approved already), else after one interval.
async function poll(
  seams: ApprovalSeams,
  deviceCode: Secret,
  intervalSeconds: number,
  deadline: number,
  immediate: boolean,
): Promise<Outcome> {
  let interval = intervalSeconds * 1000;
  let skipWait = immediate;
  for (;;) {
    if (!skipWait) {
      if (seams.now() + interval > deadline) return { kind: "ended", why: "timeout" };
      await seams.sleep(interval);
    }
    skipWait = false;
    const answer = await seams.client.poll(deviceCode);
    if (answer.kind === "approved") return { kind: "approved", token: answer.token };
    if (answer.kind === "slow-down") interval += SLOW_DOWN_STEP_MS;
    else if (answer.kind !== "pending") return { kind: "ended", why: answer.kind };
  }
}

function ended(why: "timeout" | DevicePollEnd): SetupFailure {
  switch (why) {
    case "denied":
      return new SetupFailure("auth", "approval denied: run the command again to ask again");
    case "dead":
      return new SetupFailure(
        "auth",
        "the approval is no longer valid: run the command again to start a new one",
      );
    default:
      return new SetupFailure("auth", "the approval link expired: run the command again");
  }
}

/**
 * The credential from a person's approval in the browser (D18). Resolves with the token; throws `ApprovalPending`
 * when the person has to be waited for elsewhere (exit 4), and `SetupFailure("auth")` for a denied, expired or dead
 * approval (exit 3). The pending file is deleted as soon as its code is used or dead.
 */
export async function approve(seams: ApprovalSeams): Promise<Secret> {
  const stored = await readStored(seams.cwd);
  if (stored !== undefined) return resume(seams, stored);

  const device = await seams.client.start();
  const expiresAtMs = seams.now() + device.expiresInSeconds * 1000;
  const approval: PendingApproval = {
    url: device.url,
    code: device.userCode,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  seams.open(device.url);

  if (!seams.wait) {
    await saveStored(seams.cwd, {
      ...approval,
      deviceCode: device.deviceCode.reveal(),
      intervalSeconds: device.intervalSeconds,
    });
    throw new ApprovalPending(approval, device.expiresInSeconds);
  }

  seams.say(`Approve this setup at ${device.url}. The page shows the code ${device.userCode}.\n`);
  seams.say("Waiting for approval; press Ctrl-C to stop.\n");
  const outcome = await poll(seams, device.deviceCode, device.intervalSeconds, expiresAtMs, false);
  if (outcome.kind === "approved") return outcome.token;
  throw ended(outcome.why);
}

async function resume(seams: ApprovalSeams, stored: StoredApproval): Promise<Secret> {
  const deadline = seams.now() + RESUME_WAIT_MS;
  const outcome = await poll(
    seams,
    new Secret(stored.deviceCode),
    stored.intervalSeconds,
    deadline,
    true,
  );
  if (outcome.kind === "approved") {
    await deleteStored(seams.cwd);
    return outcome.token;
  }
  if (outcome.why === "timeout") {
    const secondsLeft = Math.max(0, (Date.parse(stored.expiresAt) - seams.now()) / 1000);
    throw new ApprovalPending(
      { url: stored.url, code: stored.code, expiresAt: stored.expiresAt },
      secondsLeft,
    );
  }
  await deleteStored(seams.cwd);
  throw ended(outcome.why);
}
