import type { ServerResponse } from "node:http";
import { AppError, parseOperationChain } from "@dynjandi/transform-grammar";
import { encodeOps, type Renderer } from "./renderer.js";
import { sendError, sendImage } from "./responses.js";
import { type FileStore, isFileId } from "./store.js";

/**
 * `GET /<id>/-/<ops>` (section 4.3). The chain is parsed before the file is looked up, as the service does,
 * so a bad chain is a 400 whether or not the file exists, and the renderer is asked only for a good one.
 */
export async function serveVariant(
  response: ServerResponse,
  options: { store: FileStore; renderer: Renderer },
  id: string,
  rawOperations: string,
): Promise<void> {
  let ops: string;
  try {
    ops = encodeOps(parseOperationChain(rawOperations));
  } catch (error) {
    if (error instanceof AppError) {
      sendError(response, error.statusCode, error.message);
      return;
    }
    throw error;
  }

  const stored = isFileId(id) ? await options.store.read(id) : null;
  if (stored === null) {
    sendError(response, 404, "File not found");
    return;
  }

  const outcome = await options.renderer.render(stored.bytes, ops);
  if (!outcome.ok) {
    sendError(response, outcome.status, outcome.message);
    return;
  }
  sendImage(response, outcome.contentType, outcome.bytes);
}
