import type { Client } from "@dynjandi/sdk";

// Synchronous, makes no request, safe in a browser. Every width x format is a billed variant.
export function heroImage(client: Client, id: string) {
  const sizes = "(min-width: 800px) 800px, 100vw";
  const widths = [640, 1280];
  return {
    sources: client.pictureSources(id, { sizes, widths }), // best format first
    fallback: client.srcset(id, { format: "jpeg", widths }), // for the plain <img>, after every <source>
    placeholder: client.placeholder(id), // one more variant per image
    sizes, // put it, and your own `alt`, on the <img> too
  };
}
