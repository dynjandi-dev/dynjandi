/**
 * The only error type the SDK throws.
 *
 * `status` is the HTTP status of the response that caused the failure, including a 2xx response whose
 * body is not the documented shape. It is `0` when there was no HTTP response to report: the network
 * request failed, or the SDK refused the call before sending anything (bad options, bad focal point, a bad file id).
 * `message` is the service's `error` text when it sent one. `cause` holds the underlying error, if any.
 *
 * The client's public key is never part of `message`.
 */
export class DynjandiError extends Error {
  readonly status: number;

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "DynjandiError";
    this.status = status;
  }
}
