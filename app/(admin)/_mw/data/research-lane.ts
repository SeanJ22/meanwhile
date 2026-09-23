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
  let plain: string;
  if (raw.startsWith("no delivery path is open")) {
    plain = `closed: no delivery path is open — promotion to readers is off, so paid work would only pile up unread${waiting !== null && waiting > 0 ? `; ${waiting.toLocaleString("en-US")} paid items wait for it` : ""}.`;
  } else if (raw.startsWith("SCHEDULED BLACKOUT")) {
    plain = "closed for the weekend blackout (Saturday 6 PM to Sunday 6 AM, Phoenix time).";
  } else if (raw.startsWith("paused")) {
    plain = "paused by you.";
  } else if (raw === "") {
    plain = "closed; the runner recorded no reason.";
  } else {
    plain = `closed: ${raw}.`;
  }
  return { open: false, closedBecause: plain, recorded: raw === "" ? null : raw, waiting };
}
