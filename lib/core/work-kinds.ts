/** The words the work list is sorted by. Plain values, so Admin's screen can use them as well as the code that writes the list. */
export const WORK_KINDS = ["fact", "lead", "hunt", "recheck", "ask", "slice", "detect", "fix", "load", "check", "order"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
/** The order claims are served in: clock work, then Sean's orders, then reader requests, then the least-complete places. */
export const WORK_TIERS = ["clock", "order", "reader", "coverage"] as const;
export type WorkTier = (typeof WORK_TIERS)[number];
export type WorkStatus = "waiting" | "taken" | "done" | "refused";
/** What a hunt run from a work row is called on its cost records: the reader-facing reason the money was spent. */
export const WORK_COST_KINDS = ["ask", "reader", "order", "planner"] as const;
export type WorkCostKind = (typeof WORK_COST_KINDS)[number];
export const WORK_COST_LABELS: Readonly<Record<WorkCostKind, string>> = { ask: "Ask questions", reader: "Reader requests", order: "Your orders", planner: "Planner" };
/** The one place a row becomes a cost kind: an Ask question, a reader's request, Sean's order, or the code that planned it. */
export function workCostKindOf(row: { readonly kind: WorkKind; readonly tier: WorkTier; readonly origin: Readonly<Record<string, unknown>> }): WorkCostKind {
  if (row.kind === "ask" || row.origin.from === "ask") return "ask";
  if (row.tier === "reader" || row.origin.from === "demand") return "reader";
  if (row.tier === "order" || row.origin.from === "order") return "order";
  return "planner";
}
/** The steps an order moves through, in order. They are stored on the order's row as each is reached. */
export const ORDER_STEP_NAMES = ["Received", "Accepted", "Scheduled", "In progress", "Done"] as const;
export interface OrderStep { readonly step: (typeof ORDER_STEP_NAMES)[number]; readonly at: string }
