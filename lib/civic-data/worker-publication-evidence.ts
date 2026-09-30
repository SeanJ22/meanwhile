import { createHash } from "node:crypto";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { ParserResult, WorkerResultRecord } from "../control-plane/workers/types.ts";
import { inventoryRecordEvidence } from "../control-plane/workers/record-evidence.ts";
import { compareCandidateWithSource } from "../control-plane/workers/record-verification.ts";
import { linkingPageFrom, SECTION3_MINIMUMS, section3Page, section3Record } from "../control-plane/promotion/section3.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { ManualSourceSetReceipt } from "./types.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { isOfficialSource } from "./source-authority.ts";
import { hostOfUrl, type ValidatorObservation } from "../control-plane/promotion/validator-manual.ts";

export function requirePublication(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`WORKER_PUBLICATION_${reason}`);
}

/** Source-wide shortfalls: blanks stay open as work, no captured record is wrong. */
const COVERAGE_CODES = new Set(["COMPLETENESS_SOURCE_ROW_OMITTED", "DECLARED_COUNT_MISMATCH"]);

/** The saved page is intact: fully read, a success status, and the bytes hash to their recorded identity. */
export function captureIntact(capture: WorkerPublicationCapture): boolean {
  return capture.transport === "REACHABLE" && !capture.partial && capture.httpStatus !== null && capture.httpStatus >= 200 && capture.httpStatus < 300 &&
    capture.evidence.contentHash === `sha256-${createHash("sha256").update(capture.evidence.text).digest("hex")}`;
}

/** One reader-facing source receipt for the saved pages a publication rests on. */
export function section3SourceReceipt(captures: readonly WorkerPublicationCapture[], now: string, reviewedBy: string, reviewedEvidence: string): ManualSourceSetReceipt {
  return { contractVersion: 1, reviewedAt: now, reviewedBy,
    sources: captures.map(c => ({ requestedUrl: c.evidence.canonicalUrl, finalUrl: c.evidence.canonicalUrl, publisher: c.evidence.sourceId,
      sourceClass: "OFFICIAL_PUBLISHER", retrievedAt: c.observedAt, httpStatus: c.httpStatus!,
      rawHash: (c.evidence.sourceDocument?.contentHash ?? c.evidence.contentHash).slice(7), reviewOutcome: "SUPPORTED", reviewedEvidence })) };
}

/**
 * §3 for a completed parser result (docs/rulings.md §3): the page is an
 * intact, official capture inside its freshness window, and code finds each
 * published value on it. Records whose minimum facts pass go live; other
 * fields attach only when verified; everything else stays open as work. No
 * auditor, external authority or control batch is involved.
 */
export function verifiedWorkerRecords(input: {
  plan: AutonomousWorkPlan; parser: WorkerResultRecord; captures: readonly WorkerPublicationCapture[]; now: string;
}) {
  const { plan, parser, now } = input;
  const contract = plan.contract;
  const extraction = parser.result;
  requirePublication(contract.schemaVersion === 2, "CONTRACT_UNRESOLVED");
  if (contract.schemaVersion !== 2) throw new Error("WORKER_PUBLICATION_CONTRACT_UNRESOLVED");
  requirePublication(extraction.role === "PARSER" && extraction.verdict === "EXTRACTED", "PARSER_RESULT_UNRESOLVED");
  if (extraction.role !== "PARSER") throw new Error("WORKER_PUBLICATION_PARSER_RESULT_UNRESOLVED");
  const primary = input.captures.find(c => c.evidence.artifactId === extraction.artifactId);
  requirePublication(primary && captureIntact(primary), "PRIMARY_CAPTURE_MISSING_OR_INCOMPLETE");
  const linkingPage = linkingPageFrom(primary.evidence.canonicalUrl, input.captures.filter(captureIntact).map(c => c.evidence));
  const page = { url: primary.evidence.canonicalUrl, text: primary.evidence.text, retrievedAt: primary.observedAt, linkingPage };
  const pageVerdict = section3Page(page, contract.recordClass, now);
  requirePublication(pageVerdict.ok, pageVerdict.reason ?? "PAGE_UNVERIFIED");
  const minimums = SECTION3_MINIMUMS[contract.recordClass] ?? contract.requiredFields;
  const replay = compareCandidateWithSource(extraction, contract, primary.evidence, inventoryRecordEvidence(primary.evidence, contract.extraction));
  const global = replay.filter(f => !f.recordId && !COVERAGE_CODES.has(f.code));
  requirePublication(global.length === 0, `SOURCE_REPLAY_FAILED:${global.map(f => f.code).join(",")}`);
  const heldIds = new Set(replay.filter(f => f.recordId && !(f.field && !minimums.includes(f.field))).map(f => f.recordId!));
  // A field whose value does not replay from its source row stays open, labels included.
  const badFields = new Set(replay.filter(f => f.recordId && f.field).map(f => `${f.recordId}
${f.field}`));
  const heldRecordIds: string[] = [];
  const records: ParserResult["records"][number][] = [];
  for (const record of extraction.records) {
    const fields = Object.fromEntries(Object.entries(record.fields).filter(([field]) => !badFields.has(`${record.id}
${field}`)));
    const verdict = section3Record({ recordClass: contract.recordClass, fields, page, now, pageVerdict, minimums });
    if (heldIds.has(record.id) || !verdict.live) { heldRecordIds.push(record.id); continue; }
    // Only verified values publish; the rest stay blank and owed.
    records.push({ ...record, fields: Object.fromEntries(Object.entries(record.fields).filter(([field]) => verdict.verifiedFields.includes(field))) });
  }
  requirePublication(records.length > 0, `NO_RECORD_MEETS_MINIMUMS:${minimums.join(",")}`);
  const captures = linkingPage ? [primary, ...input.captures.filter(c => c.evidence.canonicalUrl === linkingPage.url).slice(0, 1)] : [primary];
  const sourceReceipt = section3SourceReceipt(captures, now, `section3-validator:${parser.id}`,
    `Parser result ${parser.id}: ${records.length} record(s) found on the saved official page inside its freshness window (§3).`);
  return { contract, extraction: { ...extraction, records }, primary, captures, sourceReceipt, heldRecordIds };
}

/** The latest completed extraction for a work item: what the Validator checks and publishes. */
export function latestParserResult(results: readonly WorkerResultRecord[], workItemId: string): WorkerResultRecord | undefined {
  return results.filter(r => r.workItemId === workItemId && r.result.role === "PARSER" && r.result.verdict === "EXTRACTED")
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id))[0];
}

/**
 * The saved pages a publication rests on: the extraction's own page, plus —
 * when that page is not `.gov` — saved `.gov` pages, one of which must link it
 * for it to count as official (`isOfficialSource`). Those are the work's own
 * pages and, from the field manual, pages any earlier job saved that link the
 * same host.
 */
export async function capturesForPublication(input: {
  repos: Pick<ControlPlaneRepositories, "artifacts">; workItemId: string; primaryId: string; results: readonly WorkerResultRecord[];
  readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
  officialLinks?: ReadonlyMap<string, readonly string[]>;
}): Promise<WorkerPublicationCapture[]> {
  const primary = await input.readCapture(input.primaryId, input.results);
  if (isOfficialSource(primary.evidence.canonicalUrl)) return [primary];
  const own = (await input.repos.artifacts.read(input.workItemId))
    .filter(a => a.artifactId !== input.primaryId && !a.partial && /html/i.test(a.contentType) && isOfficialSource(a.canonicalUrl)).slice(-10).map(a => a.artifactId);
  const learned = input.officialLinks?.get(hostOfUrl(primary.evidence.canonicalUrl) ?? "")?.slice(0, 3) ?? [];
  const read = await Promise.all([...new Set([...learned, ...own])].map(id => input.readCapture(id, input.results).catch(() => null)));
  return [primary, ...read.filter((c): c is WorkerPublicationCapture => c !== null)];
}

/**
 * One publication attempt as the Validator records it in the field manual:
 * the page read, the official page that linked it when it is not `.gov`, how
 * many records went live, and — for a source-side hold — why §3 refused it.
 */
export function validatorObservation(input: {
  plan: AutonomousWorkPlan; workItemId: string; page: WorkerPublicationCapture | null | undefined; captures: readonly WorkerPublicationCapture[]; published: number;
  outcome: { readonly status: string; readonly code: string; readonly detail: string; readonly recovery?: string };
}): ValidatorObservation {
  const { page, outcome } = input;
  const linking = page && !isOfficialSource(page.evidence.canonicalUrl)
    ? linkingPageFrom(page.evidence.canonicalUrl, input.captures.filter(captureIntact).map(c => c.evidence)) : null;
  const linkingCapture = linking ? input.captures.find(c => c.evidence.canonicalUrl === linking.url) : undefined;
  return { recordClass: input.plan.contract.recordClass, state: input.plan.contract.schemaVersion === 2 ? input.plan.contract.jurisdiction.state : null,
    workItemId: input.workItemId, published: input.published,
    page: page ? { url: page.evidence.canonicalUrl, artifactId: page.evidence.artifactId, contentHash: page.evidence.contentHash } : null,
    linking: linkingCapture ? { url: linkingCapture.evidence.canonicalUrl, artifactId: linkingCapture.evidence.artifactId } : null,
    refusal: input.published === 0 && outcome.status === "HELD" && outcome.recovery === "WORKER" ? { code: outcome.code, detail: outcome.detail } : null };
}

/**
 * The registry edition a door publishes. Every door shares one registry
 * pointer, so its editions are ordered by when their sources were read
 * (source-through), not by a label; the opaque worker form says exactly that.
 */
export function registryEdition(label: string): string {
  return `worker-roster:wr-${createHash("sha256").update(label).digest("hex").slice(0, 24)}`;
}
