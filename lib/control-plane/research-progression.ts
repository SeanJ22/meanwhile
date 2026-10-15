import type { MethodCandidate } from "../method/candidate.ts";
import type { ConclusionRecord } from "../method/conclusions.ts";
import type { MethodKnowledge, MethodRoute } from "../method/knowledge.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type { TransitionRecord } from "./promotion/types.ts";
import { deriveItemState, isPipelineRecord, validateTransition } from "./promotion/pipeline.ts";
import { isWindowRunRecord } from "./promotion/window.ts";
import { readAutonomousActivity, type AutonomousObligationActivity } from "./workers/activity.ts";
import type { WorkerResultRecord } from "./workers/types.ts";
import type { ScoutResult } from "./scheduler/scout-result.ts";

export const RESEARCH_MILESTONES = ["discovered", "acquired", "extracted", "canonicallyLinked", "verified", "audited", "promotionReady"] as const;
export type ResearchMilestone = (typeof RESEARCH_MILESTONES)[number];
interface MilestoneEvidence { readonly workItemId: string; readonly at: string; readonly evidenceId: string }
export interface ResearchMilestoneCount {
  readonly unit: "DISTINCT_OBLIGATIONS";
  readonly newlyReached: number;
  readonly reachedByWindowEnd: number;
  readonly evidence: readonly MilestoneEvidence[];
}
export interface ResearchBottleneck {
  readonly code: string;
  readonly affectedObligationCount: number;
  readonly states: readonly string[];
  readonly bodiesOrAuthorities: number;
  readonly recordClasses: readonly string[];
  readonly oldestObligationAt: string;
  readonly oldestAgeHours: number;
  readonly ageBasis: "AFFECTED_OBLIGATION_CREATION";
  readonly owningWorkerGroup: string;
  readonly reusableAction: string;
  /** Names and source details belong in drill-down, never one top-level row per fact. */
  readonly drillDown: readonly { workItemId: string; subject: string; evidenceIds: readonly string[] }[];
}
export interface ResearchWindowProgression {
  readonly formatVersion: 1;
  readonly windowId: string;
  readonly windowKind: "NIGHTLY_PROMOTION" | "RESEARCH_CYCLE";
  readonly previousCompletedWindowId: string | null;
  readonly since: string;
  readonly through: string;
  readonly interval: "PREVIOUS_COMPLETED_WINDOW_EXCLUSIVE_TO_THIS_WINDOW_INCLUSIVE";
  readonly scope: { readonly kind: "REGISTERED_AUTONOMOUS_CIVIC_PLANS"; readonly obligations: number; readonly excludedUnclassifiedWorkItems: number };
  readonly milestones: Readonly<Record<ResearchMilestone, ResearchMilestoneCount>>;
  /** Work performed is separate from first-ever milestones; a refresh is not a new fact. */
  readonly activity: {
    readonly obligationsWorked: number;
    readonly newEvidenceArtifacts: number;
    readonly completedResults: readonly { role: string; verdict: string; count: number; evidenceIds: readonly string[] }[];
  };
  readonly promoted: { readonly count: number | null; readonly unit: "RECORDS"; readonly reason: string };
  readonly readerVisible: { readonly count: number | null; readonly unit: "RECORDS"; readonly reason: string };
  readonly reopened: readonly { workItemId: string; at: string; reason: string }[];
  readonly regressions: readonly { workItemId: string; at: string; evidenceId: string; role: string; verdict: string }[];
  readonly methodSnapshotVersion: number;
  readonly admittedMethods: readonly { candidateId: string; routeId: string; at: string; methodVersion: number; applicability: MethodRoute["applicability"] | null }[];
  readonly reopenedConclusions: readonly { conclusionId: string; workItemId: string | null; routeId: string; earnedAtVersion: number; at: string; windowAttribution: "EXACT" | "DATE_ONLY_UNATTRIBUTABLE" }[];
  readonly candidateMethods: readonly string[];
  readonly bottlenecks: readonly ResearchBottleneck[];
  readonly evidenceGaps: readonly string[];
}

function instant(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`RESEARCH_WINDOW_CLOCK_INVALID:${value}`);
  return result;
}
const survived = (r: WorkerResultRecord): boolean => ["ACQUIRED", "EXTRACTED", "SUPPORTED", "PASS", "SURVIVED"].includes(r.result.verdict);
const independentlyVerified = (r: WorkerResultRecord): boolean => r.result.role === "VALIDATOR" && r.result.verdict === "PASS" &&
  Boolean(r.result.externalVerifications?.length) && r.result.externalVerifications!.every(v =>
    v.verdict === "PASS" && v.candidateCount > 0 && (v.authorityCount ?? 0) > 0 && v.evidence.length > 0 && v.verifiedAt !== null && instant(v.verifiedAt) <= instant(r.endedAt));

/** Pure replay of canonical evidence. Counts never certify a fact or mutate an obligation. */
export function projectResearchProgression(input: {
  readonly windowId: string; readonly previousCompletedWindowId: string | null;
  readonly windowKind?: "NIGHTLY_PROMOTION" | "RESEARCH_CYCLE";
  readonly since: string; readonly through: string;
  readonly activities: readonly AutonomousObligationActivity[];
  readonly excludedUnclassifiedWorkItems: number;
  readonly candidates: readonly MethodCandidate[];
  readonly knowledge: MethodKnowledge;
  readonly conclusions: readonly ConclusionRecord[];
}): ResearchWindowProgression {
  const start = instant(input.since), end = instant(input.through);
  if (end < start || !input.windowId) throw new Error("RESEARCH_WINDOW_INVALID");
  const inWindow = (at: string) => instant(at) > start && instant(at) <= end;
  const beforeEnd = (at: string) => instant(at) <= end;
  const rows = input.activities.filter(a => a.workItem.autonomousPlan && beforeEnd(a.workItem.createdAt));
  const events = Object.fromEntries(RESEARCH_MILESTONES.map(k => [k, []])) as unknown as Record<ResearchMilestone, MilestoneEvidence[]>;
  const reopened: ResearchWindowProgression["reopened"][number][] = [];
  const regressions: ResearchWindowProgression["regressions"][number][] = [];
  const gaps = new Set<string>();
  const groups = new Map<string, { owner: string; action: string; rows: Map<string, { activity: AutonomousObligationActivity; evidenceIds: string[] }> }>();
  const worked=new Set<string>(),newArtifacts=new Set<string>();
  const completed=new Map<string,{role:string;verdict:string;ids:Set<string>}>();
  const completedResult=(workItemId:string,role:string,verdict:string,id:string)=>{
    worked.add(workItemId); const key=`${role}:${verdict}`;
    const group=completed.get(key)??{role,verdict,ids:new Set<string>()}; group.ids.add(id);completed.set(key,group);
  };
  const block = (code: string, a: AutonomousObligationActivity, owner: string, action: string, evidenceId: string) => {
    let group = groups.get(code);
    if (!group) { group = { owner, action, rows: new Map() }; groups.set(code, group); }
    const held = group.rows.get(a.workItem.id) ?? { activity: a, evidenceIds: [] };
    held.evidenceIds.push(evidenceId); group.rows.set(a.workItem.id, held);
  };
  for (const a of rows) {
    const id = a.workItem.id;
    const add = (stage: ResearchMilestone, at: string, evidenceId: string) => events[stage].push({ workItemId: id, at, evidenceId });
    add("discovered", a.workItem.createdAt, id);
    for(const artifact of a.facts.artifacts) if(inWindow(artifact.recordedAt) && a.facts.attempts.some(attempt=>attempt.id===artifact.attemptId && attempt.outcome==="COMPLETED" && attempt.endedAt && beforeEnd(attempt.endedAt))) newArtifacts.add(artifact.artifactId);
    for(const scout of a.facts.scouts) if(inWindow(scout.recordedAt) && a.facts.attempts.some(attempt=>attempt.id===scout.attemptId && attempt.outcome==="COMPLETED")) completedResult(id,"SCOUT",scout.outcome,scout.attemptId);
    a.evidenceGaps.forEach(g => gaps.add(`${id}:${g}`));
    const proved = new Set(a.timeline.filter(e => e.kind === "WORKER_RESULT" && beforeEnd(e.at)).map(e => e.id));
    const workers = a.facts.workers.filter(r => proved.has(r.id) && !a.evidenceGaps.includes(`WORKER_WALK_ATTRIBUTION_UNPROVEN:${r.id}`) && r.completion.completedTask.workerTask?.purpose !== "DIAGNOSTIC_REPLAY")
      .sort((x,y) => x.endedAt.localeCompare(y.endedAt) || x.id.localeCompare(y.id));
    const latest = new Map<string, WorkerResultRecord>();
    for (const r of workers) {
      if(inWindow(r.endedAt)) completedResult(id,r.result.role,r.result.verdict,r.id);
      const prior = latest.get(r.result.role);
      if (prior && survived(prior) && !survived(r) && inWindow(r.endedAt)) regressions.push({ workItemId: id, at: r.endedAt, evidenceId: r.id, role: r.result.role, verdict: r.result.verdict });
      latest.set(r.result.role, r);
      if (r.result.role === "ACQUIRER" && r.result.verdict === "ACQUIRED" && r.result.artifacts.some(art => art.byteCount > 0)) add("acquired", r.endedAt, r.id);
      if (r.result.role === "PARSER" && r.result.verdict === "EXTRACTED" && r.result.actualRowCount > 0) add("extracted", r.endedAt, r.id);
      if (independentlyVerified(r) && workers.some(p => r.inputResultIds.includes(p.id) && p.result.role === "PARSER" && p.result.verdict === "EXTRACTED" && instant(p.endedAt) <= instant(r.endedAt))) add("verified",r.endedAt,r.id);
      if (r.result.role === "ADVERSARIAL_AUDITOR" && r.result.verdict === "SURVIVED" && workers.some(v => r.inputResultIds.includes(v.id) && independentlyVerified(v) && instant(v.endedAt) <= instant(r.endedAt))) add("audited",r.endedAt,r.id);
    }
    // Revalidate the existing single-door chain rather than trust stage labels or legacy validator PASS.
    const accepted: TransitionRecord[] = [];
    const pipeline = a.facts.promotion.filter(isPipelineRecord).filter(r => beforeEnd(r.at)).sort((x,y) => x.at.localeCompare(y.at));
    for (const r of pipeline) {
      if (r.stage === "REFUSED") continue;
      const worker = r.stage === "VERIFIED" && r.workerResultId ? workers.find(w => w.id === r.workerResultId) : null;
      if (r.stage === "VERIFIED" && (!worker || worker.result.role !== "VALIDATOR" || !worker.result.externalVerifications?.length || worker.result.externalVerifications.some(v => v.verdict !== "PASS"))) {
        gaps.add(`${id}:INDEPENDENT_VERIFICATION_NOT_REPRODUCED:${r.recordId}`); continue;
      }
      const chain = accepted.filter(p => p.itemId === r.itemId);
      const decision = validateTransition(deriveItemState(r.itemId, chain), r, {
        artifactById: artifactId => [...a.facts.artifacts, ...a.referencedArtifacts].find(art => art.artifactId === artifactId && instant(art.recordedAt) <= instant(r.at)) ?? null,
        attemptRoleById: attemptId => [...a.facts.attempts, ...a.referencedAttempts].find(at => at.id === attemptId)?.worker.role ?? null,
        workerResultById: workerId => workers.find(w => w.id === workerId && instant(w.endedAt) <= instant(r.at)) ?? null,
      });
      if (!decision.ok) { gaps.add(`${id}:PIPELINE_REPLAY_REFUSED:${r.recordId}`); continue; }
      accepted.push(r);
      if (r.stage === "VERIFIED") { add("verified",r.at,r.recordId); if (r.checks.some(c => c.name === "CANONICAL_IDENTITY_UNIQUE" && c.result === "PASS")) add("canonicallyLinked",r.at,r.recordId); }
      if (r.stage === "APPROVED_FOR_PROMOTION") add("promotionReady",r.at,r.recordId);
    }
    for (const t of a.workItem.transitions) if (t.to === "REOPENED" && inWindow(t.at)) reopened.push({ workItemId:id,at:t.at,reason:t.why });
    const parser = latest.get("PARSER"), detective = latest.get("DETECTIVE"), verifier = latest.get("VALIDATOR"), auditor = latest.get("ADVERSARIAL_AUDITOR"), acquirer = latest.get("ACQUIRER");
    if (!acquirer) block("ACQUISITION_NOT_RECORDED",a,"Scout / Acquirer","Walk the inherited applicable public routes for the registered obligation.",id);
    if (acquirer && !parser) block("EXTRACTION_NOT_RECORDED",a,"Parser / Engineering","Parse held evidence through its exact record-class contract.",acquirer.id);
    if (parser?.result.role === "PARSER" && parser.result.verdict !== "EXTRACTED") {
      const reasons = parser.result.warnings.filter(w => w.severity === "BLOCKING");
      for (const reason of reasons.length ? reasons : [{ code:"EXTRACTION_FAILED" }]) block(reason.code,a,"Parser / Engineering","Repair the reusable source binding or extraction procedure named by the worker failure.",parser.id);
    }
    if (detective?.result.role === "DETECTIVE" && detective.result.identity.state === "UNRESOLVED") block("IDENTITY_UNRESOLVED",a,"Detective","Bind each record to its canonical identity using independent official evidence.",detective.id);
    if (parser?.result.verdict === "EXTRACTED" && (!verifier || !verifier.inputResultIds.includes(parser.id) || verifier.result.role !== "VALIDATOR" || verifier.result.verdict !== "PASS" || !verifier.result.externalVerifications?.length || verifier.result.externalVerifications.some(v => v.verdict !== "PASS"))) block("INDEPENDENT_VERIFICATION_MISSING",a,"Verifier","Acquire and compare a qualifying independent official record.",verifier?.id ?? parser.id);
    if (auditor?.result.role === "ADVERSARIAL_AUDITOR" && auditor.result.verdict !== "SURVIVED") block("AUDIT_CONFLICT_OR_INCONCLUSIVE",a,"Adversarial Auditor","Resolve the recorded challenge with independently checked evidence.",auditor.id);
    if (acquirer?.result.role === "ACQUIRER" && acquirer.result.verdict !== "ACQUIRED" && acquirer.result.walk.some(w => ["FAILED_AT_RUNG","CHALLENGED","TIMEOUT","TLS_CLIENT_MISMATCH","OTHER_NAMED_FAILURE"].includes(w.transport))) block("SOURCE_CURRENTLY_WALLED",a,"Scout / Detective","Branch to another public representation; preserve failed-route history and keep the obligation live.",acquirer.id);
    else if(acquirer?.result.role === "ACQUIRER" && acquirer.result.verdict !== "ACQUIRED") block("ACQUISITION_INCOMPLETE_OR_NOT_RETAINED",a,"Acquirer / Engineering","Resolve the recorded completeness or evidence-retention failure; reachable transport alone does not establish a complete acquired record.",acquirer.id);
  }
  const milestones = Object.fromEntries(RESEARCH_MILESTONES.map(stage => {
    const first = new Map<string,MilestoneEvidence>();
    for (const e of events[stage].sort((a,b) => a.at.localeCompare(b.at) || a.evidenceId.localeCompare(b.evidenceId))) if (!first.has(e.workItemId)) first.set(e.workItemId,e);
    const evidence = [...first.values()].filter(e => inWindow(e.at));
    return [stage,{unit:"DISTINCT_OBLIGATIONS",newlyReached:evidence.length,reachedByWindowEnd:first.size,evidence}];
  })) as unknown as Record<ResearchMilestone,ResearchMilestoneCount>;
  const bottlenecks = [...groups].map(([code,g]): ResearchBottleneck => {
    const held = [...g.rows.values()]; const oldest = held.map(r => r.activity.workItem.createdAt).sort()[0];
    return { code,affectedObligationCount:held.length,states:[...new Set(held.map(r => r.activity.workItem.autonomousPlan!.jurisdiction))].sort(),
      bodiesOrAuthorities:new Set(held.map(r => r.activity.workItem.subject)).size,recordClasses:[...new Set(held.map(r => r.activity.recordClass ?? "UNCLASSIFIED"))].sort(),
      oldestObligationAt:oldest,oldestAgeHours:(end-instant(oldest))/3600000,ageBasis:"AFFECTED_OBLIGATION_CREATION",owningWorkerGroup:g.owner,reusableAction:g.action,
      drillDown:held.map(r => ({workItemId:r.activity.workItem.id,subject:r.activity.workItem.subject,evidenceIds:[...new Set(r.evidenceIds)].sort()})).sort((a,b) => a.workItemId.localeCompare(b.workItemId)) };
  }).sort((a,b) => b.affectedObligationCount-a.affectedObligationCount || a.code.localeCompare(b.code));
  const exactMethodEvent = (id: string, at: string): boolean => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
      if (beforeEnd(at)) gaps.add(`METHOD_EVENT_WINDOW_UNATTRIBUTABLE:${id}`);
      return false;
    }
    return inWindow(at);
  };
  const admittedMethods = input.candidates.filter(c => c.admission?.effect === "LEARNED" && exactMethodEvent(c.id, c.admission.at)).map(c => {
    const route = input.knowledge.routes.find(r => r.id === c.admission!.admittedAs);
    if (!route) gaps.add(`ADMITTED_METHOD_NOT_IN_SNAPSHOT:${c.id}`);
    return {candidateId:c.id,routeId:c.admission!.admittedAs,at:c.admission!.at,methodVersion:c.admission!.methodVersionAfter,applicability:route?.applicability ?? null};
  });
  const reopenedConclusions: ResearchWindowProgression["reopenedConclusions"][number][] = [];
  for (const c of input.conclusions) {
    if (c.fixture || !c.reopenedBy || !c.reopenedOn) continue;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(c.reopenedOn);
    if (dateOnly ? instant(c.reopenedOn) > end : !inWindow(c.reopenedOn)) continue;
    // A historical calendar date cannot identify an hourly research window.
    if (dateOnly) gaps.add(`CONCLUSION_REOPENING_WINDOW_UNATTRIBUTABLE:${c.id}`);
    reopenedConclusions.push({conclusionId:c.id,workItemId:c.earnedBy.workItemId ?? null,routeId:c.reopenedBy,earnedAtVersion:c.earnedAtVersion,at:c.reopenedOn,windowAttribution:dateOnly?"DATE_ONLY_UNATTRIBUTABLE":"EXACT"});
  }
  const candidateMethods = input.candidates.filter(c => exactMethodEvent(c.id,c.submittedAt)).map(c => c.id).sort();
  return { formatVersion:1,windowId:input.windowId,windowKind:input.windowKind??"NIGHTLY_PROMOTION",previousCompletedWindowId:input.previousCompletedWindowId,since:input.since,through:input.through,
    interval:"PREVIOUS_COMPLETED_WINDOW_EXCLUSIVE_TO_THIS_WINDOW_INCLUSIVE",scope:{kind:"REGISTERED_AUTONOMOUS_CIVIC_PLANS",obligations:rows.length,excludedUnclassifiedWorkItems:input.excludedUnclassifiedWorkItems},milestones,
    activity:{obligationsWorked:worked.size,newEvidenceArtifacts:newArtifacts.size,completedResults:[...completed.values()].map(g=>({role:g.role,verdict:g.verdict,count:g.ids.size,evidenceIds:[...g.ids].sort()})).sort((a,b)=>a.role.localeCompare(b.role)||a.verdict.localeCompare(b.verdict))},
    promoted:{count:null,unit:"RECORDS",reason:"Per-record promotion receipts are required."},
    readerVisible:{count:null,unit:"RECORDS",reason:"Served reader proof linked to each promoted record is required."},
    reopened,regressions,methodSnapshotVersion:input.knowledge.version,admittedMethods,reopenedConclusions,
    candidateMethods,bottlenecks,evidenceGaps:[...gaps].sort() };
}

/** Uses completed window boundaries and canonical research logs. No new store. */
export async function readResearchProgression(repos: ControlPlaneRepositories, input: {
  readonly windowId: string; readonly through: string; readonly candidates: readonly MethodCandidate[];
  readonly knowledge: MethodKnowledge; readonly conclusions: readonly ConclusionRecord[];
  /** A completed research cycle supplies its own canonical boundary; it is not a promotion window. */
  readonly researchBoundary?: { readonly since: string; readonly previousCompletedWindowId: string | null };
  /** The same completed finalization read used by research metrics. */
  readonly scouts?: readonly ScoutResult[];
}): Promise<ResearchWindowProgression> {
  const [items,windows] = await Promise.all([repos.workItems.list(),input.researchBoundary?Promise.resolve([]):repos.windowRuns.readAll()]);
  const completed = windows.filter(isWindowRunRecord).filter(w => w.windowId !== input.windowId && Number.isFinite(Date.parse(w.finishedAt)) && instant(w.finishedAt) < instant(input.through)).sort((a,b) => a.finishedAt.localeCompare(b.finishedAt));
  const previous = completed.at(-1);
  const ids = items.filter(w => w.value.autonomousPlan).map(w => w.id);
  const activities = await readAutonomousActivity(repos,ids,{observedAt:input.through,
    workItems:items.map(row => row.value), ...(input.scouts === undefined ? {} : { scouts: input.scouts })});
  const oldest = items.map(w => w.value.createdAt).sort()[0];
  const since = input.researchBoundary?.since ?? previous?.finishedAt ?? (oldest ? new Date(instant(oldest)-1).toISOString() : input.through);
  return projectResearchProgression({...input,activities,since,windowKind:input.researchBoundary?"RESEARCH_CYCLE":"NIGHTLY_PROMOTION",previousCompletedWindowId:input.researchBoundary?.previousCompletedWindowId ?? previous?.windowId ?? null,excludedUnclassifiedWorkItems:items.length-ids.length});
}
