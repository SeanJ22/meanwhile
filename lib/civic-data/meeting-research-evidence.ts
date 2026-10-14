/** @freshness-reads-here: stamps only the successful fetch whose bytes were just read; replays keep the original time. */
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { RoutineCandidate } from "./types.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import type { MeetingPartitionContract } from "./meeting-partitions.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { holdRawCapture, type RawCaptureRef } from "./raw-capture-vault.ts";

export interface RetainedSourceResponse {
  readonly source: string; readonly requestedUrl: string; readonly finalUrl: string;
  readonly httpStatus: number; readonly rawHash: string; readonly byteCount: number;
  readonly bytes: Uint8Array; readonly retrievedAt: string;
}
export type HeldSourceResponse = Omit<RetainedSourceResponse, "bytes"> & { readonly raw: RawCaptureRef };
export type RetainedMeetingCandidate = RoutineCandidate & { readonly retainedSourceResponses?: readonly HeldSourceResponse[] };
export const RESEARCH_MEETING_ACTIVATION = "VERIFIED_RESEARCH_TO_REGISTERED_MEETING_PARTITION/1";
export interface ResearchMeetingActivationReceipt {
  readonly kind: typeof RESEARCH_MEETING_ACTIVATION; readonly partitionId: string;
  readonly artifactId: string; readonly approvalRecordIds: readonly string[];
  readonly parserResultId: string; readonly validatorResultId: string; readonly auditorResultId: string;
  readonly evidenceScope: "CURRENT_CAPTURE_MEETING_FACTS";
  readonly coveredMeetingIds: readonly string[]; readonly approvedFactCount: number;
}
export interface ApprovedResearchMeetingPartition {
  readonly snapshot: MeetingsSnapshot;
  readonly activationReceipt: ResearchMeetingActivationReceipt;
}

export async function retainMeetingFetchBytes<T>(operation: () => Promise<T>, source: string, acceptUrl: (url: string) => boolean) {
  const originalFetch = globalThis.fetch; const responses: RetainedSourceResponse[] = []; const refusals: string[] = [];
  let retainedBytes = 0;
  const observingFetch = (async (input, init) => {
    const requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await originalFetch(input, init);
    const finalUrl = response.url || requestedUrl;
    if (response.ok && acceptUrl(finalUrl)) {
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      if (retainedBytes + bytes.length <= 16 * 1024 * 1024) {
        responses.push({ source, requestedUrl, finalUrl, httpStatus: response.status,
          rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
          bytes, retrievedAt: new Date().toISOString() });
        retainedBytes += bytes.length;
      } else refusals.push(`RESEARCH_CAPTURE_BOUND_EXCEEDED:${finalUrl}`);
    }
    return response;
  }) as typeof fetch;
  globalThis.fetch = observingFetch;
  try { return { value: await operation(), responses, refusals }; }
  finally { globalThis.fetch = originalFetch; }
}

export function holdMeetingSourceResponses(vault: EvidenceStore, responses: readonly RetainedSourceResponse[]): Promise<HeldSourceResponse[]> {
  return Promise.all(responses.map(async ({ bytes, ...metadata }) =>
    ({ ...metadata, raw: await holdRawCapture(vault, metadata.source, bytes, "application/json") })));
}

export function retainMeetingCandidateEvidence(candidate: RoutineCandidate, snapshot: MeetingsSnapshot, responses: readonly HeldSourceResponse[]): RetainedMeetingCandidate {
  const traced = snapshot.sources.flatMap(report => report.acquisitions ?? []);
  const retainedSourceResponses = responses.filter(response => traced.some(evidence => evidence.source === response.source &&
    evidence.requestedUrl === response.requestedUrl && evidence.finalUrl === response.finalUrl && evidence.rawHash === response.rawHash &&
    evidence.byteCount === response.byteCount && evidence.httpStatus === response.httpStatus));
  return retainedSourceResponses.length ? { ...candidate, retainedSourceResponses } : candidate;
}

interface FactStage {
  readonly stage: string; readonly itemId: string; readonly recordId: string; readonly recordClass?: string;
  readonly source?: { readonly kind: string; readonly artifactId?: string; readonly parserResultId?: string; readonly factKey?: string };
  readonly subjectId?: string; readonly workerResultId?: string;
  readonly burdens?: readonly { readonly name: string; readonly result: string }[];
  readonly checks?: readonly { readonly result: string }[];
  readonly survived?: boolean;
  readonly readerMeeting?: unknown;
  readonly publicationDoor?: string;
  readonly chain?: { readonly scouted: string; readonly confirmed: string; readonly verified: string; readonly audited?: string };
}
interface WorkerWitness {
  readonly id: string; readonly endedAt: string; readonly inputResultIds: readonly string[]; readonly inputArtifactIds: readonly string[];
  readonly result: { readonly role: string; readonly verdict: string };
}

export function meetingResearchWitness(partition: MeetingPartitionContract, snapshot: MeetingsSnapshot,
  artifactIds: readonly string[], stages: readonly FactStage[], workers: readonly WorkerWitness[]): ResearchMeetingActivationReceipt | null {
  if (!snapshot.meetings.length || snapshot.meetings.some(meeting => meeting.carried) ||
      !["legistar", "civicclerk"].includes(partition.meetingSource)) return null;
  const byId = new Map(stages.map(stage => [stage.recordId, stage]));
    // An Events capture neither certifies nor deletes the adapter's separate actingBodies projection.
  const orderedFacts = (value: unknown): unknown => Array.isArray(value) ? value.map(orderedFacts)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) =>
      !["collectedAt", "verifiedAt", "actingBodies"].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, orderedFacts(child)])) : value;
  const civicFacts = (value: unknown): string => JSON.stringify(orderedFacts(value));
  for (const artifactId of artifactIds) {
    const facts = stages.filter(stage => stage.stage === "SCOUTED" && stage.source?.kind === "FLEET_EXTRACTION" &&
      stage.source.artifactId === artifactId && stage.subjectId === partition.bodyId);
    const approvals: FactStage[] = [];
    let parserId: string | null = null; let validatorId: string | null = null; let auditorId: string | null = null;
    for (const meeting of snapshot.meetings) {
      const expected = [`${meeting.id}@${meeting.startsAt}`, ...(meeting.agendaUrl ? [`${meeting.id}#agenda@`] : [])];
      for (const key of expected) {
        const fact = facts.find(row => key.endsWith("#agenda@") ? row.source!.factKey?.startsWith(key) : row.source!.factKey === key);
        const approval = fact && stages.find(row => row.stage === "APPROVED_FOR_PROMOTION" && row.itemId === fact.itemId && row.chain?.scouted === fact.recordId);
        if (!approval?.chain || approval.publicationDoor !== "PERMANENT_MEETING_PARTITION" ||
            stages.filter(stage => stage.itemId === fact!.itemId).at(-1)?.stage !== "APPROVED_FOR_PROMOTION" ||
            civicFacts(approval.readerMeeting) !== civicFacts(meeting) || !approval.burdens || approval.burdens.length !== 5 ||
            approval.burdens.some(burden => burden.result !== "PASS")) continue;
        const verified = byId.get(approval.chain.verified); const audited = approval.chain.audited ? byId.get(approval.chain.audited) : undefined;
        const confirmed = byId.get(approval.chain.confirmed);
        if (confirmed?.stage !== "CONFIRMED" || verified?.stage !== "VERIFIED" || audited?.stage !== "AUDITED" ||
            [confirmed, verified, audited].some(stage => stage.itemId !== fact!.itemId) ||
            !verified.checks?.length || verified.checks.some(check => check.result !== "PASS") || !audited.survived) continue;
        const parser = workers.find(worker => worker.id === fact!.source!.parserResultId);
        const validator = workers.find(worker => worker.id === verified.workerResultId);
        const auditor = workers.find(worker => worker.id === audited.workerResultId);
        const latest = workers.filter(worker => worker.result.role === "ADVERSARIAL_AUDITOR" && worker.inputArtifactIds.includes(artifactId))
          .sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0];
        if (parser?.result.role !== "PARSER" || parser.result.verdict !== "EXTRACTED" ||
            validator?.result.role !== "VALIDATOR" || validator.result.verdict !== "PASS" ||
            auditor?.result.role !== "ADVERSARIAL_AUDITOR" || auditor.result.verdict !== "SURVIVED" ||
            !validator.inputResultIds.includes(parser.id) || !auditor.inputResultIds.includes(validator.id) || latest?.id !== auditor.id ||
            workers.some(worker => worker.inputArtifactIds.includes(artifactId) && worker.result.role === "ADVERSARIAL_AUDITOR" && worker.result.verdict === "BROKE")) continue;
        parserId = parser.id; validatorId = validator.id; auditorId = auditor.id; approvals.push(approval);
      }
    }
    const expectedCount = snapshot.meetings.reduce((sum, meeting) => sum + 1 + Number(Boolean(meeting.agendaUrl)), 0);
    if (approvals.length === expectedCount && parserId && validatorId && auditorId) return {
      kind: RESEARCH_MEETING_ACTIVATION, partitionId: partition.id, artifactId,
      approvalRecordIds: approvals.map(approval => approval.recordId), parserResultId: parserId, validatorResultId: validatorId, auditorResultId: auditorId,
      evidenceScope: "CURRENT_CAPTURE_MEETING_FACTS", coveredMeetingIds: snapshot.meetings.map(meeting => meeting.id), approvedFactCount: expectedCount,
    };
  }
  return null;
}

export async function readMeetingResearchWitness(partition: MeetingPartitionContract, snapshot: MeetingsSnapshot): Promise<ResearchMeetingActivationReceipt | null> {
  const url = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!url || partition.meetingSource !== "legistar") return null;
  const hashes = snapshot.sources.filter(report => report.source === partition.meetingSource && report.ok)
    .flatMap(report => report.acquisitions ?? []).map(evidence => `sha256-${evidence.rawHash}`);
  if (!hashes.length) return null;
  const sql = neon(url);
  const artifacts = await sql.query("SELECT record AS value FROM cp_log_artifacts WHERE record->>'contentHash' = ANY($1::text[])", [hashes]) as { value: { artifactId: string; contentHash: string; byteLength: number; canonicalUrl: string } }[];
  const acquisitions = snapshot.sources.filter(report => report.ok && report.source === partition.meetingSource).flatMap(report => report.acquisitions ?? []);
  const artifactIds = artifacts.filter(row => acquisitions.some(evidence => evidence.finalUrl === row.value.canonicalUrl &&
    evidence.byteCount === row.value.byteLength && `sha256-${evidence.rawHash}` === row.value.contentHash)).map(row => row.value.artifactId);
  if (!artifactIds.length) return null;
  const stages = await sql.query("SELECT record AS value FROM cp_log_promotion_pipeline WHERE record->>'itemId' IN (SELECT record->>'itemId' FROM cp_log_promotion_pipeline WHERE record->>'stage' = 'SCOUTED' AND record->'source'->>'artifactId' = ANY($1::text[]) AND record->>'subjectId' = $2) ORDER BY position", [artifactIds, partition.bodyId]) as { value: FactStage }[];
  if (!stages.some(row => row.value.stage === "APPROVED_FOR_PROMOTION")) return null;
  const workers = await sql.query("SELECT w.record AS value FROM cp_log_worker_results w JOIN cp_attempts a ON a.id = w.record->>'attemptId' WHERE w.record->'inputArtifactIds' ?| $1::text[] AND a.value = w.record->'completion'->'closedAttempt' AND a.value->>'outcome' = 'COMPLETED'", [artifactIds]) as { value: WorkerWitness }[];
  return meetingResearchWitness(partition, snapshot, artifactIds, stages.map(row => row.value), workers.map(row => row.value));
}
