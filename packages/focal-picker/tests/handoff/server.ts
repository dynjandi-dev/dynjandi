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
