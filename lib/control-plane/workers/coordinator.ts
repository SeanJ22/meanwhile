import { randomUUID } from "node:crypto";
import type { WorkItem } from "../work-item.ts";
import { ZERO_COST } from "../attempt.ts";
import { createRouteTask, type RouteTask } from "../route-task.ts";
import { canonicalJson, RepositoryLockHeld, type ControlPlaneRepositories } from "../repository/types.ts";
import { registerRouteTask } from "../repository/coordinator.ts";
import { dispatchOne, proofChargeOf, sweepExpiredLeases, type DeclaredExecutor, type DispatchResult } from "../scheduler/dispatch.ts";
import { ceilingPermits, researchSpendInWindow, RESEARCH_BOUNDS } from "../scheduler/research-policy.ts";
import { fingerprint } from "../ids.ts";
import { dispatchWorkerTask, enqueueWorkerTask, evidenceProjection, FLEET_POLICY_VERSION, WORKER_MAX_WALL_MS, reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { autonomousScoutHistory, eligibleHeldProtocolRecovery, scoutTransientDenial } from "./scout-scheduling.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { recordFailure, type FreshnessDebt } from "../scheduler/debt.ts";
import { isRetiredRoutineMeetingAcquisition, scheduleAutonomousAcquisition, type AutonomousWorkPlan } from "./autonomous-plan.ts";
import { isScheduled } from "../scheduler/obligation.ts";
import type { AcquirerTaskSpec, ObservedResearchRoute, ResearchSpan } from "./research-types.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import { nextAuditEscalation } from "./audit-escalation.ts";

/**
 * Blocker codes an acquisition recorded for robots.txt alone, before the owner decision of 2026-09-25. Historical:
 * the acquirer no longer produces them, and a result carrying only these is re-acquired, never left refused.
 */
const ROBOTS_ONLY_BLOCKERS: ReadonlySet<string> = new Set(["PERMISSION_DENIED", "PERMISSION_UNKNOWN"]);

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

export function assertAutonomousPlanIdentity(item: WorkItem, plan: AutonomousWorkPlan): void {
  if (plan.version !== 1 || plan.contract.subjectId !== item.subject || !plan.sourceRegistryReferences.length ||
    !plan.jurisdiction || !plan.capability || plan.acquisition.some(a => a.route.subjectId !== item.subject) ||
    plan.detective.some(d => d.question.subjectId !== item.subject)) throw new Error("AUTONOMOUS_PLAN_CANONICAL_IDENTITY_REFUSED");
}

export async function registerAutonomousPlan(repos: ControlPlaneRepositories, workItemId: string, plan: AutonomousWorkPlan, now: string): Promise<void> {
  const item = await repos.workItems.mustRead(workItemId);
  assertAutonomousPlanIdentity(item.value, plan);
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
export async function nextAutonomousOperation(runtime: AutonomousCoordinatorRuntime, workItemId: string, knownItems?: readonly WorkItem[]): Promise<AutonomousDecision> {
  const repos = runtime.repos;
  const item = (await repos.workItems.mustRead(workItemId)).value;
  const plan = item.autonomousPlan;
  const decision = (action:AutonomousDecision["action"],reason:string,task:RouteTask|null=null):AutonomousDecision => ({workItemId,action,reason,task});
  if (!plan) return decision("BLOCKED","No versioned autonomous work instructions are registered for this obligation.");
  type LinkedItem = WorkItem & { planRepair?: { parentWorkItemId: string; authority: string }; planRepairObservation?: { successorWorkItemId: string | null } };
  const children = (knownItems ?? (await repos.workItems.list()).map(row => row.value)).filter(row => (row as LinkedItem).planRepair?.parentWorkItemId === item.id);
  const linkedId = (item as LinkedItem).planRepairObservation?.successorWorkItemId;
  if (children.length || linkedId) {
    const child = children[0] as LinkedItem | undefined;
    const next = child?.autonomousPlan;
    const valid = children.length === 1 && child && next && (!linkedId || linkedId === child.id) &&
      child.planRepair?.authority === "WORK_INSTRUCTIONS_ONLY" && child.subject === item.subject &&
      canonicalJson(child.contract) === canonicalJson(item.contract) && canonicalJson(child.dependencies) === canonicalJson(item.dependencies) &&
      next.contract.subjectId === plan.contract.subjectId && next.contract.recordClass === plan.contract.recordClass &&
      next.contract.schemaVersion === 2 && plan.contract.schemaVersion === 2 && next.contract.verification.required &&
      canonicalJson(next.contract.identity) === canonicalJson(plan.contract.identity) &&
      canonicalJson(next.contract.requiredFields) === canonicalJson(plan.contract.requiredFields) && canonicalJson(next.detective) === canonicalJson(plan.detective);
    if (!valid) return decision("BLOCKED", "REPAIR_SUCCESSOR_LINK_INVALID: linked work is missing, incomplete or outside the unchanged obligation; recovery remains owed.");
    assertAutonomousPlanIdentity(child, next);
    return decision("BLOCKED", `REPAIR_WAITING_ON_SUCCESSOR:${child.id}: original obligation and blockers remain open; dispatch continues on the linked successor.`);
  }
  if (
    runtime.routineMeetingsAuthority === "PERMANENT_CIVIC_DATA_PLANE" &&
    isRetiredRoutineMeetingAcquisition(plan.contract)
  ) {
    return decision(
      "BLOCKED",
      "PDC_ROUTINE_MEETINGS_ACQUISITION_RETIRED: immutable artifacts and results remain available for projection, but only the matching permanent source/body meeting-partition contract may acquire or refresh this source",
    );
  }
  const now = (runtime.now ?? (()=>new Date().toISOString()))();
  const records = [...await readCompletedWorkerResults(repos, item.id)];
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
    const {history,debt}=autonomousScoutHistory(task,(await repos.routeTasks.list()).map(row=>row.value),attempts);
    const scoutHistory=(await repos.scoutResults.readAll()).filter(result=>result.workItemId===item.id).sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)||a.attemptId.localeCompare(b.attemptId));
    const retained = (item as WorkItem & { readonly planRepair?: { readonly retainedEvidenceIds?: readonly string[]; readonly sourceArtifactId?: string } }).planRepair;
    const handedHeldIds = [...new Set([...scoutHistory.flatMap(result => result.artifactIds),
      ...(retained?.retainedEvidenceIds ?? []), ...(retained?.sourceArtifactId ? [retained.sourceArtifactId] : [])])];
    let recoveryTaskId: string | null = null;
    let latest=history.filter(attempt=>attempt.routeTaskId===task.id).at(-1);
    while(task.state==="DISPOSED" && latest?.outcome==="COMPLETED") {
      const lastScout=scoutHistory.find(result=>result.attemptId===latest!.id);
      const continuation=createRouteTask({workItemId:item.id,routeId:`${baseRouteId}:continue:${latest.id}`,
        routeLabel:`${scope} Continue after ${latest.id}; next: ${Array.isArray(lastScout?.nextRungs) ? lastScout.nextRungs.filter((value): value is string => typeof value === "string").join("; ") || "reassess the remaining authoritative source methods" : "reassess the remaining authoritative source methods"}`,
        target:created.target,inherited:false,now});
      const existing=await repos.routeTasks.read(continuation.id);
      const recovery = eligibleHeldProtocolRecovery({ latest: lastScout ?? null, heldArtifactIds: handedHeldIds,
        continuationAttempted: history.some(attempt => attempt.routeTaskId === continuation.id) });
      if (recovery) recoveryTaskId = continuation.id;
      if(!existing && debt && Date.parse(debt.retryAt)>Date.parse(now) && !recovery) return decision("BLOCKED",`Scout completed without settling the obligation; its next rungs remain owed after ${debt.retryAt}.`,task);
      task=existing?.value??(await registerRouteTask(repos,continuation,now)).value;
      latest=history.filter(attempt=>attempt.routeTaskId===task.id).at(-1);
    }
    if(task.state==="POLICY_DENIED" && latest?.outcome==="DENIED_BY_POLICY" && task.policyDenial && debt && Date.parse(debt.retryAt)<=Date.parse(now)) {
      const deniedCondition=scoutTransientDenial(latest.abortReason);
      const spend=researchSpendInWindow(await repos.costs.readAll(),now);
      const conditionChanged=deniedCondition==="TRANSPORT"?Boolean(runtime.scoutFor):deniedCondition==="COST"&&(Boolean(runtime.lifetimeHuntSubject?.(item.subject))||ceilingPermits(spend.windowUsd,RESEARCH_BOUNDS.dailyCeilingUsd).permits);
      if(conditionChanged) {
        const row=await repos.routeTasks.mustRead(task.id); const {policyDenial,...rest}=row.value;
        task=(await repos.routeTasks.compareAndSet(task.id,row.revision,{...rest,state:"RECLAIMABLE",policyReauthorizations:[...(task.policyReauthorizations??[]),{at:now,denial:policyDenial!,reason:"The named Scout transport or rolling-cost condition changed; current policy will be checked again."}]},now)).value;
      }
    }
    if (["PENDING","RECLAIMABLE"].includes(task.state) && (!debt||Date.parse(debt.retryAt)<=Date.parse(now)||task.id===recoveryTaskId)) return decision("SCOUT",scope,task);
    return decision("BLOCKED","Scout has no accepted grounded route; preserve its next rungs and retry state.",task);
  };
  if (!acquisitions.length) return scoutOperation(false);
  let staged = false;
  let unresolved = false;
  let outsideExtractionScope=false;
  const pendingRefreshes: Parameters<typeof enqueueWorkerTask>[1][] = [];
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
        // Finish independent checking of retained bytes before refreshing them.
        // Otherwise a source whose cadence is shorter than the runner interval
        // consumes every turn with acquisition and never reaches a verifier.
        // Freshness still prevents staging and the refresh uses a real fetch.
        pendingRefreshes.push({workItemId:item.id,contract:plan.contract,now,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,
          acquisition:{...acquisition,held:[]},replayLabel:`refresh-after:${latest.id}`});
        unresolved=true;
      }
      continue;
    }
    unresolved = true;
    // A result blocked by robots.txt alone (PERMISSION_DENIED / PERMISSION_UNKNOWN, only ever recorded before the owner
    // decision of 2026-09-25) is not a failure of the route: robots.txt is recorded and never blocks a public page, so
    // the route is acquired again at once, with no failure debt and no Scout turn owed first. Access controls and
    // integrity failures keep their own retry rules below.
    if (latest.result.blockers.length > 0 && latest.result.blockers.every(blocker => ROBOTS_ONLY_BLOCKERS.has(blocker.code))) {
      const next = await taskFor({workItemId:item.id,contract:plan.contract,now,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,acquisition,replayLabel:`robots-recorded-after:${latest.id}`});
      if (next) return next;
      continue;
    }
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
      let auditSpec: Parameters<typeof enqueueWorkerTask>[1] = {...spec,role:"ADVERSARIAL_AUDITOR",producerResultId:parser.id,validatorResultId:validator.id,auditScope:plan.auditScope};
      for (;;) {
        const auditTask = await enqueueWorkerTask(repos, auditSpec);
        const audit = records.find(r => r.routeTaskId === auditTask.id);
        if (!audit) { const next = await taskFor(auditSpec); if (next) return next; unresolved = true; break; }
        const escalation = nextAuditEscalation(audit);
        if (escalation && validator.result.verdict === "PASS" && !identityUnresolved) {
          auditSpec = { ...auditSpec, auditEscalation: escalation };
          continue; // At most Haiku → Sonnet → Opus; each is one durable attempt.
        }
        if (!identityUnresolved && validator.result.verdict === "PASS" && audit.result.role === "ADVERSARIAL_AUDITOR" && audit.result.verdict === "SURVIVED") staged = true;
        else unresolved = true;
        break;
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
  for (const refresh of pendingRefreshes) {
    const next = await taskFor(refresh);
    if (next) return next;
  }
  if (staged && !unresolved && item.publicationOutcome?.recovery !== "WORKER" &&
    (item.publicationOutcome?.status !== "HELD" || item.publicationOutcome.recovery === "PUBLISHER")) return decision("STAGED",
    item.publicationOutcome?.status === "PUBLISHED" ? `Verified records published in ${item.publicationOutcome.versionId}; other coverage obligations remain open.`
      : "Scoped reviewed results are retained. Reader/Ask and promotion gates remain independent.");
  const novelty = await scoutOperation(true);
  return outsideExtractionScope ? {...novelty,reason:`EXTRACTION_SCOPE_UNESTABLISHED: the acquired representation needs a compatible extraction contract. ${novelty.reason}`} : novelty;
}

/** Independent obligations run concurrently; leases provide process-independent ownership. */
export async function runAutonomousCoordinator(runtime: AutonomousCoordinatorRuntime, options:{
  maximum?:number; concurrency?:number; deadlineMs?:number; maxScoutDispatches?:number;
  acceptsWorkItem?:(item:WorkItem)=>boolean;
  prioritizedInstructions?:readonly {receiptId:string;priority:number}[];
  admitDispatch?:(work:string)=>{admit:true}|{admit:false;code:string;why:string};
}={}) {
  const now = runtime.now ?? (()=>new Date().toISOString());
  const recovery=await sweepExpiredLeases(runtime.repos,{now:now(),observedBy:"autonomous-coordinator"});
  const items=(await runtime.repos.workItems.list()).filter(i=>i.value.autonomousPlan && (options.acceptsWorkItem?.(i.value) ?? true));
  const itemSubjectById=new Map(items.map(row=>[row.id,row.value.subject] as const));
  // Repository id order is stable, not fair. Reconstruct service order from
  // canonical Attempts each cycle; no cursor or parallel task ledger is needed.
  const lastServed=new Map<string,string>();
  for (const {value:attempt} of await runtime.repos.attempts.list()) {
    if (attempt.startedAt>(lastServed.get(attempt.workItemId)??"")) lastServed.set(attempt.workItemId,attempt.startedAt);
  }
  const priorityByReceipt=new Map(options.prioritizedInstructions?.map(row=>[row.receiptId,row.priority] as const)??[]);
  const ownerPriority=(item:WorkItem)=>Math.min(...(item.autonomousPlan?.ownerInstructions??[])
    .map(ref=>priorityByReceipt.get(ref)??Number.POSITIVE_INFINITY));
  const ids=items.sort((a,b)=>{
    const ap=ownerPriority(a.value), bp=ownerPriority(b.value);
    return (ap===bp?0:ap<bp?-1:1) ||
      (lastServed.get(a.id)??"").localeCompare(lastServed.get(b.id)??"") ||
      a.value.createdAt.localeCompare(b.value.createdAt) || a.id.localeCompare(b.id);
  }).map(i=>i.id);
  const decisions:AutonomousDecision[]=[]; const dispatches:DispatchResult[]=[];
  const deferred:{workItemId:string;reason:string;detail:string}[]=[];
  const maximum=options.maximum??ids.length; const concurrency=Math.min(options.concurrency??4,Math.max(1,ids.length));
  // No standing per-cycle Scout cap: the coordinator's own `maximum` (and the
  // wall) bound autonomous Scouts. A caller may still pass a finite diagnostic
  // sub-cap; an unbounded value clamps to `maximum`.
  const maxScoutDispatches=Math.min(options.maxScoutDispatches??maximum,maximum);
  if (!Number.isSafeInteger(maximum)||maximum<0||!Number.isSafeInteger(concurrency)||concurrency<1||!Number.isSafeInteger(maxScoutDispatches)||maxScoutDispatches<0) throw new Error("AUTONOMOUS_COORDINATOR_BOUND_INVALID");
  const minimumDispatchWallMs=Math.min(WORKER_MAX_WALL_MS,RESEARCH_BOUNDS.perDispatch.maxWallMs);
  const hasDispatchTime=()=>Date.now()+minimumDispatchWallMs<=(options.deadlineMs??Infinity);
  let cursor=0; let admitted=0; let scoutsAdmitted=0; let scoutsLimitedAdmitted=0;
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(cursor<ids.length && admitted<maximum && hasDispatchTime()) {
      const id=ids[cursor++];
      try {
      const d=await nextAutonomousOperation(runtime,id,items.map(row=>row.value)); decisions.push(d);
      if (!d.task || !["WORKER","SCOUT"].includes(d.action)) continue;
      if (admitted>=maximum) { deferred.push({workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached; work remains owed`}); continue; }
      const wall=d.action==="SCOUT"?RESEARCH_BOUNDS.perDispatch.maxWallMs:WORKER_MAX_WALL_MS;
      if(Date.now()+wall>(options.deadlineMs??Infinity)) { deferred.push({workItemId:id,reason:"WALL_CLOCK_CEILING",detail:"insufficient cycle wall time remained; work remains owed"}); continue; }
      const lifetimeScout = runtime.lifetimeHuntSubject?.(itemSubjectById.get(id) ?? "") === true;
      if(d.action==="SCOUT"&&!lifetimeScout&&scoutsLimitedAdmitted>=maxScoutDispatches) { deferred.push({workItemId:id,reason:"SCOUT_CYCLE_MAX",detail:`Scout maximum ${maxScoutDispatches} reached; work remains owed`}); continue; }
      if (d.action==="WORKER") {
        const aggregate=options.admitDispatch?.(d.task.id)??{admit:true as const};
        if(!aggregate.admit) { deferred.push({workItemId:id,reason:aggregate.code,detail:`${aggregate.why}; work remains owed`}); continue; }
        admitted++;
        dispatches.push(await dispatchWorkerTask(runtime,d.task));
        continue;
      }
      // Serialize model admission and completion so another fleet Scout cannot spend the same uncommitted allowance.
      const dispatchScout = async()=>{
        if(admitted>=maximum) { deferred.push({workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached; work remains owed`}); return; }
        if(!lifetimeScout&&scoutsLimitedAdmitted>=maxScoutDispatches) { deferred.push({workItemId:id,reason:"SCOUT_CYCLE_MAX",detail:`Scout maximum ${maxScoutDispatches} reached; work remains owed`}); return; }
        if(Date.now()+RESEARCH_BOUNDS.perDispatch.maxWallMs>(options.deadlineMs??Infinity)) { deferred.push({workItemId:id,reason:"WALL_CLOCK_CEILING",detail:"insufficient cycle wall time remained; work remains owed"}); return; }
        const aggregate=options.admitDispatch?.(d.task!.id)??{admit:true as const};
        if(!aggregate.admit) { deferred.push({workItemId:id,reason:aggregate.code,detail:`${aggregate.why}; work remains owed`}); return; }
        const spend=researchSpendInWindow(await runtime.repos.costs.readAll(),now());
        admitted++;
        scoutsAdmitted++;
        if (!lifetimeScout) scoutsLimitedAdmitted++;
        const item=(await runtime.repos.workItems.mustRead(id)).value; const plan=item.autonomousPlan!;
        const denial=!runtime.scoutFor?"SCOUT_MODEL_TRANSPORT_UNAVAILABLE":!runtime.lifetimeHuntSubject?.(item.subject)&&!ceilingPermits(spend.windowUsd,RESEARCH_BOUNDS.dailyCeilingUsd).permits?"SCOUT_COST_CEILING":null;
        const history=(await runtime.repos.scoutResults.readAll()).filter(result=>result.workItemId===item.id).sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)||a.attemptId.localeCompare(b.attemptId));
        const executor:DeclaredExecutor=denial?{lane:"BOUNDED_MODEL_WORKER",workerFor:({holder})=>({role:"SCOUT",provider:"unavailable",version:FLEET_POLICY_VERSION,instance:holder}),run:async()=>({kind:"ABORTED",ranAs:"BOUNDED_MODEL_WORKER",failureOutcome:"DENIED_BY_POLICY",endedAt:now(),cost:{...ZERO_COST,requestCount:0,inputTokens:0,outputTokens:0,usd:0},detail:`DENIED_BY_POLICY:${denial}`})}:runtime.scoutFor!(item,d.task!,history);
        // Charge the exact standing obligation that opened this WorkItem. A
        // synthetic Scout obligation without its Send marks would reserve the
        // hunt's dollars yet leave the append-only charge unattributed.
        const owningOccurrences = await runtime.repos.occurrences.listWhere(["workItemId"], item.id);
        const occurrence = owningOccurrences.find(row => row.value.routeTaskId === d.task!.id)
          ?? (owningOccurrences.length === 1 ? owningOccurrences[0] : null);
        const owner = occurrence === null ? null : await runtime.repos.obligations.read(occurrence.value.obligationId);
        const assignments = owner?.value.assignments ?? [];
        dispatches.push(await dispatchOne(runtime.repos,{obligation:{obligation:{id:d.task!.id,subjectId:item.subject,recordClass:plan.contract.recordClass,
          routeId:d.task!.routeId,active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null,assignments},nextDueAt:d.task!.createdAt,cadenceHours:24,
          cadenceSource:"DEFAULT_NO_SIGNAL",basis:"Canonical obligation needs source discovery"},routeTaskId:d.task!.id,holder:`autonomous:SCOUT:${randomUUID()}`,
          now:now(),leaseTtlMs:RESEARCH_BOUNDS.perDispatch.maxWallMs+120_000,bound:{maxAttempts:3,maxWallMs:RESEARCH_BOUNDS.perDispatch.maxWallMs,maxCostUnits:RESEARCH_BOUNDS.perDispatch.maxTokens},
          maturity:()=>"UNGRADUATED",executor,methodVersion:runtime.methodVersion,policyVersion:FLEET_POLICY_VERSION,...proofChargeOf(item.project)}));
      };
      // The lifetime hunt's durable reservation ledger arbitrates concurrent model calls.
      // Other work retains the legacy serialization until it has the same guarantee.
      if(runtime.lifetimeHuntSubject?.(itemSubjectById.get(id) ?? "")) await dispatchScout();
      else await runtime.repos.locks.withLock("autonomous-model-admission",dispatchScout);
      } catch(error) {
        if(!(error instanceof RepositoryLockHeld)) throw error;
        deferred.push({workItemId:id,reason:"REPOSITORY_LOCK_HELD",detail:error.message});
      }
    }
  }));
  for (const id of ids.slice(cursor)) deferred.push(admitted>=maximum
    ? {workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached before this registered work item; work remains owed`}
    : {workItemId:id,reason:"WALL_CLOCK_CEILING",detail:"insufficient cycle wall time remained before this registered work item; work remains owed"});
  // `considered` lets a reader check the pass: every item is dispatched, deferred, or decided not to run (MW-014).
  return {recovery,decisions,dispatches,scoutsAdmitted,scoutsLimitedAdmitted,deferred,considered:ids.length};
}
