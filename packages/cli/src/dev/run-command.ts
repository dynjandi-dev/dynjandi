import { spawn } from "node:child_process";
import { constants } from "node:os";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export interface RunCommandSettings {
  /**
   * Whether `dev` is in a terminal, where a SIGINT is a Ctrl-C that the command has received already. Defaults
   * to whether any of this process's standard streams is a terminal; tests set it.
   */
  terminal?: boolean | undefined;
}

function inTerminal(): boolean {
  return Boolean(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY);
}

/**
 * Runs `command` (the file, then its arguments) with `extraEnv` added to this process's environment and
 * resolves with the exit code `dev` should exit with: the command's own, or `128 + n` when signal `n` ended it
 * (the POSIX shell convention). No shell is involved and stdio is inherited (D18). SIGTERM sent to this process
 * is forwarded to the command while it runs, and so is SIGINT outside a terminal. Rejects if the command cannot
 * be started.
 *
 * A Ctrl-C reaches every process in the terminal's foreground job, and the command is one of them: it shares
 * this process's group and its terminal. Forwarding that SIGINT too would deliver it twice, and many runners
 * (vitest, jest, Next, pnpm) read a second SIGINT as "force quit" and skip their teardown. So in a terminal a
 * SIGINT only keeps `dev` alive while the command handles its own. A terminal never sends SIGTERM.
 */
export function runCommand(
  command: string[],
  extraEnv: Record<string, string>,
  settings: RunCommandSettings = {},
): Promise<number> {
  const [file, ...args] = command;
  if (file === undefined) return Promise.reject(new Error("no command to run"));
  const terminal = settings.terminal ?? inTerminal();

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });

    const forwarders = FORWARDED_SIGNALS.map((signal) => {
      const forward = signal === "SIGINT" && terminal ? () => {} : () => void child.kill(signal);
      process.on(signal, forward);
      return () => void process.off(signal, forward);
    });
    const stopForwarding = () => {
      for (const remove of forwarders) remove();
    };

    child.once("error", (error) => {
      stopForwarding();
      reject(
        new Error(
          `could not run "${file}": ${error.message}; check that the command is installed and on PATH`,
          { cause: error },
        ),
      );
    });
    child.once("close", (code, signal) => {
      stopForwarding();
      resolve(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0)));
    });
  });
}
