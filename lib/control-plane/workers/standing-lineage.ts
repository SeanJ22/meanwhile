import { canonicalJson, type ArtifactRecord, type ControlPlaneRepositories } from "../repository/types.ts";
import type { Attempt } from "../attempt.ts";
import { FRESHNESS_PROJECT, type FreshnessOccurrence, type StandingObligation } from "../scheduler/durable.ts";
import { isScheduled, scheduleObligation } from "../scheduler/obligation.ts";
import type { WorkItem } from "../work-item.ts";
import type { AutonomousWorkPlan } from "./autonomous-plan.ts";
import { readLineageHistory } from "./scoped-history.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";

/** A standing source's period and instruction, independent of method-version or repaired extraction details. */
export function standingLineageKeyFor(input: { readonly obligationId: string; readonly dueAt: string; readonly project: string;
  readonly subject: string; readonly plan: AutonomousWorkPlan | undefined;
  readonly instructionReceipts: readonly string[] }): string | null {
  const plan = input.plan;
  if (!plan || plan.contract.subjectId !== input.subject) return null;
  const contract = plan.contract;
  return canonicalJson({ obligationId: input.obligationId, dueAt: input.dueAt,
    project: input.project, subject: input.subject, recordClass: contract.recordClass,
    identity: contract.schemaVersion === 2 ? contract.identity : null,
    requiredFields: [...contract.requiredFields].sort(), bodyId: plan.publication?.bodyId ?? null,
    instructionReceipts: [...new Set(input.instructionReceipts)].sort() });
}
export function standingLineageKey(occurrence: FreshnessOccurrence, item: WorkItem): string | null {
  return standingLineageKeyFor({obligationId:occurrence.obligationId,dueAt:occurrence.dueAt,project:item.project,
    subject:item.subject,plan:item.autonomousPlan,instructionReceipts:item.autonomousPlan?.ownerInstructions??[]});
}

export interface StandingLineage {
  readonly key: string;
  readonly obligationId: string;
  readonly dueAt: string;
  readonly rootWorkItemId: string;
  readonly siblingRootIds: readonly string[];
  /** Actual source observation behind accepted published facts; remaining gaps stay open. */
  readonly publishedAt: string | null;
}

export type LineageArtifact = Pick<ArtifactRecord, "artifactId" | "workItemId" | "attemptId" | "partial" | "canonicalUrl">;
export type LineageAttempt = Pick<Attempt, "id" | "workItemId" | "outcome"> & { readonly worker: Pick<Attempt["worker"], "role"> };

/** Every sibling remains durable; this selects only which one may spend the next work slice. */
export function selectStandingLineages(input: {
  readonly occurrences: readonly FreshnessOccurrence[];
  readonly workItems: readonly WorkItem[];
  readonly artifacts: readonly LineageArtifact[];
  readonly attempts: readonly LineageAttempt[];
  readonly workerResults: readonly {readonly id:string;readonly workItemId:string;readonly attemptId:string;
    readonly result:{readonly role:string;readonly verdict:string}}[];
}): readonly StandingLineage[] {
  const byItem = new Map(input.workItems.map(item => [item.id, item] as const));
  const completedAttempt = new Map(input.attempts.filter(attempt=>attempt.outcome==="COMPLETED")
    .map(attempt=>[attempt.id,attempt] as const));
  const completeArtifacts = new Map<string, Set<string>>();
  for (const artifact of input.artifacts) if (!artifact.partial) {
    if (completedAttempt.get(artifact.attemptId)?.workItemId !== artifact.workItemId) continue;
    const held = completeArtifacts.get(artifact.workItemId) ?? new Set<string>();
    held.add(artifact.artifactId); completeArtifacts.set(artifact.workItemId, held);
  }
  const successfulResults = new Map<string, number>();
  const accepted = new Set(["ACQUIRED","EXTRACTED","PASS","SURVIVED","SUPPORTED"]);
  for (const result of input.workerResults) if (accepted.has(result.result.verdict))
    successfulResults.set(result.workItemId,(successfulResults.get(result.workItemId)??0)+1);
  const verifiedPublicationAt=(item:WorkItem):string|null=>{
    const outcome=item.publicationOutcome;
    if (!outcome || outcome.status === "HELD" || !outcome.candidateId || !outcome.versionId ||
      !outcome.sourceArtifactId || !outcome.sourceObservedAt || !outcome.workerResultId || outcome.workerResultId === "none" ||
      !Number.isFinite(Date.parse(outcome.at)) || !Number.isFinite(Date.parse(outcome.sourceObservedAt)) ||
      Date.parse(outcome.sourceObservedAt) > Date.parse(outcome.at)) return null;
    // A publication of zero accepted rows is not evidence that the source was
    // refreshed; both roster records and directory body records count here.
    const acceptedCount=(outcome.acceptedMembers?.length??0)+(outcome.bodyIds?.length??0)+(outcome.acceptedRecordIds?.length??0)+
      (outcome.records?.added??0)+(outcome.records?.changed??0)+(outcome.records?.reused??0);
    return acceptedCount>0?outcome.sourceObservedAt:null;
  };
  const childrenByParent = new Map<string,WorkItem[]>();
  for (const item of input.workItems) {
    const parent=(item as WorkItem & {readonly planRepair?:{readonly parentWorkItemId:string}}).planRepair?.parentWorkItemId;
    if (parent) { const children=childrenByParent.get(parent)??[]; children.push(item); childrenByParent.set(parent,children); }
  }
  const exactRepairFamily=(root:WorkItem):WorkItem[]=>{
    const family=[root], seen=new Set([root.id]);
    for (let i=0;i<family.length;i++) {
      const parent=family[i]!;
      const parentLink=(parent as WorkItem & {readonly planRepair?:{readonly depth:number;readonly rootWorkItemId:string}}).planRepair;
      for (const child of childrenByParent.get(parent.id)??[]) {
        const link=(child as WorkItem & {readonly planRepair?:{readonly parentWorkItemId:string;readonly rootWorkItemId:string;
          readonly depth:number;readonly authority:string}}).planRepair;
        if (!link || seen.has(child.id) || link.authority!=="WORK_INSTRUCTIONS_ONLY" ||
          link.parentWorkItemId!==parent.id || link.rootWorkItemId!==root.id ||
          link.depth!==(parentLink?.depth??0)+1 || child.project!==root.project || child.subject!==root.subject ||
          child.autonomousPlan?.contract.recordClass!==root.autonomousPlan?.contract.recordClass ||
          child.autonomousPlan?.contract.schemaVersion!==2 || root.autonomousPlan?.contract.schemaVersion!==2 ||
          canonicalJson(child.autonomousPlan.contract.identity)!==canonicalJson(root.autonomousPlan.contract.identity) ||
          canonicalJson([...child.autonomousPlan.contract.requiredFields].sort())!==canonicalJson([...root.autonomousPlan.contract.requiredFields].sort()) ||
          child.autonomousPlan.publication?.bodyId!==root.autonomousPlan.publication?.bodyId) continue;
        seen.add(child.id); family.push(child);
      }
    }
    return family;
  };
  const groups = new Map<string, { occurrence: FreshnessOccurrence; item: WorkItem }[]>();
  for (const occurrence of input.occurrences) {
    const item = byItem.get(occurrence.workItemId);
    if (!item) continue;
    const key = standingLineageKey(occurrence, item);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push({ occurrence, item }); groups.set(key, group);
  }
  return [...groups].map(([key, rows]) => {
    const families=new Map(rows.map(row=>[row.item.id,exactRepairFamily(row.item)] as const));
    const publicationAt=(row:typeof rows[number])=>families.get(row.item.id)?.flatMap(item=>{
      const at=verifiedPublicationAt(item); return at?[at]:[];
    }).sort().at(-1)??null;
    const lastPublishedAt = rows.map(publicationAt).filter((at): at is string => at !== null).sort().at(-1);
    // A newly opened round after a verified publication is a later reading,
    // even when a legacy standing row still carries its original due anchor.
    const renewed = lastPublishedAt ? rows.filter(row => row.occurrence.openedAt > lastPublishedAt) : [];
    const eligible = renewed.length ? renewed : rows;

    const rank = (row: typeof rows[number]) => [
      publicationAt(row) === null ? 0 : 1,
      (families.get(row.item.id)?.length??1)-1,
      (families.get(row.item.id)??[]).reduce((n,item)=>n+(successfulResults.get(item.id)??0),0),
      new Set((families.get(row.item.id)??[]).flatMap(item=>[...(completeArtifacts.get(item.id)??[])])).size,
    ];
    eligible.sort((a, b) => {
      const ar = rank(a), br = rank(b);
      for (let i = 0; i < ar.length; i++) if (ar[i] !== br[i]) return br[i]! - ar[i]!;
      return a.occurrence.openedAt.localeCompare(b.occurrence.openedAt) || a.item.id.localeCompare(b.item.id);
    });
    const chosen = eligible[0]!;
    return { key, obligationId: chosen.occurrence.obligationId, dueAt: chosen.occurrence.dueAt,
      rootWorkItemId: chosen.item.id, siblingRootIds: rows.map(row => row.item.id),
      publishedAt: publicationAt(chosen) };
  });
}

/** True means this exact due period already has source work worth continuing. */
export function standingLineageCoversDue(input: {
  readonly lineages: readonly StandingLineage[];
  readonly key: string;
  readonly now: string;
  readonly cadenceHours: number;
}): StandingLineage | null {
  const existing = input.lineages.filter(lineage => lineage.key === input.key);
  if (!existing.length) return null;

  const active = existing.find(lineage => {
    if (lineage.publishedAt === null) return true;
    const observed = Date.parse(lineage.publishedAt), current = Date.parse(input.now);
    return !Number.isFinite(observed) || !Number.isFinite(current) ||
      !Number.isFinite(input.cadenceHours) || input.cadenceHours <= 0 ||
      current < observed + input.cadenceHours * 3_600_000;
  });
  return active ?? null;
}

export async function persistVerifiedPublicationAnchors(repos:ControlPlaneRepositories,input:{
  readonly obligations:readonly StandingObligation[];readonly lineages:readonly StandingLineage[];readonly now:string;
}):Promise<{readonly updated:ReadonlyMap<string,StandingObligation>;readonly anchored:readonly string[]}> {
  const updated=new Map<string,StandingObligation>(),anchored:string[]=[];
  const nowMs=Date.parse(input.now);
  if (!Number.isFinite(nowMs)) return {updated,anchored};
  for (const obligation of input.obligations) {
    if (!obligation.active || !obligation.autonomousPlan || obligation.openOccurrenceId!==null) continue;
    const eligible=input.lineages.filter(lineage=>lineage.obligationId===obligation.id && lineage.publishedAt &&
      Date.parse(lineage.publishedAt)<=nowMs && standingLineageKeyFor({obligationId:obligation.id,dueAt:lineage.dueAt,
        project:FRESHNESS_PROJECT,subject:obligation.subjectId,plan:obligation.autonomousPlan,
        instructionReceipts:(obligation.assignments??[]).map(mark=>mark.ref)})===lineage.key)
      .map(lineage=>lineage.publishedAt!).sort();
    const observedAt=eligible.at(-1);
    if (!observedAt || (obligation.lastWorkedAt && Date.parse(obligation.lastWorkedAt)>=Date.parse(observedAt))) continue;
    const current=await repos.obligations.read(obligation.id);
    if (!current?.value.active || current.value.openOccurrenceId!==null ||
      (current.value.lastWorkedAt && Date.parse(current.value.lastWorkedAt)>=Date.parse(observedAt))) continue;
    const stillBound=input.lineages.some(lineage=>lineage.obligationId===current.id && lineage.publishedAt===observedAt &&
      standingLineageKeyFor({obligationId:current.id,dueAt:lineage.dueAt,project:FRESHNESS_PROJECT,
        subject:current.value.subjectId,plan:current.value.autonomousPlan,
        instructionReceipts:(current.value.assignments??[]).map(mark=>mark.ref)})===lineage.key);
    if (!stillBound) continue;
    const next={...current.value,lastWorkedAt:observedAt,absentUntil:null,absenceUnlock:null,updatedAt:input.now};
    const scheduled=scheduleObligation(next,nowMs);
    if (!isScheduled(scheduled)) continue;
    const persisted={...next,nextDueAt:scheduled.nextDueAt};
    await repos.obligations.compareAndSet(current.id,current.revision,persisted,input.now);
    updated.set(current.id,persisted); anchored.push(current.id);
  }
  return {updated,anchored};
}

export function brokeredSiblingCaptures(input: { readonly lineage: StandingLineage;
  readonly artifacts: readonly LineageArtifact[]; readonly attempts: readonly LineageAttempt[];
  readonly scouts: readonly Pick<ScoutResult,"attemptId"|"workItemId"|"rungs">[];
  readonly registeredHost: string }): readonly {readonly artifactId:string;readonly originWorkItemId:string}[] {
  const siblings=new Set(input.lineage.siblingRootIds.filter(id=>id!==input.lineage.rootWorkItemId));
  const completed=new Map(input.attempts.filter(attempt=>attempt.outcome==="COMPLETED" && attempt.worker.role==="SCOUT")
    .map(attempt=>[attempt.id,attempt] as const));
  const out=new Map<string,{artifactId:string;originWorkItemId:string}>();
  for (const record of input.artifacts) {
    if (!siblings.has(record.workItemId) || record.partial || completed.get(record.attemptId)?.workItemId!==record.workItemId) continue;
    let url:URL;
    try { url=new URL(record.canonicalUrl); } catch { continue; }
    if (url.protocol!=="https:" || url.hostname.toLowerCase()!==input.registeredHost.toLowerCase()) continue;
    const observed=input.scouts.some(result=>result.attemptId===record.attemptId && result.workItemId===record.workItemId &&
      result.rungs.some(rung=>["fetch_public","browse"].includes(rung.tool) && rung.target===record.canonicalUrl &&
        rung.artifactIds.includes(record.artifactId) && rung.transport==="REACHABLE" && rung.ok===true &&
        typeof rung.httpStatus==="number" && rung.httpStatus>=200 && rung.httpStatus<300));
    if (observed) out.set(`${record.workItemId}\u0000${record.artifactId}`,
      {artifactId:record.artifactId,originWorkItemId:record.workItemId});
  }
  return [...out.values()];
}

export async function readStandingLineages(repos: ControlPlaneRepositories,
  obligations: readonly StandingObligation[], now: string): Promise<readonly StandingLineage[]> {
  const lineages = new Map<string, StandingLineage>();
  for (const obligation of obligations) {
    if (!obligation.autonomousPlan || !obligation.active) continue;
    const held = await repos.dispatchState.lineages(obligation.id, async () => {
      const occurrences = await repos.occurrences.listWhere(["obligationId"], obligation.id);
      if (!occurrences.length) return [];
      const history = await readLineageHistory(repos, occurrences[0].value.workItemId);
      if (!history) throw new Error("STANDING_LINEAGE_SCOPED_READ_UNAVAILABLE");
      return selectStandingLineages(history);
    });
    const matching = held.filter(lineage => standingLineageKeyFor({ obligationId: obligation.id,
      dueAt: lineage.dueAt, project: FRESHNESS_PROJECT, subject: obligation.subjectId, plan: obligation.autonomousPlan,
      instructionReceipts: (obligation.assignments ?? []).map(mark => mark.ref) }) === lineage.key);
    const published = matching.filter(lineage => lineage.publishedAt && Date.parse(lineage.publishedAt) <= Date.parse(now))
      .sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!))[0];
    if (published) lineages.set(published.key, published);
    const observedAt = published?.publishedAt;
    const anchored = observedAt && obligation.openOccurrenceId === null &&
      (!obligation.lastWorkedAt || Date.parse(obligation.lastWorkedAt) < Date.parse(observedAt))
      ? { ...obligation, lastWorkedAt: observedAt, absentUntil: null, absenceUnlock: null } : obligation;
    const scheduled = scheduleObligation(anchored, Date.parse(now));
    if (isScheduled(scheduled)) for (const lineage of matching) if (lineage.dueAt === scheduled.nextDueAt) lineages.set(lineage.key, lineage);
  }
  return [...lineages.values()];
}
