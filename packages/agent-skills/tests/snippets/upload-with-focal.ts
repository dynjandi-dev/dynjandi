import type { Client } from "@dynjandi/sdk";

// Server-side only. `focal` is optional; when it is given, x and y are both sent, each from 0 to 1.
export async function uploadWithFocalPoint(client: Client, file: File) {
  const { id, url } = await client.upload(file, { focal: { x: 0.42, y: 0.18 } });
  return { id, url };
}
