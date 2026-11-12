import { spawn } from "node:child_process";
import { constants } from "node:os";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Runs `command` (the file, then its arguments) with `extraEnv` added to this process's environment and
 * resolves with the exit code `dev` should exit with: the command's own, or `128 + n` when signal `n` ended it
 * (the POSIX shell convention). No shell is involved and stdio is inherited (D18). SIGINT and SIGTERM sent to
 * this process are forwarded to the command while it runs. Rejects if the command cannot be started.
 */
export function runCommand(command: string[], extraEnv: Record<string, string>): Promise<number> {
  const [file, ...args] = command;
  if (file === undefined) return Promise.reject(new Error("no command to run"));

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });

    const forwarders = FORWARDED_SIGNALS.map((signal) => {
      const forward = () => void child.kill(signal);
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
