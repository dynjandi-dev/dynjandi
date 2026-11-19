// next.config.mjs
// The origin is not a secret, so it may reach the browser bundle. The project key never may:
// do not add DYNJANDI_PROJECT_KEY here.
export default {
  images: { loader: "custom", loaderFile: "./dynjandi-loader.js" },
  env: { DYNJANDI_ORIGIN: process.env.DYNJANDI_ORIGIN ?? "https://cdn.dynjandi.dev" },
};
