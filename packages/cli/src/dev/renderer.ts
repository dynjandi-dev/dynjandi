import type { RendererChoice } from "./options.js";

/** How long the renderer has to answer a render (section 4.3). */
export const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
// The start-up probe is a courtesy, so it must not hold the ready line back for long.
const PROBE_TIMEOUT_MS = 3000;
const UNAVAILABLE = "Renderer unavailable";

/** What a render came to: the renderer's image, or the status and message the caller answers with. */
export type RenderOutcome =
  | { ok: true; contentType: string; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; status: number; message: string };

export interface Renderer {
  /** `ops` is the `X-Dynjandi-Ops` value. Never rejects: every failure is an outcome. */
  render: (original: Uint8Array, ops: string) => Promise<RenderOutcome>;
}

export interface RendererSettings {
  /** Receives lines for stderr, without a newline. */
  log: (line: string) => void;
  /** Defaults to 30 s; tests shorten it. */
  timeoutMs?: number;
}

/**
 * The header's value: RFC 4648 section 5 base64url, without padding, of the UTF-8 JSON of the parsed chain.
 * The grammar package leaves the encoding to each caller (its README, *The Worker and container contract*).
 */
export function encodeOps(operations: unknown): string {
  return Buffer.from(JSON.stringify(operations), "utf8").toString("base64url");
}

function unavailable(message: string): RenderOutcome {
  return { ok: false, status: 502, message };
}

// The renderer's errors are `{ "error": "<message>" }`; anything else gets the status's own text.
async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body;
      if (typeof error === "string" && error !== "") return error;
    }
  } catch {
    // Not JSON: fall through.
  }
  return response.status === 504 ? "Render request timed out" : "Render failed";
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

function describe(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error) return cause.message;
  return error instanceof Error ? error.message : String(error);
}

function rendererAt(baseUrl: string, settings: RendererSettings): Renderer {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/transform`;
  const timeoutMs = settings.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  return {
    async render(original, ops) {
      try {
        // The timeout covers the body as well: a renderer that stalls mid-answer is as late as a silent one.
        const signal = AbortSignal.timeout(timeoutMs);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "X-Dynjandi-Ops": ops, "Content-Type": "application/octet-stream" },
          body: original as Uint8Array<ArrayBuffer>,
          signal,
          redirect: "manual",
        });
        // 4xx and 504 are the renderer's own verdict on this input, so they pass through (core#364 D8).
        if ((response.status >= 400 && response.status < 500) || response.status === 504) {
          return { ok: false, status: response.status, message: await errorMessage(response) };
        }
        if (response.status !== 200) {
          settings.log(
            `renderer at ${baseUrl} answered ${response.status}; check its logs, or restart it and point --renderer-url at it`,
          );
          return unavailable(UNAVAILABLE);
        }
        return {
          ok: true,
          contentType: response.headers.get("content-type") ?? "application/octet-stream",
          bytes: new Uint8Array(await response.arrayBuffer()),
        };
      } catch (error) {
        if (isTimeout(error)) {
          return { ok: false, status: 504, message: "Render request timed out" };
        }
        settings.log(
          `renderer at ${baseUrl} is unreachable (${describe(error)}); start it, or point --renderer-url at one that is running`,
        );
        return unavailable(UNAVAILABLE);
      }
    },
  };
}

/**
 * The renderer for the choice made on the command line. A Docker choice is a running container by now, so
 * the caller passes its URL (`startServer` does).
 */
export function createRenderer(
  choice: Exclude<RendererChoice, { kind: "docker" }>,
  settings: RendererSettings,
): Renderer {
  switch (choice.kind) {
    case "url":
      return rendererAt(choice.url, settings);
    case "none":
      return {
        render: async () =>
          unavailable(`${UNAVAILABLE}: dynjandi dev was started with --no-renderer`),
      };
  }
}

/** Asks `GET /health` once and logs a warning if the renderer is down. The `/health` body is not read. */
export async function probeRenderer(baseUrl: string, log: (line: string) => void): Promise<void> {
  const health = `${baseUrl.replace(/\/+$/, "")}/health`;
  try {
    const response = await fetch(health, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await response.body?.cancel();
    if (response.ok) return;
    log(
      `warning: renderer at ${baseUrl} answered ${response.status} to GET /health; variant URLs will fail until it is healthy`,
    );
  } catch (error) {
    log(
      `warning: renderer at ${baseUrl} did not answer GET /health (${describe(error)}); start it, or fix --renderer-url, or variant URLs will answer 502`,
    );
  }
}
