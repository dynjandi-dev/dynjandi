# Next.js

`@dynjandi/sdk/next` is a custom loader for `next/image`. It needs no `next` import and adds no peer
dependency ([SDK, using with Next.js](https://github.com/dynjandi-dev/dynjandi/blob/main/packages/sdk/README.md#using-with-nextjs)).

Point `images.loaderFile` at a file in the app that re-exports it:

```js
// next.config.mjs
export default { images: { loader: "custom", loaderFile: "./dynjandi-loader.js" } };
```

```js
// dynjandi-loader.js
export { dynjandiLoader as default } from "@dynjandi/sdk/next";
```

Then `src` is a Dynjandi file id, not a URL. An empty id, or one `url()` refuses, throws a `DynjandiError`.

- Each width Next asks for becomes one variant, `resize/<width>x/`, and each counts against the project's plan
  cap. `images.deviceSizes` and `images.imageSizes` decide how many widths Next picks; an image with `fill` or
  `sizes` is offered up to every width in those lists, so trim both to spend less.
- The loader sets no `format`, and the original format is served. For another origin or a `format`, build the
  loader with `createDynjandiLoader({ origin, format })`. It takes no crop and no focal point.
- The loader reads no client's `origin`: pass `origin` to `createDynjandiLoader`, or its URLs stay on `https://cdn.dynjandi.dev`.
