import { DynjandiError } from "./errors.js";
import { type FileRecord, getFile } from "./files.js";
import { type UploadOptions, type UploadResult, upload } from "./upload.js";
import { type UrlOptions, url } from "./url.js";

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
  /**
   * Reads the stored record of a file. Server-side only: the CDN sends no CORS headers. The response is
   * `no-store` and not cached by the SDK, so keep the record. See `getFile`.
   */
  getFile(fileId: string): Promise<FileRecord>;
  /**
   * The URL of a variant of `fileId` on the client's origin. Synchronous, and safe in browsers.
   * Throws `DynjandiError` (status 0) for options the grammar refuses. See `UrlOptions`.
   */
  url(fileId: string, options: UrlOptions): string;
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
    getFile: (fileId) => getFile(config, fileId),
    url: (fileId, urlOptions) => url(config.origin, fileId, urlOptions),
  };
}
