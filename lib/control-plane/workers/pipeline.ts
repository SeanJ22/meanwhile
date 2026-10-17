import { appendTransition, readPipelineStates, scoutedFromScoutResult } from "../promotion/pipeline.ts";
import { PROMOTION_PIPELINE_FORMAT_VERSION, VERIFICATION_CHECKS, type TransitionRecord, type VerificationCheckName } from "../promotion/types.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { isWorkerReaderContract } from "../../civic-data/worker-reader-contracts.ts";

export async function projectFleetPipeline(repos: ControlPlaneRepositories): Promise<void> {
  const results = await readCompletedWorkerResults(repos);
  if (!results.length) return;
  const ctx = {workerResultById:(id:string)=>results.find(result=>result.id===id)??null};
  for (const scout of await repos.scoutResults.readAll()) {
    for (const offered of scoutedFromScoutResult(scout)) {
      if (results.some(r => r.inputArtifactIds.some(id => offered.artifactIds.includes(id)))) await appendTransition(repos, offered, ctx, offered.at);
    }
  }
  const states = await readPipelineStates(repos);
  const registryWork = new Set<string>();
  for(const workItemId of new Set(results.filter(result=>result.result.role==="VALIDATOR").map(result=>result.workItemId))) {
    const row=await repos.workItems.readNarrowed(workItemId,{autonomousPlan:["publication"]});
    const value=row?.value as {autonomousPlan?:{publication?:{contractId?:string}}}|undefined;
    const id=value?.autonomousPlan?.publication?.contractId;
    if(id==="registry-runtime-bindings"||(id!==undefined&&isWorkerReaderContract(id)))registryWork.add(workItemId);
  }
  for (const result of results) {
    if (result.result.role !== "VALIDATOR") continue;

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
}
