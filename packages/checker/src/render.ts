import type { CheckResult, OperationReport } from "./check.js";

// Everything a person pasted reaches the page through `textContent` and nothing else: no innerHTML,
// no insertAdjacentHTML (plan Constraint 3). The only link is the Dynjandi URL the checker built.

const STATUS_LABEL: Record<OperationReport["status"], string> = {
  supported: "Supported",
  invalid: "Invalid arguments",
  unsupported: "Not supported",
};
// A glyph beside the word, so status never rests on colour alone (plan D8).
const STATUS_MARK: Record<OperationReport["status"], string> = {
  supported: "✓",
  invalid: "!",
  unsupported: "✕",
};

function element(doc: Document, tag: string, text?: string, className?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (text !== undefined) {
    node.textContent = text;
  }
  if (className !== undefined) {
    node.className = className;
  }
  return node;
}

// The checker reads the URL's path, so a name arrives percent-encoded. Decoding is for display only.
function displayText(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function operationItem(doc: Document, report: OperationReport): HTMLElement {
  const item = element(doc, "li", undefined, `operation ${report.status}`);
  const status = element(doc, "span", undefined, "status");
  status.append(
    element(doc, "span", STATUS_MARK[report.status]),
    doc.createTextNode(` ${STATUS_LABEL[report.status]}`),
  );
  status.firstElementChild?.setAttribute("aria-hidden", "true");
  item.append(status, doc.createTextNode(" "), element(doc, "code", displayText(report.raw)));
  if (report.note !== undefined) {
    item.append(element(doc, "p", displayText(report.note), "note"));
  }
  if (report.canonical !== undefined) {
    item.append(element(doc, "p", `Canonical form: ${report.canonical}`, "note"));
  }
  return item;
}

function urlBlock(doc: Document, heading: string, caveat: string | null, url: string): HTMLElement {
  const block = element(doc, "div", undefined, "url-block");
  block.append(element(doc, "h3", heading));
  if (caveat !== null) {
    block.append(element(doc, "p", caveat, "note"));
  }
  const link = doc.createElement("a");
  link.textContent = url;
  link.href = url;
  link.rel = "noopener noreferrer";
  const line = element(doc, "p", undefined, "url");
  line.append(link);
  block.append(line);
  return block;
}

/** Replaces the contents of `section` with the result. */
export function renderResult(section: HTMLElement, result: CheckResult): void {
  const doc = section.ownerDocument;
  const heading = element(doc, "h2", "Result");
  heading.id = "result-heading";
  const children: HTMLElement[] = [heading];

  if (result.kind === "not-a-file-url") {
    children.push(element(doc, "p", result.reason));
    section.replaceChildren(...children);
    return;
  }

  const supported = result.operations.filter((report) => report.status === "supported").length;
  children.push(
    element(
      doc,
      "p",
      `${supported} of ${result.operations.length} operations supported for file ${result.fileId}.`,
    ),
  );
  const list = element(doc, "ul", undefined, "operations");
  list.append(...result.operations.map((report) => operationItem(doc, report)));
  children.push(list);

  if (result.dynjandiUrl !== null) {
    children.push(urlBlock(doc, "Dynjandi URL", null, result.dynjandiUrl));
  }
  if (result.partialUrl !== null) {
    children.push(
      urlBlock(
        doc,
        "Dynjandi URL without the unsupported operations",
        "Not equivalent: this is a different image from the one the original URL produces.",
        result.partialUrl,
      ),
    );
  }
  if (result.dynjandiUrl === null && result.partialUrl === null) {
    children.push(
      element(doc, "p", "None of the operations is supported, so there is no URL to show."),
    );
  }
  section.replaceChildren(...children);
}
