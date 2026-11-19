import { createClient } from "@dynjandi/sdk";

const projectKey = process.env.DYNJANDI_PROJECT_KEY;
if (!projectKey) throw new Error("DYNJANDI_PROJECT_KEY is not set");

// Server-side only: the project key authorises uploads and file reads for one project.
export const dynjandi = createClient({ projectKey });
