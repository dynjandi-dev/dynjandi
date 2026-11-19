import { createClient } from "@dynjandi/sdk";

const projectKey = process.env.DYNJANDI_PROJECT_KEY;
if (!projectKey) throw new Error("DYNJANDI_PROJECT_KEY is not set");

// In a container: `origin` is what a browser loads, `apiOrigin` is what this container calls.
// The compose file maps DYNJANDI_CONTAINER_ORIGIN to DYNJANDI_API_ORIGIN.
export const client = createClient({
  projectKey,
  origin: process.env.DYNJANDI_ORIGIN,
  apiOrigin: process.env.DYNJANDI_API_ORIGIN,
});
