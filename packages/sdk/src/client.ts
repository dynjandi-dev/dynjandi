import { DynjandiError } from "./errors.js";
import { type FileRecord, getFile } from "./files.js";
import {
  type PictureSource,
  type PictureSourcesOptions,
  type PlaceholderOptions,
  pictureSources,
  placeholder,
  type SrcsetOptions,
  srcset,
} from "./responsive.js";
import { type UploadOptions, type UploadResult, upload } from "./upload.js";
import { type StoredFile, type UrlOptions, url } from "./url.js";

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
   * The URL of a variant of a file on the client's origin. Takes a file id, or a stored file (a
   * `getFile` or `upload` result) whose focal point a crop then uses. Synchronous, makes no request,
   * and is safe in browsers. Throws `DynjandiError` (status 0) for options the grammar refuses. See
   * `UrlOptions`.
   */
  url(file: string | StoredFile, options: UrlOptions): string;
  /**
   * An `srcset` attribute value for a file id or stored file, as `url` takes: one candidate per width.
   * Synchronous, and safe in browsers. Each width is a separate variant that counts against the plan cap; see `DEFAULT_WIDTHS`.
   * Throws `DynjandiError` (status 0) for options it refuses. See `SrcsetOptions`.
   */
  srcset(file: string | StoredFile, options?: SrcsetOptions): string;
  /**
   * The attributes of one `<source>` per format (default `DEFAULT_FORMATS`), best first, each with an
   * `srcset` over the same widths. Render the jpeg fallback as the `<img>` with `srcset(id, { format: "jpeg" })`.
   * Synchronous, and safe in browsers. Variants per image = widths x formats; see `DEFAULT_WIDTHS`.
   * Throws `DynjandiError` (status 0) for options it refuses. See `PictureSourcesOptions`.
   */
  pictureSources(file: string | StoredFile, options?: PictureSourcesOptions): PictureSource[];
  /**
   * The URL of a small, low-quality stand-in: width 24, quality 20, webp unless overridden, with your
   * `crop` kept. Not a blur. One more variant per image. Synchronous, and safe in browsers.
   * Throws `DynjandiError` (status 0) for a `height` or options `url()` refuses. See `PlaceholderOptions`.
   */
  placeholder(file: string | StoredFile, options?: PlaceholderOptions): string;
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
    url: (file, urlOptions) => url(config.origin, file, urlOptions),
    srcset: (file, srcsetOptions) => srcset(config.origin, file, srcsetOptions),
    pictureSources: (file, pictureOptions) => pictureSources(config.origin, file, pictureOptions),
    placeholder: (file, placeholderOptions) => placeholder(config.origin, file, placeholderOptions),
  };
}
