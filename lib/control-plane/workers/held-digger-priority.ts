import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { WorkItem } from "../work-item.ts";
import { FRESHNESS_PROJECT, occurrenceId, type FreshnessOccurrence, type StandingObligation } from "../scheduler/durable.ts";
import { currentAssignmentRefs } from "../scheduler/obligation.ts";
import { ASK_GAP_OBLIGATION_CLASS } from "../ask-gap-id.ts";

export interface HeldDiggerPriority {
  readonly originalObligationId: string;
  readonly assignmentRefs: ReturnType<typeof currentAssignmentRefs>;
}

/** The queue needs identity and order refs, never the source plan's full payload. */
export type HeldDiggerWorkItem = Pick<WorkItem, "id" | "subject" | "project" | "obligation"> & {
  readonly autonomousPlan?: Pick<NonNullable<WorkItem["autonomousPlan"]>, "ownerInstructions">;
};

/** Held tasks need not appear in the autonomous coordinator's selection snapshot. */
export async function readHeldDiggerWorkItems(input: {
  readonly repos: Pick<ControlPlaneRepositories, "workItems">;
  readonly workItemIds: readonly string[];
}): Promise<ReadonlyMap<string, HeldDiggerWorkItem>> {
  const out = new Map<string, HeldDiggerWorkItem>();
  for (const id of new Set(input.workItemIds)) {
    const row = await input.repos.workItems.readNarrowed(id,
      { id: true, subject: true, project: true, obligation: true, autonomousPlan: ["ownerInstructions"] });
    const item = row?.value as HeldDiggerWorkItem | undefined;
    if (item?.id === id && typeof item.subject === "string" && typeof item.project === "string" && typeof item.obligation === "string") out.set(id, item);
  }
  return out;
}

/** Invocation-local priority only. The original source occurrence keeps its ownership, plans and budget attribution. */
export async function readHeldDiggerPriorities(input: {
  readonly repos: Pick<ControlPlaneRepositories, "occurrences" | "obligations">;
  /** Exact held task items, including deterministic items absent from coordinator selections. */
  readonly items: readonly HeldDiggerWorkItem[];
}): Promise<ReadonlyMap<string, HeldDiggerPriority>> {
  const out = new Map<string, HeldDiggerPriority>();
  const obligations = new Map<string, Promise<Pick<StandingObligation, "id" | "subjectId" | "recordClass" | "assignments"> | null>>();
  for (const item of new Map(input.items.map(item => [item.id, item])).values()) {
    if (item.autonomousPlan || item.project !== FRESHNESS_PROJECT) continue;
    const match = /^(.*)#([1-9]\d*)$/.exec(item.obligation);
    if (!match) continue;
    const originalObligationId = match[1]!, sequence = Number(match[2]);
    if (!Number.isSafeInteger(sequence)) continue;
    const id = occurrenceId(originalObligationId, sequence);
    const row = await input.repos.occurrences.readNarrowed(id, { id: true, obligationId: true, sequence: true, workItemId: true });
    const occurrence = row?.value as Pick<FreshnessOccurrence, "id" | "obligationId" | "sequence" | "workItemId"> | undefined;
    if (!occurrence || occurrence.id !== id || occurrence.workItemId !== item.id || occurrence.obligationId !== originalObligationId || occurrence.sequence !== sequence) continue;
    if (!obligations.has(originalObligationId)) obligations.set(originalObligationId, input.repos.obligations.readNarrowed(originalObligationId,
      { id: true, subjectId: true, recordClass: true, assignments: ["assignmentKey", "ref", "relation", "at"] })
      .then(held => held?.value as Pick<StandingObligation, "id" | "subjectId" | "recordClass" | "assignments"> | undefined ?? null));
    const original = await obligations.get(originalObligationId)!;
    if (!original || original.id !== originalObligationId || original.subjectId !== item.subject ||
      ![ASK_GAP_OBLIGATION_CLASS, "held-subject-enrichment"].includes(original.recordClass)) continue;
    out.set(item.id, { originalObligationId, assignmentRefs: currentAssignmentRefs(original.assignments) });
  }
  return out;
}

/** Reuse the queue's selected places and actual current DISPATCH targets; an old Send alone never chooses focus. */
export function heldDiggerNamedOrder(priority: HeldDiggerPriority | undefined, input: {
  readonly placeOrder: readonly string[];
  readonly activeDispatches: readonly { readonly key: string; readonly ref: string }[];
  readonly dispatchPriority: ReadonlySet<string>;
}): { readonly rank: number; readonly receiptId: string | null } {
  if (!priority) return { rank: Infinity, receiptId: null };
  const selected = priority.assignmentRefs.map(mark => ({ rank: input.placeOrder.indexOf(mark.ref), receiptId: mark.ref }))
    .filter(mark => mark.rank >= 0).sort((a, b) => a.rank - b.rank)[0];
  if (selected) return selected;
  const direct = input.activeDispatches.find(target => priority.assignmentRefs.some(mark => mark.key === target.key && mark.ref === target.ref));
  if (direct || input.dispatchPriority.has(priority.originalObligationId)) {
    return { rank: input.placeOrder.length, receiptId: direct?.ref ?? null };
  }
  return { rank: Infinity, receiptId: null };
}

/** Keep all currently named work before background; the caller's existing hunt rounds order each tier. */
export function compareNamedBeforeBackground(leftRank: number, rightRank: number): number {
  const background = (rank: number) => Number(!Number.isFinite(rank) || rank < 0);
  return background(leftRank) - background(rightRank);
}
