# @dynjandi/focal-picker

A focal point picker for images uploaded to [Dynjandi](https://cdn.dynjandi.dev), an image CDN: a way for
a CMS or admin to choose the part of a photo that survives a crop, and hand the point to `upload` in
[`@dynjandi/sdk`](../sdk/README.md).

**Status: not published.** This package is not on npm, and nothing publishes it. What exists: the
`<dynjandi-focal-picker>` element (image, marker, X and Y inputs, crop previews), a React wrapper for it,
and the DOM-free helpers behind it.

## Install

Not on npm yet; once published:

```sh
npm install @dynjandi/focal-picker
```

ESM only. It has no runtime dependencies and makes no network request: it reports a point and sends
nothing. Node 22 or newer for the tooling. React and `react-dom` are optional peer dependencies, needed only
for the `./react` entry.

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

Styling hooks: the parts `surface`, `image`, `marker`, `error`, `fields`, `previews`, `preview`,
`preview-box`, `preview-image` and `preview-caption`.

### Crop previews

Under the inputs, one box per crop shape shows what survives a crop to that shape for the current point,
captioned with the shape (`16:9`). Each box draws the same image the surface shows (the same URL, so a
`File` still has one object URL) positioned with `cropWindow`, the service's measured behaviour. That is
not CSS `object-position`: at 9:16 on a 2:1 photo with the point at 60% across, the service's window
starts at 45.9% of the width, and `object-position: 60%` would start at 43.1%. With no point yet, the
previews show the centre crop and their captions say so. The previews are hidden from assistive technology,
like the surface; the inputs carry the same point. They follow a drag (every `input` event), a typed
commit and a set `value`, and only restyle their images while the point moves.

`picker.ratios` sets the shapes: a list of `[width, height]` pairs, default
`[[16, 9], [1, 1], [4, 5], [9, 16]]`. Pairs, not `"16:9"` strings, so there is nothing to parse. A list that
is empty or holds anything but two positive finite numbers is replaced by the default, with one
`console.warn` per assignment. The getter returns a copy.

```js
picker.ratios = [[3, 2], [1, 1]];
```

## React

```tsx
import { FocalPicker } from "@dynjandi/focal-picker/react"; // registers the element too
```

`FocalPicker` is the element in a React component. Props: `file`, `src`, `ratios` (as on the element),
`value`, `defaultValue`, `onChange(point)`, `onInput(point)`, and a `ref` that reaches the
`<dynjandi-focal-picker>` element. `onChange` and `onInput` receive the `{ x, y }` point itself, not the event.

- **Uncontrolled**, with no `value`: the picker keeps the point. `defaultValue` is where it starts (read once,
  on mount).
- **Controlled**, with `value` (`{ x, y }`, or `null` for no point): the picker shows `value`. A drag or a
  typed entry is still reported to `onChange`, and the picker moves under the pointer while it drags, but once
  the change is committed the picker returns to `value` unless the parent has passed the new point back. So
  `value={point} onChange={setPoint}` follows the person, and a parent that refuses a point keeps the old one.
- `file` and `ratios` are set on the element in effects; `src` is an attribute. Nothing else is forwarded.

**Versions.** The peer range is React and `react-dom` `^19.0.0`, the only version the tests run (19.3.1). The
wrapper sets properties and listens to events in effects rather than leaning on React 19's custom element
support, and a one-off run of the same tests on React 18.3.1 passed, but 18 is not tested in this repository
and not claimed.

**Client only.** Importing `./react` imports `./element`, which needs a DOM (`HTMLElement`, `customElements`)
when it loads, so importing it throws where there is no DOM. Load the module only in the browser: where a
framework renders on a server, a client component alone is not enough, because its imports are still
evaluated during server pre-rendering. Use a dynamic `import()` that runs only in the browser, such as
`next/dynamic` with `ssr: false`. The form below imports the wrapper statically, so it is for code that
only ever runs in the browser.

## From the picker to `upload`

The picker sends nothing, and `upload` is server-side only (the CDN sends no CORS headers), so the point goes
through your own server: the picker reports `{ x, y }`, your form puts it in your own request, and your
server hands it to the SDK. `null` means no point was chosen, and then the request carries no `focalX` or
`focalY` and the server calls `upload` without a `focal` option.

In the browser, a form that holds the file and the picker and posts both (`focalX` and `focalY` are your
field names to choose):

```tsx
import type { FocalPoint } from "@dynjandi/focal-picker";
import { FocalPicker } from "@dynjandi/focal-picker/react";
import { type FormEvent, useState } from "react";

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [focal, setFocal] = useState<FocalPoint | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (file === null) return;
    const body = new FormData();
    body.set("file", file);
    if (focal !== null) {
      body.set("focalX", String(focal.x));
      body.set("focalY", String(focal.y));
    }
    await fetch("/api/images", { method: "POST", body });
  }

  return (
    <form onSubmit={submit}>
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          setFile(event.currentTarget.files?.[0] ?? null);
          setFocal(null);
        }}
      />
      {file !== null && <FocalPicker file={file} value={focal} onChange={setFocal} />}
      <button type="submit" disabled={file === null}>
        Upload
      </button>
    </form>
  );
}
```

On the server, receiving that request and calling [`client.upload`](../sdk/README.md):

```ts
import { createClient } from "@dynjandi/sdk";

const client = createClient({ publicKey: "pk_your_project_key" });

// POST /api/images: the form the browser sent, with focalX and focalY only when a point was chosen.
export async function handleUpload(request: Request): Promise<Response> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return new Response("file is required", { status: 400 });

  const x = form.get("focalX");
  const y = form.get("focalY");
  const stored =
    typeof x === "string" && typeof y === "string"
      ? await client.upload(file, { focal: { x: Number(x), y: Number(y) } })
      : await client.upload(file); // no point chosen: no `focal` option

  return Response.json({ id: stored.id, url: stored.url });
}
```

Both snippets are real files, `tests/handoff/UploadForm.tsx` and `tests/handoff/server.ts`, compiled against
the SDK and this package's entries by `pnpm typecheck`; `tests/readme.test.ts` fails if the text here is not
the text of those files. `upload` refuses a point outside 0 to 1 before any request, and the picker only
emits points inside it.

## Accessibility

The image surface, its marker and the crop previews are a pointer affordance and are hidden from assistive
technology. The path for keyboard and screen reader users is the two labelled number inputs, X and Y in
percent: Tab reaches X, then Y, then leaves the element (no focus trap), and typing a value moves the point
and the previews.

**Automated**, in `tests/browser/`, all in headless Chromium (`pnpm test`):

- axe-core (`a11y.browser.test.ts`) finds no violations, against its WCAG 2.0, 2.1 and 2.2 A and AA rules
  and best practices, in four states: empty (no image, no point), with a point (image loaded, previews
  shown), with an error (an unreadable image), and at a narrow viewport (320 px).
- A keyboard-only path (`e2e.browser.test.ts`): Tab order X then Y with nothing else focusable, typing
  changes the point and the previews, and each focused input has a visible focus indicator (computed
  outline).
- `forced-colors: active`: the marker keeps a solid border and an outline in a different colour (forced
  colours remove the shadow that makes it two-tone otherwise), and the focus indicator stays.
- Reflow at 320 CSS px (200% zoom of a 640 px window): the element and the page do not scroll sideways.
- `prefers-reduced-motion: reduce`: the element has no transitions or animations to turn off, asserted on
  every element in its shadow root.
- A drag over a generated 6000 by 4000 image with all four previews costs well under one 60 Hz frame
  (16.7 ms) per `pointermove`.

**Not automated, and needs a person**: a read-through with a screen reader (VoiceOver, NVDA) and a drag on
a touch device. Nothing in this repository drives either.

**Browsers.** Chromium is the only browser the tests run in. The element uses standard platform features
(custom elements, shadow DOM, pointer events, constructable stylesheets with a `<style>` fallback), so it is
intended to work in current Firefox and Safari, but that is not tested and not claimed.

## The helpers

The package root (`@dynjandi/focal-picker`) is DOM-free and registers nothing: `FocalPoint` (the `{ x, y }`
shape `upload` takes as `focal`), `clampPoint`, `roundPoint` (3 decimals, never outside 0 to 1), `stepPoint`
(a 0.1 percent keyboard step), `cropWindow` (the part of an image that survives a crop to a given ratio, as
measured from the service) and `pointFromRect` (a pointer position over the displayed image, as a point).
