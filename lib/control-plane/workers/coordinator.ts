import { BOX_PARSER_IMPLEMENTATION } from "./quoted-proof.ts";
import { readSpendWindow } from "../spend-window.ts";
import { randomUUID } from "node:crypto";
import type { WorkItem } from "../work-item.ts";
import { ZERO_COST, type Attempt } from "../attempt.ts";
import { createRouteTask, type RouteTask } from "../route-task.ts";
import { canonicalJson, RepositoryLockHeld, type ControlPlaneRepositories } from "../repository/types.ts";
import { isControlPlaneRequestTimeout } from "../repository/request-bounds.ts";
import { registerRouteTask } from "../repository/coordinator.ts";
import { dispatchOne, hunterWallLimitMs, proofChargeOf, sweepExpiredLeases, type DeclaredExecutor, type DispatchResult, type ReclaimSweep } from "../scheduler/dispatch.ts";
import { ceilingPermits, researchSpendInWindow } from "../scheduler/research-policy.ts";
import { dispatchWorkerTask, enqueueWorkerTask, FLEET_POLICY_VERSION, reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { readStandingLineages } from "./standing-lineage-read.ts";
import { forEachAggregate, withHistoryIndex, type HistoryIndex } from "./streamed-history.ts";
import { createPlannerSpool, plannerMap, type PlannerSpool } from "../scheduler/planner-spool.ts";
import { DiskRows } from "../scheduler/disk-rows.ts";
import { CONTROL_PLANE_QUERY_CONCURRENCY } from "../repository/pg-store.ts";
import { taskIdentity, type TaskIdentity } from "./task-identity.ts";
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
import { partOfItem, sendOf, SQUAD_DIFFICULTY_WINDOW_HOURS, type SquadReading, type SquadWeight } from "./squad-weights.ts";

/** Blocker codes an acquisition once recorded for robots.txt alone. A result carrying only these is re-acquired, never left refused. */
const ROBOTS_ONLY_BLOCKERS: ReadonlySet<string> = new Set(["PERMISSION_DENIED", "PERMISSION_UNKNOWN"]);

export interface AutonomousCoordinatorRuntime extends FleetRuntime {
  /** Release the shared pinned method snapshot after the runtime is no longer serving tasks. */
  readonly close?: () => Promise<void>;
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

/** Queue reporting needs identities and roles; the lease owner reads the complete task by id. */
type SelectedDecision = Omit<AutonomousDecision,"task"> & {readonly task: TaskIdentity|null};
function selectedDecision(decision: AutonomousDecision): SelectedDecision {
  const task = decision.task;
  return {...decision, task: task ? taskIdentity(task) : null};
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

/** Typed state chooses one next operation. Absence is never inferred from an empty list. */
export async function nextAutonomousOperation(runtime: AutonomousCoordinatorRuntime, workItemId: string, knownItems?: readonly WorkItem[],
  knownHistory?: { readonly attempts: readonly Attempt[]; readonly routeTasks: readonly RouteTask[];
    readonly completedRecords?: readonly WorkerResultRecord[] }): Promise<AutonomousDecision> {
  const repos = runtime.repos;
  // The coordinator already took a consistent candidate snapshot. Re-reading
  // each item is a costly point request for every owed subject and can consume
  // the entire runner selection wall before a held continuation is admitted.
  const item = knownItems?.find(row => row.id === workItemId) ?? (await repos.workItems.mustRead(workItemId)).value;
  const plan = item.autonomousPlan;
  const decision = (action:AutonomousDecision["action"],reason:string,task:RouteTask|null=null):AutonomousDecision => ({workItemId,action,task,reason});
  if (!plan) return decision("BLOCKED","No versioned autonomous work instructions are registered for this obligation.");
  if (isHuntPacketPlan(plan)) return huntOperation(runtime, item, knownHistory);
  type LinkedItem = WorkItem & { planRepair?: { parentWorkItemId: string; authority: string }; planRepairObservation?: { successorWorkItemId: string | null } };
  const children = (knownItems ?? (await repos.workItems.listWhere(["planRepair", "parentWorkItemId"], item.id))
    .map(row => row.value)).filter(row => (row as LinkedItem).planRepair?.parentWorkItemId === item.id);
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
  const readHeldArtifactIds = async () => {
    const required = plan.contract.schemaVersion === 2 ? plan.contract.verification.authorities.flatMap(authority =>
      [...authority.artifactIds, ...authority.authorityEvidenceArtifactIds]) : [];
    const held = new Set<string>();
    for (const id of new Set(required)) if ((await repos.artifacts.keysWhere(["artifactId"], id)).length) held.add(id);
    return held;
  };
  let heldArtifactIdsRead: Promise<Set<string>> | null = null;
  const heldArtifactIds = () => heldArtifactIdsRead ??= readHeldArtifactIds();
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
  for (const task of tasks.filter(task => task.routeId === HUNT_PACKET_ROUTE_ID || task.routeId === EXA_AGENT_ROUTE_ID)) {
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
  return tasks.every(task => task.state === "DISPOSED")
    ? decision("STAGED", "This packet's job finished; every fact it reported is in the Box, and its blanks are recomputed before any next job.")
    : decision("BLOCKED", "This packet's job is running or waiting out a short backoff.");
}

/** Execute a pending canonical task in a lease-owning worker process. */
export async function dispatchAutonomousTask(runtime: AutonomousCoordinatorRuntime, task: RouteTask): Promise<DispatchResult> {
  if (task.workerTask) return dispatchWorkerTask(runtime, task);
  const now = runtime.now ?? (() => new Date().toISOString());
  const spend=researchSpendInWindow(await readSpendWindow(runtime.repos,now()),now());
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

interface CoordinatorOptions {
  maximum?:number; concurrency?:number; deadlineMs?:number; maxScoutDispatches?:number;
  planOnly?:boolean;
  acceptsWorkItem?:(item:WorkItem)=>boolean;
  prioritizedInstructions?:readonly {receiptId:string;priority:number}[];
  admitDispatch?:(work:string)=>{admit:true}|{admit:false;code:string;why:string};
  squads?:SquadReading;
}
interface CollectedCoordinatorOptions extends CoordinatorOptions {
  readonly planner?:undefined;
  onSelectionSnapshot?:(items:readonly WorkItem[])=>void;
}
interface StreamedCoordinatorOptions extends CoordinatorOptions {
  readonly planner:PlannerSpool;
  onSelectionSnapshot?:(items:DiskRows<WorkItem>)=>void;
}
type CoordinatorDeferred={workItemId:string;reason:string;detail:string};
type CoordinatorRows<T,D extends boolean>=D extends true?DiskRows<T>:T[];
interface CoordinatorReading<D extends boolean> {
  readonly recovery:ReclaimSweep<boolean>;
  readonly decisions:CoordinatorRows<SelectedDecision,D>;
  readonly dispatches:CoordinatorRows<DispatchResult,D>;
  readonly scoutsAdmitted:number;
  readonly scoutsLimitedAdmitted:number;
  readonly deferred:CoordinatorRows<CoordinatorDeferred,D>;
  readonly considered:number;
  readonly squadWeights:CoordinatorRows<SquadWeight,D>;
}
interface OrderedWork {readonly id:string;readonly body:string;readonly served:string;readonly group_priority:string;readonly group_served:string;readonly send:string}

/** Order each Send and its own places using two disk cursors. */
function sortCoordinatorWork(db:HistoryIndex,count:number):void {
  const statement=`SELECT w.id,w.body,w.served,w.send,g.priority AS group_priority,g.served AS group_served
    FROM work w JOIN groups g ON g.send=w.send WHERE w.selected=1 AND w.item_order>=? AND w.item_order<? ORDER BY w.item_order`;
  const compare=(a:OrderedWork,b:OrderedWork):number=>{
    const groups=Number(a.group_priority)-Number(b.group_priority)||a.group_served.localeCompare(b.group_served)||a.send.localeCompare(b.send);
    if(groups)return groups;
    const left=JSON.parse(a.body) as WorkItem,right=JSON.parse(b.body) as WorkItem;
    return a.served.localeCompare(b.served)||
      (left.autonomousPlan?.capability==="voting-source-blanks"&&right.autonomousPlan?.capability==="voting-source-blanks"
        ?(right.autonomousPlan.subjectPopulation??-1)-(left.autonomousPlan.subjectPopulation??-1):0)||
      left.createdAt.localeCompare(right.createdAt)||left.id.localeCompare(right.id);
  };
  const put=db.prepare("INSERT INTO sorting VALUES(?,?)");
  let initial=0;
  for(const row of db.prepare("SELECT id FROM work WHERE selected=1 ORDER BY item_order").iterate())put.run(row.id,initial++);
  db.exec("UPDATE work SET item_order=(SELECT rank FROM sorting WHERE sorting.id=work.id) WHERE selected=1");
  for(let width=1;width<count;width*=2){
    db.exec("DELETE FROM sorting");let rank=0;
    for(let start=0;start<count;start+=2*width){
      const a=db.prepare(statement).iterate(start,start+width)[Symbol.iterator]();
      const b=db.prepare(statement+" /* right */").iterate(start+width,start+2*width)[Symbol.iterator]();
      let left=a.next(),right=b.next();
      while(!left.done||!right.done){
        const useLeft=right.done||!left.done&&!(compare(left.value as unknown as OrderedWork,right.value as unknown as OrderedWork)>0);
        const chosen=useLeft?left.value!:right.value!;put.run(chosen.id,rank++);
        if(useLeft)left=a.next();else right=b.next();
      }
    }
    db.exec("UPDATE work SET item_order=(SELECT rank FROM sorting WHERE sorting.id=work.id) WHERE selected=1");
  }
}

export function runAutonomousCoordinator(runtime:AutonomousCoordinatorRuntime,options:StreamedCoordinatorOptions):Promise<CoordinatorReading<true>>;
export function runAutonomousCoordinator(runtime:AutonomousCoordinatorRuntime,options?:CollectedCoordinatorOptions):Promise<CoordinatorReading<false>>;
export async function runAutonomousCoordinator(runtime:AutonomousCoordinatorRuntime,options:StreamedCoordinatorOptions|CollectedCoordinatorOptions={}):Promise<CoordinatorReading<true>|CoordinatorReading<false>> {
  if(!options.planner&&process.env.NODE_ENV==="production")throw new Error("AUTONOMOUS_COORDINATOR_PLANNER_REQUIRED");
  const owned=options.planner?null:await createPlannerSpool(),planner=options.planner??owned!;
  const prefix=`coordinator:${randomUUID()}`;
  const output=<T>(name:string)=>{
    let count=0;
    const table=planner.table<{id:string;order:number;value:T}>(`${prefix}:${name}`,row=>row.id);
    return {add:(value:T,order?:number)=>{const id=count++;table.add({id:String(id),order:order??id,value});},
      rows:table.rowsBy([["order"]]).map(row=>row.value)};
  };
  const decisions=output<SelectedDecision>("decisions"),dispatches=output<DispatchResult>("dispatches"),deferred=output<CoordinatorDeferred>("deferred"),weightRows=output<SquadWeight>("weights");
  const summaries=planner.table<WorkItem>(`${prefix}:snapshot`,row=>row.id);
  try{return await withHistoryIndex(async db=>{
    const now=runtime.now??(()=>new Date().toISOString());
    const recovery=options.planner
      ?await sweepExpiredLeases(runtime.repos,{now:now(),observedBy:"autonomous-coordinator",sink:{
        reclaimed:output<string>("recovery-reclaimed"),releasedSettled:output<string>("recovery-settled"),
        stillLive:output<string>("recovery-live"),refused:output<{routeTaskId:string;why:string}>("recovery-refused"),
      }})
      :await sweepExpiredLeases(runtime.repos,{now:now(),observedBy:"autonomous-coordinator"});
    db.exec(`CREATE TABLE work(id TEXT PRIMARY KEY,body TEXT NOT NULL,accepted INTEGER NOT NULL,selected INTEGER NOT NULL DEFAULT 0,
      served TEXT NOT NULL DEFAULT '',send TEXT NOT NULL DEFAULT '',part TEXT NOT NULL DEFAULT '',item_order INTEGER NOT NULL);
      CREATE TABLE roots(id TEXT PRIMARY KEY,canonical TEXT NOT NULL);
      CREATE TABLE occurrences(obligation TEXT PRIMARY KEY,work_id TEXT,first_index INTEGER NOT NULL);
      CREATE TABLE groups(send TEXT PRIMARY KEY,priority REAL NOT NULL,served TEXT NOT NULL,turns INTEGER NOT NULL DEFAULT 0,debts INTEGER NOT NULL DEFAULT 0,rank INTEGER);
      CREATE TABLE parts(send TEXT NOT NULL,part TEXT NOT NULL,remaining INTEGER NOT NULL DEFAULT 0,turns INTEGER NOT NULL DEFAULT 0,debts INTEGER NOT NULL DEFAULT 0,
        weight REAL NOT NULL DEFAULT 1,current REAL NOT NULL DEFAULT 0,first_index INTEGER NOT NULL,part_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(send,part));
      CREATE TABLE sorting(id TEXT PRIMARY KEY,rank INTEGER NOT NULL);
      CREATE TABLE sequences(send TEXT NOT NULL,seq INTEGER NOT NULL,id TEXT NOT NULL,PRIMARY KEY(send,seq));
      CREATE TABLE queue(rank INTEGER PRIMARY KEY,id TEXT NOT NULL);
      CREATE INDEX work_part ON work(selected,send,part,item_order);
      CREATE INDEX work_selection_order ON work(selected,item_order);`);
    let seen=0,considered=0;
    const putWork=db.prepare("INSERT INTO work(id,body,accepted,item_order) VALUES(?,?,?,?)");
    await forEachAggregate(runtime.repos.workItems,async row=>{
      const item=row.value,plan=item.autonomousPlan;
      const summary={id:item.id,project:item.project,subject:item.subject,createdAt:item.createdAt,
        ...("planRepair"in item?{planRepair:{parentWorkItemId:(item as WorkItem&{planRepair:{parentWorkItemId:string}}).planRepair.parentWorkItemId}}:{}),
        ...(plan?{autonomousPlan:{capability:plan.capability,subjectPopulation:plan.subjectPopulation,jurisdiction:plan.jurisdiction,
          ownerInstructions:plan.ownerInstructions,missionPart:plan.missionPart,contract:{recordClass:plan.contract.recordClass}}}:{})} as WorkItem;
      const accepted=!!plan&&(options.acceptsWorkItem?options.acceptsWorkItem((await runtime.repos.workItems.mustRead(item.id)).value):true);
      summaries.add(summary);putWork.run(item.id,JSON.stringify(summary),Number(accepted),seen++);if(accepted)considered++;
    },{id:true,project:true,subject:true,createdAt:true,planRepair:["parentWorkItemId"],autonomousPlan:{capability:true,subjectPopulation:true,jurisdiction:true,ownerInstructions:true,missionPart:true,contract:["recordClass"]}});
    if(options.planner)(options as StreamedCoordinatorOptions).onSelectionSnapshot?.(summaries.rows);
    else (options as CollectedCoordinatorOptions).onSelectionSnapshot?.([...summaries.rows]);
    const served=db.prepare("UPDATE work SET served=MAX(served,?) WHERE id=?");
    await forEachAggregate(runtime.repos.attempts,row=>{served.run(row.value.startedAt,row.value.workItemId);},{workItemId:true,startedAt:true});
    let occurrenceAt=0;
    const occurrence=db.prepare("INSERT INTO occurrences VALUES(?,?,?) ON CONFLICT(obligation) DO UPDATE SET work_id=CASE WHEN excluded.work_id='' THEN occurrences.work_id ELSE excluded.work_id END");
    await forEachAggregate(runtime.repos.occurrences,row=>{occurrence.run(row.value.obligationId,row.value.workItemId??"",occurrenceAt++);},{obligationId:true,workItemId:true});
    const root=db.prepare("INSERT OR REPLACE INTO roots VALUES(?,?)");
    for(const held of db.prepare("SELECT obligation FROM occurrences ORDER BY first_index").iterate())
      for(const lineage of await readStandingLineages(runtime.repos,[held.obligation]))for(const id of lineage.siblingRootIds)root.run(id,lineage.rootWorkItemId);
    const work=db.prepare("SELECT body,served,send,part FROM work WHERE id=?"),canonical=db.prepare("SELECT canonical FROM roots WHERE id=?");
    const lineageRoot=(item:WorkItem):string|null=>{
      let current=item;const visited=new Set<string>();
      while(!canonical.get(current.id)){
        if(visited.has(current.id))return null;visited.add(current.id);
        const parentId=(current as WorkItem&{planRepair?:{parentWorkItemId:string}}).planRepair?.parentWorkItemId;
        const held=parentId?work.get(parentId):undefined,parent=held?JSON.parse(held.body) as WorkItem:undefined;
        if(!parent||parent.project!==item.project||parent.subject!==item.subject)return null;current=parent;
      }
      return current.id;
    };
    const priority=plannerMap<number>(planner,`${prefix}:priority`);
    for(const row of options.prioritizedInstructions??[])priority.set(row.receiptId,row.priority);
    const select=db.prepare("UPDATE work SET selected=1,send=?,part=? WHERE id=?");
    const group=db.prepare("INSERT INTO groups(send,priority,served) VALUES(?,?,?) ON CONFLICT(send) DO UPDATE SET served=MAX(groups.served,excluded.served)");
    const part=db.prepare("INSERT INTO parts(send,part,remaining,first_index) VALUES(?,?,1,?) ON CONFLICT(send,part) DO UPDATE SET remaining=parts.remaining+1");
    let count=0;
    for(const held of db.prepare("SELECT id,body,served,item_order FROM work WHERE accepted=1 ORDER BY item_order").iterate()){
      const item=JSON.parse(held.body) as WorkItem,ancestor=lineageRoot(item),chosen=ancestor?canonical.get(ancestor)?.canonical:null;
      if(ancestor&&chosen!==ancestor){deferred.add({workItemId:item.id,reason:"DUPLICATE_PERIOD_LINEAGE",detail:`This recorded work remains open; source acquisition continues on canonical period root ${chosen}.`});continue;}
      const send=sendOf(item,priority),mission=partOfItem(item,options.squads?.parts);
      select.run(send,mission,item.id);group.run(send,priority.get(send)??Infinity,held.served);part.run(send,mission,Number(held.item_order));count++;
    }
    if(options.squads){
      const since=Date.parse(now())-SQUAD_DIFFICULTY_WINDOW_HOURS*3_600_000,turn=db.prepare("UPDATE parts SET turns=turns+1 WHERE send=? AND part=?"),sendTurn=db.prepare("UPDATE groups SET turns=turns+1 WHERE send=?");
      await forEachAggregate(runtime.repos.routeTasks,row=>{
        if(row.value.workerTask?.role!=="DETECTIVE"||!(Date.parse(row.value.createdAt)>=since))return;
        const own=db.prepare("SELECT send,part FROM work WHERE selected=1 AND id=?").get(row.value.workItemId);
        if(own){turn.run(own.send,own.part);sendTurn.run(own.send);}
      },{workItemId:true,createdAt:true,workerTask:["role"]});
      const debt=db.prepare("UPDATE parts SET debts=debts+1 WHERE send=? AND part=?"),sendDebt=db.prepare("UPDATE groups SET debts=debts+1 WHERE send=?");
      await forEachAggregate(runtime.repos.debts,row=>{
        const own=db.prepare("SELECT w.send,w.part FROM work w JOIN occurrences o ON o.work_id=w.id WHERE w.selected=1 AND o.obligation=?").get(row.value.obligationId);
        if(own){debt.run(own.send,own.part);sendDebt.run(own.send);}
      },{obligationId:true});
      for(const held of db.prepare("SELECT p.*,g.turns AS send_turns,g.debts AS send_debts FROM parts p JOIN groups g ON p.send=g.send ORDER BY p.send,p.part").iterate()){
        const open=options.squads.open.get(held.send),n=open?open.get(held.part)??0:null;
        const detectiveTurns=Number(held.turns),openDebts=Number(held.debts),difficulty=1+(Number(held.send_turns)?detectiveTurns/Number(held.send_turns):0)+(Number(held.send_debts)?openDebts/Number(held.send_debts):0);
        const weight=n===null?difficulty:n*difficulty;
        db.prepare("UPDATE parts SET weight=? WHERE send=? AND part=?").run(weight,held.send,held.part);
        weightRows.add({send:held.send,part:held.part,open:n,detectiveTurns,openDebts,weight},Number(held.first_index));
      }
    }
    sortCoordinatorWork(db,count);
    // JavaScript's locale comparison and stable first occurrence also order mission-part ties.
    const partRows="SELECT p.part,MIN(w.item_order) AS first_at FROM parts p JOIN work w ON w.send=p.send AND w.part=p.part WHERE p.send=? AND w.selected=1 GROUP BY p.part";
    for(const send of db.prepare("SELECT send FROM groups").iterate())for(const lane of db.prepare(partRows).iterate(send.send)){
      let rank=0;
      for(const other of db.prepare(partRows).iterate(send.send)){
        const comparison=other.part.localeCompare(lane.part);
        if(comparison<0||comparison===0&&Number(other.first_at)<Number(lane.first_at))rank++;
      }
      db.prepare("UPDATE parts SET part_order=? WHERE send=? AND part=?").run(rank,send.send,lane.part);
    }
    let groupRank=0,lastGroup:string|undefined;
    for(const row of db.prepare("SELECT send FROM work WHERE selected=1 ORDER BY item_order").iterate())if(row.send!==lastGroup){db.prepare("UPDATE groups SET rank=? WHERE send=?").run(groupRank++,row.send);lastGroup=row.send;}
    const sequence=db.prepare("INSERT INTO sequences VALUES(?,?,?)"),takePart=db.prepare("SELECT id FROM work WHERE selected=1 AND send=? AND part=? ORDER BY item_order LIMIT 1");
    for(const send of db.prepare("SELECT send FROM groups ORDER BY rank").iterate()){
      let seq=0;
      const take=(mission:string)=>{const own=takePart.get(send.send,mission)!;sequence.run(send.send,seq++,own.id);db.prepare("UPDATE work SET selected=2 WHERE id=?").run(own.id);db.prepare("UPDATE parts SET remaining=remaining-1 WHERE send=? AND part=?").run(send.send,mission);};
      for(;;){
        let total=0,best:{part:string;current:number}|undefined;
        for(const lane of db.prepare("SELECT part,weight,current FROM parts WHERE send=? AND remaining>0 AND weight>0 ORDER BY part_order").iterate(send.send)){
          const current=Number(lane.current)+Number(lane.weight);total+=Number(lane.weight);
          db.prepare("UPDATE parts SET current=? WHERE send=? AND part=?").run(current,send.send,lane.part);
          if(!best||current>best.current)best={part:lane.part,current};
        }
        if(!best)break;
        db.prepare("UPDATE parts SET current=? WHERE send=? AND part=?").run(best.current-total,send.send,best.part);take(best.part);
      }
      for(;;){let moved=false;for(const lane of db.prepare("SELECT part FROM parts WHERE send=? AND remaining>0 ORDER BY part_order").iterate(send.send)){take(lane.part);moved=true;}if(!moved)break;}
    }
    let rank=0;for(const row of db.prepare("SELECT s.id FROM sequences s JOIN groups g ON g.send=s.send ORDER BY s.seq,g.rank").iterate())db.prepare("INSERT INTO queue VALUES(?,?)").run(rank++,row.id);
    const maximum=options.maximum??count,concurrency=Math.min(options.concurrency??CONTROL_PLANE_QUERY_CONCURRENCY,Math.max(1,count));
    const maxScoutDispatches=Math.min(options.maxScoutDispatches??maximum,maximum);
    if(!Number.isSafeInteger(maximum)||maximum<0||!Number.isSafeInteger(concurrency)||concurrency<1||!Number.isSafeInteger(maxScoutDispatches)||maxScoutDispatches<0)throw new Error("AUTONOMOUS_COORDINATOR_BOUND_INVALID");
    let cursor=0,admitted=0,scoutsAdmitted=0,scoutsLimitedAdmitted=0;
    const queue=db.prepare("SELECT id FROM queue WHERE rank=?");
    const lanes=await Promise.allSettled(Array.from({length:concurrency},async()=>{
      while(cursor<count&&admitted<maximum){
        const position=cursor++,id=queue.get(position)!.id;
        try{
          let d:AutonomousDecision;
          try{d=await nextAutonomousOperation(runtime,id);}
          catch(error){
            if(error instanceof Error&&/^WORKER_ARTIFACT_MISSING_OR_PARTIAL(?::|$)/.test(error.message)){d={workItemId:id,action:"BLOCKED",task:null,reason:`${error.message}; source reference remains unresolved`};deferred.add({workItemId:id,reason:"WORKER_ARTIFACT_MISSING_OR_PARTIAL",detail:d.reason});}
            else if(isControlPlaneRequestTimeout(error)&&error.kind==="DEADLINE"){deferred.add({workItemId:id,reason:"WALL_CLOCK_CEILING",detail:"the bounded cycle ended during repository selection; this work remains owed"});break;}
            else throw error;
          }
          decisions.add(selectedDecision(d),position);
          if(!d.task||!["WORKER","SCOUT"].includes(d.action))continue;
          if(admitted>=maximum){deferred.add({workItemId:id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached; work remains owed`});continue;}
          const subject=(JSON.parse(work.get(id)!.body) as WorkItem).subject,lifetimeScout=runtime.lifetimeHuntSubject?.(subject)===true;
          if(d.action==="SCOUT"&&!lifetimeScout&&scoutsLimitedAdmitted>=maxScoutDispatches){deferred.add({workItemId:id,reason:"SCOUT_CYCLE_MAX",detail:`Scout maximum ${maxScoutDispatches} reached; work remains owed`});continue;}
          if(options.planOnly)continue;
          const aggregate=options.admitDispatch?.(d.task.id)??{admit:true as const};
          if(!aggregate.admit){deferred.add({workItemId:id,reason:aggregate.code,detail:`${aggregate.why}; work remains owed`});continue;}
          admitted++;
          if(d.action==="WORKER"){dispatches.add(await dispatchWorkerTask(runtime,d.task));continue;}
          scoutsAdmitted++;if(!lifetimeScout)scoutsLimitedAdmitted++;
          dispatches.add(await dispatchAutonomousTask(runtime,d.task));
        }catch(error){if(!(error instanceof RepositoryLockHeld))throw error;deferred.add({workItemId:id,reason:"REPOSITORY_LOCK_HELD",detail:error.message});}
      }
    }));
    const failed=lanes.find((lane):lane is PromiseRejectedResult=>lane.status==="rejected");if(failed)throw failed.reason;
    for(const row of db.prepare("SELECT id FROM queue WHERE rank>=? ORDER BY rank").iterate(cursor))deferred.add(admitted>=maximum
      ?{workItemId:row.id,reason:"COORDINATOR_CYCLE_MAX",detail:`cycle maximum ${maximum} reached before this registered work item; work remains owed`}
      :{workItemId:row.id,reason:"WALL_CLOCK_CEILING",detail:"insufficient cycle wall time remained before this registered work item; work remains owed"});
    const common={recovery,scoutsAdmitted,scoutsLimitedAdmitted,considered};
    return options.planner?{...common,decisions:decisions.rows,dispatches:dispatches.rows,deferred:deferred.rows,squadWeights:weightRows.rows}
      :{...common,decisions:[...decisions.rows],dispatches:[...dispatches.rows],deferred:[...deferred.rows],squadWeights:[...weightRows.rows]};
  });}finally{await owned?.close();}
}
