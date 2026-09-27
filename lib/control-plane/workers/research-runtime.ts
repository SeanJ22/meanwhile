import { performance } from "node:perf_hooks";
import { ZERO_COST, type WorkerRef } from "../attempt.ts";
import { defaultGrant, requireCapability } from "../capability.ts";
import { contentHash, fingerprint } from "../ids.ts";
import { putArtifact, type EvidenceStore } from "../evidence/store.ts";
import type { Artifact } from "../evidence/artifact.ts";
import type { RouteTask } from "../route-task.ts";
import { recordArtifactMetadata } from "../repository/coordinator.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";
import { readCompletedWorkerResult } from "../repository/worker-completion.ts";
import { buildScoutToolkit, realOpenBytes } from "../scheduler/scout-tools.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
import type { DeclaredExecutor } from "../scheduler/dispatch.ts";
import { RESEARCH_BOUNDS } from "../scheduler/research-policy.ts";
import type { ScheduledObligation } from "../scheduler/obligation.ts";
import { runAcquirer } from "./acquirer.ts";
import { runDetective } from "./detective.ts";
import { runEngineeringWorker } from "./engineering.ts";
import { researchLearningEntries } from "./field-manual-learnings.ts";
import { writeFieldManualDiscoveries } from "../scheduler/field-manual-scout.ts";
import { researchVaultResolver } from "./vault-object.ts";
import { assertFleetResult, type FleetResult, type WorkerUsage } from "./types.ts";
import { evidenceProjection, FLEET_POLICY_VERSION, type FleetRuntime } from "./runtime.ts";

const NULL_USAGE: WorkerUsage = {inputTokens:null,outputTokens:null,cacheReadInputTokens:null,cacheCreationInputTokens:null,uncachedInputTokens:null};
export const RESEARCH_WORKER_VERSION = "autonomous-research-workers/1.0.0";
export interface ResearchRuntimeTools {
  readonly repos: ControlPlaneRepositories;
  readonly store: EvidenceStore;
  readonly spaceOut: ScoutToolContext["spaceOut"];
  readonly browse?: ScoutToolContext["browse"];
  readonly openBytes?: ScoutToolContext["openBytes"];
  readonly now: () => string;
}

export function scheduledWorkerObligation(task: RouteTask): ScheduledObligation {
  const spec = task.workerTask;
  if (!spec) throw new Error("WORKER_TASK_MISSING");
  return {obligation:{id:task.id,recordClass:spec.contract.recordClass,subjectId:spec.contract.subjectId,routeId:task.routeId,
    active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null},nextDueAt:task.createdAt,cadenceHours:24,
    cadenceSource:"DEFAULT_NO_SIGNAL",basis:"Persisted bounded worker computation remains owed until committed."};
}

/** Vault AND append attribution on each tool write, before the disposable process can disappear. */
export function durableResearchTools(input: ResearchRuntimeTools, binding: {
  project: string; attemptId: string; workItemId: string; routeTaskId: string;
}) {
  const putBytes = async (artifact: Artifact, bytes: Uint8Array) => {
    if (artifact.attemptId !== binding.attemptId || artifact.workItemId !== binding.workItemId) throw new Error("RESEARCH_VAULT_ATTEMPT_BINDING_REFUSED");
    const {key,written} = await putArtifact(input.store, binding.project, artifact, bytes);
    await recordArtifactMetadata(input.repos, {artifactId:artifact.id,attemptId:artifact.attemptId,workItemId:artifact.workItemId,
      routeTaskId:binding.routeTaskId,tier:artifact.tier,contentHash:artifact.contentHash,byteLength:artifact.byteLength,
      contentType:artifact.contentType,canonicalUrl:artifact.canonicalUrl,partial:artifact.httpStatus === 206 || artifact.extraction?.complete === false,recordedAt:artifact.retrievedAt},input.now());
    return {stored:true,where:key,why:written?"Vaulted and durably attributed before interpretation":"Identical evidence retained; first observation attribution preserved"};
  };
  return {vault:async (artifact:Artifact,body:string) => putBytes(artifact,Buffer.from(body,"utf8")),vaultBytes:putBytes,
    spaceOut:input.spaceOut,...(input.browse?{browse:input.browse}:{}),...(input.openBytes?{openBytes:input.openBytes}:{})};
}

export function researchRoleExecutor(runtime: FleetRuntime, tools: ResearchRuntimeTools, task: RouteTask, holder: string): DeclaredExecutor {
  const spec = task.workerTask;
  if (!spec || !["ACQUIRER","DETECTIVE","ENGINEERING"].includes(spec.role)) throw new Error("RESEARCH_ROLE_SPEC_MISSING");
  const worker: WorkerRef = {role:spec.role,provider:"we-the-people",version:RESEARCH_WORKER_VERSION,instance:holder};
  return {lane:"DETERMINISTIC",workerFor:()=>worker,run:async ({attemptId,workItemId,routeTaskId,bound}) => {
    const started = performance.now();
    const deadline = Date.now() + bound.maxWallMs;
    const item = (await tools.repos.workItems.mustRead(workItemId)).value;
    const attempt = await tools.repos.attempts.mustRead(attemptId);
    const baseGrant = defaultGrant({role:spec.role,project:item.project,policyVersion:FLEET_POLICY_VERSION,grantedAt:attempt.value.startedAt});
    const grant = {...baseGrant, capabilities:spec.role === "ACQUIRER" ? baseGrant.capabilities : ["VAULT_READ_SANITIZED" as const]};
    await tools.repos.attempts.compareAndSet(attemptId,attempt.revision,{...attempt.value,capabilityGrant:grant},tools.now());
    let result: FleetResult;
    let requestCount = 0;
    let bytesFetched = 0;
    let measuredToolkit: ReturnType<typeof buildScoutToolkit> | undefined;
    try {
      requireCapability(grant,"VAULT_READ_SANITIZED");
      if (spec.role === "ACQUIRER") {
        if (!spec.acquisition || spec.acquisition.route.subjectId !== item.subject) throw new Error("ACQUIRER_TASK_BINDING_REFUSED");
        const toolkit = buildScoutToolkit({obligation:scheduledWorkerObligation(task),route:null,providerId:null,attemptId,workItemId,routeTaskId,
          holder,bound:{...RESEARCH_BOUNDS.perDispatch,maxWallMs:Math.min(bound.maxWallMs,RESEARCH_BOUNDS.perDispatch.maxWallMs)},now:tools.now,
          inherited:{artifactIds:[],summary:"Grounded acquisition through the existing toolkit."},...durableResearchTools(tools,{project:item.project,attemptId,workItemId,routeTaskId}),
          openBytes: async request => {
            const remaining = deadline-Date.now();
            if (remaining <= 0) return {status:null,bytes:new Uint8Array(),contentType:"",finalUrl:null,durationMs:0,transportError:"ACQUIRER_WALL_BOUND_EXCEEDED"};
            return (tools.openBytes??realOpenBytes)({...request,timeoutMs:Math.min(request.timeoutMs,remaining)});
          }});
        measuredToolkit = toolkit;
        result = await runAcquirer({...spec.acquisition,attemptId,worker,project:item.project,workItemId,grant,now:tools.now},
          {toolkit,readVault:researchVaultResolver(tools.repos,tools.store,item.project)});
        requestCount = toolkit.requestCount; bytesFetched = toolkit.bytesFetched;
      } else if (spec.role === "DETECTIVE") {
        if (!spec.detective || spec.detective.question.subjectId !== item.subject) throw new Error("DETECTIVE_TASK_BINDING_REFUSED");
        result = runDetective({...spec.detective,attemptId,worker,project:item.project,grant,now:tools.now(),
          evidence:await Promise.all(spec.detective.artifactIds.map(async id => evidenceProjection(await runtime.readEvidence(id))))});
      } else {
        if (!spec.engineering) throw new Error("ENGINEERING_TASK_SPEC_MISSING");
        const validation = await readCompletedWorkerResult(tools.repos,spec.engineering.validation.resultId);
        if (validation.attempt.id !== spec.engineering.validation.attemptId || validation.record.result.role !== "VALIDATOR" ||
          validation.record.result.verdict !== spec.engineering.validation.verdict ||
          !(validation.record.result.verdict === "PASS" || (validation.record.result.verdict === "INCONCLUSIVE" && validation.record.result.extractionVerdict === "PASS")) ||
          !spec.engineering.supportingArtifactIds.every(id => validation.record.inputArtifactIds.includes(id))) throw new Error("ENGINEERING_VALIDATED_METHOD_BINDING_REFUSED");
        result = await runEngineeringWorker({spec:spec.engineering,attemptId,worker,grant,
          methodEvidence:evidenceProjection(await runtime.readEvidence(spec.engineering.methodArtifactId)),
          supportingEvidence:await Promise.all(spec.engineering.supportingArtifactIds.map(async id => evidenceProjection(await runtime.readEvidence(id))))});
      }
      assertFleetResult(result,spec.role,attemptId);
      // Redirect what a detective or engineer just LEARNED into the one growing field manual, live —
      // the write-with-no-read gap the scouts had, now closed one role up (owner directive 2026-09-19).
      // A write-back never fails a worker whose result already stands.
      try {
        const learnings = researchLearningEntries(result, tools.now());
        if (learnings.length > 0) await writeFieldManualDiscoveries(tools.repos, learnings, tools.now());
      } catch { /* field-manual write-back is best-effort; the worker result is authoritative */ }
      const cost = {...ZERO_COST,durationMs:Math.round(performance.now()-started),requestCount,bytesFetched};
      const ids = result.artifactIds;
      return {kind:"RESULT_RECORDED",ranAs:"DETERMINISTIC",cost,detail:`${spec.role} ${result.verdict}; research result only; promotion OFF`,
        workerResult:{id:`wr-${fingerprint([attemptId])}`,schemaVersion:1,workItemId,routeTaskId,attemptId,worker,grant,methodVersion:attempt.value.methodVersion,
          policyVersion:attempt.value.policyVersion,startedAt:attempt.value.startedAt,endedAt:tools.now(),executionMode:"DETERMINISTIC",cost,usage:NULL_USAGE,
          inputArtifactIds:ids,inputResultIds:spec.engineering?[spec.engineering.validation.resultId]:[],semanticHash:contentHash(canonicalJson(result)),result}};
    } catch (error) {
      return {kind:"ABORTED",ranAs:"DETERMINISTIC",endedAt:tools.now(),detail:error instanceof Error?error.message:"RESEARCH_WORKER_FAILED",
        cost:{...ZERO_COST,durationMs:Math.round(performance.now()-started),requestCount:measuredToolkit?.requestCount??requestCount,bytesFetched:measuredToolkit?.bytesFetched??bytesFetched}};
    }
  }};
}
