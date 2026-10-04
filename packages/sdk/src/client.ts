import { DynjandiError } from "./errors.js";
import {
  type PictureSource,
  type PictureSourcesOptions,
  pictureSources,
  type SrcsetOptions,
  srcset,
} from "./responsive.js";
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
   * The URL of a variant of `fileId` on the client's origin. Synchronous, and safe in browsers.
   * Throws `DynjandiError` (status 0) for options the grammar refuses. See `UrlOptions`.
   */
  url(fileId: string, options: UrlOptions): string;
  /**
   * An `srcset` attribute value for `fileId`: one candidate per width. Synchronous, and safe in
   * browsers. Each width is a separate variant that counts against the plan cap; see `DEFAULT_WIDTHS`.
   * Throws `DynjandiError` (status 0) for options it refuses. See `SrcsetOptions`.
   */
  srcset(fileId: string, options?: SrcsetOptions): string;
  /**
   * The attributes of one `<source>` per format (default `DEFAULT_FORMATS`), best first, each with an
   * `srcset` over the same widths. Render the jpeg fallback as the `<img>` with `srcset(id, { format: "jpeg" })`.
   * Synchronous, and safe in browsers. Variants per image = widths x formats; see `DEFAULT_WIDTHS`.
   * Throws `DynjandiError` (status 0) for options it refuses. See `PictureSourcesOptions`.
   */
  pictureSources(fileId: string, options?: PictureSourcesOptions): PictureSource[];
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
    url: (fileId, urlOptions) => url(config.origin, fileId, urlOptions),
    srcset: (fileId, srcsetOptions) => srcset(config.origin, fileId, srcsetOptions),
    pictureSources: (fileId, pictureOptions) =>
      pictureSources(config.origin, fileId, pictureOptions),
  };
}
