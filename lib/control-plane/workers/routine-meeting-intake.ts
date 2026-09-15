import { randomUUID } from "node:crypto";
import type { RetainedSourceResponse, RetainedMeetingCandidate } from "../../civic-data/meeting-research-evidence.ts";
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
import { beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../repository/coordinator.ts";
import { enqueueWorkerTask, FLEET_POLICY_VERSION } from "./runtime.ts";
import { registeredHeldMeetingContract } from "./held-meeting-contract.ts";
import { ZERO_COST } from "../attempt.ts";

/** Retain an actual routine response for independent work. No acquisition is scheduled here. */
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
  if (prior?.value.state === "DISPOSED") return null;
  await registerRouteTask(repos, task, now);
  const holder = `routine-meeting-receipt:${randomUUID()}`;
  const claim = await claimRouteTask(repos, { routeTaskId: task.id, holder, now, ttlMs: 120_000 });
  const attempt = await beginAttemptFor(repos, { routeTaskId: task.id, workItemId: item.id, lease: claim.lease.value,
    worker: { role: "ACQUIRER", provider: "permanent-meeting-source", version: "routine-held-evidence/1", instance: holder },
    methodVersion: input.methodVersion, policyVersion: FLEET_POLICY_VERSION, now });
  const { artifact } = recordAcquisition({ canonicalUrl: response.finalUrl, retrievalUrl: response.requestedUrl,
    retrievedAt: response.retrievedAt, httpStatus: response.httpStatus, contentType: "application/json",
    sourceId: response.source, methodRouteId: task.routeId, workItemId: item.id, attemptId: attempt.id,
    permission: "ALLOWED", transport: "REACHABLE" }, text);
  if (artifact.contentHash !== `sha256-${response.rawHash}` || artifact.byteLength !== response.byteCount) throw new Error("ROUTINE_RESEARCH_CAPTURE_BYTE_MISMATCH");
  await putArtifact(store, item.project, artifact, response.bytes);
  await recordArtifactMetadata(repos, { artifactId: artifact.id, workItemId: item.id, routeTaskId: task.id, attemptId: attempt.id,
    tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
    canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: response.retrievedAt }, now);
  await disposeRouteTask(repos, { routeTaskId: task.id, attemptId: attempt.id,
    expectedTaskRevision: (await repos.routeTasks.mustRead(task.id)).revision, artifactIds: [artifact.id], now,
    cost: { ...ZERO_COST, usd: 0, inputTokens: 0, outputTokens: 0, requestCount: 0 },
    disposition: { disposition: "INGESTED", attemptId: attempt.id, at: now, artifactIds: [artifact.id], observation: null,
      permission: "ALLOWED", transport: "REACHABLE", note: `Exact bytes copied from permanent candidate ${input.candidateVersionId ?? "recorded-test-capture"}, acquired ${response.retrievedAt}; no extra HTTP request or model call occurred.` } });
  const parser = await enqueueWorkerTask(repos, { workItemId: item.id, artifactId: artifact.id, contract, now, role: "PARSER" });
  return { workItemId: item.id, artifactId: artifact.id, parserTaskId: parser.id, attemptId: attempt.id };
}

/** Research consumes durable source candidates; routine children never import the control plane. */
export async function retainRecentRoutineMeetingEvidence(input: {
  readonly repos: ControlPlaneRepositories; readonly store: EvidenceStore; readonly methodVersion: number; readonly now?: () => string;
  readonly candidates?: readonly RetainedMeetingCandidate[];
}) {
  const partition = meetingPartitionForRow("legistar", PIMA_LEGISTAR_CONTRACT.subjectId);
  const candidates = input.candidates ?? (await getDb().select({ candidate: civicDataCandidates.candidate }).from(civicDataCandidates)
    .where(and(eq(civicDataCandidates.scope, partition.scope), eq(civicDataCandidates.recordClass, "MEETING"),
      sql`${civicDataCandidates.candidate} ? 'retainedSourceResponses'`))
    .orderBy(desc(civicDataCandidates.retrievedAt)).limit(2)).map(row => row.candidate as RetainedMeetingCandidate);
  const results = [];
  for (const candidate of [...candidates].reverse()) {
    if (candidate.scope !== partition.scope || candidate.recordClass !== "MEETING") continue;
    for (const held of candidate.retainedSourceResponses ?? []) {
      const response = { ...held, bytes: new Uint8Array(Buffer.from(held.base64, "base64")) };
      const result = await retainRoutineMeetingForWorkers({ ...input, response, candidateVersionId: candidate.id, subjectId: partition.bodyId });
      if (result) results.push(result);
    }
  }
  return results;
}
