import { isQuotedExtraction, quotedSourceFindings } from "../control-plane/workers/quoted-proof.ts";
import { manualClassForKind } from "../control-plane/promotion/source-kinds.ts";
import { createHash } from "node:crypto";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { ParserResult, WorkerResultRecord, WorkerEvidence } from "../control-plane/workers/types.ts";
import { inventoryRecordEvidence } from "../control-plane/workers/record-evidence.ts";
import { compareCandidateWithSource } from "../control-plane/workers/record-verification.ts";
import { linkingPageFrom, pageLinksTo, SECTION3_MINIMUMS, section3Page, section3Record } from "../control-plane/promotion/section3.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { ManualSourceSetReceipt } from "./types.ts";
import { keysWhere, type ArtifactRecord, type ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { readCompletedWorkerResultsOf } from "../control-plane/repository/worker-completion.ts";
import { isOfficialSource } from "./source-authority.ts";
import { hostOfUrl, type ValidatorObservation } from "../control-plane/promotion/validator-manual.ts";

export function requirePublication(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`WORKER_PUBLICATION_${reason}`);
}

const COVERAGE_CODES = new Set(["COMPLETENESS_SOURCE_ROW_OMITTED", "DECLARED_COUNT_MISMATCH"]);

/** Each distinct content once, newest first, at most `pages` distinct pages. Every copy is kept, so a reader can skip a later "Access Denied" copy. */
export function heldPageCopies(artifacts: readonly ArtifactRecord[], pages: number): readonly ArtifactRecord[] {
  const hashes = new Set<string>(), urls = new Set<string>();
  // Only HTTPS copies: the publication door accepts no other source, and a page it would refuse must not hold the facts beside it.
  return [...artifacts].filter(a => !a.partial && /^(?:text\/(?:html|plain|csv|tab-separated-values)|application\/(?:xhtml\+xml|json|csv))(?:;|$)/i.test(a.contentType) && a.canonicalUrl.startsWith("https://"))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .filter(a => !hashes.has(a.contentHash) && Boolean(hashes.add(a.contentHash)))
    .filter(a => urls.has(a.canonicalUrl) || (urls.size < pages && Boolean(urls.add(a.canonicalUrl))));
}

export function captureIntact(capture: WorkerPublicationCapture): boolean {
  return captureProblem(capture) === null;
}

export function captureProblem(capture: Pick<WorkerPublicationCapture,"transport"|"partial"|"httpStatus"> & {
  readonly evidence: {readonly text:string;readonly contentHash:string};
}): string | null {
  if (capture.transport !== "REACHABLE") return `TRANSPORT_${capture.transport}`;
  if (capture.partial) return "PARTIAL_CAPTURE";
  if (capture.httpStatus === null || capture.httpStatus < 200 || capture.httpStatus >= 300) return `HTTP_STATUS_${capture.httpStatus}`;
  const hash = `sha256-${createHash("sha256").update(capture.evidence.text).digest("hex")}`;
  return capture.evidence.contentHash === hash ? null
    : `CONTENT_HASH_MISMATCH: the page text hashes to ${hash.slice(0, 19)}…, not its recorded ${capture.evidence.contentHash.slice(0, 19)}… (pass the exact saved text)`;
}

export function section3SourceReceipt(captures: readonly (Pick<WorkerPublicationCapture,"campaign"|"sourcePolicy"|"observedAt"|"httpStatus"> & {
  readonly evidence: Pick<WorkerEvidence,"canonicalUrl"|"sourceId"|"contentHash"|"text"|"sourceDocument">;
})[], now: string, reviewedBy: string, reviewedEvidence: string, recordClass = ""): ManualSourceSetReceipt {
  return { contractVersion: 1, reviewedAt: now, reviewedBy,
    sources: captures.map(c => ({ requestedUrl: c.evidence.canonicalUrl, finalUrl: c.evidence.canonicalUrl, publisher: c.evidence.sourceId,
      sourceClass: manualClassForKind(section3Page({ url: c.evidence.canonicalUrl, text: c.evidence.text, retrievedAt: c.observedAt,
        sourcePolicy: c.sourcePolicy, campaign: c.campaign, linkingPage: linkingPageFrom(c.evidence.canonicalUrl, captures.map(copy => copy.evidence)) }, recordClass, now).kind), retrievedAt: c.observedAt, httpStatus: c.httpStatus!,
      rawHash: (c.evidence.sourceDocument?.contentHash ?? c.evidence.contentHash).slice(7), reviewOutcome: "SUPPORTED", reviewedEvidence })) };
}

export function verifiedWorkerRecords(input: {
  plan: AutonomousWorkPlan; parser: WorkerResultRecord; captures: readonly WorkerPublicationCapture[]; now: string;
  results?: readonly WorkerResultRecord[];
  pullRemoves?: boolean;
}) {
  const { plan, parser, now } = input;
  const contract = plan.contract;
  const extraction = parser.result;
  requirePublication(contract.schemaVersion === 2, "CONTRACT_UNRESOLVED");
  if (contract.schemaVersion !== 2) throw new Error("WORKER_PUBLICATION_CONTRACT_UNRESOLVED");
  requirePublication(extraction.role === "PARSER" && extraction.verdict === "EXTRACTED", "PARSER_RESULT_UNRESOLVED");
  if (extraction.role !== "PARSER") throw new Error("WORKER_PUBLICATION_PARSER_RESULT_UNRESOLVED");
  const pulled = input.results ? auditPull(input.results, parser) : null;
  requirePublication(!pulled?.all || input.pullRemoves, "AUDIT_BROKE:the Auditor broke this extraction; a new extraction is owed");
  const primary = input.captures.find(c => c.evidence.artifactId === extraction.artifactId);
  requirePublication(primary && captureIntact(primary), "PRIMARY_CAPTURE_MISSING_OR_INCOMPLETE");
  const linkingPage = linkingPageFrom(primary.evidence.canonicalUrl, input.captures.filter(captureIntact).map(c => c.evidence));
  const page = { url: primary.evidence.canonicalUrl, text: primary.evidence.text, retrievedAt: primary.observedAt, linkingPage, sourcePolicy: primary.sourcePolicy, campaign: primary.campaign,
    citations: input.captures.filter(c => c !== primary && captureIntact(c)).map(c => ({ url: c.evidence.canonicalUrl, text: c.evidence.text, retrievedAt: c.observedAt })) };
  const pageVerdict = section3Page(page, contract.recordClass, now);
  requirePublication(pageVerdict.ok, pageVerdict.reason ?? "PAGE_UNVERIFIED");
  const minimums = SECTION3_MINIMUMS[contract.recordClass] ?? contract.requiredFields;
  const replay = isQuotedExtraction(contract, extraction)
    ? quotedSourceFindings(extraction, { ...contract, requiredFields: SECTION3_MINIMUMS[contract.recordClass] ?? contract.requiredFields }, primary.evidence)
    : compareCandidateWithSource(extraction, contract, primary.evidence, inventoryRecordEvidence(primary.evidence, contract.extraction, contract));
  const global = replay.filter(f => !f.recordId && !COVERAGE_CODES.has(f.code));
  requirePublication(global.length === 0, `SOURCE_REPLAY_FAILED:${global.map(f => f.code).join(",")}`);
  const heldIds = new Set(replay.filter(f => f.recordId && !(f.field && !minimums.includes(f.field))).map(f => f.recordId!));
  // A field whose value does not replay from its source row stays open, labels included.
  const badFields = new Set(replay.filter(f => f.recordId && f.field).map(f => `${f.recordId}
${f.field}`));
  const heldRecordIds: string[] = [];
  const records: ParserResult["records"][number][] = [];
  const pulledRecords: ParserResult["records"][number][] = [];
  for (const record of extraction.records) {
    if (input.pullRemoves && pulled && (pulled.all || pulled.recordIds.has(record.id))) { pulledRecords.push(record); heldRecordIds.push(record.id); continue; }
    const fields = Object.fromEntries(Object.entries(record.fields).filter(([field]) => !badFields.has(`${record.id}
${field}`)));
    let verdict = section3Record({ recordClass: contract.recordClass, fields, page, now, pageVerdict, minimums });
    if (!verdict.live && contract.recordClass === "CAMPAIGN_FINANCE_FILING") {
      verdict = section3Record({ recordClass: "CAMPAIGN_FINANCE_DOCUMENT", fields, page, now, pageVerdict });
    }
    if (heldIds.has(record.id) || pulled?.recordIds.has(record.id) || !verdict.live) { heldRecordIds.push(record.id); continue; }
    // Only verified values publish; the rest stay blank and owed.
    records.push({ ...record, fields: Object.fromEntries(Object.entries(record.fields).filter(([field]) => verdict.verifiedFields.includes(field))) });
  }
  requirePublication(records.length > 0 || pulledRecords.length > 0, `NO_RECORD_MEETS_MINIMUMS:${minimums.join(",")}`);
  const captures = [primary, ...input.captures.filter(c => c !== primary && captureIntact(c) &&
    (c.evidence.canonicalUrl === linkingPage?.url || pageLinksTo(page, c.evidence.canonicalUrl)))];
  const sourceReceipt = section3SourceReceipt(captures, now, `section3-validator:${parser.id}`,
    `Parser result ${parser.id}: ${records.length} record(s) found on the saved page inside its freshness window (§3).`, contract.recordClass);
  return { contract, extraction: { ...extraction, records }, primary, captures, sourceReceipt, heldRecordIds, pulledRecords };
}

/**
 * A publication job's worker results: those of its own work items, and, for a saved page another item captured,
 * that item's own (its Acquirer's walk dates the page). Nothing else is read. `readCapture` hands each page the
 * results of the items that captured it.
 */
export async function jobWorkerResults<C>(repos: ControlPlaneRepositories, workItemIds: readonly string[],
  readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<C>) {
  const byItem = new Map<string, readonly WorkerResultRecord[]>();
  const resultsOf = async (ids: readonly string[]): Promise<readonly WorkerResultRecord[]> => {
    const missing = [...new Set(ids)].filter(id => !byItem.has(id));
    if (missing.length) {
      const read = await readCompletedWorkerResultsOf(repos, missing);
      for (const id of missing) byItem.set(id, read.filter(record => record.workItemId === id));
    }
    return [...new Set(ids)].flatMap(id => byItem.get(id)!);
  };
  return {
    results: await resultsOf(workItemIds),
    readCapture: async (id: string, own: readonly WorkerResultRecord[]): Promise<C> => {
      const owners = await keysWhere(repos.artifacts, ["artifactId"], id);
      return readCapture(id, owners === null ? own : await resultsOf(owners));
    },
  };
}

export function latestParserResult(results: readonly WorkerResultRecord[], workItemId: string): WorkerResultRecord | undefined {
  return results.filter(r => r.workItemId === workItemId && r.result.role === "PARSER" && r.result.verdict === "EXTRACTED")
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id))[0];
}

export async function capturesForPublication(input: {
  repos: Pick<ControlPlaneRepositories, "artifacts">; workItemId: string; primaryId: string; results: readonly WorkerResultRecord[];
  readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
  officialLinks?: ReadonlyMap<string, readonly string[]>;
}): Promise<WorkerPublicationCapture[]> {
  const primary = await input.readCapture(input.primaryId, input.results);
  if (isOfficialSource(primary.evidence.canonicalUrl)) return [primary];
  const own = (await input.repos.artifacts.read(input.workItemId))
    .filter(a => a.artifactId !== input.primaryId && !a.partial && /^(?:text\/(?:html|plain|csv|tab-separated-values)|application\/(?:xhtml\+xml|json|csv))(?:;|$)/i.test(a.contentType)).slice(-10).map(a => a.artifactId);
  const learned = input.officialLinks?.get(hostOfUrl(primary.evidence.canonicalUrl) ?? "")?.slice(0, 3) ?? [];
  const read = await Promise.all([...new Set([...learned, ...own])].map(id => input.readCapture(id, input.results).catch(() => null)));
  return [primary, ...read.filter((c): c is WorkerPublicationCapture => c !== null)];
}

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

/** Every door shares one registry pointer, so editions are ordered by source-through, not by label. */
export function registryEdition(label: string): string {
  return `worker-roster:wr-${createHash("sha256").update(label).digest("hex").slice(0, 24)}`;
}

export function auditPull(results: readonly WorkerResultRecord[], parser: WorkerResultRecord): { readonly all: boolean; readonly recordIds: ReadonlySet<string>; readonly at: string } | null {
  if (parser.result.role !== "PARSER") return null;
  const attemptId = parser.result.attemptId;
  const broke = results.filter(r => r.workItemId === parser.workItemId && r.result.role === "ADVERSARIAL_AUDITOR" &&
    r.result.verdict === "BROKE" && r.result.producerAttemptId === attemptId);
  if (!broke.length) return null;
  const named = broke.map(r => (r.result as { brokenRecordIds?: readonly string[] }).brokenRecordIds ?? null);
  return { all: named.some(ids => ids === null || ids.length === 0), recordIds: new Set(named.flatMap(ids => ids ?? [])),
    at: broke.map(r => r.endedAt).sort().at(-1)! };
}
