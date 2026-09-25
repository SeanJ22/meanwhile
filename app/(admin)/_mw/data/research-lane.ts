/**
 * The paid research lane's standing, in the owner's words, from the research
 * state the runner writes each cycle. The runner's own reason is kept beside
 * the plain sentence so nothing is paraphrased away.
 */
import type { ResearchState } from "@/lib/control-plane/scheduler/research-policy.ts";

export interface PaidLane {
  readonly open: boolean;
  /** One plain sentence, or null when the lane is open. */
  readonly closedBecause: string | null;
  /** The runner's own words. */
  readonly recorded: string | null;
  readonly waiting: number | null;
}

export function paidLaneOf(state: ResearchState | null): PaidLane {
  if (state === null) {
    return { open: false, closedBecause: "Whether it is open is unknown: the research state was not read.", recorded: null, waiting: null };
  }
  const waiting = typeof state.queue?.modelClassDeferredForLane === "number" ? state.queue.modelClassDeferredForLane : null;
  if (state.modelLaneEnabled) return { open: true, closedBecause: null, recorded: null, waiting };
  const raw = state.modelLaneDisabledReason ?? "";
  // The waiting count belongs to every closed reason, not only the one the
  // runner happened to name first: the owner's pause now outranks the
  // delivery gate, and the count must not vanish with the reordering.
  const waitingClause = waiting !== null && waiting > 0 ? `; ${waiting.toLocaleString("en-US")} paid items wait` : "";
  let plain: string;
  if (raw.startsWith("no delivery path is open")) {
    plain = `closed: no delivery path is open — promotion to readers is off, so paid work would only pile up unread${waitingClause}.`;
  } else if (raw.startsWith("SCHEDULED BLACKOUT")) {
    plain = "closed for the weekend blackout (Saturday 6 PM to Sunday 6 AM, Phoenix time).";
  } else if (raw.startsWith("paused")) {
    plain = `paused by you${waitingClause}.`;
  } else if (raw.startsWith("the owner paused the runner")) {
    plain = `paused: you paused the runner${waitingClause}.`;
  } else if (raw.startsWith("held closed as if paused")) {
    plain = `held closed: a spending control could not be read, so paid work waits until it can be${waitingClause}.`;
  } else if (raw === "") {
    plain = "closed; the runner recorded no reason.";
  } else {
    plain = `closed: ${raw}.`;
  }
  return { open: false, closedBecause: plain, recorded: raw === "" ? null : raw, waiting };
}
