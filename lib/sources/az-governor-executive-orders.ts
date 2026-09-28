import { createHash } from "node:crypto";

import { extractTextLayer } from "../extract/text-layer.ts";
import type { ExecutiveAction } from "../officials/executive-actions.ts";

export const AZ_GOVERNOR_ORDERS_INDEX = "https://azgovernor.gov/executive-orders";
const DETAIL = /^https:\/\/azgovernor\.gov\/office-arizona-governor\/executive-order\/(\d{4}-\d+)$/;
const PDF = /^https:\/\/azgovernor\.gov\/(?:sites\/default\/files\/[^?#]+\.pdf|file\/\d+\/download\?token=[A-Za-z0-9_-]+)$/;
const GOVERNOR = "Office of the Arizona Governor";

export interface GovernorOrderCapture {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly rawHash: string;
  readonly bodyBase64: string;
  readonly byteCount: number;
}

export function captureGovernorOrderResponse(input: {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly bytes: Uint8Array;
}): GovernorOrderCapture {
  return {
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    httpStatus: input.httpStatus,
    retrievedAt: input.retrievedAt,
    rawHash: createHash("sha256").update(input.bytes).digest("hex"),
    bodyBase64: Buffer.from(input.bytes).toString("base64"),
    byteCount: input.bytes.length,
  };
}

function bytes(capture: GovernorOrderCapture): Uint8Array {
  const body = Buffer.from(capture.bodyBase64, "base64");
  if (body.length !== capture.byteCount || createHash("sha256").update(body).digest("hex") !== capture.rawHash) {
    throw new Error(`AZ_GOVERNOR_CAPTURE_HASH_MISMATCH:${capture.requestedUrl}`);
  }
  return body;
}

function text(capture: GovernorOrderCapture): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes(capture));
}

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|quot|apos|nbsp|rsquo|#039|#39|#8217);|&#(\d+);/g, (entity, numeric: string | undefined) => {
    if (numeric) return String.fromCodePoint(Number(numeric));
    return ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&nbsp;": " ", "&rsquo;": "’", "&#039;": "'", "&#39;": "'", "&#8217;": "’" } as Record<string, string>)[entity] ?? entity;
  }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function exactDate(value: string): string | null {
  if (!/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(value)) return null;
  const date = new Date(`${value} 00:00:00 GMT`);
  if (!Number.isFinite(date.getTime())) return null;
  const canonical = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(date);
  return canonical === value ? date.toISOString().slice(0, 10) : null;
}

export interface GovernorIndexOrder {
  readonly number: string;
  readonly title: string;
  readonly date: string;
  readonly detailUrl: string;
  readonly pdfUrl: string;
}

export function parseGovernorOrderIndex(capture: GovernorOrderCapture): {
  readonly orders: readonly GovernorIndexOrder[];
  readonly hasNextPage: boolean;
} {
  if (capture.requestedUrl !== AZ_GOVERNOR_ORDERS_INDEX || capture.finalUrl !== AZ_GOVERNOR_ORDERS_INDEX || capture.httpStatus !== 200) {
    throw new Error("AZ_GOVERNOR_INDEX_SOURCE_INVALID");
  }
  const html = text(capture);
  const cards = [...html.matchAll(/<div class="panelizer-view-mode node node-dvm-1-featured node-executive-order[^\"]*"[\s\S]*?<\/section>/g)];
  const wrappers = [...html.matchAll(/node-executive-order node-\d+/g)].length;
  if (cards.length === 0 || wrappers !== cards.length) throw new Error("AZ_GOVERNOR_INDEX_CARD_BOUNDARY_INVALID");
  const orders: GovernorIndexOrder[] = [];
  for (const card of cards) {
    const body = card[0];
    const detail = body.match(/<h4[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const number = body.match(/<h3[^>]*>\s*Executive Order:\s*(\d{4}-\d+)\s*<\/h3>/i)?.[1];
    const dateText = body.match(/<div class="date[^\"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
    const download = body.match(/<span class="eo-download-btn"[^>]*>\s*<a href="([^"]+)"/i)?.[1];
    const title = detail ? decodeHtml(detail[2]) : "";
    const date = dateText ? exactDate(decodeHtml(dateText)) : null;
    if (!detail || !number || !date || !download || DETAIL.exec(detail[1])?.[1] !== number || !PDF.test(download) || !title) {
      throw new Error("AZ_GOVERNOR_INDEX_CARD_INCOMPLETE");
    }
    orders.push({ number, title, date, detailUrl: detail[1], pdfUrl: download });
  }
  if (new Set(orders.map((order) => order.number)).size !== orders.length) throw new Error("AZ_GOVERNOR_INDEX_DUPLICATE_ORDER");
  return { orders, hasNextPage: /class="pager-next"|rel="next"/i.test(html) };
}

export async function verifiedGovernorOrder(input: {
  readonly index: GovernorIndexOrder;
  readonly detail: GovernorOrderCapture;
  readonly pdf: GovernorOrderCapture;
}): Promise<ExecutiveAction> {
  const { index, detail, pdf } = input;
  if (detail.requestedUrl !== index.detailUrl || detail.finalUrl !== index.detailUrl || detail.httpStatus !== 200) {
    throw new Error(`AZ_GOVERNOR_DETAIL_SOURCE_INVALID:${index.number}`);
  }
  const html = text(detail);
  const title = decodeHtml(html.match(/<h1>\s*([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const designation = decodeHtml(html.match(/<h3 class="category">\s*(Executive Order \d{4}-\d+)\s*<\/h3>/i)?.[1] ?? "");
  const dateText = decodeHtml(html.match(/field-name-field-issue-date[\s\S]{0,300}?<span class="date-display-single">([^<]+)<\/span>/i)?.[1] ?? "");
  const pdfUrl = html.match(/field-name-field-eo-document[\s\S]{0,500}?<a href="([^"]+)"[^>]*type="application\/pdf(?:;[^"]*)?"/i)?.[1];
  if (title !== index.title || designation !== `Executive Order ${index.number}` || exactDate(dateText) !== index.date ||
      !pdfUrl || !PDF.test(pdfUrl) || pdfUrl !== pdf.requestedUrl) {
    throw new Error(`AZ_GOVERNOR_DETAIL_DISAGREES_WITH_INDEX:${index.number}`);
  }
  if (!/NOW,\s*THEREFORE\s*,\s*I,\s*Katie Hobbs,\s*Governor of the State of Arizona/i.test(decodeHtml(html))) {
    throw new Error(`AZ_GOVERNOR_ORDER_OPERATIVE_TEXT_MISSING:${index.number}`);
  }
  const pdfBytes = bytes(pdf);
  if (pdf.httpStatus !== 200 || !PDF.test(pdf.requestedUrl) || !PDF.test(pdf.finalUrl) ||
      pdfBytes.length < 100 || Buffer.from(pdfBytes.subarray(0, 4)).toString("ascii") !== "%PDF") {
    throw new Error(`AZ_GOVERNOR_PDF_INVALID:${index.number}`);
  }
  // The publisher currently serves a scanned PDF. Keep the exact bytes and
  // distinguish an unread text layer from the independently verified HTML.
  const layer = await extractTextLayer(pdfBytes, pdf.finalUrl);
  if (layer.outcome === "EXTRACTED" && !layer.items.some((page) => new RegExp(index.number.replace("-", "\\s*-\\s*")).test(page.text))) {
    throw new Error(`AZ_GOVERNOR_PDF_NUMBER_DISAGREES:${index.number}`);
  }
  return {
    id: `az-eo-${index.number}`, officeholderId: "statewide:az/governor", officeholderName: "Katie Hobbs",
    officeTitle: "Governor", ocdId: "ocd-division/country:us/state:az", kind: "EXECUTIVE_ORDER",
    designation, title, occurredAt: index.date, occurredAtState: "PUBLISHED", sourceUrl: detail.finalUrl,
    documentUrl: pdf.finalUrl, sourceOrg: GOVERNOR, collectedAt: detail.retrievedAt,
    sessionId: null, chapter: null, coveredBills: [], enactmentRoute: null,
  };
}
