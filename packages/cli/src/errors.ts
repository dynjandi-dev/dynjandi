import { redact } from "./setup/secret.js";

/** A mistake in how a command was called: exit 2, message on stderr. */
export class UsageError extends Error {}

/**
 * How `dynjandi setup` stops (D13): `failure` exits 1, `auth` exits 3 (no usable credential) and `pending` exits 4
 * (waiting for approval in the browser). The message is one line that names the fix, scrubbed of every credential
 * (D12).
 */
export class SetupFailure extends Error {
  readonly kind: "failure" | "auth" | "pending";

  constructor(kind: "failure" | "auth" | "pending", message: string) {
    super(redact(message));
    this.name = "SetupFailure";
    this.kind = kind;
  }
}
