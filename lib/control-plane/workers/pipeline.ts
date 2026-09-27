import { appendTransition, contextFromRepositories, readPipelineStates, scoutedFromScoutResult } from "../promotion/pipeline.ts";
import { PROMOTION_PIPELINE_FORMAT_VERSION, VERIFICATION_CHECKS, type TransitionRecord } from "../promotion/types.ts";
import { projectFactChains, type FactChainOptions, type FactChainReport } from "../promotion/fact-chain.ts";
import { meetingFactContract } from "../promotion/meeting-facts.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { refreshRegistryRuntimeFromPromoted } from "../../registry/runtime-read-model.ts";
import { refreshVenueResolutionsFromPromoted } from "../../civic-data/curated-reader-read-model.ts";
import { mayUseTestFixture } from "../../civic-data/fixture-policy.ts";
import { isWorkerReaderContract } from "../../civic-data/worker-reader-contracts.ts";

/**
 * PRDY-3 (2026-09-06): a completed extraction under a meeting-fact contract
 * (LEGISTAR_EVENTS, CIVICCLERK_EVENTS) is projected as FACTS through
 * `projectFactChains`, where every check is measured and the audit controls
 * are scored, when the caller can re-read immutable bytes from the vault.
 * Every other result keeps the honest generic offer below: three checks
 * NOT_IMPLEMENTED and controls NOT MEASURED, which refuse.
 */
export type FleetPipelineOptions = Pick<FactChainOptions, "readArtifactText" | "now" | "root" | "registryBodyIds" | "wiring" | "freshness">;

/** Offer exact worker outputs through the existing gated pipeline; missing confirmation remains a durable refusal. */
export async function projectFleetPipeline(repos: ControlPlaneRepositories, options?: FleetPipelineOptions): Promise<FactChainReport | null> {
  if (options && !options.registryBodyIds) await refreshRegistryRuntimeFromPromoted();
  // Fact normalization consumes the promoted venue authority synchronously.
  // Refuse a missing/unreachable production pointer before offering any facts.
  if (options && !mayUseTestFixture()) await refreshVenueResolutionsFromPromoted();
  const results = await readCompletedWorkerResults(repos);
  if (!results.length) return null;
  const ctx = await contextFromRepositories(repos);
  for (const scout of await repos.scoutResults.readAll()) {
    for (const offered of scoutedFromScoutResult(scout)) {
      if (results.some(r => r.inputArtifactIds.some(id => offered.artifactIds.includes(id)))) await appendTransition(repos, offered, ctx, offered.at);
    }
  }
  const factPath = options !== undefined;
  const states = await readPipelineStates(repos);
  const registryWork = new Set((await repos.workItems.list()).filter(row => {
    const id = row.value.autonomousPlan?.publication?.contractId;
    return id === "registry-runtime-bindings" || (id !== undefined && isWorkerReaderContract(id));
  }).map(row => row.id));
  for (const result of results) {
    if (result.result.role !== "VALIDATOR" && result.result.role !== "ADVERSARIAL_AUDITOR") continue;
    if (factPath && meetingFactContract(result) !== null) continue;
    // This class has an existing typed publication door. Its actual source,
    // identity, negative controls and reader checks are run there; a generic
    // NOT_IMPLEMENTED offer is neither that door's approval nor its refusal.
    // Keep historical generic refusals intact.
    if (registryWork.has(result.workItemId)) continue;
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
  return factPath ? projectFactChains(repos, options) : null;
}
