# @dynjandi/focal-picker

A focal point picker for images uploaded to [Dynjandi](https://cdn.dynjandi.dev), an image CDN: a way for
a CMS or admin to choose the part of a photo that survives a crop, and hand the point to `upload` in
[`@dynjandi/sdk`](../sdk/README.md).

**Status: not published, and only part of the picker is built.** This package is not on npm, and nothing
publishes it. What exists: the `<dynjandi-focal-picker>` element (image, marker, X and Y inputs), and the
DOM-free helpers behind it. Crop previews and a React wrapper are not built yet.

## Install

Not on npm yet; once published:

```sh
npm install @dynjandi/focal-picker
```

ESM only. It has no runtime dependencies and makes no network request: it reports a point and sends
nothing. Node 22 or newer for the tooling.

## The element

```js
import "@dynjandi/focal-picker/element"; // registers <dynjandi-focal-picker>; safe to import twice
```

```html
<dynjandi-focal-picker id="picker" style="max-width: 480px"></dynjandi-focal-picker>
```

```js
const picker = document.querySelector("#picker");
picker.file = fileFromInput; // a File or Blob; or: picker.src = "https://..." / the src attribute
picker.value = { x: 0.42, y: 0.18 }; // optional: start from a stored point
picker.addEventListener("change", (event) => {
  const { x, y } = event.detail; // pass as `focal` to upload()
});
```

Click or drag on the image to set the point. Two labelled number inputs, X and Y in percent (0 to 100, step
0.1), show the same point and are the keyboard and screen reader path; the image and its marker are hidden
from assistive technology. An entry that is empty or outside 0 to 100 is ignored and the last good value
comes back.

The image is the `file` property (a `File` or `Blob`, shown through an object URL the element revokes when
the file changes or the element is removed) or the `src` attribute or property (a URL). `file` wins when
both are set. An image that cannot be read shows an error message instead of the surface.

### `value` and events

- `picker.value` is `{ x, y }`, each coordinate 0 to 1, or `null` for no point (call `upload` without
  `focal`). Setting it clamps into 0 to 1 and rounds to 3 decimals, so what the picker holds is always
  something `upload` accepts. The getter returns a copy. Setting `value` emits no event.
- `input` fires while a drag moves the point; `change` fires once when the drag ends (only if the point
  moved) and when a typed entry is committed (on Enter or blur, if it changed the point). Both carry
  `detail: { x, y }`, and bubble and cross the shadow root. Typing in the inputs does not fire `input`.
- With no point yet, the first typed entry in one input takes the centre (0.5) for the other axis.

Styling hooks: the parts `surface`, `image`, `marker`, `error` and `fields`.

## The helpers

The package root (`@dynjandi/focal-picker`) is DOM-free and registers nothing: `FocalPoint` (the `{ x, y }`
shape `upload` takes as `focal`), `clampPoint`, `roundPoint` (3 decimals, never outside 0 to 1), `stepPoint`
(a 0.1 percent keyboard step), `cropWindow` (the part of an image that survives a crop to a given ratio, as
measured from the service) and `pointFromRect` (a pointer position over the displayed image, as a point).
