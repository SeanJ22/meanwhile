import { cannotRun, extracted, zeroRows } from "./types.ts";
import type { ExtractResult } from "./types.ts";
import { createRequire } from "node:module";
import { walkStrings, type PayloadString } from "./embedded-payload.ts";

export function extractEmbeddedHtml(html: string): { text: string; fragments: number } | null {
  if (!html.includes("JSON.parse")) return null;
  type Node = { type?: string; name?: string; value?: unknown; start?: number; computed?: boolean; callee?: Node;
    object?: Node; property?: Node; arguments?: Node[]; [field: string]: unknown };
  const { parse } = createRequire(import.meta.url)("next/dist/compiled/acorn") as {
    parse: (source: string, options: { ecmaVersion: string; sourceType: string }) => Node };
  const fragments = new Set<string>();
  const links = new Set<string>();
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const collectLinks = (value: unknown, depth = 0): void => {
    if (depth > 40 || !value || typeof value !== "object") return;
    if (!Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      const pairs = [[row.buttonUrl, row.buttonText], [row.href, row.label ?? row.text]];
      for (const [url, label] of pairs) {
        if (typeof url !== "string" || typeof label !== "string" || !label.trim() ||
            !/^(?:https?:\/\/|\/(?!\/)|\.\.?\/|#)/i.test(url)) continue;
        links.add(`<a href="${escape(url)}">${escape(label)}</a>`);
      }
    }
    for (const child of Object.values(value)) collectLinks(child, depth + 1);
  };
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let tree: Node;
    try { tree = parse(script[1], { ecmaVersion: "latest", sourceType: "script" }); }
    catch { continue; }
    const nodes: Node[] = [tree];
    const literals: { start: number; value: string }[] = [];
    while (nodes.length) {
      const node = nodes.pop()!;
      if (node.type === "CallExpression" && node.callee?.type === "MemberExpression" && !node.callee.computed &&
          node.callee.object?.type === "Identifier" && node.callee.object.name === "JSON" &&
          node.callee.property?.name === "parse" && node.arguments?.length === 1 &&
          node.arguments[0].type === "Literal" && typeof node.arguments[0].value === "string") {
        literals.push({ start: node.start ?? 0, value: node.arguments[0].value });
      }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) {
          for (const item of child) if (item && typeof item === "object" && typeof item.type === "string") nodes.push(item as Node);
        } else if (child && typeof child === "object" && typeof (child as Node).type === "string") nodes.push(child as Node);
      }
    }
    for (const literal of literals.sort((a, b) => a.start - b.start)) {
      try {
        const fields: PayloadString[] = [];
        const value: unknown = JSON.parse(literal.value);
        walkStrings(value, "", fields, 0);
        for (const field of fields) if (/<[a-z][^>]*>/i.test(field.value)) fragments.add(field.value);
        collectLinks(value);
      } catch { /* A malformed literal supplies no decoded page content. */ }
    }
  }
  return fragments.size || links.size ? { text: [html, ...fragments, ...links].join("\n"), fragments: fragments.size } : null;
}

export interface PdfPage {
  page: number;
  text: string;
  links?: string[];
}

/** How little text a page can hold before it is treated as no text at all. */
const MIN_PAGE_CHARS = 2;

export async function extractTextLayer(
  bytes: Uint8Array,
  source: string,
): Promise<ExtractResult<PdfPage>> {
  if (bytes.length === 0) {
    return cannotRun("TEXT_LAYER", source, "the input is zero bytes — nothing was fetched");
  }

  // `%PDF` is checked first, so a fetched HTML error page reports as the wrong type, not an empty PDF.
  const magic = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (!magic.startsWith("%PDF")) {
    return cannotRun(
      "TEXT_LAYER",
      source,
      `the input does not begin with %PDF (saw ${JSON.stringify(magic)}) — this is ` +
        "not a PDF, and reading it as one would report a document that says nothing",
      { inputBytes: bytes.length },
    );
  }

  let doc;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    doc = await getDocument({ data: bytes, useWorkerFetch: false, .../^https?:\/\//.test(source) ? { docBaseUrl: source } : {} }).promise;
  } catch (error) {
    return cannotRun(
      "TEXT_LAYER",
      source,
      `the PDF engine refused the file: ${(error as Error).message}`,
      { inputBytes: bytes.length },
    );
  }

  const pages: PdfPage[] = [];
  let pagesEmpty = 0;
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: unknown) =>
          item && typeof item === "object" && "str" in item ? String(item.str) : "",
        )
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      const links = [...new Set((await page.getAnnotations()).flatMap(annotation =>
        typeof annotation.url === "string" && /^https?:\/\//i.test(annotation.url) ? [annotation.url] : []))];
      if (text.length >= MIN_PAGE_CHARS) pages.push({ page: i, text, ...(links.length ? { links } : {}) });
      else pagesEmpty += 1;
    }
  } finally {
    await doc.cleanup();
  }

  const counts = { pages: doc.numPages, pagesWithText: pages.length, pagesEmpty };

  if (pages.length === 0) {
    /* Every page rendered and none carried text: a scan, for OCR, not an empty document. */
    return zeroRows(
      "TEXT_LAYER",
      source,
      bytes.length,
      `all ${doc.numPages} page(s) rendered and none carried a text layer — this is ` +
        "a scanned PDF. The next rung is OCR (lib/extract/ocr.ts), NOT a finding " +
        "that the document is empty.",
      counts,
    );
  }

  return extracted("TEXT_LAYER", source, bytes.length, pages, counts);
}
