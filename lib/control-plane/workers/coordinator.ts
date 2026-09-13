import { randomUUID } from "node:crypto";
import type { WorkItem } from "../work-item.ts";
import { ZERO_COST } from "../attempt.ts";
import { createRouteTask, type RouteTask } from "../route-task.ts";
import { canonicalJson, RepositoryLockHeld, type ControlPlaneRepositories } from "../repository/types.ts";
import { registerRouteTask } from "../repository/coordinator.ts";
import { dispatchOne, sweepExpiredLeases, type DeclaredExecutor, type DispatchResult } from "../scheduler/dispatch.ts";
import { ceilingPermits, researchSpendInWindow, RESEARCH_BOUNDS } from "../scheduler/research-policy.ts";
import { fingerprint } from "../ids.ts";
import { dispatchWorkerTask, enqueueWorkerTask, evidenceProjection, FLEET_POLICY_VERSION, WORKER_MAX_WALL_MS, reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { readCompletedWorkerResult } from "../repository/worker-completion.ts";
import { recordFailure, type FreshnessDebt } from "../scheduler/debt.ts";
import { scheduleAutonomousAcquisition, type AutonomousWorkPlan } from "./autonomous-plan.ts";
import { isScheduled } from "../scheduler/obligation.ts";
import type { AcquirerTaskSpec, ObservedResearchRoute, ResearchSpan } from "./research-types.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";

export interface AutonomousCoordinatorRuntime extends FleetRuntime {
  /** Existing Scout executor, configured with this canonical WorkItem and its inherited history. */
  readonly scoutFor?: (item: WorkItem, task: RouteTask, history?: readonly ScoutResult[]) => DeclaredExecutor;
}
export interface AutonomousDecision {
  readonly workItemId: string;
  readonly action: "SCOUT" | "WORKER" | "BLOCKED" | "STAGED";
  readonly task: RouteTask | null;
  readonly reason: string;
}

export async function registerAutonomousPlan(repos: ControlPlaneRepositories, workItemId: string, plan: AutonomousWorkPlan, now: string): Promise<void> {
  const item = await repos.workItems.mustRead(workItemId);
  if (plan.version !== 1 || plan.contract.subjectId !== item.value.subject || !plan.sourceRegistryReferences.length ||
    !plan.jurisdiction || !plan.capability || plan.acquisition.some(a => a.route.subjectId !== item.value.subject) ||
    plan.detective.some(d => d.question.subjectId !== item.value.subject)) throw new Error("AUTONOMOUS_PLAN_CANONICAL_IDENTITY_REFUSED");
  if (item.value.autonomousPlan) {
    if (canonicalJson(item.value.autonomousPlan) !== canonicalJson(plan)) throw new Error("AUTONOMOUS_PLAN_ALREADY_REGISTERED_DIFFERENT_CONTRACT");
    return;
  }
  await repos.workItems.compareAndSet(workItemId,item.revision,{...item.value,autonomousPlan:plan},now);
}

/** Candidate assertions are usable only after matching the accepted Scout's actual vaulted observation. */
async function scoutSources(runtime: FleetRuntime, item: WorkItem): Promise<ObservedResearchRoute[]> {
  const plan = item.autonomousPlan!;
  const out: ObservedResearchRoute[] = [];
  for (const scout of await runtime.repos.scoutResults.readAll()) {
    if (scout.workItemId !== item.id || scout.refusal !== null) continue;
    const attempt = (await runtime.repos.attempts.mustRead(scout.attemptId)).value;
    if (attempt.outcome !== "COMPLETED") continue;
    for (const candidate of scout.candidates) {
      for (const id of candidate.evidenceArtifactIds) {
        const evidence = evidenceProjection(await runtime.readEvidence(id));
        const start = evidence.text.indexOf(candidate.url);
        const direct = evidence.canonicalUrl === candidate.url;
        if (start < 0 && !direct) continue;
        const anchors=[...plan.seedUrls,...plan.sources.map(source=>source.url),...(plan.contract.schemaVersion===2?plan.contract.sourceScope.canonicalUrls:[])];
        const observedOrigin=new URL(evidence.canonicalUrl).origin;
        if(!anchors.some(anchor=>new URL(anchor).origin===observedOrigin)) continue;
        const spanStart = start >= 0 ? start : 0;
        const quote = start >= 0 ? candidate.url : evidence.text.slice(0,128);
        if (!quote) continue;
        const span: ResearchSpan = {artifactId:id,contentHash:evidence.contentHash,start:spanStart,end:spanStart+quote.length,quote,offsetUnit:"UTF16_CODE_UNITS"};
        const publisherQuote=evidence.text.slice(0,Math.min(evidence.text.length,512));
        const publisherSpan:ResearchSpan={artifactId:id,contentHash:evidence.contentHash,start:0,end:publisherQuote.length,quote:publisherQuote,offsetUnit:"UTF16_CODE_UNITS"};
        out.push({id:candidate.routeId,subjectId:item.subject,jurisdiction:plan.jurisdiction,recordClass:plan.contract.recordClass,
          sourceId:new URL(candidate.url).host,publisher:plan.contract.schemaVersion===2?plan.contract.sourceScope.publisher:observedOrigin,url:candidate.url,observedLocator:candidate.url,
          observedAt:evidence.retrievedAt,firstObservedAt:evidence.retrievedAt,methodVersion:runtime.methodVersion,permission:candidate.permission,
          observation:span,publisherSubjectEvidence:[publisherSpan],applicableBecause:candidate.relevance,nextRouteIds:scout.nextRungs,retrieval:"fetch_public"});
        break;
      }
    }
  }
  return out;
}

/** Typed state chooses one next operation. Absence is never inferred from an empty list. */
export async function nextAutonomousOperation(runtime: AutonomousCoordinatorRuntime, workItemId: string): Promise<AutonomousDecision> {
  const repos = runtime.repos;
  const item = (await repos.workItems.mustRead(workItemId)).value;
  const plan = item.autonomousPlan;
  const decision = (action:AutonomousDecision["action"],reason:string,task:RouteTask|null=null):AutonomousDecision => ({workItemId,action,reason,task});
  if (!plan) return decision("BLOCKED","No versioned autonomous work instructions are registered for this obligation.");
  const now = (runtime.now ?? (()=>new Date().toISOString()))();
  const records = [] as Awaited<ReturnType<typeof repos.workerResults.read>>[number][];
  for (const record of await repos.workerResults.read(item.id)) {
    try { records.push((await readCompletedWorkerResult(repos, record.id)).record); }
    catch { /* An uncommitted result never drives the next civic computation. */ }
  }
  records.sort((a,b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id));
  const attempts = (await repos.attempts.list()).map(a=>a.value);
  const taskFor = async (input:Parameters<typeof enqueueWorkerTask>[1]) => {
    let task = await enqueueWorkerTask(repos,input);
    const admission = workerTaskAdmission(task,attempts,now);
    if(admission.due && admission.requiresPolicyRecheck) {
      const authorized=await reauthorizeWorkerTask(runtime,task,now); if(!authorized)return null; task=authorized;
    }
    return admission.due ? decision("WORKER",admission.reason,task) : null;
  };
  const sources = [...plan.sources,...await scoutSources(runtime,item)];
  const acquisitions: AcquirerTaskSpec[] = [...plan.acquisition];
  for (const source of sources) if (!acquisitions.some(a=>a.route.id===source.id && a.route.url===source.url)) acquisitions.push({route:source,held:[]});
  const scoutOperation = async (novelty: boolean): Promise<AutonomousDecision> => {
    const signature = fingerprint([item.id,canonicalJson(plan.seedUrls),String(runtime.methodVersion)]);
    const baseRouteId=`autonomous:${novelty ? "novelty" : "scout"}:${signature}`;
    const scope = novelty
      ? "UNRESOLVED_INVESTIGATION: inherited computations have not settled the obligation. Walk remaining applicable methods, then investigate new public representations or methods; preserve the live obligation."
      : "Discover an observed authoritative public route";
    const created = createRouteTask({workItemId:item.id,routeId:baseRouteId,routeLabel:scope,
      target:plan.seedUrls.join(" "),inherited:false,now});
    const prior = await repos.routeTasks.read(created.id);
    let task = prior?.value ?? (await registerRouteTask(repos,created,now)).value;
    const family=new Set((await repos.routeTasks.list()).filter(row=>row.value.workItemId===item.id &&
      (row.value.routeId===baseRouteId || row.value.routeId.startsWith(`${baseRouteId}:continue:`))).map(row=>row.id));
    const history=attempts.filter(attempt=>family.has(attempt.routeTaskId)).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id));
    let debt:FreshnessDebt|null=null;
    for(const attempt of history) {
      // Completion of a bounded search is not completion of the still-unknown source obligation.
      if(attempt.endedAt) debt=recordFailure(debt,{obligationId:created.id,cause:attempt.outcome==="COMPLETED"?"EXTRACTION_FAILED":attempt.abortReason?.includes("COST_CEILING")?"RATE_LIMITED":"TRANSPORT_FAILED",detail:attempt.abortReason??"Scout completed without an accepted grounded source route",target:created.target,dueAt:task.createdAt,now:attempt.endedAt});
    }
    const scoutHistory=(await repos.scoutResults.readAll()).filter(result=>result.workItemId===item.id).sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)||a.attemptId.localeCompare(b.attemptId));
    let latest=history.filter(attempt=>attempt.routeTaskId===task.id).at(-1);
    while(task.state==="DISPOSED" && latest?.outcome==="COMPLETED") {
      const lastScout=scoutHistory.find(result=>result.attemptId===latest!.id);
      const continuation=createRouteTask({workItemId:item.id,routeId:`${baseRouteId}:continue:${latest.id}`,
        routeLabel:`${scope} Continue after ${latest.id}; next: ${lastScout?.nextRungs.join("; ") || "reassess the remaining authoritative source methods"}`,
        target:created.target,inherited:false,now});
      const existing=await repos.routeTasks.read(continuation.id);
      if(!existing && debt && Date.parse(debt.retryAt)>Date.parse(now)) return decision("BLOCKED",`Scout completed without settling the obligation; its next rungs remain owed after ${debt.retryAt}.`,task);
      task=existing?.value??(await registerRouteTask(repos,continuation,now)).value;
      latest=history.filter(attempt=>attempt.routeTaskId===task.id).at(-1);
    }
    if(task.state==="POLICY_DENIED" && latest?.outcome==="DENIED_BY_POLICY" && task.policyDenial && debt && Date.parse(debt.retryAt)<=Date.parse(now)) {
      const reason=latest.abortReason??"";
      const spend=researchSpendInWindow(await repos.costs.readAll(),now);
      const conditionChanged=reason.includes("SCOUT_MODEL_TRANSPORT_UNAVAILABLE")?Boolean(runtime.scoutFor):reason.includes("SCOUT_COST_CEILING")&&ceilingPermits(spend.windowUsd,RESEARCH_BOUNDS.dailyCeilingUsd).permits;
      if(conditionChanged) {
        const row=await repos.routeTasks.mustRead(task.id); const {policyDenial,...rest}=row.value;
        task=(await repos.routeTasks.compareAndSet(task.id,row.revision,{...rest,state:"RECLAIMABLE",policyReauthorizations:[...(task.policyReauthorizations??[]),{at:now,denial:policyDenial!,reason:"The named Scout transport or rolling-cost condition changed; current policy will be checked again."}]},now)).value;
      }
    }
    if (["PENDING","RECLAIMABLE"].includes(task.state) && (!debt||Date.parse(debt.retryAt)<=Date.parse(now))) return decision("SCOUT",scope,task);
    return decision("BLOCKED","Scout has no accepted grounded route; preserve its next rungs and retry state.",task);
  };
  if (!acquisitions.length) return scoutOperation(false);
  let staged = false;
  let unresolved = false;
  let outsideExtractionScope=false;
  // Acquire the declared supporting authorities before scheduling their dependent validation.
  for (const acquisition of acquisitions) {
    const history = records.filter(r => r.result.role === "ACQUIRER" && r.result.source.id === acquisition.route.id && r.result.source.url === acquisition.route.url);
    const latest = history[0];
    if (!latest) {
      const next = await taskFor({workItemId:item.id,contract:plan.contract,now,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,acquisition});
      if (next) return next;
      unresolved = true; continue;
    }
    if (latest.result.role !== "ACQUIRER") continue;
    if(latest.result.verdict==="ACQUIRED") {
      const schedule=scheduleAutonomousAcquisition(plan,latest.result,now);
      if(!isScheduled(schedule)) {unresolved=true;continue;}
      if(Date.parse(schedule.nextDueAt)<=Date.parse(now)) {
        // A publisher freshness check must not reuse an expired immutable capture.
        const next=await taskFor({workItemId:item.id,contract:plan.contract,now,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,
          acquisition:{...acquisition,held:[]},replayLabel:`refresh-after:${latest.id}`});
        if(next)return next;
        unresolved=true;
      }
      continue;
    }
    unresolved = true;
    if (latest.result.blockers.some(blocker => !blocker.retryable)) continue;
    let debt: FreshnessDebt | null = null;
    for (const failed of [...history].reverse()) {
      if (failed.result.verdict === "ACQUIRED") { debt = null; continue; }
      debt = recordFailure(debt,{obligationId:item.id,cause:"TRANSPORT_FAILED",detail:`ACQUIRER ${failed.result.verdict}`,target:acquisition.route.url,dueAt:failed.startedAt,now:failed.endedAt});
    }
    // An hourly runner must not spend every pass retrying the same failed URL
    // before the unresolved investigation ever gets a Scout turn.
    const scoutTriedAfterFailure = attempts.some(a => a.workItemId === item.id && a.worker.role === "SCOUT" && a.endedAt !== null && Date.parse(a.endedAt) >= Date.parse(latest.endedAt));
    if (debt && Date.parse(debt.retryAt) <= Date.parse(now) && scoutTriedAfterFailure) {
      const next = await taskFor({workItemId:item.id,contract:plan.contract,now,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,acquisition,replayLabel:`retry-after:${latest.id}`});
      if (next) return next;
    }
  }
  for (const acquisition of acquisitions) {
    const common = {workItemId:item.id,contract:plan.contract,now};
    // A failed refresh does not erase the last trustworthy capture. The source
    // loop above keeps its freshness/recovery obligation unresolved separately.
    const acquired = records.find(r=>r.result.role==="ACQUIRER" && r.result.verdict==="ACQUIRED" && r.result.source.id===acquisition.route.id && r.result.source.url===acquisition.route.url);
    if (!acquired) { const next = await taskFor({...common,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,acquisition}); if(next)return next; unresolved=true; continue; }
    if (acquired.result.role !== "ACQUIRER") continue;
    for (const artifact of acquired.result.artifacts.filter(a=>a.completeness==="COMPLETE")) {
      // Supporting/authority captures have their own instructions; never parse a diagnostic page as the primary class.
      if (plan.contract.schemaVersion===2 && !plan.contract.sourceScope.canonicalUrls.includes(artifact.canonicalUrl)) {
        if(!plan.contract.verification.authorities.some(authority=>authority.canonicalUrls.includes(artifact.canonicalUrl))) {outsideExtractionScope=true;unresolved=true;}
        continue;
      }
      const spec = {...common,artifactId:artifact.artifactId};
      const parserTask = await enqueueWorkerTask(repos,{...spec,role:"PARSER"});
      const parser = records.find(r=>r.routeTaskId===parserTask.id && r.result.role==="PARSER");
      if (!parser) { const next=await taskFor({...spec,role:"PARSER"}); if(next)return next; unresolved=true; continue; }
      if (parser.result.verdict!=="EXTRACTED") { unresolved=true; continue; }
      let identityUnresolved=false;
      for (const detective of plan.detective) {
        const detectiveSpec={...spec,artifactId:detective.artifactIds[0],role:"DETECTIVE" as const,detective};
        const detectiveTask=await enqueueWorkerTask(repos,detectiveSpec);
        const finding=records.find(r=>r.routeTaskId===detectiveTask.id);
        if (!finding) { const next=await taskFor(detectiveSpec); if(next)return next; identityUnresolved=true; }
        else if(finding.result.role!=="DETECTIVE" || finding.result.verdict!=="SUPPORTED" ||
          (detective.question.kind==="IDENTITY" && (finding.result.identity.state!=="CANDIDATE" || finding.result.identity.canonicalId!==plan.contract.subjectId))) identityUnresolved=true;
      }
      // Independent checking can diagnose held extraction while identity work
      // remains open. An unresolved Detective still prevents staging below.
      if(identityUnresolved) unresolved=true;
      if (plan.contract.schemaVersion===2) {
        const heldIds=new Set((await repos.artifacts.readAll()).map(artifact=>artifact.artifactId));
        if(plan.contract.verification.authorities.some(authority=>[...authority.artifactIds,...authority.authorityEvidenceArtifactIds].some(id=>!heldIds.has(id)))) { unresolved=true; continue; }
      }
      const validatorTask=await enqueueWorkerTask(repos,{...spec,role:"VALIDATOR",producerResultId:parser.id});
      const validator=records.find(r=>r.routeTaskId===validatorTask.id && r.result.role==="VALIDATOR");
      if (!validator) { const next=await taskFor({...spec,role:"VALIDATOR",producerResultId:parser.id}); if(next)return next; unresolved=true; continue; }
      if (validator.result.role!=="VALIDATOR" || (validator.result.verdict!=="PASS" && validator.result.extractionVerdict!=="PASS")) { unresolved=true; continue; }
      const auditTask=await enqueueWorkerTask(repos,{...spec,role:"ADVERSARIAL_AUDITOR",producerResultId:parser.id,validatorResultId:validator.id,auditScope:plan.auditScope});
      if (!records.some(r=>r.routeTaskId===auditTask.id)) { const next=await taskFor({...spec,role:"ADVERSARIAL_AUDITOR",producerResultId:parser.id,validatorResultId:validator.id,auditScope:plan.auditScope}); if(next)return next; unresolved=true; }
      else {
        const audit=records.find(r=>r.routeTaskId===auditTask.id);
        if (!identityUnresolved && validator.result.verdict==="PASS" && audit?.result.role==="ADVERSARIAL_AUDITOR" && audit.result.verdict==="SURVIVED") staged=true;
        else unresolved=true;
      }
    }
  }
  for (const detective of plan.detective) {
    const next=await taskFor({workItemId:item.id,contract:plan.contract,now,role:"DETECTIVE",artifactId:detective.artifactIds[0],detective});
    if(next)return next;
  }
  for (const engineering of plan.engineering) {
    const next=await taskFor({workItemId:item.id,contract:plan.contract,now,role:"ENGINEERING",artifactId:engineering.methodArtifactId,engineering});
    if(next)return next;
  }
  if (staged && !unresolved) return decision("STAGED","Scoped reviewed results are retained. Reader/Ask and promotion gates remain independent.");
  const novelty = await scoutOperation(true);
  return outsideExtractionScope ? {...novelty,reason:`EXTRACTION_SCOPE_UNESTABLISHED: the acquired representation needs a compatible extraction contract. ${novelty.reason}`} : novelty;
}

/** Independent obligations run concurrently; leases provide process-independent ownership. */
export async function runAutonomousCoordinator(runtime: AutonomousCoordinatorRuntime, options:{
  maximum?:number; concurrency?:number; deadlineMs?:number; maxScoutDispatches?:number;
  admitDispatch?:(work:string)=>{admit:true}|{admit:false;code:string;why:string};
}={}) {
  const now = runtime.now ?? (()=>new Date().toISOString());
  const recovery=await sweepExpiredLeases(runtime.repos,{now:now(),observedBy:"autonomous-coordinator"});
  const items=(await runtime.repos.workItems.list()).filter(i=>i.value.autonomousPlan);
  // Repository id order is stable, not fair. Reconstruct service order from
  // canonical Attempts each cycle; no cursor or parallel task ledger is needed.
  const lastServed=new Map<string,string>();
  for (const {value:attempt} of await runtime.repos.attempts.list()) {
    if (attempt.startedAt>(lastServed.get(attempt.workItemId)??"")) lastServed.set(attempt.workItemId,attempt.startedAt);
  }
  const ids=items.sort((a,b)=>(lastServed.get(a.id)??"").localeCompare(lastServed.get(b.id)??"") ||
    a.value.createdAt.localeCompare(b.value.createdAt) || a.id.localeCompare(b.id)).map(i=>i.id);
  const decisions:AutonomousDecision[]=[]; const dispatches:DispatchResult[]=[];
  const deferred:{workItemId:string;reason:string;detail:string}[]=[];
  const maximum=Math.min(options.maximum??3,20); const concurrency=Math.min(options.concurrency??2,2);
  const maxScoutDispatches=Math.min(options.maxScoutDispatches??RESEARCH_BOUNDS.maxScoutDispatchesPerCycle,RESEARCH_BOUNDS.maxScoutDispatchesPerCycle);
  if (!Number.isSafeInteger(maximum)||maximum<0||!Number.isSafeInteger(concurrency)||concurrency<1||!Number.isSafeInteger(maxScoutDispatches)||maxScoutDispatches<0) throw new Error("AUTONOMOUS_COORDINATOR_BOUND_INVALID");
  const minimumDispatchWallMs=Math.min(WORKER_MAX_WALL_MS,RESEARCH_BOUNDS.perDispatch.maxWallMs);
  const hasDispatchTime=()=>Date.now()+minimumDispatchWallMs<=(options.deadlineMs??Infinity);
  let cursor=0; let admitted=0; let scoutsAdmitted=0;
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(cursor<ids.length && admitted<maximum && hasDispatchTime()) {
      const id=ids[cursor++];
      try {
      const d=await nextAutonomousOperation(runtime,id); decisions.push(d);
      if (!d.task || !["WORKER","SCOUT"].includes(d.action)) continue;
      if (admitted>=maximum) { deferred.push({workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached; work remains owed`}); continue; }
      const wall=d.action==="SCOUT"?RESEARCH_BOUNDS.perDispatch.maxWallMs:WORKER_MAX_WALL_MS;
      if(Date.now()+wall>(options.deadlineMs??Infinity)) { deferred.push({workItemId:id,reason:"WALL_CLOCK_CEILING",detail:"insufficient cycle wall time remained; work remains owed"}); continue; }
      if(d.action==="SCOUT"&&scoutsAdmitted>=maxScoutDispatches) { deferred.push({workItemId:id,reason:"SCOUT_CYCLE_MAX",detail:`Scout maximum ${maxScoutDispatches} reached; work remains owed`}); continue; }
      if (d.action==="WORKER") {
        const aggregate=options.admitDispatch?.(d.task.id)??{admit:true as const};
        if(!aggregate.admit) { deferred.push({workItemId:id,reason:aggregate.code,detail:`${aggregate.why}; work remains owed`}); continue; }
        admitted++;
        dispatches.push(await dispatchWorkerTask(runtime,d.task));
        continue;
      }
      // Serialize model admission and completion so another fleet Scout cannot spend the same uncommitted allowance.
      await runtime.repos.locks.withLock("autonomous-model-admission",async()=>{
        if(admitted>=maximum) { deferred.push({workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached; work remains owed`}); return; }
        if(scoutsAdmitted>=maxScoutDispatches) { deferred.push({workItemId:id,reason:"SCOUT_CYCLE_MAX",detail:`Scout maximum ${maxScoutDispatches} reached; work remains owed`}); return; }
        if(Date.now()+RESEARCH_BOUNDS.perDispatch.maxWallMs>(options.deadlineMs??Infinity)) { deferred.push({workItemId:id,reason:"WALL_CLOCK_CEILING",detail:"insufficient cycle wall time remained; work remains owed"}); return; }
        const aggregate=options.admitDispatch?.(d.task!.id)??{admit:true as const};
        if(!aggregate.admit) { deferred.push({workItemId:id,reason:aggregate.code,detail:`${aggregate.why}; work remains owed`}); return; }
        const spend=researchSpendInWindow(await runtime.repos.costs.readAll(),now());
        admitted++;
        scoutsAdmitted++;
        const item=(await runtime.repos.workItems.mustRead(id)).value; const plan=item.autonomousPlan!;
        const denial=!runtime.scoutFor?"SCOUT_MODEL_TRANSPORT_UNAVAILABLE":!ceilingPermits(spend.windowUsd,RESEARCH_BOUNDS.dailyCeilingUsd).permits?"SCOUT_COST_CEILING":null;
        const history=(await runtime.repos.scoutResults.readAll()).filter(result=>result.workItemId===item.id).sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)||a.attemptId.localeCompare(b.attemptId));
        const executor:DeclaredExecutor=denial?{lane:"BOUNDED_MODEL_WORKER",workerFor:({holder})=>({role:"SCOUT",provider:"unavailable",version:FLEET_POLICY_VERSION,instance:holder}),run:async()=>({kind:"ABORTED",ranAs:"BOUNDED_MODEL_WORKER",failureOutcome:"DENIED_BY_POLICY",endedAt:now(),cost:{...ZERO_COST,requestCount:0,inputTokens:0,outputTokens:0,usd:0},detail:`DENIED_BY_POLICY:${denial}`})}:runtime.scoutFor!(item,d.task!,history);
        dispatches.push(await dispatchOne(runtime.repos,{obligation:{obligation:{id:d.task!.id,subjectId:item.subject,recordClass:plan.contract.recordClass,
          routeId:d.task!.routeId,active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null},nextDueAt:d.task!.createdAt,cadenceHours:24,
          cadenceSource:"DEFAULT_NO_SIGNAL",basis:"Canonical obligation needs source discovery"},routeTaskId:d.task!.id,holder:`autonomous:SCOUT:${randomUUID()}`,
          now:now(),leaseTtlMs:RESEARCH_BOUNDS.perDispatch.maxWallMs+120_000,bound:{maxAttempts:3,maxWallMs:RESEARCH_BOUNDS.perDispatch.maxWallMs,maxCostUnits:RESEARCH_BOUNDS.perDispatch.maxTokens},
          maturity:()=>"UNGRADUATED",executor,methodVersion:runtime.methodVersion,policyVersion:FLEET_POLICY_VERSION}));
      });
      } catch(error) {
        if(!(error instanceof RepositoryLockHeld)) throw error;
        deferred.push({workItemId:id,reason:"REPOSITORY_LOCK_HELD",detail:error.message});
      }
    }
  }));
  for (const id of ids.slice(cursor)) deferred.push(admitted>=maximum
    ? {workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached before this registered work item; work remains owed`}
    : {workItemId:id,reason:"WALL_CLOCK_CEILING",detail:"insufficient cycle wall time remained before this registered work item; work remains owed"});
  return {recovery,decisions,dispatches,scoutsAdmitted,deferred};
}
