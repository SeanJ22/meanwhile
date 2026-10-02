import { appendTransition, contextFromRepositories, readPipelineStates, scoutedFromScoutResult } from "../promotion/pipeline.ts";
import { PROMOTION_PIPELINE_FORMAT_VERSION, VERIFICATION_CHECKS, type TransitionRecord, type VerificationCheckName } from "../promotion/types.ts";
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
 * `projectFactChains`, where every check is measured, when the caller can
 * re-read immutable bytes from the vault. Every other Validator result is
 * offered as the §3 check it ran (docs/rulings.md §3): values on a saved
 * official page from the right place, inside the freshness window. No audit
 * stage is offered for these; §3 does not have one.
 */
export type FleetPipelineOptions = Pick<FactChainOptions, "readArtifactText" | "now" | "root" | "registryBodyIds" | "wiring" | "freshness">;

/** Offer exact worker outputs through the existing pipeline. */
export async function projectFleetPipeline(repos: ControlPlaneRepositories, options?: FleetPipelineOptions): Promise<FactChainReport | null> {
  const results = await readCompletedWorkerResults(repos);
  if (!results.length) return null;
  if (options && !options.registryBodyIds) await refreshRegistryRuntimeFromPromoted();
  // Fact normalization consumes the promoted venue authority synchronously.
  // Refuse a missing/unreachable production pointer before offering any facts.
  if (options && !mayUseTestFixture()) await refreshVenueResolutionsFromPromoted();
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
    if (result.result.role !== "VALIDATOR") continue;
    if (factPath && meetingFactContract(result) !== null) continue;
    // This class publishes through its typed reader door, which runs §3 itself.
    if (registryWork.has(result.workItemId)) continue;
    const state = states.find(s => s.byStage.SCOUTED?.artifactIds.some(id => result.inputArtifactIds.includes(id)));
    if (!state) continue;
    const base = { formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION as typeof PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${result.id}:pipeline:3`, itemId: state.itemId, at: result.endedAt,
      actor: { role: result.worker.role, lane: result.executionMode === "MODEL_ASSISTED" ? "BOUNDED_MODEL_WORKER" as const : "DETERMINISTIC" as const, instance: result.worker.instance }, workerResultId: result.id };
    const v = result.result;
    const pass = v.verdict === "PASS" && v.validatedRecordCount > 0;
    const detail: Record<VerificationCheckName, string> = {
      CLAIM_RESOLVES_TO_SOURCE_SPAN: `Validator ${result.id}: ${v.validatedRecordCount} record(s) with their values found on the saved page.`,
      CANONICAL_IDENTITY_UNIQUE: "Each record keeps its own source identity; one bad row holds only itself.",
      ASSERTION_CLASS_BURDENS: "§3: the page is official for this place and inside its freshness window.",
      NEUTRALITY_AND_RENDERING_SYMMETRY: "Not a judgment call under §3; the typed reader door renders it.",
      FALSE_ZERO: "Only records found on the page are offered; nothing is asserted absent.",
    };
    const offered: TransitionRecord = { ...base, stage: "VERIFIED", checks: VERIFICATION_CHECKS.map(name => ({ name, result: pass ? "PASS" as const : "FAIL" as const,
      detail: pass ? detail[name] : `Validator ${result.id} ${v.verdict}: ${v.findings.filter(f => f.severity !== "INFO").map(f => f.code).join(", ") || "no record met its minimum facts"}` })) };
    await appendTransition(repos, offered, ctx, result.endedAt);
  }
  return factPath ? projectFactChains(repos, options) : null;
}
