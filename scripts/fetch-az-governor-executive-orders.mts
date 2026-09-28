/** Original-hunt, source-scoped Governor executive-order read. No manual review is asserted. */
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  AZ_GOVERNOR_EXECUTIVE_ORDERS_CONTRACT,
  azGovernorExecutiveOrdersCandidate,
  readAzGovernorOrdersPrior,
} from "../lib/outcomes/data-plane.ts";
import {
  AZ_GOVERNOR_ORDERS_INDEX,
  captureGovernorOrderResponse,
  parseGovernorOrderIndex,
  verifiedGovernorOrder,
  type GovernorOrderCapture,
} from "../lib/sources/az-governor-executive-orders.ts";
import { OUTBOUND_USER_AGENT } from "../lib/geo/outbound-agent.ts";

if (!process.argv.includes("--promote")) throw new Error("AZ_GOVERNOR_ORDER_PROMOTION_ONLY");
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const MAX_HTML_BYTES = 500_000;
const MAX_PDF_BYTES = 8_000_000;
const HOST_GAP_MS = 10_000;
let lastRequestAt = 0;
let submitted = false;

async function capture(url: string, maximum: number): Promise<GovernorOrderCapture> {
  const gap = lastRequestAt + HOST_GAP_MS - Date.now();
  if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
  lastRequestAt = Date.now();
  const response = await fetch(url, { headers: { "user-agent": OUTBOUND_USER_AGENT },
    redirect: "follow", signal: AbortSignal.timeout(20_000) });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new Error(`AZ_GOVERNOR_DOCUMENT_TOO_LARGE:${url}`);
  if (!response.body) throw new Error(`AZ_GOVERNOR_DOCUMENT_BODY_MISSING:${url}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new Error(`AZ_GOVERNOR_DOCUMENT_TOO_LARGE:${url}`);
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return captureGovernorOrderResponse({ requestedUrl: url, finalUrl: response.url,
    httpStatus: response.status, retrievedAt: new Date().toISOString(), bytes: body });
}

async function main(): Promise<void> {
  const prior = await readAzGovernorOrdersPrior(store, new Date().toISOString());
  const index = await capture(AZ_GOVERNOR_ORDERS_INDEX, MAX_HTML_BYTES);
  const page = parseGovernorOrderIndex(index);
  const captures: GovernorOrderCapture[] = [];
  const verified: { detail: GovernorOrderCapture; pdf: GovernorOrderCapture }[] = [];
  const held: { key: string; code: string; detail: string }[] = [];
  for (const row of page.orders) {
    try {
      const detail = await capture(row.detailUrl, MAX_HTML_BYTES);
      captures.push(detail);
      // The detail page's own field supplies the current signed-document link;
      // the index's token URL is historical navigation evidence only.
      const html = Buffer.from(detail.bodyBase64, "base64").toString("utf8");
      const pdfUrl = html.match(/field-name-field-eo-document[\s\S]{0,500}?<a href="([^"]+)"[^>]*type="application\/pdf(?:;[^"]*)?"/i)?.[1];
      if (!pdfUrl || !/^https:\/\/azgovernor\.gov\/(?:sites\/default\/files\/[^?#]+\.pdf|file\/\d+\/download\?token=[A-Za-z0-9_-]+)$/.test(pdfUrl)) {
        throw new Error("DETAIL_PDF_ROUTE_MISSING");
      }
      const pdf = await capture(pdfUrl, MAX_PDF_BYTES);
      captures.push(pdf);
      await verifiedGovernorOrder({ index: row, detail, pdf });
      verified.push({ detail, pdf });
    } catch (error) {
      held.push({ key: `action:az-eo-${row.number}`, code: "GOVERNOR_ORDER_SOURCE_UNVERIFIED",
        detail: `${row.detailUrl}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const retrievedAt = new Date().toISOString();
  const candidate = await azGovernorExecutiveOrdersCandidate({ index, captures, verified, held, prior, retrievedAt });
  submitted = true;
  const outcome = await processRegisteredRoutineCandidate(store, AZ_GOVERNOR_EXECUTIVE_ORDERS_CONTRACT.contractId,
    candidate, retrievedAt, prior?.versionId ?? null);
  printSourceRunnerReceipt(AZ_GOVERNOR_EXECUTIVE_ORDERS_CONTRACT.contractId, candidate, outcome);
  if (!outcome.promoted) throw new Error(`AZ_GOVERNOR_ORDER_PROMOTION_HELD:${outcome.candidate.failureCode}`);
}

try {
  await main();
} catch (error) {
  if (!submitted) {
    const attemptedAt = new Date().toISOString();
    const candidate = failedAcquisitionCandidate({ sourceId: AZ_GOVERNOR_EXECUTIVE_ORDERS_CONTRACT.sourceId,
      recordClass: AZ_GOVERNOR_EXECUTIVE_ORDERS_CONTRACT.recordClass,
      scope: AZ_GOVERNOR_EXECUTIVE_ORDERS_CONTRACT.scope,
      requestedUrl: AZ_GOVERNOR_ORDERS_INDEX, attemptedAt,
      failureDetail: error instanceof Error ? error.message : String(error),
      parserVersion: AZ_GOVERNOR_EXECUTIVE_ORDERS_CONTRACT.parserVersion });
    const outcome = await processRegisteredRoutineCandidate(store, AZ_GOVERNOR_EXECUTIVE_ORDERS_CONTRACT.contractId,
      candidate, attemptedAt);
    printSourceRunnerReceipt(AZ_GOVERNOR_EXECUTIVE_ORDERS_CONTRACT.contractId, candidate, outcome);
  }
  throw error;
}
