import { durableResearchTools, type ResearchRuntimeTools } from "./durable-research-tools.ts";
export { durableResearchTools, type ResearchRuntimeTools } from "./durable-research-tools.ts";
import { readSourceReliability } from "../scheduler/scout-reliability.ts";
import { readFieldManual, writeFieldManual, newFieldManualEntry } from "../field-manual.ts";
import { performance } from "node:perf_hooks";
import { ZERO_COST, type WorkerRef } from "../attempt.ts";
import { defaultGrant, requireCapability } from "../capability.ts";
import { contentHash, fingerprint } from "../ids.ts";
import type { RouteTask } from "../route-task.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";
import { readCompletedWorkerResult } from "../repository/worker-completion.ts";
import { buildScoutToolkit, realOpenBytes } from "../scheduler/scout-tools.ts";
import type { DeclaredExecutor } from "../scheduler/dispatch.ts";
import { RESEARCH_BOUNDS } from "../scheduler/research-policy.ts";
import type { ScheduledObligation } from "../scheduler/obligation.ts";
import { runAcquirer } from "./acquirer.ts";
import { runEngineeringWorker } from "./engineering.ts";
import { researchLearningEntries } from "./field-manual-learnings.ts";
import { researchVaultResolver } from "./vault-object.ts";
import { assertFleetResult, type FleetResult, type WorkerUsage } from "./types.ts";
import { evidenceProjection, FLEET_POLICY_VERSION, type FleetRuntime } from "./runtime.ts";
import type { PlanRepairLink } from "./plan-repair.ts";

const NULL_USAGE: WorkerUsage = {inputTokens:null,outputTokens:null,cacheReadInputTokens:null,cacheCreationInputTokens:null,uncachedInputTokens:null};
export const RESEARCH_WORKER_VERSION = "autonomous-research-workers/1.0.0";
/** A child may reuse bytes only from an actual linked ancestor that acquired
 * them in a completed Attempt. Declared origin IDs are never authority. */
export async function authorizeInheritedHeldArtifact(repos: ControlPlaneRepositories, input: {
  readonly artifactId: string; readonly originWorkItemId: string;
  readonly childWorkItemId: string; readonly project: string;
}, siblingRootFor?: (input:{readonly artifactId:string;readonly originWorkItemId:string;
  readonly childWorkItemId:string;readonly project:string})=>string|null): Promise<boolean> {
  if (input.originWorkItemId === input.childWorkItemId) return false;
  const linkedRoot = siblingRootFor?.(input) ?? null;
  const linkedAncestorId = linkedRoot ?? input.originWorkItemId;
  const child = (await repos.workItems.read(input.childWorkItemId))?.value;
  if (!child || child.project !== input.project) return false;
  const seen = new Set<string>();
  let cursor = child;
  while (cursor.id !== linkedAncestorId) {
    if (seen.has(cursor.id)) return false;
    seen.add(cursor.id);
    const link = (cursor as typeof cursor & { readonly planRepair?: PlanRepairLink }).planRepair;
    if (!link || link.authority !== "WORK_INSTRUCTIONS_ONLY" || !link.parentWorkItemId ||
      !Number.isSafeInteger(link.depth) || link.depth < 1) return false;
    const parent = (await repos.workItems.read(link.parentWorkItemId))?.value;
    if (!parent || parent.project !== child.project || parent.subject !== child.subject) return false;
    const parentLink = (parent as typeof parent & { readonly planRepair?: PlanRepairLink }).planRepair;
    if (link.depth !== (parentLink?.depth ?? 0) + 1 ||
      link.rootWorkItemId !== (parentLink?.rootWorkItemId ?? parent.id)) return false;
    cursor = parent;
  }
  const origin = (await repos.workItems.read(input.originWorkItemId))?.value;
  if (!origin || origin.project !== child.project || origin.subject !== child.subject) return false;
  const records = (await repos.artifacts.read(input.originWorkItemId)).filter(record => record.artifactId === input.artifactId &&
    record.workItemId === input.originWorkItemId && !record.partial);
  for (const record of records) {
    const attempt = (await repos.attempts.read(record.attemptId))?.value;
    if (attempt?.workItemId === input.originWorkItemId && attempt.outcome === "COMPLETED") return true;
  }
  return false;
}
export function scheduledWorkerObligation(task: RouteTask): ScheduledObligation {
  const spec = task.workerTask;
  if (!spec) throw new Error("WORKER_TASK_MISSING");
  return {obligation:{id:task.id,recordClass:spec.contract.recordClass,subjectId:spec.contract.subjectId,routeId:task.routeId,
    active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null},nextDueAt:task.createdAt,cadenceHours:24,
    cadenceSource:"DEFAULT_NO_SIGNAL",basis:"Persisted bounded worker computation remains owed until committed."};
}

export function researchRoleExecutor(runtime: FleetRuntime, tools: ResearchRuntimeTools, task: RouteTask, holder: string, root = process.cwd()): DeclaredExecutor {
  const spec = task.workerTask;
  if (!spec || !["ACQUIRER","ENGINEERING"].includes(spec.role)) throw new Error("RESEARCH_ROLE_SPEC_MISSING");
  const worker: WorkerRef = {role:spec.role,provider:"we-the-people",version:RESEARCH_WORKER_VERSION,instance:holder};
  return {lane:"DETERMINISTIC",workerFor:()=>worker,run:async ({attemptId,workItemId,routeTaskId,bound}) => {
    const started = performance.now();
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
      const learned = await readFieldManual(tools.repos, {role:spec.role === "ENGINEERING" ? "ENGINEER" : spec.role as "ACQUIRER" | "DETECTIVE", recordClass:spec.contract.recordClass});
      if (spec.role === "ACQUIRER") {
        if (!spec.acquisition || spec.acquisition.route.subjectId !== item.subject) throw new Error("ACQUIRER_TASK_BINDING_REFUSED");
        const scheduled = scheduledWorkerObligation(task);
        const toolkit = buildScoutToolkit({root,obligation:{...scheduled,obligation:{...scheduled.obligation,autonomousPlan:item.autonomousPlan}},route:null,providerId:null,attemptId,workItemId,routeTaskId,
          holder,bound:RESEARCH_BOUNDS.perDispatch,now:tools.now,
          inherited:{artifactIds:[],summary:learned.projection.lines.join("\n"),manualEntries:learned.store.entries},...durableResearchTools(tools,{project:item.project,attemptId,workItemId,routeTaskId}),
          openBytes: async request => {
            return (tools.openBytesFor?.(item.subject)??tools.openBytes??realOpenBytes)(request);
          }});
        measuredToolkit = toolkit;
        result = await runAcquirer({...spec.acquisition,attemptId,worker,project:item.project,workItemId,grant,now:tools.now},
          {toolkit,sourceReliability:await readSourceReliability(tools.repos),readVault:researchVaultResolver(tools.repos,tools.store,item.project),
            authorizeInheritedHeld: inherited => authorizeInheritedHeldArtifact(tools.repos,inherited,tools.siblingHeldRootFor)});
        requestCount = toolkit.requestCount; bytesFetched = toolkit.bytesFetched;
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
        const learnings = [...researchLearningEntries(result, tools.now())];
        if (result.role === "ACQUIRER") learnings.push(newFieldManualEntry("acquirer",result.source.url,{
          role:"SHARED",kind:"SOURCE_RELIABILITY",title:result.source.publisher,
          summary:result.verdict+": "+result.blockers.map(b=>b.description).join("; "),
          outcome:result.verdict === "ACQUIRED"?"YIELDED":"FAILED",url:result.source.url,
          observedAt:tools.now(),recordClasses:[result.source.recordClass],payload:{source:result.source,verdict:result.verdict,walk:result.walk}}));
        if (learnings.length > 0) await writeFieldManual(tools.repos, learnings, tools.now());
      } catch { /* field-manual write-back is best-effort; the worker result is authoritative */ }
      const cost = {...ZERO_COST,durationMs:Math.round(performance.now()-started),requestCount,bytesFetched};
      const ids = result.artifactIds;
      return {kind:"RESULT_RECORDED",ranAs:"DETERMINISTIC",cost,detail:`${spec.role} ${result.verdict}; research result recorded; publication requires independent promotion and reader verification`,
        workerResult:{id:`wr-${fingerprint([attemptId])}`,schemaVersion:1,workItemId,routeTaskId,attemptId,worker,grant,methodVersion:attempt.value.methodVersion,
          policyVersion:attempt.value.policyVersion,startedAt:attempt.value.startedAt,endedAt:tools.now(),executionMode:"DETERMINISTIC",cost,usage:NULL_USAGE,
          inputArtifactIds:ids,inputResultIds:spec.engineering?[spec.engineering.validation.resultId]:[],semanticHash:contentHash(canonicalJson(result)),result}};
    } catch (error) {
      return {kind:"ABORTED",ranAs:"DETERMINISTIC",endedAt:tools.now(),detail:error instanceof Error?error.message:"RESEARCH_WORKER_FAILED",
        cost:{...ZERO_COST,durationMs:Math.round(performance.now()-started),requestCount:measuredToolkit?.requestCount??requestCount,bytesFetched:measuredToolkit?.bytesFetched??bytesFetched}};
    }
  }};
}
