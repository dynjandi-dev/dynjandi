import type { Client } from "@dynjandi/sdk";

export async function bannerUrl(client: Client, id: string) {
  const file = await client.getFile(id); // server-side only; fetch once and keep it
  // A crop that names no `position` or `focal` crops on the stored point (or the center, if none).
  return client.url(file, { crop: { width: 1280, height: 400 } });
}
