import { DynjandiError } from "./errors";
import { type UploadOptions, type UploadResult, upload } from "./upload";

export const DEFAULT_ORIGIN = "https://cdn.dynjandi.dev";

export interface ClientOptions {
  /** The project's public key. Sent only in the `X-Public-Key` header. */
  publicKey: string;
  /** The service origin. Defaults to `https://cdn.dynjandi.dev`. */
  origin?: string;
  /** The `fetch` to use. Defaults to `globalThis.fetch`; tests inject their own. */
  fetch?: typeof fetch;
}

export interface Client {
  /** Uploads a file. Server-side only: the CDN sends no CORS headers. See `upload`. */
  upload(file: Blob, options?: UploadOptions): Promise<UploadResult>;
}

export function createClient(options: ClientOptions): Client {
  if (options.publicKey === "") {
    throw new DynjandiError("createClient needs a non-empty publicKey.", 0);
  }

  let origin: string;
  try {
    origin = new URL(options.origin ?? DEFAULT_ORIGIN).origin;
  } catch (cause) {
    throw new DynjandiError("createClient needs an absolute origin URL.", 0, { cause });
  }

  const config = {
    publicKey: options.publicKey,
    origin,
    fetch: options.fetch ?? globalThis.fetch,
  };

  return {
    upload: (file, uploadOptions) => upload(config, file, uploadOptions),
  };
}
