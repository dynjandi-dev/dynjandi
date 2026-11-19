#!/usr/bin/env bash
# Writes a synthetic, bgmusik-shaped workspace into the empty working directory. No real key, no bgmusik source.
set -euo pipefail

mkdir -p admin/src admin/e2e site/src

cat > package.json <<'JSON'
{ "name": "bgmusik-shaped", "private": true, "workspaces": ["admin", "site"] }
JSON

cat > admin/package.json <<'JSON'
{
  "name": "admin",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "test:e2e": "node e2e/run.mjs" },
  "dependencies": { "@dynjandi/sdk": "0.1.0" },
  "devDependencies": { "vite": "5.4.0" }
}
JSON

cat > admin/vite.config.ts <<'TS'
import { defineConfig, loadEnv } from "vite";

// Local dev config: reads only DYNJANDI_PUBLIC_KEY. With a key it talks to the live project;
// without one it starts the hand-written stand-in in e2e/fake-dynjandi.mjs.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: { port: 5173 },
    define: { __HAS_KEY__: JSON.stringify(Boolean(env.DYNJANDI_PUBLIC_KEY)) },
  };
});
TS

cat > admin/.env.example <<'ENV'
DYNJANDI_PUBLIC_KEY=example-placeholder-not-a-real-key
ENV

cat > admin/src/upload.ts <<'TS'
import { createClient } from "@dynjandi/sdk";

const client = createClient({ publicKey: process.env.DYNJANDI_PUBLIC_KEY ?? "example-placeholder-not-a-real-key" });

export async function uploadCover(file: File) {
  const { id } = await client.upload(file);
  return id;
}
TS

cat > admin/e2e/fake-dynjandi.mjs <<'JS'
// Hand-written stand-in for Dynjandi, used by the admin's e2e tests.
// It simulates a dropped upload: every third POST /upload hangs up mid-request, and it reports
// what it received, so the test can assert the admin retries and shows the error state.
import { createServer } from "node:http";

let uploads = 0;
const received = [];

export const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/upload") {
    uploads += 1;
    received.push({ n: uploads, type: req.headers["content-type"] });
    if (uploads % 3 === 0) {
      req.socket.destroy(); // the dropped upload
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: `fake-${uploads}`, url: `http://127.0.0.1:4599/fake-${uploads}` }));
    return;
  }
  if (req.url === "/_received") {
    res.end(JSON.stringify(received));
    return;
  }
  res.statusCode = 404;
  res.end();
});

if (process.argv[1] === new URL(import.meta.url).pathname) server.listen(4599, "127.0.0.1");
JS

cat > admin/e2e/run.mjs <<'JS'
import { server } from "./fake-dynjandi.mjs";

server.listen(4599, "127.0.0.1", () => {
  console.log("stand-in listening; the e2e suite would run here");
  server.close();
});
JS

cat > site/package.json <<'JSON'
{
  "name": "site",
  "private": true,
  "type": "module",
  "dependencies": { "@dynjandi/sdk": "0.1.0" }
}
JSON

# The site's client only builds URLs: it has no `origin`, so every URL points at cdn.dynjandi.dev.
cat > site/src/images.ts <<'TS'
import { createClient } from "@dynjandi/sdk";

const PLACEHOLDER_KEY = "example-placeholder-not-a-real-key";

const client = createClient({ publicKey: PLACEHOLDER_KEY });

export function coverUrl(id: string) {
  return client.url(id, { resize: { width: 600 } });
}
TS

cat > README.md <<'MD'
# bgmusik-shaped fixture

`admin/` uploads covers; its e2e tests use `admin/e2e/fake-dynjandi.mjs`.
`site/` builds image URLs.
MD
