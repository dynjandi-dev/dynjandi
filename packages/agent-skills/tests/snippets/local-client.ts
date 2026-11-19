import { createClient } from "@dynjandi/sdk";

// Make every client through this: one that only builds URLs needs the origin too, or its URLs
// point at production while the uploads went to the local server. Unset, `origin` is production.
export function makeClient() {
  const projectKey = process.env.DYNJANDI_PROJECT_KEY;
  if (!projectKey) throw new Error("DYNJANDI_PROJECT_KEY is not set");
  return createClient({ projectKey, origin: process.env.DYNJANDI_ORIGIN });
}
