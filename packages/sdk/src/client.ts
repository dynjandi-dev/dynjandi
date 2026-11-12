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

/**
 * The origin of an `http:` or `https:` URL; anything else throws `DynjandiError` (status 0) with `message`.
 * Parsing alone is not enough: `host.docker.internal:4600`, with no scheme, parses as the scheme
 * `host.docker.internal:` and has the origin `"null"`, which would only fail at the first request.
 */
export function httpOrigin(value: string, message: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new DynjandiError(message, 0, { cause });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DynjandiError(message, 0);
  }
  return parsed.origin;
}

/** The project key, given as `projectKey` or as the deprecated `publicKey`, never both. */
type KeyOption =
  | {
      /** The project key. A credential: keep it on your server. Sent only in the `X-Project-Key` header. */
      projectKey: string;
      publicKey?: never;
    }
  | {
      /** @deprecated Use `projectKey`. Sent in the `X-Project-Key` header, like `projectKey`. */
      publicKey: string;
      projectKey?: never;
    };

export type ClientOptions = KeyOption & {
  /**
   * The service origin that every URL the SDK hands out is on: `upload`'s `url`, `url()`, `srcset`,
   * `pictureSources` and `placeholder`. Defaults to `https://cdn.dynjandi.dev`. Use the origin your
   * users' browsers reach.
   */
  origin?: string | undefined;
  /**
   * The origin that `upload` and `getFile` send their requests, and the project key, to. Defaults to
   * `origin`. Set it when your server reaches the service under another name than browsers do, such as
   * an app in a container calling `dynjandi dev` on the host. The key goes here and nowhere else.
   */
  apiOrigin?: string | undefined;
  /** The `fetch` to use. Defaults to `globalThis.fetch`; tests inject their own. */
  fetch?: typeof fetch;
};

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
  // The one place the deprecated alias is read; everything past here says projectKey. The messages name
  // the options and never a value.
  if (options.projectKey !== undefined && options.publicKey !== undefined) {
    throw new DynjandiError("createClient takes projectKey or publicKey, not both.", 0);
  }
  const projectKey = options.projectKey ?? options.publicKey;
  if (projectKey === undefined) {
    throw new DynjandiError("createClient needs a projectKey.", 0);
  }
  if (projectKey === "") {
    throw new DynjandiError("createClient needs a non-empty projectKey.", 0);
  }

  const origin = httpOrigin(
    options.origin ?? DEFAULT_ORIGIN,
    "createClient needs an absolute origin URL, starting http:// or https://.",
  );
  const apiOrigin =
    options.apiOrigin === undefined
      ? origin
      : httpOrigin(
          options.apiOrigin,
          "createClient needs an absolute apiOrigin URL, starting http:// or https://.",
        );

  const config = {
    projectKey,
    origin,
    apiOrigin,
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
