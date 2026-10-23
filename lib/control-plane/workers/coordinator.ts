import {exaAgentEnabled} from '../../hunt/exa-admission.ts';
import { BOX_PARSER_IMPLEMENTATION } from "./quoted-proof.ts";
import { readSpendWindow } from "../spend-window.ts";
import { readCoordinatorWorkItems } from "../repository/pg-store.ts";
import { randomUUID } from "node:crypto";
import type { WorkItem } from "../work-item.ts";
import { ZERO_COST, type Attempt } from "../attempt.ts";
import { createRouteTask, type RouteTask } from "../route-task.ts";
import { canonicalJson, RepositoryLockHeld, type ControlPlaneRepositories } from "../repository/types.ts";
import { isControlPlaneRequestTimeout } from "../repository/request-bounds.ts";
import { registerRouteTask } from "../repository/coordinator.ts";
import { dispatchOne, hunterWallLimitMs, proofChargeOf, sweepExpiredLeases, type DeclaredExecutor, type DispatchResult } from "../scheduler/dispatch.ts";
import { ceilingPermits } from "../scheduler/research-policy.ts";
import { dispatchWorkerTask, enqueueWorkerTask, FLEET_POLICY_VERSION, reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { selectStandingLineages } from "./standing-lineage.ts";
import { readLineageHistory } from "./scoped-history.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { FIRST_BACKOFF_MINUTES, recordFailure, type FreshnessDebt } from "../scheduler/debt.ts";
import { isRetiredRoutineMeetingAcquisition, scheduleAutonomousAcquisition, type AutonomousWorkPlan } from "./autonomous-plan.ts";
import { isScheduled } from "../scheduler/obligation.ts";
import type { FreshnessObligation } from "../scheduler/obligation.ts";
import type { FreshnessOccurrence } from "../scheduler/durable.ts";
import type { AcquirerTaskSpec } from "./research-types.ts";
import type { WorkerResultRecord } from "./types.ts";
import { nextAuditEscalation } from "./audit-escalation.ts";
import { needsSecondSource } from "../promotion/section3.ts";
import { acquirerFailureCause } from "./known-door-failure.ts";
import { isHuntPacketPlan } from "../../hunt/packet-plan.ts";
import { HUNT_PACKET_ROUTE_ID } from "../../hunt/packet.ts";
import { EXA_AGENT_ROUTE_ID } from "../../hunt/exa-lane.ts";
import { interleaveByWeight, partOfItem, sendOf, squadKey, squadWeights, type SquadReading, type SquadWeight } from "./squad-weights.ts";

/** Blocker codes an acquisition once recorded for robots.txt alone. A result carrying only these is re-acquired, never left refused. */
const ROBOTS_ONLY_BLOCKERS: ReadonlySet<string> = new Set(["PERMISSION_DENIED", "PERMISSION_UNKNOWN"]);

export interface AutonomousCoordinatorRuntime extends FleetRuntime {
  readonly prepareWorkItem?: (item: WorkItem) => Promise<WorkItem>;
  /** Called before a task runs on a runtime built once for the whole process: refreshes only that task's own history. */
  readonly beginTask?: (task: RouteTask, item?: WorkItem) => Promise<void>;
  /** The hunter (or the Exa agent lane) for one hunt packet job. */
  readonly scoutFor?: (item: WorkItem, task: RouteTask) => Promise<DeclaredExecutor>;
  /** Admin's switch that also sends each hunt packet to Exa's research agent. */
  readonly exaAgentLane?: boolean;
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

/** Typed state chooses one next operation. Absence is never inferred from an empty list. */
export async function nextAutonomousOperation(runtime: AutonomousCoordinatorRuntime, workItemId: string, knownItems?: readonly WorkItem[],
  knownHistory?: { readonly attempts: readonly Attempt[]; readonly routeTasks: readonly RouteTask[];
    readonly completedRecords?: readonly WorkerResultRecord[];readonly exaAgentEnabled?:boolean }): Promise<AutonomousDecision> {
  const repos = runtime.repos;
  const selected = knownItems?.find(row => row.id === workItemId) ?? (await repos.workItems.mustRead(workItemId)).value;
  const item = await runtime.prepareWorkItem?.(selected) ?? selected;
  const plan = item.autonomousPlan;
  const decision = (action:AutonomousDecision["action"],reason:string,task:RouteTask|null=null):AutonomousDecision => ({workItemId,action,task,reason});
  if (!plan) return decision("BLOCKED","No versioned autonomous work instructions are registered for this obligation.");
  if (isHuntPacketPlan(plan)) return huntOperation({...runtime,exaAgentLane:knownHistory?.exaAgentEnabled??await exaAgentEnabled(repos)}, item, knownHistory);
  type LinkedItem = WorkItem & { planRepair?: { parentWorkItemId: string; authority: string }; planRepairObservation?: { successorWorkItemId: string | null } };
  const children = (await repos.workItems.listWhere(["planRepair", "parentWorkItemId"], item.id)).map(row => row.value);
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
  let heldArtifactIdsRead: Promise<Set<string>> | null = null;
  const heldArtifactIds = () => heldArtifactIdsRead ??= (async () => {
    if (!repos.artifacts.keysWhere) throw new Error("ARTIFACT_SCOPED_READ_UNAVAILABLE");
    const required = plan.contract.schemaVersion === 2
      ? plan.contract.verification.authorities.flatMap(authority=>[...authority.artifactIds,...authority.authorityEvidenceArtifactIds]) : [];
    const found = new Set<string>();
    for (const id of new Set(required)) if ((await repos.artifacts.keysWhere(["artifactId"],id)).length) found.add(id);
    return found;
  })();
  records.sort((a,b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id));
  const attempts = knownHistory?.attempts ?? (await repos.attempts.listWhere(["workItemId"], item.id)).map(a=>a.value);
  const taskFor = async (input:Parameters<typeof enqueueWorkerTask>[1]) => {
    let task = await enqueueWorkerTask(repos,input);
    const admission = workerTaskAdmission(task,attempts,now);
    if(admission.due && admission.requiresPolicyRecheck) {
      const authorized=await reauthorizeWorkerTask(runtime,task,now); if(!authorized)return null; task=authorized;
    }
    return admission.due ? decision("WORKER",admission.reason,task) : null;
  };
  const acquisitions: AcquirerTaskSpec[] = [...plan.acquisition];
  for (const source of plan.sources) if (!acquisitions.some(a=>a.route.id===source.id && a.route.url===source.url)) acquisitions.push({route:source,held:[]});
  if (!acquisitions.length) return decision("BLOCKED", UNHUNTED);
  let staged = false;
  let unresolved = false;
  let outsideExtractionScope=false;
  const pendingRefreshes: Parameters<typeof enqueueWorkerTask>[1][] = [];
  const boxedArtifactIds = new Set(records.flatMap(r => r.workItemId === item.id && r.result.role === "PARSER" &&
    r.result.implementation === BOX_PARSER_IMPLEMENTATION && r.result.verdict === "EXTRACTED" && r.methodVersion === runtime.methodVersion
    ? [r.result.artifactId] : []));
  const acquiredBoxPage = (record: WorkerResultRecord) => record.result.role === "ACQUIRER" &&
    record.result.artifacts.some(artifact => boxedArtifactIds.has(artifact.artifactId));
  /* Known doors in a passing outage, each waiting for its free plain retry. */
  const outageWaits = new Map<string, string>();
  const doorKey = (acquisition: AcquirerTaskSpec) => `${acquisition.route.id}\u0000${acquisition.route.url}`;
  // Acquire the declared supporting authorities before scheduling their dependent validation.
  for (const acquisition of acquisitions) {
    const history = records.filter(r => r.result.role === "ACQUIRER" && (r.result.source.id === acquisition.route.id || acquiredBoxPage(r)) && r.result.source.url === acquisition.route.url);
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
        pendingRefreshes.push({workItemId:item.id,contract:plan.contract,now,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,
          acquisition:{...acquisition,held:[]},replayLabel:`refresh-after:${latest.id}`});
        unresolved=true;
      }
      continue;
    }
    const unresolvedBefore: boolean = unresolved;
    unresolved = true;
    // A result blocked by robots.txt alone (PERMISSION_DENIED / PERMISSION_UNKNOWN, older results only) is acquired again at once with no failure debt; access controls and integrity failures keep their own retry rules.
    if (latest.result.blockers.length > 0 && latest.result.blockers.every(blocker => ROBOTS_ONLY_BLOCKERS.has(blocker.code))) {
      const next = await taskFor({workItemId:item.id,contract:plan.contract,now,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,acquisition,replayLabel:`robots-recorded-after:${latest.id}`});
      if (next) return next;
      continue;
    }
    if (latest.result.blockers.some(blocker => !blocker.retryable)) continue;
    let debt: FreshnessDebt | null = null;
    for (const failed of [...history].reverse()) {
      if (failed.result.verdict === "ACQUIRED") { debt = null; continue; }
      const cause = failed.result.role === "ACQUIRER" ? acquirerFailureCause(failed.result) : "TRANSPORT_FAILED";
      debt = recordFailure(debt,{obligationId:item.id,cause,detail:`ACQUIRER ${failed.result.verdict}`,target:acquisition.route.url,dueAt:failed.startedAt,now:failed.endedAt});
    }
    // A failed known door keeps its free plain retry on its backoff; a shut door's blanks go to its government's packet.
    if (!debt || Date.parse(debt.retryAt) <= Date.parse(now)) {
      const next = await taskFor({workItemId:item.id,contract:plan.contract,now,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,acquisition,replayLabel:`retry-after:${latest.id}`});
      if (next) return next;
    } else {
      outageWaits.set(doorKey(acquisition), debt.retryAt);
      unresolved = unresolvedBefore;
    }
  }
  for (const acquisition of acquisitions) {
    const common = {workItemId:item.id,contract:plan.contract,now};
    // A failed refresh does not erase the last trustworthy capture. The source
    // loop above keeps its freshness/recovery obligation unresolved separately.
    const acquired = records.find(r=>r.result.role==="ACQUIRER" && r.result.verdict==="ACQUIRED" && (r.result.source.id===acquisition.route.id || acquiredBoxPage(r)) && r.result.source.url===acquisition.route.url);
    if (!acquired && outageWaits.has(doorKey(acquisition))) continue;
    if (!acquired) { const next = await taskFor({...common,role:"ACQUIRER",artifactId:acquisition.route.observation.artifactId,acquisition}); if(next)return next; unresolved=true; continue; }
    if (acquired.result.role !== "ACQUIRER") continue;
    for (const artifact of acquired.result.artifacts.filter(a=>a.completeness==="COMPLETE")) {
      // Supporting/authority captures have their own instructions; never parse a diagnostic page as the primary class.
      if (plan.contract.schemaVersion===2 && !plan.contract.sourceScope.canonicalUrls.includes(artifact.canonicalUrl)) {
        if(!plan.contract.verification.authorities.some(authority=>authority.canonicalUrls.includes(artifact.canonicalUrl))) {outsideExtractionScope=true;unresolved=true;}
        continue;
      }
      const spec = {...common,artifactId:artifact.artifactId};
      const boxed = records.find(r => r.workItemId === item.id && r.result.role === "PARSER" && r.result.verdict === "EXTRACTED" &&
        r.result.implementation === BOX_PARSER_IMPLEMENTATION && r.result.artifactId === artifact.artifactId &&
        r.result.subjectId === plan.contract.subjectId && r.result.recordClass === plan.contract.recordClass &&
        r.methodVersion === runtime.methodVersion);
      // The Box's quoted extraction is checked by the ordinary publication
      // door in this pass. Do not create another Parser or validator turn.
      if (boxed && !needsSecondSource(plan.contract)) { staged = true; continue; }
      const parserTask = boxed ? null : await enqueueWorkerTask(repos,{...spec,role:"PARSER"});
      const parser = boxed ?? records.find(r=>r.routeTaskId===parserTask?.id && r.result.role==="PARSER");
      if (!parser) { const next=await taskFor({...spec,role:"PARSER"}); if(next)return next; unresolved=true; continue; }
      if (parser.result.verdict!=="EXTRACTED") { unresolved=true; continue; }
      if (plan.contract.schemaVersion===2) {
        const heldIds=await heldArtifactIds();
        if(plan.contract.verification.authorities.some(authority=>[...authority.artifactIds,...authority.authorityEvidenceArtifactIds].some(id=>!heldIds.has(id)))) { unresolved=true; continue; }
      }
      const validatorTask=await enqueueWorkerTask(repos,{...spec,role:"VALIDATOR",producerResultId:parser.id});
      const validator=records.find(r=>r.routeTaskId===validatorTask.id && r.result.role==="VALIDATOR");
      if (!validator) { const next=await taskFor({...spec,role:"VALIDATOR",producerResultId:parser.id}); if(next)return next; unresolved=true; continue; }
      if (validator.result.role!=="VALIDATOR" || (validator.result.verdict!=="PASS" && validator.result.extractionVerdict!=="PASS")) { unresolved=true; continue; }
      // A fact that is not a judgment call is verified when the Validator passes; there is no audit stage.
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
  for (const refresh of pendingRefreshes) {
    const next = await taskFor(refresh);
    if (next) return next;
  }
  if (staged && !unresolved && !outageWaits.size && item.publicationOutcome?.recovery !== "WORKER" &&
    (item.publicationOutcome?.status !== "HELD" || item.publicationOutcome.recovery === "PUBLISHER")) return decision("STAGED",
    item.publicationOutcome?.status === "PUBLISHED" ? `Verified records published in ${item.publicationOutcome.versionId}; other coverage obligations remain open.`
      : "Scoped reviewed results are retained. Reader/Ask and promotion gates remain independent.");
  if (outageWaits.size && !unresolved) {
    const at = [...outageWaits.values()].sort()[0];
    return decision("BLOCKED", `A known source had a passing outage; it is read again with plain code at ${at}. No paid walk is owed for it.`);
  }
  return decision("BLOCKED", outsideExtractionScope ? `EXTRACTION_SCOPE_UNESTABLISHED: the acquired representation needs a compatible extraction contract. ${UNHUNTED}` : UNHUNTED);
}

/** Work no known source settles is not hunted on its own: its blanks are in its government's hunt packet. */
const UNHUNTED = "No known source settles this work yet; its open blanks are hunted in its government's packet.";

/** Our own spending guard refused a request before anything was sent; it is checked again on a fixed pace, not backed off. */
function refusedByOurOwnGuard(reason: string | null | undefined): boolean {
  return /SCOUT_POLICY_DENIED|refused before sending by Admin's spending or execution limits|DENIED_BY_POLICY/.test(reason ?? "");
}

/** A packet's jobs: the hunter's, and Exa's agent's when Admin turns that lane on. Each runs once per occurrence. */
async function huntOperation(runtime: AutonomousCoordinatorRuntime, item: WorkItem,
  knownHistory?: { readonly attempts: readonly Attempt[]; readonly routeTasks: readonly RouteTask[] }): Promise<AutonomousDecision> {
  const repos = runtime.repos;
  const now = (runtime.now ?? (() => new Date().toISOString()))();
  const decision = (action: AutonomousDecision["action"], reason: string, task: RouteTask | null = null): AutonomousDecision =>
    ({ workItemId: item.id, action, task, reason });
  let tasks = (knownHistory?.routeTasks ?? (await repos.routeTasks.listWhere(["workItemId"], item.id)).map(row => row.value)).filter(task => !task.workerTask);
  const hunter = tasks.find(task => task.routeId === HUNT_PACKET_ROUTE_ID);
  if (!hunter) return decision("BLOCKED", "This packet's job has not been opened yet.");
  if (runtime.exaAgentLane && !tasks.some(task => task.routeId === EXA_AGENT_ROUTE_ID)) {
    const created = createRouteTask({ workItemId: item.id, routeId: EXA_AGENT_ROUTE_ID, routeLabel: "Exa research agent on the same packet",
      target: item.subject, inherited: false, now });
    tasks = [...tasks, (await repos.routeTasks.read(created.id))?.value ?? (await registerRouteTask(repos, created, now)).value];
  }
  const attempts = knownHistory?.attempts ?? (await repos.attempts.listWhere(["workItemId"], item.id)).map(row => row.value);
  for (const task of tasks.filter(task => task.routeId === HUNT_PACKET_ROUTE_ID || runtime.exaAgentLane && task.routeId === EXA_AGENT_ROUTE_ID)) {
    const latest = attempts.filter(attempt => attempt.routeTaskId === task.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1);
    if (task.state === "POLICY_DENIED" && latest?.endedAt) {
      const recheckAt = Date.parse(latest.endedAt) + FIRST_BACKOFF_MINUTES * 60_000;
      if (Date.parse(now) < recheckAt) continue;
      const row = await repos.routeTasks.mustRead(task.id);
      const { policyDenial, ...rest } = row.value;
      if (!policyDenial || !refusedByOurOwnGuard(latest.abortReason) && !/TRANSPORT|COST/.test(latest.abortReason ?? "")) continue;
      const reopened = (await repos.routeTasks.compareAndSet(task.id, row.revision, { ...rest, state: "RECLAIMABLE",
        policyReauthorizations: [...(task.policyReauthorizations ?? []), { at: now, denial: policyDenial,
          reason: "Admin's limits refused the request before it was sent; the job goes back in line." }] }, now)).value;
      return decision("SCOUT", reopened.routeLabel, reopened);
    }
    if (!["PENDING", "RECLAIMABLE"].includes(task.state)) continue;
    if (latest?.endedAt && latest.outcome !== "COMPLETED" && Date.parse(now) < Date.parse(latest.endedAt) + FIRST_BACKOFF_MINUTES * 60_000) continue;
    return decision("SCOUT", task.routeLabel, task);
  }
  return tasks.filter(task=>task.routeId!==EXA_AGENT_ROUTE_ID || runtime.exaAgentLane).every(task => task.state === "DISPOSED")
    ? decision("STAGED", "This packet's job finished; every fact it reported is in the Box, and its blanks are recomputed before any next job.")
    : decision("BLOCKED", "This packet's job is running or waiting out a short backoff.");
}

/** Serve one item per hunt in each round; priority orders a round, never drains a whole hunt first. */
export function fairAutonomousWorkIds(items: readonly WorkItem[], lastServed: ReadonlyMap<string, string>,
  priorities: readonly { receiptId: string; priority: number }[] = [],
  /* Each Send's turns go round-robin over its mission parts, weighted by open blanks and difficulty. */
  squads?: { readonly partOf: (item: WorkItem) => string; readonly weightOf: (send: string, part: string) => number }): string[] {
  const priority = new Map(priorities.map(row => [row.receiptId, row.priority] as const));
  const groups = new Map<string, { priority: number; lastServed: string; items: WorkItem[] }>();
  for (const item of items) {
    const key = sendOf(item, priority);
    const group = groups.get(key) ?? { priority: priority.get(key) ?? Infinity, lastServed: "", items: [] };
    group.items.push(item);
    if ((lastServed.get(item.id) ?? "") > group.lastServed) group.lastServed = lastServed.get(item.id)!;
    groups.set(key, group);
  }
  const ordered = [...groups].sort(([ak, a], [bk, b]) =>
    a.priority - b.priority || a.lastServed.localeCompare(b.lastServed) || ak.localeCompare(bk));
  const partOf = squads?.partOf ?? ((item: WorkItem) => partOfItem(item));
  const sequences = ordered.map(([send, group]) => {
    group.items.sort((a, b) =>
      (lastServed.get(a.id) ?? "").localeCompare(lastServed.get(b.id) ?? "") ||
      (a.autonomousPlan?.capability === "voting-source-blanks" && b.autonomousPlan?.capability === "voting-source-blanks"
        ? (a.autonomousPlan.votingGoogleAvailable === false ? 0 : a.autonomousPlan.votingGoogleAvailable === true ? 2 : 1) -
          (b.autonomousPlan.votingGoogleAvailable === false ? 0 : b.autonomousPlan.votingGoogleAvailable === true ? 2 : 1) ||
          (b.autonomousPlan.subjectPopulation ?? -1) - (a.autonomousPlan.subjectPopulation ?? -1) : 0) ||
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const byPart = new Map<string, WorkItem[]>();
    for (const item of group.items) {
      const part = partOf(item);
      byPart.set(part, [...(byPart.get(part) ?? []), item]);
    }
    return interleaveByWeight([...byPart].sort(([a], [b]) => a.localeCompare(b))
      .map(([part, rows]) => ({ weight: squads ? squads.weightOf(send, part) : 1, items: rows })));
  });
  const ids: string[] = [];
  for (let round = 0; ids.length < items.length; round++) {
    for (const sequence of sequences) if (sequence[round]) ids.push(sequence[round].id);
  }
  return ids;
}

/** Execute a pending canonical task in a lease-owning worker process. */
export async function dispatchAutonomousTask(runtime: AutonomousCoordinatorRuntime, task: RouteTask): Promise<DispatchResult> {
  if (task.workerTask) return dispatchWorkerTask(runtime, task);
  const now = runtime.now ?? (() => new Date().toISOString());
  const spend=await readSpendWindow(runtime.repos,now());
  const item=(await runtime.repos.workItems.mustRead(task.workItemId)).value; const plan=item.autonomousPlan!;
  const denial=!runtime.scoutFor?"SCOUT_MODEL_TRANSPORT_UNAVAILABLE":!ceilingPermits(spend.windowUsd,runtime.rollingCeilingUsd ?? 0).permits?"SCOUT_COST_CEILING":null;
  const executor:DeclaredExecutor=denial?{lane:"BOUNDED_MODEL_WORKER",workerFor:({holder})=>({role:"SCOUT",provider:"unavailable",version:FLEET_POLICY_VERSION,instance:holder}),run:async()=>({kind:"ABORTED",ranAs:"BOUNDED_MODEL_WORKER",failureOutcome:"DENIED_BY_POLICY",endedAt:now(),cost:{...ZERO_COST,requestCount:0,inputTokens:0,outputTokens:0,usd:0},detail:`DENIED_BY_POLICY:${denial}`})}:await runtime.scoutFor!(item,task);
  // Charge the exact standing obligation that opened this WorkItem, with its Send marks.
  const owner = await owningObligation(runtime.repos, item.id, task.id);
  const assignments = owner?.value.assignments ?? [];
  return dispatchOne(runtime.repos,{obligation:{obligation:{id:task.id,subjectId:item.subject,recordClass:plan.contract.recordClass,
    routeId:task.routeId,active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null,assignments},nextDueAt:task.createdAt,cadenceHours:24,
    cadenceSource:"DEFAULT_NO_SIGNAL",basis:"One hunt packet job"},routeTaskId:task.id,holder:`autonomous:SCOUT:${randomUUID()}`,
    now:now(),clock:now,leaseTtlMs:300_000,bound:{maxAttempts:3,maxWallMs:hunterWallLimitMs(),maxCostUnits:0},
    maturity:()=>"UNGRADUATED",executor,methodVersion:runtime.methodVersion,policyVersion:FLEET_POLICY_VERSION,...proofChargeOf(item.project)});
}

/** The standing obligation whose occurrence opened this work item, when one did. */
async function owningObligation(repos: ControlPlaneRepositories, workItemId: string, routeTaskId: string) {
  const owningOccurrences = await repos.occurrences.listWhere(["workItemId"], workItemId);
  const occurrence = owningOccurrences.find(row => row.value.routeTaskId === routeTaskId)
    ?? (owningOccurrences.length === 1 ? owningOccurrences[0] : null);
  return occurrence === null ? null : await repos.obligations.read(occurrence.value.obligationId);
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
  /** This wave's open blanks by Send and part, for weighting each Send's turns. */
  squads?:SquadReading;
}={}) {
  const now = runtime.now ?? (()=>new Date().toISOString());
  const recovery=await sweepExpiredLeases(runtime.repos,{now:now(),observedBy:"autonomous-coordinator"});
  runtime={...runtime,exaAgentLane:await exaAgentEnabled(runtime.repos)};
  const allItems=await readCoordinatorWorkItems(runtime.repos,runtime.exaAgentLane);
  const open=await runtime.repos.dispatchState.readOpen();
  const snapshot=new Map([...open.workItems.values()].map(row=>[row.id,row.value] as const));
  for(const item of allItems) snapshot.set(item.id,item);
  options.onSelectionSnapshot?.([...snapshot.values()]);
  const candidates=allItems.filter(item=>item.autonomousPlan && (options.acceptsWorkItem?.(item) ?? true));
  const byItem=new Map(allItems.map(item=>[item.id,item] as const));
  const occurrenceRows=new Map<string,FreshnessOccurrence>();
  const duplicateLineageDeferred:{workItemId:string;reason:string;detail:string}[]=[];
  const items:{id:string;value:WorkItem}[]=[];
  for (const item of candidates) {
    let current:WorkItem|null=item;
    const seen=new Set<string>();
    let selectedRoot:string|null=null;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const occurrences=await runtime.repos.occurrences.listWhere(["workItemId"],current.id);
      for (const occurrence of occurrences) {
        occurrenceRows.set(occurrence.id,occurrence.value);
        const lineages=await runtime.repos.dispatchState.lineages(occurrence.value.obligationId,async()=>{
          const history=await readLineageHistory(runtime.repos,current!.id);
          return selectStandingLineages(history);
        });
        selectedRoot=lineages.find(lineage=>lineage.siblingRootIds.includes(current!.id))?.rootWorkItemId??null;
        if (selectedRoot) break;
      }
      if (selectedRoot) break;
      const parentId: string | undefined=(current as WorkItem & {readonly planRepair?:{readonly parentWorkItemId:string}}).planRepair?.parentWorkItemId;
      const parent:WorkItem|null=parentId?(byItem.get(parentId)??(await runtime.repos.workItems.read(parentId))?.value??null):null;
      current=parent?.project===item.project && parent.subject===item.subject?parent:null;
    }
    if (selectedRoot && current?.id!==selectedRoot) duplicateLineageDeferred.push({workItemId:item.id,reason:"DUPLICATE_PERIOD_LINEAGE",
      detail:`This recorded work remains open; source acquisition continues on canonical period root ${selectedRoot}.`});
    else items.push({id:item.id,value:item});
  }
  const itemSubjectById=new Map(items.map(row=>[row.id,row.value.subject] as const));
  const knownItems=items.map(row=>row.value);
  const lastServed=new Map<string,string>();
  for (const item of knownItems) {
    const attempts=await runtime.repos.attempts.listWhereNarrowed(["workItemId"],item.id,{startedAt:true});
    for (const attempt of attempts) {
      const at=(attempt.value as Pick<Attempt,"startedAt">).startedAt;
      if (at>(lastServed.get(item.id)??"")) lastServed.set(item.id,at);
    }
  }
  let weights:ReadonlyMap<string,SquadWeight>|null=null;
  if(options.squads) {
    const workByObligation=new Map([...occurrenceRows.values()].sort((a,b)=>a.id.localeCompare(b.id))
      .map(row=>[row.obligationId,row.workItemId] as const));
    const debts:{debt:FreshnessDebt;workItemId:string}[]=[];
    for (const [obligationId,workItemId] of workByObligation) {
      const row=await runtime.repos.debts.read(obligationId);
      if(row) debts.push({debt:row.value,workItemId});
    }
    const routeTasks:RouteTask[]=[];
    for (const item of knownItems) for (const row of await runtime.repos.routeTasks.listWhereNarrowed(["workItemId"],item.id,
      {workItemId:true,createdAt:true,workerTask:["role"]})) routeTasks.push(row.value as RouteTask);
    weights=squadWeights({items:knownItems,priority:new Map((options.prioritizedInstructions??[]).map(row=>[row.receiptId,row.priority] as const)),
      reading:options.squads,routeTasks,now:now(),debts});
  }
  const squadParts=options.squads?.parts;
  const ids=fairAutonomousWorkIds(items.map(row => row.value), lastServed, options.prioritizedInstructions,
    weights?{partOf:item=>partOfItem(item,squadParts),weightOf:(send,part)=>weights!.get(squadKey(send,part))?.weight??1}:undefined);
  const decisions:AutonomousDecision[]=[]; const dispatches:DispatchResult[]=[];
  const deferred:{workItemId:string;reason:string;detail:string}[]=[...duplicateLineageDeferred];
  const maximum=options.maximum??ids.length; const concurrency=Math.min(options.concurrency??Math.max(1,ids.length),Math.max(1,ids.length));
  // A caller may still pass a finite diagnostic
  // sub-cap; an unbounded value clamps to `maximum`.
  const maxScoutDispatches=Math.min(options.maxScoutDispatches??maximum,maximum);
  if (!Number.isSafeInteger(maximum)||maximum<0||!Number.isSafeInteger(concurrency)||concurrency<1||!Number.isSafeInteger(maxScoutDispatches)||maxScoutDispatches<0) throw new Error("AUTONOMOUS_COORDINATOR_BOUND_INVALID");

  let cursor=0; let admitted=0; let scoutsAdmitted=0; let scoutsLimitedAdmitted=0;
  const lanes=await Promise.allSettled(Array.from({length:concurrency},async()=>{
    while(cursor<ids.length && admitted<maximum) {
      const id=ids[cursor++];
      try {
      let d: AutonomousDecision;
      try {
        const [attempts,tasks,completedRecords]=await Promise.all([
          runtime.repos.attempts.listWhere(["workItemId"],id),runtime.repos.routeTasks.listWhere(["workItemId"],id),
          readCompletedWorkerResults(runtime.repos,id),
        ]);
        d=await nextAutonomousOperation(runtime,id,knownItems,{
          attempts:attempts.map(row=>row.value),routeTasks:tasks.map(row=>row.value),completedRecords,exaAgentEnabled:runtime.exaAgentLane,
        });
      } catch (error) {
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
  // `considered` lets a reader check the pass: every item is dispatched, deferred, or decided not to run.
  return {recovery,decisions,dispatches,scoutsAdmitted,scoutsLimitedAdmitted,deferred,considered:candidates.length,
    squadWeights:weights===null?[]:[...weights.values()]};
}
