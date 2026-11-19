// dynjandi-loader.js
import { createDynjandiLoader } from "@dynjandi/sdk/next";

// The loader takes its own origin; it reads no client's. Unset, it builds production URLs.
export default createDynjandiLoader({
  origin: process.env.DYNJANDI_ORIGIN ?? "https://cdn.dynjandi.dev",
});
