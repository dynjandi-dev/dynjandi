# Variants

Read this when building image URLs. Every call here is synchronous, makes no request and is safe in a
browser; `client` is what `createClient` returned.

## `url(file, options)`

`file` is a file id, or a stored file (the result of `getFile` or `upload`). At least one option is required.
Dimensions are 1 to 10000 and `quality` is 1 to 100; `url()` refuses what the grammar would not accept
([SDK, `url`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#urlfile-options)).

With a stored file, a crop that names neither `position` nor `focal` uses the stored point; an explicit
`focal` or `position` wins; a file with no stored point crops on `center`.

## `srcset(file, options?)`

One `<url> <width>w` candidate per width, smallest first. `widths` defaults to `DEFAULT_WIDTHS`
(`[320, 640, 960, 1280, 1920]`) and must be distinct integers from 1 to 10000. A `height` is refused, because
a fixed height at several widths distorts the image; pass `crop` for a fixed aspect ratio. Put `alt` and
`sizes` on the `<img>` yourself
([SDK, `srcset`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#srcsetfile-options)).

## `pictureSources(file, options?)`

One `<source>` per format, as `{ type, srcset, sizes? }[]`, best format first, because the browser takes the
first one it supports. `formats` defaults to `["avif", "webp"]`. The fallback is not a source: it is the plain
`<img>` with `srcset(id, { format: "jpeg" })`, and it comes after every `<source>`. A `format` option is
refused; use `formats`. It returns data, so use your framework's attribute names (`srcSet` in React)
([SDK, `pictureSources`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#picturesourcesfile-options)).
`sizes` is not escaped: escaping it is your job if it reaches markup.

## `placeholder(file, options?)`

A small, low-quality image (`width` 24, `quality` 20, `webp`, each unless you pass your own), not a blur.
Pass the same `crop` as the image it stands in for. It is one more variant per image
([SDK, `placeholder`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#placeholderfile-options)).

## What it costs

Variants per image = widths x formats, and the fallback `<img>` is one more format. With the defaults,
`srcset(id)` is 5 variants, `pictureSources(id)` is 10, and the same plus a `jpeg` fallback is 15; with
`widths: [640, 1280]` the last is 6. `placeholder()` adds one more. The service upscales, and the SDK does not
know the original's width, so give no width wider than the original
([SDK, `pictureSources`](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#picturesourcesfile-options),
[upscaling](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#placeholderfile-options)).

## Errors

Every failure is a `DynjandiError`; its `status` is the HTTP status, or `0` when no response was received or
the SDK refused the call before sending it
([SDK, errors](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#errors)).
