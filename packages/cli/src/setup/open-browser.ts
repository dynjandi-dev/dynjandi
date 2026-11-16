import { spawn as nodeSpawn } from "node:child_process";
import { approvalUrl } from "./api.js";

/** The part of a child process the opener uses: it only has to be told to ignore a failure and let go. */
export interface OpenerChild {
  on(event: "error", listener: () => void): unknown;
  unref(): void;
}

export type SpawnOpener = (
  command: string,
  args: string[],
  options: { stdio: "ignore"; detached: true; windowsHide: true },
) => OpenerChild;

export interface OpenerSettings {
  /** Default: `node:child_process`'s `spawn`. */
  spawn?: SpawnOpener | undefined;
  /** Default: `process.platform`. */
  platform?: NodeJS.Platform | undefined;
}

/** D18: `open` on macOS, `rundll32 url.dll,FileProtocolHandler` on Windows, `xdg-open` elsewhere. */
export function openerCommand(
  url: string,
  platform: NodeJS.Platform,
): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }
  return { command: "xdg-open", args: [url] };
}

/**
 * Tries to open `url` in the browser, and says whether it started the opener. Only an `https://app.dynjandi.dev/`
 * address is opened (D18). The opener runs through `spawn` with an argument array and no shell, detached and
 * silent. A browser that does not open (SSH, a container, no desktop) is not a failure: the printed link is enough.
 */
export function openBrowser(url: string, settings: OpenerSettings = {}): boolean {
  if (approvalUrl(url) === undefined) return false;
  const spawn = settings.spawn ?? defaultSpawn;
  const { command, args } = openerCommand(url, settings.platform ?? process.platform);
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
    // A missing opener (ENOENT) arrives as an event, later; nothing is left to say about it.
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const defaultSpawn: SpawnOpener = (command, args, options) => nodeSpawn(command, args, options);
