/** The words the work list is sorted by. Plain values, so Admin's screen can use them as well as the code that writes the list. */
export const WORK_KINDS = ["fact", "lead", "hunt", "recheck", "ask", "slice", "detect", "fix", "load", "check"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
/** The order claims are served in: clock work, then Sean's orders, then reader requests, then the least-complete places. */
export const WORK_TIERS = ["clock", "order", "reader", "coverage"] as const;
export type WorkTier = (typeof WORK_TIERS)[number];
export type WorkStatus = "waiting" | "taken" | "done" | "refused";
/** An order's row carries these steps; Received, In progress and Done are written by the list itself. */
export interface OrderStep { readonly step: "Received" | "Accepted" | "Scheduled" | "In progress" | "Done"; readonly at: string }
