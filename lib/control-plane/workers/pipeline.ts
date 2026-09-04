import { appendTransition, contextFromRepositories, readPipelineStates, scoutedFromScoutResult } from "../promotion/pipeline.ts";
import { PROMOTION_PIPELINE_FORMAT_VERSION, VERIFICATION_CHECKS, type TransitionRecord } from "../promotion/types.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { readCompletedWorkerResult } from "../repository/worker-completion.ts";

/** Offer exact worker outputs through the existing gated pipeline; missing confirmation remains a durable refusal. */
export async function projectFleetPipeline(repos: ControlPlaneRepositories): Promise<void> {
  const results = await repos.workerResults.readAll();
  if (!results.length) return;
  const ctx = await contextFromRepositories(repos);
  for (const scout of await repos.scoutResults.readAll()) {
    for (const offered of scoutedFromScoutResult(scout)) {
      if (results.some(r => r.inputArtifactIds.some(id => offered.artifactIds.includes(id)))) await appendTransition(repos, offered, ctx, offered.at);
    }
  }
  const states = await readPipelineStates(repos);
  for (const result of results) {
    if (result.result.role === "PARSER") continue;
    await readCompletedWorkerResult(repos, result.id);
    const state = states.find(s => s.byStage.SCOUTED?.artifactIds.some(id => result.inputArtifactIds.includes(id)));
    if (!state) continue;
    const base = { formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION as typeof PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${result.id}:pipeline:2`, itemId: state.itemId, at: result.endedAt,
      actor: { role: result.worker.role, lane: result.executionMode === "MODEL_ASSISTED" ? "BOUNDED_MODEL_WORKER" as const : "DETERMINISTIC" as const, instance: result.worker.instance }, workerResultId: result.id };
    const offered: TransitionRecord = result.result.role === "VALIDATOR" ? { ...base, stage: "VERIFIED", checks: VERIFICATION_CHECKS.map(name => ({ name,
      result: ["CLAIM_RESOLVES_TO_SOURCE_SPAN", "CANONICAL_IDENTITY_UNIQUE"].includes(name)
        ? result.result.verdict === "PASS" ? "PASS" as const : "FAIL" as const : "NOT_IMPLEMENTED" as const,
      detail: ["CLAIM_RESOLVES_TO_SOURCE_SPAN", "CANONICAL_IDENTITY_UNIQUE"].includes(name) ? `Exact typed Validator result ${result.id}, scoped to its immutable capture.`
        : "Capture validation does not prove reader rendering, whole-source false-zero safety, or every reader assertion-class burden." })) }
      : { ...base, stage: "AUDITED", startedFrom: result.result.startedFrom, survived: result.result.verdict === "SURVIVED", controls: null,
        findings: [...result.result.findings.map(f => `${f.code}: ${f.detail}`), `${result.completion.completedTask.workerTask!.auditScope} audit. Runtime independent known-answer batch controls are NOT MEASURED; deterministic seeded gates are separate.`] };
    await appendTransition(repos, offered, ctx, result.endedAt);
  }
}
