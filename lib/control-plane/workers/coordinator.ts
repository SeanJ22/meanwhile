import { readSubjectScoutHistory } from "./detective.ts";
import { adapterWaitReasonFromKnowledge, reusableScoutCandidates, subjectScoutHistory, scoutFactGrounded } from "./detective.ts";
import { randomUUID } from "node:crypto";
import type { WorkItem } from "../work-item.ts";
import { ZERO_COST, type Attempt } from "../attempt.ts";
import { createRouteTask, type RouteTask } from "../route-task.ts";
import { canonicalJson, RepositoryLockHeld, type ControlPlaneRepositories } from "../repository/types.ts";
import { isControlPlaneRequestTimeout } from "../repository/request-bounds.ts";
import { registerRouteTask } from "../repository/coordinator.ts";
import { dispatchOne, proofChargeOf, sweepExpiredLeases, type DeclaredExecutor, type DispatchResult } from "../scheduler/dispatch.ts";
import { ceilingPermits, researchSpendInWindow } from "../scheduler/research-policy.ts";
import { fingerprint } from "../ids.ts";
import { dispatchWorkerTask, enqueueWorkerTask, evidenceProjection, FLEET_POLICY_VERSION, reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { autonomousScoutHistory, eligibleHeldProtocolRecovery, scoutTransientDenial, unchangedScoutFailure } from "./scout-scheduling.ts";
import { selectStandingLineages } from "./standing-lineage.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { recordFailure, type FreshnessDebt } from "../scheduler/debt.ts";
import { isRetiredRoutineMeetingAcquisition, scheduleAutonomousAcquisition, type AutonomousWorkPlan } from "./autonomous-plan.ts";
import { isScheduled } from "../scheduler/obligation.ts";
import type { FreshnessObligation } from "../scheduler/obligation.ts";
import type { FreshnessOccurrence } from "../scheduler/durable.ts";
import type { AcquirerTaskSpec, ObservedResearchRoute, ResearchSpan } from "./research-types.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { WorkerResultRecord } from "./types.ts";
import { nextAuditEscalation } from "./audit-escalation.ts";
import { needsSecondSource } from "../promotion/section3.ts";

/**
 * Blocker codes an acquisition recorded for robots.txt alone, before the owner decision of 2026-09-25. Historical:
 * the acquirer no longer produces them, and a result carrying only these is re-acquired, never left refused.
 */
const ROBOTS_ONLY_BLOCKERS: ReadonlySet<string> = new Set(["PERMISSION_DENIED", "PERMISSION_UNKNOWN"]);

export interface AutonomousCoordinatorRuntime extends FleetRuntime {
  /** Called before a task runs on a runtime built once for the whole process: refreshes only that task's own history. */
  readonly beginTask?: (task: RouteTask) => Promise<void>;
  /** Existing Scout executor, configured with this canonical WorkItem and its inherited history. */
  readonly scoutFor?: (item: WorkItem, task: RouteTask, history?: readonly ScoutResult[]) => DeclaredExecutor;
  /** Only the standing lineage broker may hand complete, attributed sibling captures to this root.
   * Keep the scheduling recovery gate in sync with the Scout's actual inherited artifact IDs. */
  readonly authorizedSiblingHeldArtifactIdsFor?: (item: WorkItem) => readonly string[];
}
export interface AutonomousDecision {
  readonly workItemId: string;
  readonly action: "SCOUT" | "WORKER" | "BLOCKED" | "STAGED";
  readonly task: RouteTask | null;
  readonly reason: string;
}

/** A filtered or paused cycle cannot start either autonomous entry point. */
export function autonomousCycleAllowed(input: { readonly dry: boolean; readonly canary: boolean;
  readonly only: string | null; readonly ids: ReadonlySet<string> | null; readonly runnerPaused: boolean }): boolean {
  return !input.dry && !input.canary && input.only === null && input.ids === null && !input.runnerPaused;
}

/** Exact immutable instruction lineage for an early technical slice. An old
 * occurrence can predate ownerInstructions on its WorkItem, but a later Send
 * on the same obligation cannot retroactively assign it to that instruction. */
export function exactInstructionAutonomousWorkIds(input: {
  obligations: readonly FreshnessObligation[]; occurrences: readonly FreshnessOccurrence[];
  workItems: readonly WorkItem[]; assignmentKey: string; receiptId: string;
}): ReadonlySet<string> {
  const owners = new Map(input.obligations.map(row => [row.id, row] as const));
  const roots = new Set<string>();
  const conflicted = new Set<string>();
  const occurrenceCounts = new Map<string, number>();
  for (const occurrence of input.occurrences) {
    const count = (occurrenceCounts.get(occurrence.workItemId) ?? 0) + 1;
    occurrenceCounts.set(occurrence.workItemId, count);
    // Normal IDs include the occurrence sequence; duplicate ownership of one
    // WorkItem is inconsistent retained data, never a reason to pick a receipt.
    if (count > 1) { conflicted.add(occurrence.workItemId); continue; }
    const openedAt = Date.parse(occurrence.openedAt);
    if (!Number.isFinite(openedAt)) { conflicted.add(occurrence.workItemId); continue; }
    const marks = (owners.get(occurrence.obligationId)?.assignments ?? [])
      .filter(mark => mark.assignmentKey === input.assignmentKey);
    if (marks.some(mark => !Number.isFinite(Date.parse(mark.at)))) { conflicted.add(occurrence.workItemId); continue; }
    const effective = marks.filter(mark => Date.parse(mark.at) <= openedAt);
    if (!effective.length) continue;
    const latestAt = Math.max(...effective.map(mark => Date.parse(mark.at)));
    const latestRefs = new Set(effective.filter(mark => Date.parse(mark.at) === latestAt).map(mark => mark.ref));
    if (latestRefs.size !== 1) { conflicted.add(occurrence.workItemId); continue; }
    if (latestRefs.has(input.receiptId)) roots.add(occurrence.workItemId);
  }
  const byId = new Map(input.workItems.map(item => [item.id, item] as const));
  const admitted = new Set<string>();
  for (const item of input.workItems) {
    const explicit = item.autonomousPlan?.ownerInstructions?.includes(input.receiptId) === true;
    let current: WorkItem | undefined = item;
    const seen = new Set<string>();
    let inherited = false;
    let ambiguous = false;
    while (current && !seen.has(current.id)) {
      if (conflicted.has(current.id)) { ambiguous = true; break; }
      if (roots.has(current.id)) inherited = true;
      seen.add(current.id);
      const link: { readonly parentWorkItemId: string; readonly authority: string } | undefined =
        (current as WorkItem & { readonly planRepair?: {
        readonly parentWorkItemId: string; readonly authority: string;
      } }).planRepair;
      const parent: WorkItem | undefined = link?.authority === "WORK_INSTRUCTIONS_ONLY" ? byId.get(link.parentWorkItemId) : undefined;
      current = parent?.project === item.project && parent.subject === item.subject ? parent : undefined;
    }
    if (!ambiguous && (explicit || inherited)) admitted.add(item.id);
  }
  return admitted;
}

export function assertAutonomousPlanIdentity(item: WorkItem, plan: AutonomousWorkPlan): void {
  if (plan.version !== 1 || plan.contract.subjectId !== item.subject || !plan.sourceRegistryReferences.length ||
    !plan.jurisdiction || !plan.capability || plan.acquisition.some(a => a.route.subjectId !== item.subject)) throw new Error("AUTONOMOUS_PLAN_CANONICAL_IDENTITY_REFUSED");
}

function withoutRetiredDetective<T extends object>(plan: T): Omit<T, "detective"> {
  const { detective: _retired, ...rest } = plan as T & { detective?: unknown };
  return rest;
}

export async function registerAutonomousPlan(repos: ControlPlaneRepositories, workItemId: string, plan: AutonomousWorkPlan, now: string): Promise<void> {
  const item = await repos.workItems.mustRead(workItemId);
  assertAutonomousPlanIdentity(item.value, plan);
  if (item.value.autonomousPlan) {
    // Plans stored before the rule-based detective was retired still carry an empty `detective` list.
    if (canonicalJson(withoutRetiredDetective(item.value.autonomousPlan)) !== canonicalJson(withoutRetiredDetective(plan))) throw new Error("AUTONOMOUS_PLAN_ALREADY_REGISTERED_DIFFERENT_CONTRACT");
    return;
  }
  await repos.workItems.compareAndSet(workItemId,item.revision,{...item.value,autonomousPlan:plan},now);
}

type MissingHeldArtifactReason = "WORKER_ARTIFACT_MISSING_OR_PARTIAL" | "WORKER_ARTIFACT_NOT_IN_VAULT";

function missingHeldArtifactReason(error: unknown): MissingHeldArtifactReason | null {
  if (!(error instanceof Error)) return null;
  if (/^WORKER_ARTIFACT_MISSING_OR_PARTIAL(?::|$)/.test(error.message)) return "WORKER_ARTIFACT_MISSING_OR_PARTIAL";
  if (/^WORKER_ARTIFACT_NOT_IN_VAULT(?::|$)/.test(error.message)) return "WORKER_ARTIFACT_NOT_IN_VAULT";
  return null;
}

/** Candidate assertions are usable only after matching the accepted Scout's actual vaulted observation. */
async function scoutSources(runtime: FleetRuntime, item: WorkItem, knownScouts?: readonly ScoutResult[],
  onMissingArtifact?: (artifactId: string, reason: MissingHeldArtifactReason) => void): Promise<ObservedResearchRoute[]> {
  const plan = item.autonomousPlan!;
  const out: ObservedResearchRoute[] = [];
  for (const scout of knownScouts ?? await runtime.repos.scoutResults.readAll()) {
    if (scout.subjectId !== item.subject || scout.recordClass !== plan.contract.recordClass || scout.refusal !== null) continue;
    const attempt = (await runtime.repos.attempts.mustRead(scout.attemptId)).value;
    if (attempt.outcome !== "COMPLETED") continue;
    for (const candidate of reusableScoutCandidates(scout)) {
      for (const id of candidate.evidenceArtifactIds) {
        let input: Awaited<ReturnType<FleetRuntime["readEvidence"]>>;
        try { input = await runtime.readEvidence(id); }
        catch (error) {
          const reason = missingHeldArtifactReason(error);
          if (!reason) throw error;
          onMissingArtifact?.(id, reason);
          continue;
        }
        const evidence = evidenceProjection(input);
        const start = evidence.text.indexOf(candidate.url);
        const direct = evidence.canonicalUrl === candidate.url;
        if (start < 0 && !direct) continue;
        const anchors=[...plan.seedUrls,...plan.sources.map(source=>source.url),...(plan.contract.schemaVersion===2?plan.contract.sourceScope.canonicalUrls:[])];
        const observedOrigin=new URL(evidence.canonicalUrl).origin;
        const fact = candidate.routeId.startsWith('held-fact:') && direct && scoutFactGrounded(scout,candidate.url,evidence.text);
        if(candidate.routeId.startsWith('held-fact:') && !fact) continue;
        if(!fact && !anchors.some(anchor=>new URL(anchor).origin===observedOrigin)) continue;
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
export async function nextAutonomousOperation(runtime: AutonomousCoordinatorRuntime, workItemId: string, knownItems?: readonly WorkItem[],
  knownHistory?: { readonly attempts: readonly Attempt[]; readonly scouts: readonly ScoutResult[]; readonly routeTasks: readonly RouteTask[];
    readonly completedRecords?: readonly WorkerResultRecord[];
    readonly onMissingArtifact?: (artifactId: string, reason: MissingHeldArtifactReason) => void }): Promise<AutonomousDecision> {
  const repos = runtime.repos;
  // The coordinator already took a consistent candidate snapshot. Re-reading
  // each item is a costly point request for every owed subject and can consume
  // the entire runner selection wall before a held continuation is admitted.
  const item = knownItems?.find(row => row.id === workItemId) ?? (await repos.workItems.mustRead(workItemId)).value;
  const plan = item.autonomousPlan;
  const missingArtifacts = new Map<string, MissingHeldArtifactReason>();
  const decision = (action:AutonomousDecision["action"],reason:string,task:RouteTask|null=null):AutonomousDecision => ({workItemId,action,task,
    reason: missingArtifacts.size ? `${reason}; ${[...missingArtifacts].map(([id,missingReason])=>`${missingReason}:${id}`).join("; ")}; these source references remain unresolved` : reason });
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
      canonicalJson(next.contract.requiredFields) === canonicalJson(plan.contract.requiredFields);
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
  const records = [...(knownHistory?.completedRecords ?? await readCompletedWorkerResults(repos, item.id))];
  records.sort((a,b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id));
  const attempts = knownHistory?.attempts ?? (await repos.attempts.list()).map(a=>a.value);
  const taskFor = async (input:Parameters<typeof enqueueWorkerTask>[1]) => {
    let task = await enqueueWorkerTask(repos,input);
    const admission = workerTaskAdmission(task,attempts,now);
    if(admission.due && admission.requiresPolicyRecheck) {
      const authorized=await reauthorizeWorkerTask(runtime,task,now); if(!authorized)return null; task=authorized;
    }
    return admission.due ? decision("WORKER",admission.reason,task) : null;
  };
  const sources = [...plan.sources,...await scoutSources(runtime,item,knownHistory?.scouts, (id, reason) => {
    if (missingArtifacts.has(id)) return;
    missingArtifacts.set(id, reason);
    knownHistory?.onMissingArtifact?.(id, reason);
  })];
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
    const {history,debt}=autonomousScoutHistory(task,knownHistory?.routeTasks ?? (await repos.routeTasks.list()).map(row=>row.value),attempts);
    const scoutHistory=subjectScoutHistory(knownHistory?.scouts ?? await repos.scoutResults.readAll(),item.subject,plan.contract.recordClass);
    const adapterWait = await adapterWaitReasonFromKnowledge(repos,scoutHistory);
    if (adapterWait) return decision("BLOCKED",adapterWait,task);
    const retained = (item as WorkItem & { readonly planRepair?: { readonly retainedEvidenceIds?: readonly string[]; readonly sourceArtifactId?: string } }).planRepair;
    const handedHeldIds = [...new Set([...scoutHistory.flatMap(result => result.artifactIds),
      ...(retained?.retainedEvidenceIds ?? []), ...(retained?.sourceArtifactId ? [retained.sourceArtifactId] : []),
      ...(runtime.authorizedSiblingHeldArtifactIdsFor?.(item) ?? [])])];
    let recoveryTaskId: string | null = null;
    let latest=history.filter(attempt=>attempt.routeTaskId===task.id).at(-1);
    if (unchangedScoutFailure(latest)) return decision("BLOCKED", "The unchanged Scout request already failed; changed inputs or a repaired method must create its successor.", task);
    while(task.state==="DISPOSED" && latest?.outcome==="COMPLETED") {
      const lastScout=scoutHistory.find(result=>result.attemptId===latest!.id);
      const continuation=createRouteTask({workItemId:item.id,routeId:`${baseRouteId}:continue:${latest.id}`,
        routeLabel:`${scope} Continue after ${latest.id}; next: ${Array.isArray(lastScout?.nextRungs) ? lastScout.nextRungs.filter((value): value is string => typeof value === "string").join("; ") || "reassess the remaining authoritative source methods" : "reassess the remaining authoritative source methods"}`,
        target:created.target,inherited:false,now});
      const existing=await repos.routeTasks.read(continuation.id);
      const recovery = eligibleHeldProtocolRecovery({ latest: lastScout ?? null, heldArtifactIds: handedHeldIds,
        continuationAttempted: history.some(attempt => attempt.routeTaskId === continuation.id) });
      if (!existing && !recovery && !lastScout?.nextRungs.some(rung => typeof rung === "string" && rung.trim().length > 0)) {
        return decision("BLOCKED", "The completed Scout supplied no next rung; changed inputs or a repaired method must create its successor.", task);
      }
      if (recovery) recoveryTaskId = continuation.id;
      if(!existing && debt && Date.parse(debt.retryAt)>Date.parse(now) && !recovery) return decision("BLOCKED",`Scout completed without settling the obligation; its next rungs remain owed after ${debt.retryAt}.`,task);
      task=existing?.value??(await registerRouteTask(repos,continuation,now)).value;
      latest=history.filter(attempt=>attempt.routeTaskId===task.id).at(-1);
    }
    if(task.state==="POLICY_DENIED" && latest?.outcome==="DENIED_BY_POLICY" && task.policyDenial && debt && Date.parse(debt.retryAt)<=Date.parse(now)) {
      const deniedCondition=scoutTransientDenial(latest.abortReason);
      const spend=researchSpendInWindow(await repos.costs.readAll(),now);
      const conditionChanged=deniedCondition==="TRANSPORT"?Boolean(runtime.scoutFor):deniedCondition==="COST"&&ceilingPermits(spend.windowUsd,(runtime.rollingCeilingUsd ?? 0)).permits;
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
    const scoutTriedAfterFailure = attempts.some(a => a.workItemId === item.id && (a.worker.role === "SCOUT" || a.worker.role === "DETECTIVE") && a.endedAt !== null && Date.parse(a.endedAt) >= Date.parse(latest.endedAt));
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
      if (plan.contract.schemaVersion===2) {
        const heldIds=new Set((await repos.artifacts.readAll()).map(artifact=>artifact.artifactId));
        if(plan.contract.verification.authorities.some(authority=>[...authority.artifactIds,...authority.authorityEvidenceArtifactIds].some(id=>!heldIds.has(id)))) { unresolved=true; continue; }
      }
      const validatorTask=await enqueueWorkerTask(repos,{...spec,role:"VALIDATOR",producerResultId:parser.id});
      const validator=records.find(r=>r.routeTaskId===validatorTask.id && r.result.role==="VALIDATOR");
      if (!validator) { const next=await taskFor({...spec,role:"VALIDATOR",producerResultId:parser.id}); if(next)return next; unresolved=true; continue; }
      if (validator.result.role!=="VALIDATOR" || (validator.result.verdict!=="PASS" && validator.result.extractionVerdict!=="PASS")) { unresolved=true; continue; }
      // §3: a fact that is not a judgment call is verified when the Validator passes; there is no audit stage.
      if (validator.result.verdict==="PASS" && !needsSecondSource(plan.contract)) { staged=true; continue; }
      let auditSpec: Parameters<typeof enqueueWorkerTask>[1] = {...spec,role:"ADVERSARIAL_AUDITOR",producerResultId:parser.id,validatorResultId:validator.id,auditScope:plan.auditScope};
      for (;;) {
        const auditTask = await enqueueWorkerTask(repos, auditSpec);
        const audit = records.find(r => r.routeTaskId === auditTask.id);
        if (!audit) { const next = await taskFor(auditSpec); if (next) return next; unresolved = true; break; }
        const escalation = nextAuditEscalation(audit);
        if (escalation && validator.result.verdict === "PASS") {
          auditSpec = { ...auditSpec, auditEscalation: escalation };
          continue; // At most Haiku → Sonnet → Opus; each is one durable attempt.
        }
        if (validator.result.verdict === "PASS" && audit.result.role === "ADVERSARIAL_AUDITOR" && audit.result.verdict === "SURVIVED") staged = true;
        else unresolved = true;
        break;
      }
    }
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

/** Serve one item per hunt in each round; priority orders a round, never drains a whole hunt first. */
export function fairAutonomousWorkIds(items: readonly WorkItem[], lastServed: ReadonlyMap<string, string>,
  priorities: readonly { receiptId: string; priority: number }[] = []): string[] {
  const priority = new Map(priorities.map(row => [row.receiptId, row.priority] as const));
  const groups = new Map<string, { priority: number; lastServed: string; items: WorkItem[] }>();
  for (const item of items) {
    const refs = [...(item.autonomousPlan?.ownerInstructions ?? [])]
      .sort((a, b) => (priority.get(a) ?? Infinity) - (priority.get(b) ?? Infinity) || a.localeCompare(b));
    const key = refs[0] ?? "standing";
    const group = groups.get(key) ?? { priority: priority.get(key) ?? Infinity, lastServed: "", items: [] };
    group.items.push(item);
    if ((lastServed.get(item.id) ?? "") > group.lastServed) group.lastServed = lastServed.get(item.id)!;
    groups.set(key, group);
  }
  const ordered = [...groups].sort(([ak, a], [bk, b]) =>
    a.priority - b.priority || a.lastServed.localeCompare(b.lastServed) || ak.localeCompare(bk));
  for (const [, group] of ordered) group.items.sort((a, b) =>
    (lastServed.get(a.id) ?? "").localeCompare(lastServed.get(b.id) ?? "") ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const ids: string[] = [];
  for (let round = 0; ids.length < items.length; round++) {
    for (const [, group] of ordered) if (group.items[round]) ids.push(group.items[round].id);
  }
  return ids;
}

/** Execute a pending canonical task in a lease-owning worker process. */
export async function dispatchAutonomousTask(runtime: AutonomousCoordinatorRuntime, task: RouteTask): Promise<DispatchResult> {
  if (task.workerTask) return dispatchWorkerTask(runtime, task);
  const now = runtime.now ?? (() => new Date().toISOString());
        const spend=researchSpendInWindow(await runtime.repos.costs.readAll(),now());
        const item=(await runtime.repos.workItems.mustRead(task.workItemId)).value; const plan=item.autonomousPlan!;
        const denial=!runtime.scoutFor?"SCOUT_MODEL_TRANSPORT_UNAVAILABLE":!ceilingPermits(spend.windowUsd,runtime.rollingCeilingUsd ?? 0).permits?"SCOUT_COST_CEILING":null;
        const history=await readSubjectScoutHistory(runtime.repos,[{subjectId:item.subject,recordClass:plan.contract.recordClass}]);
        const executor:DeclaredExecutor=denial?{lane:"BOUNDED_MODEL_WORKER",workerFor:({holder})=>({role:"SCOUT",provider:"unavailable",version:FLEET_POLICY_VERSION,instance:holder}),run:async()=>({kind:"ABORTED",ranAs:"BOUNDED_MODEL_WORKER",failureOutcome:"DENIED_BY_POLICY",endedAt:now(),cost:{...ZERO_COST,requestCount:0,inputTokens:0,outputTokens:0,usd:0},detail:`DENIED_BY_POLICY:${denial}`})}:runtime.scoutFor!(item,task,history);
        // Charge the exact standing obligation that opened this WorkItem. A
        // synthetic Scout obligation without its Send marks would reserve the
        // hunt's dollars yet leave the append-only charge unattributed.
        const owningOccurrences = await runtime.repos.occurrences.listWhere(["workItemId"], item.id);
        const occurrence = owningOccurrences.find(row => row.value.routeTaskId === task.id)
          ?? (owningOccurrences.length === 1 ? owningOccurrences[0] : null);
        const owner = occurrence === null ? null : await runtime.repos.obligations.read(occurrence.value.obligationId);
        const assignments = owner?.value.assignments ?? [];
        return dispatchOne(runtime.repos,{obligation:{obligation:{id:task.id,subjectId:item.subject,recordClass:plan.contract.recordClass,
          routeId:task.routeId,active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null,assignments},nextDueAt:task.createdAt,cadenceHours:24,
          cadenceSource:"DEFAULT_NO_SIGNAL",basis:"Canonical obligation needs source discovery"},routeTaskId:task.id,holder:`autonomous:SCOUT:${randomUUID()}`,
          now:now(),clock:now,leaseTtlMs:300_000,bound:{maxAttempts:3,maxWallMs:0,maxCostUnits:0},
          maturity:()=>"UNGRADUATED",executor,methodVersion:runtime.methodVersion,policyVersion:FLEET_POLICY_VERSION,...proofChargeOf(item.project)});
}

export async function runAutonomousCoordinator(runtime: AutonomousCoordinatorRuntime, options:{
  maximum?:number; concurrency?:number; deadlineMs?:number; maxScoutDispatches?:number;
  /** Selection enqueues existing RouteTasks; worker processes claim them later. */
  planOnly?: boolean;
  /** Invocation-local ordering metadata, including held work without an autonomous plan. */
  onSelectionSnapshot?:(items:readonly WorkItem[])=>void;
  acceptsWorkItem?:(item:WorkItem)=>boolean;
  prioritizedInstructions?:readonly {receiptId:string;priority:number}[];
  admitDispatch?:(work:string)=>{admit:true}|{admit:false;code:string;why:string};
}={}) {
  const now = runtime.now ?? (()=>new Date().toISOString());
  const recovery=await sweepExpiredLeases(runtime.repos,{now:now(),observedBy:"autonomous-coordinator"});
  const allItems=(await runtime.repos.workItems.list()).map(row=>row.value);
  options.onSelectionSnapshot?.(allItems);
  const candidates=allItems.filter(item=>item.autonomousPlan && (options.acceptsWorkItem?.(item) ?? true));
  const attemptRows=await runtime.repos.attempts.list();
  const attempts=attemptRows.map(row=>row.value);
  // A cycle's candidate set is fixed before dispatch. Join immutable Scout
  // results and existing route tasks once, then hand each item only its own
  // history. Re-reading both entire logs for every owed item made selection
  // quadratic and exhausted the original hunt's early worker wall.
  const [scouts, routeTaskRows, workerRecords] = await Promise.all([
    runtime.repos.scoutResults.readAll(), runtime.repos.routeTasks.list(), runtime.repos.workerResults.readAll(),
  ]);
  const scoutsByWork=new Map<string,ScoutResult[]>();
  for(const scout of scouts) {
    const rows=scoutsByWork.get(scout.workItemId)??[]; rows.push(scout); scoutsByWork.set(scout.workItemId,rows);
  }
  const routeTasksByWork=new Map<string,RouteTask[]>();
  for(const row of routeTaskRows) {
    const rows=routeTasksByWork.get(row.value.workItemId)??[]; rows.push(row.value); routeTasksByWork.set(row.value.workItemId,rows);
  }
  const attemptsByWork=new Map<string,Attempt[]>();
  for(const attempt of attempts) {
    const rows=attemptsByWork.get(attempt.workItemId)??[]; rows.push(attempt); attemptsByWork.set(attempt.workItemId,rows);
  }
  const lineages=selectStandingLineages({occurrences:(await runtime.repos.occurrences.list()).map(row=>row.value),
    workItems:allItems,artifacts:await runtime.repos.artifacts.readAll(),attempts,
    workerResults:workerRecords});
  const selectedRoot=new Map(lineages.flatMap(lineage=>lineage.siblingRootIds.map(id=>[id,lineage.rootWorkItemId] as const)));
  const byItem=new Map(allItems.map(item=>[item.id,item] as const));
  const lineageRoot=(item:WorkItem):string|null=>{
    let current=item; const seen=new Set<string>();
    while(!selectedRoot.has(current.id)) {
      if(seen.has(current.id)) return null;
      seen.add(current.id);
      const parentId=(current as WorkItem & {readonly planRepair?:{readonly parentWorkItemId:string}}).planRepair?.parentWorkItemId;
      const parent=parentId?byItem.get(parentId):null;
      if(!parent || parent.project!==item.project || parent.subject!==item.subject) return null;
      current=parent;
    }
    return current.id;
  };
  const duplicateLineageDeferred:{workItemId:string;reason:string;detail:string}[]=[];
  const items=candidates.filter(item=>{
    const root=lineageRoot(item);
    if(!root || selectedRoot.get(root)===root) return true;
    duplicateLineageDeferred.push({workItemId:item.id,reason:"DUPLICATE_PERIOD_LINEAGE",
      detail:`This recorded work remains open; source acquisition continues on canonical period root ${selectedRoot.get(root)}.`});
    return false;
  }).map(value=>({id:value.id,value}));
  const itemSubjectById=new Map(items.map(row=>[row.id,row.value.subject] as const));
  const knownItems=items.map(row=>row.value);
  // Repository id order is stable, not fair. Reconstruct service order from
  // canonical Attempts each cycle; no cursor or parallel task ledger is needed.
  const lastServed=new Map<string,string>();
  for (const attempt of attempts) {
    if (attempt.startedAt>(lastServed.get(attempt.workItemId)??"")) lastServed.set(attempt.workItemId,attempt.startedAt);
  }
  const ids=fairAutonomousWorkIds(items.map(row => row.value), lastServed, options.prioritizedInstructions);
  // Validate this invocation's already loaded history through the same shared
  // completion path. Independent calls still read current repository state;
  // leases, capabilities and budget admission are never frozen by this join.
  const candidateIds=new Set(ids);
  const completedRecords=await readCompletedWorkerResults({...runtime.repos,
    workerResults:{...runtime.repos.workerResults,readAll:async()=>workerRecords.filter(record=>candidateIds.has(record.workItemId))},
    attempts:{...runtime.repos.attempts,list:async()=>attemptRows},
  });
  const recordsByWork=new Map<string,WorkerResultRecord[]>();
  for(const record of completedRecords) {
    const rows=recordsByWork.get(record.workItemId)??[]; rows.push(record); recordsByWork.set(record.workItemId,rows);
  }
  const decisions:AutonomousDecision[]=[]; const dispatches:DispatchResult[]=[];
  const deferred:{workItemId:string;reason:string;detail:string}[]=[...duplicateLineageDeferred];
  const maximum=options.maximum??ids.length; const concurrency=Math.min(options.concurrency??Math.max(1,ids.length),Math.max(1,ids.length));
  // A caller may still pass a finite diagnostic
  // sub-cap; an unbounded value clamps to `maximum`.
  const maxScoutDispatches=Math.min(options.maxScoutDispatches??maximum,maximum);
  if (!Number.isSafeInteger(maximum)||maximum<0||!Number.isSafeInteger(concurrency)||concurrency<1||!Number.isSafeInteger(maxScoutDispatches)||maxScoutDispatches<0) throw new Error("AUTONOMOUS_COORDINATOR_BOUND_INVALID");

  let cursor=0; let admitted=0; let scoutsAdmitted=0; let scoutsLimitedAdmitted=0;
  // Join every admitted lane even when another lane's selection fails. An
  // early Promise.all rejection would let an already dispatched paid worker
  // continue after the cycle began its final records.
  const lanes=await Promise.allSettled(Array.from({length:concurrency},async()=>{
    while(cursor<ids.length && admitted<maximum) {
      const id=ids[cursor++];
      try {
      let d: AutonomousDecision;
      try {
        d=await nextAutonomousOperation(runtime,id,knownItems,{
          attempts:attemptsByWork.get(id)??[],scouts:scoutsByWork.get(id)??[],routeTasks:routeTasksByWork.get(id)??[],
          completedRecords:recordsByWork.get(id)??[],
          onMissingArtifact: (artifactId,reason) => deferred.push({workItemId:id,reason,
            detail:`${artifactId}; this source reference remains unresolved; other eligible work continues`}),
        });
      } catch (error) {
        // Only a bounded, pre-dispatch selection can be deferred as unpaid
        // work. A timeout after dispatch may carry unknown provider exposure
        // and must reach the ordinary durable attempt/hold failure path.
        if (error instanceof Error && /^WORKER_ARTIFACT_MISSING_OR_PARTIAL(?::|$)/.test(error.message)) {
          d = {workItemId:id,action:"BLOCKED",task:null,reason:`${error.message}; source reference remains unresolved`};
          deferred.push({workItemId:id,reason:"WORKER_ARTIFACT_MISSING_OR_PARTIAL",detail:d.reason});
        } else if (isControlPlaneRequestTimeout(error) && error.kind === "DEADLINE") {
          deferred.push({workItemId:id,reason:"WALL_CLOCK_CEILING",detail:"the bounded cycle ended during repository selection; this work remains owed"});
          break;
        } else throw error;
      }
      decisions.push(d);
      if (!d.task || !["WORKER","SCOUT"].includes(d.action)) continue;
      if (admitted>=maximum) { deferred.push({workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached; work remains owed`}); continue; }
      const lifetimeScout = runtime.lifetimeHuntSubject?.(itemSubjectById.get(id) ?? "") === true;
      if(d.action==="SCOUT"&&!lifetimeScout&&scoutsLimitedAdmitted>=maxScoutDispatches) { deferred.push({workItemId:id,reason:"SCOUT_CYCLE_MAX",detail:`Scout maximum ${maxScoutDispatches} reached; work remains owed`}); continue; }
      if (options.planOnly) continue;
      if (d.action==="WORKER") {
        const aggregate=options.admitDispatch?.(d.task.id)??{admit:true as const};
        if(!aggregate.admit) { deferred.push({workItemId:id,reason:aggregate.code,detail:`${aggregate.why}; work remains owed`}); continue; }
        admitted++;
        dispatches.push(await dispatchWorkerTask(runtime,d.task));
        continue;
      }
      // Shared durable reservations arbitrate model spending; task leases arbitrate execution.
      const dispatchScout = async()=>{
        if(admitted>=maximum) { deferred.push({workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached; work remains owed`}); return; }
        if(!lifetimeScout&&scoutsLimitedAdmitted>=maxScoutDispatches) { deferred.push({workItemId:id,reason:"SCOUT_CYCLE_MAX",detail:`Scout maximum ${maxScoutDispatches} reached; work remains owed`}); return; }
        const aggregate=options.admitDispatch?.(d.task!.id)??{admit:true as const};
        if(!aggregate.admit) { deferred.push({workItemId:id,reason:aggregate.code,detail:`${aggregate.why}; work remains owed`}); return; }
        admitted++;
        scoutsAdmitted++;
        if (!lifetimeScout) scoutsLimitedAdmitted++;
        dispatches.push(await dispatchAutonomousTask(runtime,d.task!));
      };
      // The lifetime hunt's durable reservation ledger arbitrates concurrent model calls.
      // Other work retains the legacy serialization until it has the same guarantee.
      await dispatchScout();
      } catch(error) {
        if(!(error instanceof RepositoryLockHeld)) throw error;
        deferred.push({workItemId:id,reason:"REPOSITORY_LOCK_HELD",detail:error.message});
      }
    }
  }));
  const failed=lanes.find((lane): lane is PromiseRejectedResult => lane.status==="rejected");
  if(failed) throw failed.reason;
  const order = new Map(ids.map((id, index) => [id, index]));
  decisions.sort((a, b) => order.get(a.workItemId)! - order.get(b.workItemId)!);
  for (const id of ids.slice(cursor)) deferred.push(admitted>=maximum
    ? {workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached before this registered work item; work remains owed`}
    : {workItemId:id,reason:"WALL_CLOCK_CEILING",detail:"insufficient cycle wall time remained before this registered work item; work remains owed"});
  // `considered` lets a reader check the pass: every item is dispatched, deferred, or decided not to run (MW-014).
  return {recovery,decisions,dispatches,scoutsAdmitted,scoutsLimitedAdmitted,deferred,considered:candidates.length};
}
