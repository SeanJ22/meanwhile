import { randomUUID } from "node:crypto";
import type { RetainedSourceResponse, RetainedMeetingCandidate } from "../../civic-data/retained-meeting-bytes.ts";
import { factReader } from "../../facts/db.ts";
import type { Query } from "../../facts/publish.ts";
import { meetingPartitionForRow } from "../../civic-data/meeting-partitions.ts";
import { PIMA_LEGISTAR_CONTRACT } from "./held-meeting-contract.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { EvidenceStore } from "../evidence/store.ts";
import { putArtifact } from "../evidence/store.ts";
import { recordAcquisition } from "../evidence/artifact.ts";
import { createWorkItem } from "../work-item.ts";
import { createRouteTask } from "../route-task.ts";
import { abandonAttempt, beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../repository/coordinator.ts";
import { enqueueWorkerTask, FLEET_POLICY_VERSION } from "./runtime.ts";
import { registeredHeldMeetingContract } from "./held-meeting-contract.ts";
import { ZERO_COST } from "../attempt.ts";

const CAPTURE_OBLIGATION = "Independently verify the permanent meeting source capture for Reader publication";
type CaptureMetadata = Omit<RetainedSourceResponse, "bytes">;
interface CaptureHead { readonly candidateId: string; readonly ordinal: number; readonly response: CaptureMetadata }
function captureTask(response: CaptureMetadata, subjectId: string, candidateVersionId: string | undefined, now: string) {
  const contract = registeredHeldMeetingContract(response.finalUrl, subjectId);
  if (!contract || response.source !== "legistar" || response.httpStatus < 200 || response.httpStatus >= 300) return null;
  const item = createWorkItem({ project: "freshness", subject: contract.subjectId, obligation: CAPTURE_OBLIGATION,
    why: "The standing routine acquisition owns this source; retained bytes must reach parser, validator, auditor and the same production partition.",
    contract: { requiresValidation: true, requiresAudit: true }, now });
  const task = createRouteTask({ workItemId: item.id, routeId: `routine-meeting-capture:${candidateVersionId ?? response.retrievedAt}:${response.rawHash}`,
    routeLabel: "Actual permanent source acquisition receipt", target: response.requestedUrl, inherited: false, now });
  return { contract, item, task };
}

export const RECENT_ROUTINE_MEETING_CAPTURE_HEADS_SQL = `WITH recent AS MATERIALIZED (
  SELECT id,candidate,retrieved_at FROM civic_data_candidates WHERE scope=$1 AND record_class='MEETING'
    AND candidate ? 'retainedSourceResponses' ORDER BY retrieved_at DESC LIMIT 2
) SELECT c.id AS candidate_id,s.ordinal_index AS ordinal,reader_payload_value(h.value-'base64') AS response
  FROM recent c,LATERAL reader_payload_members(reader_payload_node(c.candidate)->'retainedSourceResponses') s,
    LATERAL (SELECT reader_payload_node(s.item) AS value) h ORDER BY c.retrieved_at,c.id,s.ordinal_index`;
export const ROUTINE_MEETING_CAPTURE_BYTES_SQL = `SELECT reader_payload_value(h.value->'base64') AS base64
  FROM civic_data_candidates c,LATERAL reader_payload_members(reader_payload_node(c.candidate)->'retainedSourceResponses') s,
    LATERAL (SELECT reader_payload_node(s.item) AS value) h WHERE c.id=$1 AND s.ordinal_index=$2
    AND h.value->>'rawHash'=$3 AND reader_payload_value(h.value->'requestedUrl')#>>'{}'=$4`;

/**
 * Retain an actual routine response for independent work. No acquisition is
 * scheduled here. One capture task per candidate response, settled once: the
 * same candidate (and task id) returns every pass. A byte-identical response at
 * a new URL settles as a re-observation of the held artifact (the feed's request
 * window changes its URL daily). A failure after the Attempt opens closes it
 * with the cause.
 */
export async function retainRoutineMeetingForWorkers(input: {
  readonly repos: ControlPlaneRepositories; readonly store: EvidenceStore;
  readonly response: RetainedSourceResponse; readonly subjectId: string; readonly methodVersion: number;
  readonly candidateVersionId?: string;
  readonly now?: () => string;
}) {
  const { repos, store, response } = input;
  const now = (input.now ?? (() => new Date().toISOString()))();
  const planned = captureTask(response, input.subjectId, input.candidateVersionId, now);
  if (!planned) return null;
  const { contract, item, task } = planned;
  const prior = await repos.routeTasks.read(task.id);
  if (prior?.value.disposition != null || prior && prior.value.state !== "PENDING" && prior.value.state !== "RECLAIMABLE") return null;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
  // Refuse HTML failures and empty feeds; retained bytes are evidence, not a guessed class.
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || typeof row !== "object" ||
      row.EventBodyId !== contract.sourceBodyId || row.EventBodyName !== contract.sourceBodyName)) return null;
  if (!await repos.workItems.read(item.id)) await registerWorkItem(repos, item, now);
  // CLAIMED belongs to a live capture or to the lease sweep; POLICY_DENIED waits for its named change.
  if (!prior) await registerRouteTask(repos, task, now);
  const holder = `routine-meeting-receipt:${randomUUID()}`;
  const claim = await claimRouteTask(repos, { routeTaskId: task.id, holder, now, ttlMs: 120_000 });
  const attempt = await beginAttemptFor(repos, { routeTaskId: task.id, workItemId: item.id, lease: claim.lease.value,
    worker: { role: "ACQUIRER", provider: "permanent-meeting-source", version: "routine-held-evidence/1", instance: holder },
    methodVersion: input.methodVersion, policyVersion: FLEET_POLICY_VERSION, now });
  let artifactId: string;
  try {
    const { artifact } = recordAcquisition({ canonicalUrl: response.finalUrl, retrievalUrl: response.requestedUrl,
      retrievedAt: response.retrievedAt, httpStatus: response.httpStatus, contentType: "application/json",
      sourceId: response.source, methodRouteId: task.routeId, workItemId: item.id, attemptId: attempt.id,
      permission: "ALLOWED", transport: "REACHABLE" }, text);
    if (artifact.contentHash !== `sha256-${response.rawHash}` || artifact.byteLength !== response.byteCount) throw new Error("ROUTINE_RESEARCH_CAPTURE_BYTE_MISMATCH");
    await putArtifact(store, item.project, artifact, response.bytes);
    const held = (await repos.artifacts.read(item.id)).find(record => record.artifactId === artifact.id) ?? null;
    // Same bytes, same classification, another URL: the content is held; this retrieval is a re-observation of it.
    const reobservation = held !== null && held.contentHash === artifact.contentHash && held.byteLength === artifact.byteLength &&
      held.tier === artifact.tier && !held.partial && held.canonicalUrl !== artifact.canonicalUrl ? held : null;
    if (!reobservation) {
      await recordArtifactMetadata(repos, { artifactId: artifact.id, workItemId: item.id, routeTaskId: task.id, attemptId: attempt.id,
        tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
        canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: response.retrievedAt }, now);
    }
    const copied = `Exact bytes copied from permanent candidate ${input.candidateVersionId ?? "recorded-test-capture"}, acquired ${response.retrievedAt}`;
    await disposeRouteTask(repos, { routeTaskId: task.id, attemptId: attempt.id,
      expectedTaskRevision: (await repos.routeTasks.mustRead(task.id)).revision, artifactIds: [artifact.id], now,
      cost: { ...ZERO_COST, usd: 0, inputTokens: 0, outputTokens: 0, requestCount: 0 },
      disposition: { disposition: "INGESTED", attemptId: attempt.id, at: now, artifactIds: [artifact.id], observation: null,
        permission: "ALLOWED", transport: "REACHABLE", note: reobservation
          ? `${copied} from ${artifact.canonicalUrl}. Byte-identical to artifact ${artifact.id}, first recorded ${reobservation.recordedAt} ` +
            `from ${reobservation.canonicalUrl}; the artifact log keeps that first observation. No extra HTTP request or model call occurred.`
          : `${copied}; no extra HTTP request or model call occurred.` } });
    artifactId = artifact.id;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    try {
      // A committed disposition is finished by reconcile(); closing its Attempt here would contradict it.
      const committed = (await repos.dispositions.read(task.id)).some(commit => commit.attemptId === attempt.id);
      if (!committed) {
        await abandonAttempt(repos, { routeTaskId: task.id, attemptId: attempt.id, outcome: "ABORTED", now,
          reason: `ROUTINE_MEETING_CAPTURE_FAILED: ${cause}`.slice(0, 2_000) });
      }
    } catch (closing) {
      throw new Error(`${cause}; the capture Attempt ${attempt.id} could not be closed: ${closing instanceof Error ? closing.message : String(closing)}`);
    }
    throw error;
  }
  const parser = await enqueueWorkerTask(repos, { workItemId: item.id, artifactId, contract, now, role: "PARSER" });
  return { workItemId: item.id, artifactId, parserTaskId: parser.id, attemptId: attempt.id };
}

/** Research consumes durable source candidates; routine children never import the control plane. */
export async function retainRecentRoutineMeetingEvidence(input: {
  readonly repos: ControlPlaneRepositories; readonly store: EvidenceStore; readonly methodVersion: number; readonly now?: () => string;
  readonly candidates?: readonly RetainedMeetingCandidate[];
  readonly query?: Query;
}) {
  const partition = meetingPartitionForRow("legistar", PIMA_LEGISTAR_CONTRACT.subjectId);
  const query = input.query ?? (input.candidates ? null : factReader());
  if (!input.candidates && !query) throw new Error("ROUTINE_MEETING_CAPTURE_READER_UNAVAILABLE");
  const heads: CaptureHead[] = input.candidates ? [...input.candidates].reverse().flatMap(candidate =>
    candidate.scope !== partition.scope || candidate.recordClass !== "MEETING" ? [] : (candidate.retainedSourceResponses ?? []).map(({base64:_base64,...response},ordinal) => ({candidateId:candidate.id,ordinal,response})))
    : (await query!(RECENT_ROUTINE_MEETING_CAPTURE_HEADS_SQL,[partition.scope])).map(row => ({candidateId:String(row.candidate_id),ordinal:Number(row.ordinal),response:row.response as CaptureMetadata}));
  const results = [];
  // One response's refusal does not keep another candidate's bytes from independent work; every refusal is still reported.
  const failures: string[] = [];
  for (const head of heads) {
    try {
      const planned = captureTask(head.response, partition.bodyId, head.candidateId, (input.now ?? (() => new Date().toISOString()))());
      if (!planned) continue;
      const prior = await input.repos.routeTasks.read(planned.task.id);
      if (prior?.value.disposition != null || prior && prior.value.state !== "PENDING" && prior.value.state !== "RECLAIMABLE") continue;
      const base64 = input.candidates ? input.candidates.find(candidate => candidate.id === head.candidateId)?.retainedSourceResponses?.[head.ordinal]?.base64
        : (await query!(ROUTINE_MEETING_CAPTURE_BYTES_SQL, [head.candidateId, head.ordinal, head.response.rawHash, head.response.requestedUrl]))[0]?.base64;
      if (typeof base64 !== "string") throw new Error("ROUTINE_MEETING_CAPTURE_BYTES_UNAVAILABLE");
      const response = { ...head.response, bytes: new Uint8Array(Buffer.from(base64, "base64")) };
      const result = await retainRoutineMeetingForWorkers({ ...input, response, candidateVersionId: head.candidateId, subjectId: partition.bodyId });
      if (result) results.push(result);
    } catch (error) {
      failures.push(`${head.candidateId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) throw new Error(`${failures.join("; ")} (${results.length} other capture(s) retained)`);
  return results;
}
