/**
 * Consumer-side projection of the fleet operations contract
 * (`lib/control-plane/fleet-operations.ts`, `fleet-operations/v1`). PURE and
 * React-free so a producer→consumer test can drive it with the real read
 * service's output. Every rule here enforces one of the contract's honesty
 * requirements; the Admin panel (components/admin/fleet-operations-panel.tsx)
 * renders these results.
 */

import {
  FLEET_OPERATIONS_EXTENSION_VERSION,
  FLEET_OPERATIONS_VERSION,
  type FleetOperation,
  type FleetOperationsReport,
  type FleetTaskOperation,
} from "@/lib/control-plane/fleet-operations";
import type { FleetDeliveryItem } from "@/lib/control-plane/fleet-delivery";
import type { ScoutTaskAdmission } from "@/lib/control-plane/workers/scout-scheduling";

/** What one on-demand fetch of the endpoint yielded. */
export type FleetFetch =
  | { readonly status: "REPORT"; readonly report: FleetOperationsReport }
  | { readonly status: "CONTROL_PLANE_UNAVAILABLE"; readonly observedAt: string; readonly detail: string }
  | { readonly status: "TRANSPORT_ERROR"; readonly detail: string };

/**
 * Consumer state across refreshes. On a FAILED refresh the previously shown
 * report and its ORIGINAL observedAt are retained and the error is surfaced
 * alongside — the consumer never restamps old facts (contract §Read and
 * freshness behavior).
 */
export interface FleetConsumerState {
  readonly shown: FleetOperationsReport | null;
  readonly lastError: string | null;
  readonly unknownVersion: boolean;
}

export const EMPTY_CONSUMER_STATE: FleetConsumerState = { shown: null, lastError: null, unknownVersion: false };

export function isKnownVersion(formatVersion: string): boolean {
  return formatVersion === FLEET_OPERATIONS_VERSION;
}

/** Fold an incoming fetch into the consumer state, retaining facts on failure. */
export function applyRefresh(prev: FleetConsumerState, incoming: FleetFetch): FleetConsumerState {
  if (incoming.status === "REPORT") {
    if (!isKnownVersion(incoming.report.formatVersion)) {
      // An unknown version needs a new consumer; keep the prior good report, flag it.
      return { shown: prev.shown, lastError: `Unknown report version ${incoming.report.formatVersion}; this consumer implements ${FLEET_OPERATIONS_VERSION}.`, unknownVersion: true };
    }
    return { shown: incoming.report, lastError: null, unknownVersion: false };
  }
  const detail = incoming.status === "CONTROL_PLANE_UNAVAILABLE"
    ? `Control plane unavailable — no fleet facts were read (${incoming.detail}).`
    : `Could not reach the operations report (${incoming.detail}).`;
  // Retain prev.shown AND its original observedAt; surface the new error.
  return { shown: prev.shown, lastError: detail, unknownVersion: prev.unknownVersion };
}

export type SectionState = "HELD" | "NOT_RECORDED" | "STORE_UNREACHABLE";

/** HTTP 200 never means every section was measured — each section carries its own outcome. */
export function anySectionUnavailable(report: FleetOperationsReport): boolean {
  return [report.operations, report.coverageGaps, report.ownerDecisions].some((s) => s.kind === "STORE_UNREACHABLE");
}

/** Spending is UNKNOWN or INCOMPLETE — never rendered as $0 — whenever nothing was
 *  measured, ledger entries are incomplete, or attempts carry no cost entry. */
export function spendingDisplay(spending: FleetOperation["spending"]): {
  readonly known: boolean;
  readonly complete: boolean;
  readonly text: string;
} {
  const { usd, attemptsWithoutCostEntry } = spending;
  const gaps = attemptsWithoutCostEntry.length;
  if (usd.total === null) {
    return { known: false, complete: false, text: gaps ? `Not measured — ${gaps} attempt(s) have no cost entry` : "Not measured" };
  }
  const measured = `$${usd.total.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const complete = usd.complete && usd.unmeasured === 0 && gaps === 0;
  if (complete) return { known: true, complete: true, text: measured };
  const missing = [
    usd.unmeasured ? `${usd.unmeasured} unmeasured` : null,
    gaps ? `${gaps} attempt(s) with no cost entry` : null,
  ].filter(Boolean).join(", ");
  return { known: true, complete: false, text: `${measured} measured so far — incomplete (${missing})` };
}

/** The next PREREQUISITE, explicitly never a promised dispatch time; a retryAt is a
 *  boundary, not a scheduled run. */
export function nextActionDisplay(task: FleetTaskOperation): string {
  const base: Record<FleetTaskOperation["nextAutomaticAction"], string> = {
    ADMISSION_CHECK: "an admission check",
    POLICY_RECHECK: "a policy recheck",
    WAIT_FOR_BACKOFF: "waiting out a backoff window",
    LEASE_RECONCILIATION: "lease reconciliation",
    UNKNOWN: "unknown from this read",
    NONE_FOR_THIS_TASK: "none for this task (does not complete its parent or publish)",
  };
  const prefix = task.nextAutomaticAction === "NONE_FOR_THIS_TASK" || task.nextAutomaticAction === "UNKNOWN"
    ? "Next automatic action"
    : "Next prerequisite";
  const suffix = task.retryAt ? ` · earliest recheck ${task.retryAt} (a boundary, not a dispatch)` : "";
  return `${prefix}: ${base[task.nextAutomaticAction]} — a prerequisite, not a scheduled dispatch${suffix}`;
}

/** Progress (useful advance) is distinct from activity (a heartbeat/retry can move
 *  activity while yielding no new evidence). */
export function progressSummary(op: FleetOperation): { readonly advanced: boolean; readonly progressAt: string | null; readonly activityAt: string | null } {
  return {
    advanced: op.lastProgress !== null,
    progressAt: op.lastProgress?.at ?? null,
    activityAt: op.lastActivity?.at ?? null,
  };
}

export const NOTES = {
  publication: "Publication is UNKNOWN in v1: a recorded promotion stage is not proof a fact reached the website.",
  delivery: "Delivery freshness is only whether this report was read recently — not whether the civic data is fresh.",
  coverage: "Reader-instrument ZIP gaps, at the snapshot's own publish time. Not the ZIP-completion denominator.",
  acquisition: "Last successful acquisition held. Acquisition is not verification, permission for a new fetch, or current freshness.",
  extensionUnavailable: "This producer does not supply the operational extension — an unavailable capability, not an empty result.",
  deliveryLocal: "Delivery details join LOCAL evidence (windows, shadow readbacks). They narrow, but never replace, the conservative UNKNOWN served-publication status.",
  receiptsNotProvided: "Full item receipts are not supplied by the HTTP endpoint; a shadow readback is not certified served publication.",
} as const;

// ── v1.1 extension (fleet-operations/extensions/1) ─────────────────────────────
// All additive. A report from an older producer omits these; the consumer treats
// a missing extension as an UNAVAILABLE CAPABILITY, never an empty success.

export function extensionCapability(report: FleetOperationsReport): "PRESENT" | "UNAVAILABLE" {
  return report.extensionVersion === FLEET_OPERATIONS_EXTENSION_VERSION ? "PRESENT" : "UNAVAILABLE";
}

/** The Scout family's next PREREQUISITE — never a dispatch time. Selection always
 *  requires coordinator re-evaluation; a retryAt is a boundary, not a run. */
export function scoutPrerequisite(scout: ScoutTaskAdmission): string {
  const state: Record<ScoutTaskAdmission["state"], string> = {
    TIMING_ELIGIBLE: "timing-eligible — admission may be evaluated",
    BACKOFF: "waiting out a backoff window",
    IN_FLIGHT: "in flight — lease reconciliation",
    POLICY_RECHECK: "a policy recheck (named transport/cost condition must change)",
    POLICY_DENIED: "policy denied — no automatic recovery",
    CONTINUATION_CANDIDATE: "continuation candidate — still needs unresolved source work",
    CONTINUED: "already continued in an existing child",
    UNKNOWN: "unknown from this read",
  };
  const suffix = scout.retryAt ? ` · earliest retry ${scout.retryAt} (a boundary, not a dispatch)` : "";
  return `Scout: ${state[scout.state]} — a prerequisite; selection still requires coordinator re-evaluation${suffix}`;
}

/** Local delivery evidence is never served proof. */
export function deliveryItemStatusLabel(item: FleetDeliveryItem): { readonly text: string; readonly served: false } {
  const map: Record<FleetDeliveryItem["status"], string> = {
    HELD: "held (established refusal or missing approval)",
    SHADOW_READBACK_VERIFIED: "shadow readback verified locally — NOT served to a reader",
    READER_MATERIALIZED_UNPROVEN: "reader-materialized, served proof still missing",
    UNKNOWN: "unknown",
  };
  return { text: map[item.status], served: false };
}

/** Summarize the publication.delivery ReadOutcome without ever upgrading local
 *  evidence to served publication. */
export function deliverySummary(
  delivery: FleetOperation["publication"]["delivery"],
): { readonly kind: string; readonly text: string } {
  if (delivery.kind === "STORE_UNREACHABLE") return { kind: delivery.kind, text: `window store unreadable — ${delivery.detail}` };
  if (delivery.kind === "NOT_RECORDED") return { kind: delivery.kind, text: `no joined window evidence — ${delivery.detail}` };
  const v = delivery.value;
  const receipts = v.receiptAvailability === "PROVIDED" ? "full receipts supplied (still not certified publication)" : "full receipts NOT provided by the endpoint";
  return { kind: delivery.kind, text: `delivery v1: ${v.items.length} item(s); ${receipts}` };
}
