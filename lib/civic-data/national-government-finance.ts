import { createHash } from "node:crypto";
import { parseCsv } from "../reference/index.ts";
import { readZip } from "../sources/legiscan/zip.ts";
import type { DoorRecord } from "../doors/registry.ts";
import type { CapturedFinanceResponse } from "../funding/campaign-finance.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { captureIntact, section3SourceReceipt } from "./worker-publication-evidence.ts";
import { linkingPageFrom, section3Page, valueOnPage } from "../control-plane/promotion/section3.ts";
import { GOVERNMENT_FINANCE_FIELDS, governmentFinanceFact, governmentFinanceKind, type GovernmentFinanceField } from "./government-finance.ts";
import type { ManualProjectionPackage } from "./manual-projections.ts";
import { prepareManualProjectionSuccessor } from "./manual-successor.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import type { RoutineDataStore } from "./store.ts";

/** Door field maps carry the source's codebook and government key, so Census,
 * FAC and USAspending are read in ordinary code before any paid local work. */
export const NATIONAL_GOVERNMENT_FINANCE_DOOR_KINDS = ["government-finance-census", "government-finance-fac", "government-finance-usaspending"] as const;
type Field = "governmentId" | "governmentName" | "title" | "kindLabel" | "sourceSentence" | GovernmentFinanceField;
const fields: readonly Field[] = ["governmentId", "governmentName", "title", "kindLabel", "sourceSentence", ...GOVERNMENT_FINANCE_FIELDS];
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const getPath = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, key) =>
  v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined, value);
const literal = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
function filedNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) return null;
  return Number(raw);
}
export function nationalGovernmentFinancePackage(input: {
  readonly door: DoorRecord;
  readonly government: { readonly bodyId: string; readonly ocdId: string; readonly name: string; readonly sourceGovernmentId: string };
  readonly responses: readonly CapturedFinanceResponse[];
  /** Official saved metadata/codebook, if the source's units or labels are not in every row. */
  readonly metadataCaptures?: readonly WorkerPublicationCapture[];
  readonly now: string;
}): ManualProjectionPackage {
  const { door, government, now } = input;
  if (!(NATIONAL_GOVERNMENT_FINANCE_DOOR_KINDS as readonly string[]).includes(door.kind) || !government.sourceGovernmentId ||
    !government.bodyId || !government.name || door.ocdId !== government.ocdId || !input.responses.length) throw new Error("National finance must name this admitted government's door and publisher key.");
  let map: Partial<Record<Field, string>>, fixed: Partial<Record<Field, unknown>>;
  try { map = JSON.parse(String(door.config.fieldMap)); fixed = JSON.parse(String(door.config.fixedFields ?? "{}")); }
  catch { throw new Error("The government finance field map is unreadable."); }
  if (!map || typeof map !== "object" || Array.isArray(map) || !fixed || typeof fixed !== "object" || Array.isArray(fixed) ||
    typeof map.governmentId !== "string" || Object.keys(map).some(key => !(fields as readonly string[]).includes(key)) ||
    Object.values(map).some(value => typeof value !== "string" || !value) || Object.hasOwn(fixed, "governmentId") ||
    Object.keys(fixed).some(key => !(fields as readonly string[]).includes(key)) ||
    Object.values(fixed).some(value => value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value)))) throw new Error("The government finance map lacks a source government key or has unsupported fields.");
  const metadata = (input.metadataCaptures ?? []).filter(captureIntact);
  const admittedMetadata = metadata.filter(capture => section3Page({ url: capture.evidence.canonicalUrl, text: capture.evidence.text,
    retrievedAt: capture.observedAt, sourcePolicy: capture.sourcePolicy,
    linkingPage: linkingPageFrom(capture.evidence.canonicalUrl, metadata.map(row => row.evidence)) }, "PUBLIC_RECORD", now).ok);
  const records = [], used: WorkerPublicationCapture[] = [], rawHashes: string[] = [];
  for (const response of input.responses) {
    const rawHash = sha(response.bytes);
    if (!response.complete || response.partial || response.rawHash !== rawHash || response.transport !== "REACHABLE" ||
      !response.httpStatus || response.httpStatus < 200 || response.httpStatus >= 300 || response.httpStatus === 206 ||
      !door.hosts.includes(new URL(response.url).hostname.toLowerCase())) throw new Error("The saved national finance response is incomplete or outside its source door.");
    let bytes = response.bytes;
    if (typeof door.config.fileName === "string") {
      const found = readZip(bytes).filter(entry => entry.name === door.config.fileName);
      if (found.length !== 1) throw new Error("The finance archive lacks its exact registered export.");
      bytes = found[0].data;
    }
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
    const capture: WorkerPublicationCapture = { evidence: { artifactId: `national-finance:${rawHash}`, acquiredByAttemptId: "saved-national-finance",
      canonicalUrl: response.url, contentHash: `sha256-${sha(text)}`, text, retrievedAt: response.retrievedAt, sourceId: response.publisher,
      methodRouteId: `national-finance:${door.doorId}` },
      observedAt: response.retrievedAt, httpStatus: response.httpStatus, transport: response.transport, partial: false, sourcePolicy: response.sourcePolicy };
    if (!section3Page({ url: response.url, text, retrievedAt: response.retrievedAt, sourcePolicy: response.sourcePolicy,
      linkingPage: linkingPageFrom(response.url, metadata.map(row => row.evidence)) }, "PUBLIC_RECORD", now).ok) throw new Error("The national finance source is not admitted by the current publication settings.");
    let rows: Record<string, unknown>[];
    if (door.config.format === "json") {
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error("The national finance JSON is unreadable."); }
      const selected = typeof door.config.rowsPath === "string" ? getPath(value, door.config.rowsPath) : value;
      if (!Array.isArray(selected) || selected.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("The national finance response lacks its registered row list.");
      rows = selected;
    } else {
      const [headers, ...data] = parseCsv(text);
      if (!headers?.length || new Set(headers).size !== headers.length || !headers.includes(map.governmentId!)) throw new Error("The national finance export lacks its unique source columns.");
      rows = data.filter(row => row.some(cell => cell.trim())).map(row => {
        if (row.length !== headers.length) throw new Error("A national finance row differs from its export columns.");
        return Object.fromEntries(headers.map((key, index) => [key, row[index]]));
      });
    }
    let selected = false;
    for (const row of rows) {
      const get = (field: Field): unknown => map[field] ? Object.hasOwn(row, map[field]!) ? row[map[field]!] : getPath(row, map[field]!) : fixed[field];
      if (literal(get("governmentId")) !== government.sourceGovernmentId) continue;
      if (get("governmentName") !== undefined && literal(get("governmentName")) !== government.name) throw new Error("The publisher government key disagrees with its held government name.");
      for (const value of Object.values(fixed)) if (value !== null && ![text, ...admittedMetadata.map(c => c.evidence.text)].some(source => valueOnPage(value as string | number, source))) throw new Error("A registered finance label or unit is absent from its saved official codebook.");
      const title = literal(get("title")), detailKind = governmentFinanceKind(literal(get("kindLabel")));
      if (!title || !detailKind) throw new Error("The national finance row lacks its source title or finance category.");
      const sourceSentence = literal(get("sourceSentence")) || title;
      if (![text, ...admittedMetadata.map(c => c.evidence.text)].some(source => valueOnPage(sourceSentence, source))) throw new Error("The finance source words are absent from their original capture.");
      const details: Partial<Record<GovernmentFinanceField, string | number | null>> = {};
      for (const field of GOVERNMENT_FINANCE_FIELDS) {
        const value = get(field);
        if (value === undefined) continue;
        details[field] = ["amount", "rate", "publishedTotal"].includes(field) ? filedNumber(value) : value === null || value === "" ? null : literal(value);
      }
      records.push(governmentFinanceFact({ bodyId: government.bodyId, ocdId: government.ocdId, government: government.name, title, detailKind,
        sourceSentence, sourceUrl: response.url, sourceHash: rawHash, capturedAt: response.retrievedAt, details }));
      selected = true;
    }
    if (selected) { used.push(capture); rawHashes.push(rawHash); }
  }
  if (!records.length || new Set(records.map(row => row.id)).size !== records.length) throw new Error("The national finance read has no unique source-bound facts for this government.");
  const sourceReceipt = section3SourceReceipt([...used, ...admittedMetadata], now, "section3-validator:national-government-finance",
    "Saved official finance rows read without a model, bound to the held publisher government key, with original raw hashes and source units.");
  return { contractId: "government-budgets", version: `government-finance-v2:${new Date(now).toISOString()}`,
    sourceThrough: used.map(capture => capture.observedAt).sort().at(-1)!,
    sourceReceipt: { ...sourceReceipt, sources: sourceReceipt.sources.map((source, index) => index < used.length ? { ...source, rawHash: rawHashes[index] } : source) },
    payload: { kind: "government-budgets", records } };
}
/** Existing admitted lease calls this before requesting paid local facts. No
 * new clock, model transport, country-wide projection or production seed. */
export async function publishNationalGovernmentFinance(store: RoutineDataStore, input: Parameters<typeof nationalGovernmentFinancePackage>[0]) {
  const built = nationalGovernmentFinancePackage(input);
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(built, store, input.now);
  return processRegisteredManualCandidate(store, "government-budgets", candidate, input.now, expectedBaseVersionId);
}
