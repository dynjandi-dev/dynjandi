import type { OutputFormat } from "@dynjandi/transform-grammar/builder";
import { DEFAULT_ORIGIN, httpOrigin } from "./client.js";
import { type UrlOptions, url } from "./url.js";

/**
 * What Next.js passes a custom image loader (`next/image`'s `ImageLoaderProps`), declared here so this
 * package needs no `next` import or peer dependency. `src` is a Dynjandi file id.
 */
export interface NextImageLoaderProps {
  src: string;
  /** The width Next picked from `images.deviceSizes` and `images.imageSizes`. */
  width: number;
  quality?: number | undefined;
}

export interface DynjandiLoaderOptions {
  /** The service origin. Defaults to `https://cdn.dynjandi.dev`. */
  origin?: string;
  /** Encode every variant as this format. Omitted, the loader emits no `format` operation. */
  format?: OutputFormat;
}

/**
 * A Next.js `loader` for `next/image`: `src` is a bare file id and each width Next asks for becomes one
 * variant URL, `resize/<width>x/` plus `quality/<quality>/` when Next passes a quality, plus `format/`
 * when `format` is set. Nothing else is emitted: the loader goes through `url()` and adds no grammar.
 * Each width is a separate variant that counts against the plan cap; `images.deviceSizes` and
 * `images.imageSizes` decide how many. Synchronous, and safe on the server and in browsers.
 *
 * A bad `origin` throws `DynjandiError` (status 0) here, not on every render. The returned loader throws
 * `DynjandiError` (status 0) for an empty `src`, an id the grammar refuses, or a width or quality
 * outside the grammar's range.
 */
export function createDynjandiLoader(
  options: DynjandiLoaderOptions = {},
): (props: NextImageLoaderProps) => string {
  const origin = httpOrigin(
    options.origin ?? DEFAULT_ORIGIN,
    "createDynjandiLoader needs an absolute origin URL, starting http:// or https://.",
  );
  const { format } = options;

  return ({ src, width, quality }) => {
    const urlOptions: UrlOptions = { width };
    if (quality !== undefined) {
      urlOptions.quality = quality;
    }
    if (format !== undefined) {
      urlOptions.format = format;
    }
    return url(origin, src, urlOptions);
  };
}

/**
 * The loader for the default origin and no `format`, for a `loaderFile` that re-exports it as its default
 * export. Use `createDynjandiLoader` for anything else.
 */
export const dynjandiLoader: (props: NextImageLoaderProps) => string = createDynjandiLoader();
