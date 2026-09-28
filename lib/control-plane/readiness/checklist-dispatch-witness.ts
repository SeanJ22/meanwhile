import { createHash } from "node:crypto";
import type { AssignmentSources } from "../assignment-view.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";
import type { ChecklistInstance, ChecklistWitness } from "./checklist-score.ts";
import { CHECKLIST_PROFILE } from "./checklist-score.ts";

const VERSION = "checklist-normal-dispatch/1";
const time = (value: string | null | undefined) => value ? Date.parse(value) : NaN;

/** GATE-04 asks for one normal dispatched task with a durable result. This
 * proves that narrow operating predicate; it gives no civic/publication credit.
 * Canonical membership, occurrence, work, attempt and artifact must all join.
 * Historical completion cannot prove a later instruction at the same ZIP. */
export function checklistDispatchWitness(input: {
  readonly scope: ExpansionScopeDecision;
  readonly sources: AssignmentSources;
  readonly instances: readonly ChecklistInstance[];
  readonly observedAt: string;
}): readonly ChecklistWitness[] {
  const { scope, sources, observedAt } = input;
  const instance = input.instances.find(row => row.predicateKey === "GATE-04" &&
    row.objectId === scope.key && row.period === `instruction:${scope.receiptId}`);
  const clause = `${CHECKLIST_PROFILE.version}:GATE-04`;
  if (!instance || instance.predicate.kind !== "CAPABILITY" ||
    instance.predicate.requiredClauses.length !== 1 || instance.predicate.requiredClauses[0] !== clause) return [];
  const observed = time(observedAt), started = time(scope.budgetStartedAt ?? scope.decidedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(started)) return [];
  const workById = new Map(sources.workItems.map(row => [row.id, row]));
  const obligations = new Map(sources.obligations.map(row => [row.id, row]));
  const occurrences = new Map((sources.occurrences ?? []).map(row => [row.workItemId, row]));
  const artifacts = new Map(sources.artifacts.map(row => [row.artifactId, row]));
  for (const attempt of [...sources.attempts].sort((a,b) => a.id.localeCompare(b.id))) {
    const work = workById.get(attempt.workItemId), occurrence = occurrences.get(attempt.workItemId);
    if (!work || work.project !== "freshness" || !occurrence || attempt.outcome !== "COMPLETED") continue;
    const obligation = obligations.get(occurrence.obligationId);
    const marks = obligation?.assignments?.filter(mark => mark.assignmentKey === scope.key && mark.ref === scope.receiptId) ?? [];
    const joined = Math.min(...marks.map(mark => time(mark.at)).filter(Number.isFinite));
    const begin = time(attempt.startedAt), end = time(attempt.endedAt);
    if (!Number.isFinite(joined) || !Number.isFinite(begin) || !Number.isFinite(end) ||
      begin < Math.max(started, joined) || end < begin || end > observed ||
      time(occurrence.dueAt) > begin || !Number.isFinite(time(occurrence.dueAt)) ||
      time(occurrence.openedAt) > begin || !Number.isFinite(time(occurrence.openedAt)) ||
      work.subject !== obligation?.subjectId || occurrence.routeTaskId !== attempt.routeTaskId ||
      !work.routeTaskIds.includes(attempt.routeTaskId)) continue;
    const artifact = attempt.artifactIds.map(id => artifacts.get(id)).find(row => {
      if (!row || row.partial || row.byteLength <= 0 || row.attemptId !== attempt.id ||
        row.workItemId !== work.id || row.routeTaskId !== attempt.routeTaskId ||
        !/^(?:sha256-)?[a-f0-9]{64}$/.test(row.contentHash) ||
        !Number.isFinite(time(row.recordedAt)) || time(row.recordedAt) < begin || time(row.recordedAt) > end) return false;
      try { const url = new URL(row.canonicalUrl); return url.protocol === "https:" && !url.username && !url.password; }
      catch { return false; }
    });
    if (!artifact) continue;
    const id = `${VERSION}:${createHash("sha256").update(JSON.stringify([scope.receiptId, occurrence.id, attempt.id, artifact.artifactId, artifact.contentHash])).digest("hex")}`;
    return [{id, obligationKey:instance.obligationKey, objectId:instance.objectId,
      jurisdictionId:instance.jurisdictionId, period:instance.period, predicateKey:instance.predicateKey,
      contractVersion:instance.predicate.contractVersion, recordedAt:observedAt,
      sourcePublication:"UNKNOWN", acquisition:"PRESENT", sourceIds:[artifact.canonicalUrl],
      artifactIds:[artifact.artifactId], contentHashes:[artifact.contentHash], attemptIds:[attempt.id],
      verificationIds:[occurrence.id, attempt.id, artifact.artifactId], verification:"PASS",
      satisfiedClauses:[clause], conflict:false, freshness:{ruleId:null,validUntil:null},
      publication:{state:"NONE",candidateId:null,version:null,receiptId:null,at:null},
      surfaces:[],change:"UNDETERMINED"}];
  }
  return [];
}
