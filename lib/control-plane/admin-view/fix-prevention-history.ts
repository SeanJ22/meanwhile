/** Exact, bounded repair-lineage history for Admin. No queued action is a fix. */
import { unreachable, type ReadOutcome } from "../admin-data.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { WorkItem } from "../work-item.ts";
import type { PlanRepairLink, RepairObservation } from "../workers/plan-repair.ts";

export const FIX_HISTORY_VERSION = "fix-prevention-history/v1" as const;
export const FIX_HISTORY_MAX_ITEMS = 64;
export const FIX_HISTORY_MAX_EVENTS = 100;
const RECENT_RESULTS_PER_ITEM = 16;
const READ_CONCURRENCY = 16;

type LinkedWork = WorkItem & {
  readonly planRepair?: PlanRepairLink;
  readonly planRepairObservations?: Readonly<Record<string, RepairObservation>>;
};
export interface FixHistoryEvent {
  readonly kind: "REPAIR_REFUSED" | "REPAIR_INSTRUCTIONS_ADMITTED" | "WORKER_CHECK_RECORDED" | "PUBLICATION_ATTEMPT_RECORDED";
  readonly at: string | null;
  readonly workItemId: string;
  readonly evidenceId: string;
  readonly code: string;
  /** A recorded check or publisher result, never a claim that the underlying problem is fixed. */
  readonly outcome: string | null;
}
export interface FixPreventionHistory {
  readonly formatVersion: typeof FIX_HISTORY_VERSION;
  readonly observedAt: string;
  readonly requestedWorkItemId: string;
  readonly rootWorkItemId: string;
  readonly subjectId: string;
  readonly scope: { readonly assignmentKey: string; readonly receiptId: string; readonly match: "EXACT" | "UNCONFIRMED" } | null;
  readonly knownLineageItems: number;
  readonly knownEvents: number;
  readonly returnedEvents: number;
  readonly hasEarlierKnownEvents: boolean;
  readonly knownLinksReadComplete: boolean;
  readonly events: readonly FixHistoryEvent[];
  readonly diagnosis: { readonly confirmedCause: null; readonly observedRefusals: number };
  readonly fix: { readonly applied: null; readonly admittedInstructionSets: number };
  readonly prevention: { readonly proved: null };
  readonly proof: { readonly fixProved: null; readonly recordedWorkerChecks: number };
  readonly publicEffect: { readonly confirmed: null; readonly recordedPublisherAttempts: number };
  readonly gaps: readonly string[];
}

type NarrowScout = { readonly workItemId: string; readonly attemptId: string; readonly recordedAt: string };
type NarrowResult = { readonly workItemId: string; readonly id: string; readonly endedAt: string;
  readonly result: { readonly role: string; readonly verdict: string } };
type ItemEvidence = { readonly item: LinkedWork; readonly scouts: readonly NarrowScout[];
  readonly results: readonly NarrowResult[]; readonly scoutWindowFull: boolean; readonly resultWindowFull: boolean };

function iso(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}
function code(value: unknown): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_:-]{0,80}$/.test(value) ? value : "UNREADABLE_CODE";
}
function narrowScout(value: unknown, workItemId: string): NarrowScout | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<NarrowScout>;
  return row.workItemId === workItemId && typeof row.attemptId === "string" && typeof row.recordedAt === "string" ? row as NarrowScout : null;
}
function narrowResult(value: unknown, workItemId: string): NarrowResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<NarrowResult>;
  return row.workItemId === workItemId && typeof row.id === "string" && typeof row.endedAt === "string" &&
    row.result && typeof row.result.role === "string" && typeof row.result.verdict === "string" ? row as NarrowResult : null;
}
async function batches<T, R>(items: readonly T[], fn: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (let i = 0; i < items.length; i += READ_CONCURRENCY) result.push(...await Promise.all(items.slice(i, i + READ_CONCURRENCY).map(fn)));
  return result;
}

export function projectFixPreventionHistory(input: {
  readonly requestedWorkItemId: string; readonly rootWorkItemId: string; readonly subjectId: string;
  readonly scope: FixPreventionHistory["scope"]; readonly observedAt: string;
  readonly items: readonly ItemEvidence[]; readonly lineageTruncated: boolean;
  readonly extraGaps?: readonly string[]; readonly limit?: number;
}): FixPreventionHistory {
  const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(FIX_HISTORY_MAX_EVENTS, input.limit!)) : 40;
  const gaps = new Set(input.extraGaps ?? []);
  const events: FixHistoryEvent[] = [];
  let observedRefusals = 0;
  let admittedInstructionSets = 0;
  let recordedWorkerChecks = 0;
  let recordedPublisherAttempts = 0;
  for (const { item, scouts, results, scoutWindowFull, resultWindowFull } of input.items) {
    if (scoutWindowFull || resultWindowFull) gaps.add("Older Scout times or worker checks may exist beyond this per-item read window.");
    const scoutTime = new Map(scouts.map(row => [row.attemptId, iso(row.recordedAt)]));
    for (const observation of Object.values(item.planRepairObservations ?? {})) {
      if (observation.parentWorkItemId !== item.id || !observation.scoutAttemptId) {
        gaps.add("A repair observation has an invalid parent or attempt link."); continue;
      }
      if (observation.successorWorkItemId) continue; // Admission is represented by the validated child, below.
      observedRefusals++;
      events.push({ kind: "REPAIR_REFUSED", at: scoutTime.get(observation.scoutAttemptId) ?? null,
        workItemId: item.id, evidenceId: observation.scoutAttemptId, code: code(observation.code), outcome: "REFUSED" });
    }
    if (item.planRepair) {
      admittedInstructionSets++;
      events.push({ kind: "REPAIR_INSTRUCTIONS_ADMITTED", at: iso(item.planRepair.admittedAt), workItemId: item.id,
        evidenceId: item.planRepair.scoutAttemptId, code: "INSTRUCTIONS_ONLY", outcome: null });
    }
    for (const result of results) {
      recordedWorkerChecks++;
      events.push({ kind: "WORKER_CHECK_RECORDED", at: iso(result.endedAt), workItemId: item.id,
        evidenceId: result.id, code: code(result.result.role), outcome: code(result.result.verdict) });
    }
    const publication = item.publicationOutcome;
    if (publication) {
      recordedPublisherAttempts++;
      events.push({ kind: "PUBLICATION_ATTEMPT_RECORDED", at: iso(publication.at), workItemId: item.id,
        evidenceId: publication.workerResultId, code: code(publication.code), outcome: publication.status });
    }
  }
  if (input.lineageTruncated) gaps.add("Further linked repair work exists beyond this read's item bound.");
  if (input.scope?.match === "UNCONFIRMED") gaps.add("The requested instruction cannot be proven as this lineage's exact owner; history remains available by work ID.");
  if (events.some(event => event.at === null)) gaps.add("At least one saved event has no usable event time; its position is not a measured chronology.");
  const order = { REPAIR_REFUSED: 0, REPAIR_INSTRUCTIONS_ADMITTED: 1, WORKER_CHECK_RECORDED: 2, PUBLICATION_ATTEMPT_RECORDED: 3 } as const;
  events.sort((a, b) => (a.at === null ? -Infinity : Date.parse(a.at)) - (b.at === null ? -Infinity : Date.parse(b.at)) ||
    order[a.kind] - order[b.kind] || a.evidenceId.localeCompare(b.evidenceId));
  const page = events.slice(-limit).reverse();
  return { formatVersion: FIX_HISTORY_VERSION, observedAt: input.observedAt,
    requestedWorkItemId: input.requestedWorkItemId, rootWorkItemId: input.rootWorkItemId, subjectId: input.subjectId,
    scope: input.scope, knownLineageItems: input.items.length, knownEvents: events.length, returnedEvents: page.length,
    hasEarlierKnownEvents: events.length > page.length,
    knownLinksReadComplete: !input.lineageTruncated && !input.items.some(row => row.scoutWindowFull || row.resultWindowFull) && gaps.size === 0,
    events: page, diagnosis: { confirmedCause: null, observedRefusals },
    fix: { applied: null, admittedInstructionSets }, prevention: { proved: null },
    proof: { fixProved: null, recordedWorkerChecks }, publicEffect: { confirmed: null, recordedPublisherAttempts }, gaps: [...gaps] };
}

/** Follow only explicit parent/successor IDs. No same-subject or same-scope guess creates lineage. */
export async function readFixPreventionHistory(repos: ControlPlaneRepositories, query: {
  readonly workItemId: string; readonly subjectId?: string;
  readonly scope?: { readonly assignmentKey: string; readonly receiptId: string };
  readonly observedAt: string; readonly limit?: number;
}): Promise<ReadOutcome<FixPreventionHistory>> {
  try {
    const requested = (await repos.workItems.read(query.workItemId))?.value as LinkedWork | undefined;
    if (!requested || (query.subjectId && requested.subject !== query.subjectId))
      return { kind: "NOT_RECORDED", detail: "No work item has that exact work and subject identity." };
    let root = requested;
    const ancestors = new Set([requested.id]);
    while (root.planRepair && ancestors.size < FIX_HISTORY_MAX_ITEMS) {
      const parent = (await repos.workItems.read(root.planRepair.parentWorkItemId))?.value as LinkedWork | undefined;
      if (!parent || parent.project !== requested.project || parent.subject !== requested.subject || ancestors.has(parent.id) ||
        root.planRepair.rootWorkItemId !== (parent.planRepair?.rootWorkItemId ?? parent.id))
        return { kind: "NOT_RECORDED", detail: "The saved repair parent link does not prove this work lineage." };
      ancestors.add(parent.id);
      root = parent;
    }
    if (root.planRepair) return { kind: "NOT_RECORDED", detail: "The exact repair root could not be validated within this read's item bound." };
    const gaps: string[] = [];
    const items: LinkedWork[] = [root];
    const seen = new Set([root.id]);
    let lineageTruncated = false;
    for (let i = 0; i < items.length && items.length < FIX_HISTORY_MAX_ITEMS; i++) {
      const parent = items[i]!;
      for (const observation of Object.values(parent.planRepairObservations ?? {})) {
        const childId = observation.successorWorkItemId;
        if (!childId || seen.has(childId)) continue;
        if (items.length >= FIX_HISTORY_MAX_ITEMS) { lineageTruncated = true; break; }
        const child = (await repos.workItems.read(childId))?.value as LinkedWork | undefined;
        if (!child || child.project !== root.project || child.subject !== root.subject ||
          child.planRepair?.parentWorkItemId !== parent.id || child.planRepair.rootWorkItemId !== root.id ||
          child.planRepair.scoutAttemptId !== observation.scoutAttemptId ||
          child.planRepair.depth !== (parent.planRepair?.depth ?? 0) + 1 ||
          child.planRepair.authority !== "WORK_INSTRUCTIONS_ONLY") {
          gaps.push("A claimed successor lacks an exact validated parent, subject, project, or Scout link."); continue;
        }
        seen.add(child.id); items.push(child);
      }
    }
    if (!seen.has(requested.id)) return { kind: "NOT_RECORDED", detail: "The requested work is not linked from the root's saved successor records." };
    let scope: FixPreventionHistory["scope"] = null;
    if (query.scope) {
      const obligation = (await repos.obligations.read(root.obligation))?.value;
      const marked = obligation?.assignments?.some(mark => mark.assignmentKey === query.scope!.assignmentKey && mark.ref === query.scope!.receiptId) ?? false;
      if (!marked) return { kind: "NOT_RECORDED", detail: "No exact instruction receipt links this work's obligation to the requested scope." };
      const tagged = items.every(item => item.autonomousPlan?.ownerInstructions?.includes(query.scope!.receiptId) === true ||
        (item.manualSourceGap?.assignmentKey === query.scope!.assignmentKey && item.manualSourceGap.instructionReceipt === query.scope!.receiptId));
      scope = { ...query.scope, match: tagged ? "EXACT" : "UNCONFIRMED" };
    }
    const evidence = await batches(items, async (item): Promise<ItemEvidence> => {
      const [scoutRows, resultRows] = await Promise.all([
        repos.scoutResults.readRecentWhere(item.obligation, ["workItemId"], item.id, RECENT_RESULTS_PER_ITEM,
          { workItemId: true, attemptId: true, recordedAt: true }),
        repos.workerResults.readRecentWhere(item.id, ["workItemId"], item.id, RECENT_RESULTS_PER_ITEM,
          { workItemId: true, id: true, endedAt: true, result: ["role", "verdict"] }),
      ]);
      const scouts = scoutRows.map(row => narrowScout(row, item.id)).filter((row): row is NarrowScout => row !== null);
      const results = resultRows.map(row => narrowResult(row, item.id)).filter((row): row is NarrowResult => row !== null);
      if (scouts.length !== scoutRows.length || results.length !== resultRows.length)
        gaps.push("At least one saved Scout or worker check could not be interpreted.");
      return { item, scouts, results,
        scoutWindowFull: scoutRows.length === RECENT_RESULTS_PER_ITEM,
        resultWindowFull: resultRows.length === RECENT_RESULTS_PER_ITEM };
    });
    return { kind: "HELD", value: projectFixPreventionHistory({ requestedWorkItemId: requested.id, rootWorkItemId: root.id,
      subjectId: root.subject, scope, observedAt: query.observedAt, items: evidence, lineageTruncated,
      extraGaps: gaps, limit: query.limit }) };
  } catch (error) { return unreachable("the exact repair history", error); }
}
