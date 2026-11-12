// The "app" that runs inside the container in tests/e2e/containers.e2e.test.ts (plan #43, Phase 4). It is the
// app of plan section 4.2: the built SDK with `origin` (what a browser on the host loads) and `apiOrigin` (what
// this container reaches the server by). It prints one JSON line of what it saw, for the test to check from the
// host. Plain ESM, no build step: the container runs it with `node`.
//
// Environment: SDK_MODULE (path to the SDK's dist/index.js), DYNJANDI_PROJECT_KEY, DYNJANDI_ORIGIN,
// DYNJANDI_API_ORIGIN, PNG_BASE64 (the picture to upload).

const { createClient } = await import(process.env.SDK_MODULE);
const client = createClient({
  projectKey: process.env.DYNJANDI_PROJECT_KEY,
  origin: process.env.DYNJANDI_ORIGIN,
  apiOrigin: process.env.DYNJANDI_API_ORIGIN,
});

// /health is not an SDK call: this reaches the server by the container's name for it (apiOrigin).
const health = await (await fetch(`${process.env.DYNJANDI_API_ORIGIN}/health`)).json();
const png = Buffer.from(process.env.PNG_BASE64, "base64");
const uploaded = await client.upload(new File([png], "container.png", { type: "image/png" }), {
  focal: { x: 0.25, y: 0.75 },
});
const file = await client.getFile(uploaded.id);
const variant = client.url(uploaded.id, { width: 20, format: "png" });

process.stdout.write(
  `${JSON.stringify({
    service: health.service,
    id: uploaded.id,
    url: uploaded.url,
    variant,
    focalX: file.focalX,
    focalY: file.focalY,
    bytes: file.bytes,
  })}\n`,
);
