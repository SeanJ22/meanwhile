import { randomUUID } from "node:crypto";
import type { RetainedSourceResponse, RetainedMeetingCandidate } from "../../civic-data/meeting-research-evidence.ts";
import { readRawCapture, rawCaptureVault } from "../../civic-data/raw-capture-vault.ts";
import { getDb } from "../../db/index.ts";
import { civicDataCandidates } from "../../db/schema.ts";
import { and, desc, eq, sql } from "drizzle-orm";
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
  const contract = registeredHeldMeetingContract(response.finalUrl, input.subjectId);
  if (!contract || response.source !== "legistar" || response.httpStatus < 200 || response.httpStatus >= 300) return null;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
  // Refuse HTML failures and empty feeds; retained bytes are evidence, not a guessed class.
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || typeof row !== "object" ||
      row.EventBodyId !== contract.sourceBodyId || row.EventBodyName !== contract.sourceBodyName)) return null;
  const now = (input.now ?? (() => new Date().toISOString()))();
  const item = createWorkItem({ project: "freshness", subject: contract.subjectId,
    obligation: "Independently verify the permanent meeting source capture for Reader publication",
    why: "The standing routine acquisition owns this source; retained bytes must reach parser, validator, auditor and the same production partition.",
    contract: { requiresValidation: true, requiresAudit: true }, now });
  if (!await repos.workItems.read(item.id)) await registerWorkItem(repos, item, now);
  const task = createRouteTask({ workItemId: item.id, routeId: `routine-meeting-capture:${input.candidateVersionId ?? response.retrievedAt}:${response.rawHash}`,
    routeLabel: "Actual permanent source acquisition receipt", target: response.requestedUrl, inherited: false, now });
  const prior = await repos.routeTasks.read(task.id);
  if (prior?.value.disposition != null) return null;
  // CLAIMED belongs to a live capture or to the lease sweep; POLICY_DENIED waits for its named change.
  if (prior && prior.value.state !== "PENDING" && prior.value.state !== "RECLAIMABLE") return null;
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
  readonly candidates?: readonly RetainedMeetingCandidate[]; readonly vault?: EvidenceStore;
}) {
  const vault = input.vault ?? rawCaptureVault();
  const partition = meetingPartitionForRow("legistar", PIMA_LEGISTAR_CONTRACT.subjectId);
  const candidates = input.candidates ?? (await getDb().select({ candidate: civicDataCandidates.candidate }).from(civicDataCandidates)
    .where(and(eq(civicDataCandidates.scope, partition.scope), eq(civicDataCandidates.recordClass, "MEETING"),
      sql`${civicDataCandidates.candidate} ? 'retainedSourceResponses'`))
    .orderBy(desc(civicDataCandidates.retrievedAt)).limit(2)).map(row => row.candidate as RetainedMeetingCandidate);
  const results = [];
  // One response's refusal does not keep another candidate's bytes from independent work; every refusal is still reported.
  const failures: string[] = [];
  for (const candidate of [...candidates].reverse()) {
    if (candidate.scope !== partition.scope || candidate.recordClass !== "MEETING") continue;
    for (const { raw, ...held } of candidate.retainedSourceResponses ?? []) {
      try {
        const response = { ...held, bytes: await readRawCapture(vault, raw) };
        const result = await retainRoutineMeetingForWorkers({ ...input, response, candidateVersionId: candidate.id, subjectId: partition.bodyId });
        if (result) results.push(result);
      } catch (error) {
        failures.push(`${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (failures.length) throw new Error(`${failures.join("; ")} (${results.length} other capture(s) retained)`);
  return results;
}
