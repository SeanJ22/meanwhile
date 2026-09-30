import type { ResearchIntent, ResearchIntentRequest } from "./research-policy.ts";

/**
 * WHY THE RESEARCH CYCLE'S MODEL LANE IS CLOSED, OR NULL WHEN IT IS OPEN.
 *
 * One ordered answer for every reason a cycle admits no paid model work. The
 * Scouts, the prompt-cache pre-warm and the adversarial auditor all key off
 * `modelLaneEnabled` in freshness-shadow.mts, so closing the lane here closes
 * every paid model call the cycle makes. The first reason that holds wins, so
 * the digest names the most basic one.
 *
 * NO DELIVERY PATH (owner directive, 2026-09-22: "prevent paid work from
 * accumulating behind a blocked delivery path while keeping useful processing
 * and routine publication moving"). While the activation gate keeps promotion
 * off, nothing a Scout or auditor produces can reach a reader; it accumulates
 * as inventory behind a closed door (RULING 248: acquisition without promotion
 * is inventory, not product). The lane reopens by itself in the first cycle
 * after the gate opens a record class. Obligations stay owed: a closed lane
 * defers work, it never disposes of it. Plain-code work and routine civic-data
 * publication are not model work and are untouched.
 *
 * THE OWNER'S CONTROLS FAIL CLOSED (2026-09-25). Paid research is paused by the
 * owner, and either of his pauses closes the lane: the research-lane PAUSE and
 * the runner-level PAUSE_RUNNER that Admin's runner card issues. Before this the
 * lane read only the first, so a runner pause left paid Scouts admissible in any
 * cycle that ran under it. A control that could not be read or is malformed (the
 * intent log, the spend-ceiling row) is not a control that said "go": the lane
 * is held closed as if paused, and the reason names what could not be read.
 * The owner's pause is shown ahead of the credential and delivery reasons —
 * every reason closes the lane the same way, so the order only chooses which
 * fact the digest and the console lead with, and his decision is the one that
 * outlasts the others.
 */
/**
 * The part of the activation gate this rule reads. Wider than today's
 * `ActivationGateReading` (whose `promotionEnabled` is the literal `false`), so
 * the rule stays correct, and its open case testable, when promotion opens.
 */
export interface DeliveryGate {
  readonly promotionEnabled: boolean;
  readonly openRecordClasses: readonly string[];
}

export interface ModelLaneFacts {
  readonly scheduledBlackout: boolean;
  readonly dry: boolean;
  readonly noModel: boolean;
  readonly credentialConfigured: boolean;
  /** The credential's variable NAME, for the reason line. Never its value. */
  readonly credentialVar: string;
  readonly activation: DeliveryGate;
  /** The research-lane PAUSE stands. */
  readonly paused: boolean;
  readonly pauseIntentId: string | null;
  /** The runner-level PAUSE_RUNNER stands. */
  readonly runnerPaused: boolean;
  readonly runnerPauseIntentId: string | null;
  /**
   * Each owner spending control this cycle could not read or found malformed,
   * as a sentence. Empty when every control read cleanly.
   */
  readonly unreadableControls: readonly string[];
}

export interface ModelLaneClosure {
  readonly code: "SCHEDULED_BLACKOUT" | "LANE_DISABLED" | "PAUSED";
  readonly reason: string;
}

/** The latest saved lane decision awaiting this normal cycle's acknowledgement. */
export function pendingResearchLaneAcknowledgment(
  log: readonly ResearchIntent[],
  laneClosure: ModelLaneClosure | null,
): { readonly intent: ResearchIntentRequest; readonly detail: string } | null {
  const pending = log
    .filter((r): r is ResearchIntentRequest =>
      r.kind === "INTENT" && (r.action === "PAUSE" || r.action === "RESUME"))
    .sort((a, b) => a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0);
  const latest = pending.at(-1);
  if (latest === undefined || log.some(r => r.kind === "HONORED" && r.honors === latest.intentId)) return null;
  return {
    intent: latest,
    detail: latest.action === "PAUSE"
      ? "model lane closed for this cycle"
      : laneClosure === null
        ? "model lane reopened"
        : `model lane reopened by the owner, but it stays closed this cycle: ${laneClosure.reason}`,
  };
}

/** True when promotion is on and at least one record class is open to it. */
export function deliveryPathOpen(activation: DeliveryGate): boolean {
  return activation.promotionEnabled && activation.openRecordClasses.length > 0;
}

export function modelLaneClosure(f: ModelLaneFacts): ModelLaneClosure | null {
  if (f.scheduledBlackout) {
    return {
      code: "SCHEDULED_BLACKOUT",
      reason: "SCHEDULED BLACKOUT: Saturday 18:00 through Sunday 06:00 America/Phoenix permits no model or network research",
    };
  }
  if (f.dry) return { code: "LANE_DISABLED", reason: "--dry: no retrieval of any kind runs, so no Scout runs" };
  if (f.noModel) return { code: "LANE_DISABLED", reason: "--no-model: the Scout lane is held closed for this diagnostic cycle" };
  if (f.paused) return { code: "PAUSED", reason: `paused by owner intent ${f.pauseIntentId ?? "(id unrecorded)"}` };
  if (f.runnerPaused) {
    return { code: "PAUSED", reason: `the owner paused the runner (intent ${f.runnerPauseIntentId ?? "(id unrecorded)"}); no paid model work runs under it` };
  }
  if (f.unreadableControls.length > 0) {
    return {
      code: "PAUSED",
      reason:
        `held closed as if paused, because an owner spending control could not be read: ${f.unreadableControls.join("; ")}. ` +
        "Plain-code work, routine publication and free discovery walks continue",
    };
  }
  if (!f.credentialConfigured) {
    return { code: "LANE_DISABLED", reason: `${f.credentialVar} is not set in this process, so no model can be invoked` };
  }
  if (!deliveryPathOpen(f.activation)) {
    return {
      code: "LANE_DISABLED",
      reason:
        `no delivery path is open: the activation gate keeps promotion ${f.activation.promotionEnabled ? "on" : "OFF"} with ` +
        `${f.activation.openRecordClasses.length} record class(es) open, so paid model work would only accumulate unread. ` +
        "Scouts, the pre-warm and the auditor wait for the gate; plain-code work and routine publication continue",
    };
  }
  return null;
}
