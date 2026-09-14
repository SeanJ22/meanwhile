/**
 * Consumer-side projection of the fleet operations contract
 * (`lib/control-plane/fleet-operations.ts`, `fleet-operations/v1`). PURE and
 * React-free so a producer→consumer test can drive it with the real read
 * service's output. Every rule here enforces one of the contract's honesty
 * requirements; the Admin panel (components/admin/fleet-operations-panel.tsx)
 * renders these results.
 */

import type {
  FleetOperation,
  FleetOperationsReport,
  FleetReceiptLoading,
  FleetTaskOperation,
} from "@/lib/control-plane/fleet-operations";
import type { FleetDeliveryItem } from "@/lib/control-plane/fleet-delivery";
// TYPE-ONLY: fleet-receipt-store.ts is a server module (node:fs). The type is
// erased at compile time, so the client bundle never pulls the loader.
import type { FleetReceiptLoadEntry } from "@/lib/control-plane/fleet-receipt-store";
import type { ScoutTaskAdmission } from "@/lib/control-plane/workers/scout-scheduling";

/**
 * Client-safe MIRROR of the two contract version strings this consumer compares
 * against. This module renders in the browser (the Admin panel is a client
 * component), and importing the RUNTIME exports from `fleet-operations.ts` would
 * drag its server read-service graph (`admin-data` → `pg-store` → `node:fs`) into
 * the client bundle — which fails the build with "the chunking context does not
 * support external modules (request: node:fs)". The TYPE imports above are erased
 * at compile time and are safe; these two strings are the only runtime values the
 * client needs. `tests/fleet-operations-consumer.test.ts` drives the real service
 * — whose reports carry the contract's own version strings — through this module,
 * so any drift between this mirror and the contract fails a test immediately.
 */
const FLEET_OPERATIONS_VERSION = "fleet-operations/v1";
const FLEET_OPERATIONS_EXTENSION_VERSION = "fleet-operations/extensions/1";

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

/**
 * The one on-demand read of the authenticated endpoint, shared by every client
 * presentation of the fleet report (the panel and the operations map) so a single
 * fetch shape cannot drift between them (RULING 103). Client-safe: it uses the
 * global `fetch` and returns a typed `FleetFetch` the consumer folds; it imports no
 * server module. `?? "network error"` is the admin-only transport detail when the
 * fetch throws with no Error.message — it describes the console's own failure to
 * reach its endpoint, never a claim about civic data.
 */
export async function fetchFleetOperations(): Promise<FleetFetch> {
  try {
    const res = await fetch("/api/admin/fleet/operations", { headers: { accept: "application/json" }, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as
      | (FleetOperationsReport & { error?: undefined })
      | { formatVersion?: string; observedAt?: string; error?: { code?: string; detail?: string } }
      | { says?: string }
      | null;
    if (body && "error" in body && body.error?.code === "CONTROL_PLANE_UNAVAILABLE") {
      return { status: "CONTROL_PLANE_UNAVAILABLE", observedAt: body.observedAt ?? "", detail: body.error.detail ?? "" };
    }
    if (body && "formatVersion" in body && body.formatVersion && "operations" in body) {
      return { status: "REPORT", report: body as FleetOperationsReport };
    }
    const says = body && "says" in body ? body.says : undefined;
    return { status: "TRANSPORT_ERROR", detail: says ?? `HTTP ${res.status}` };
  } catch (error) {
    return { status: "TRANSPORT_ERROR", detail: (error as Error)?.message ?? "network error" };
  }
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
    PERMANENT_AUTHORITY_PROMOTED: "promoted by the permanent civic-data authority (validated) — served-reader proof still separate",
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

// ── v1.2 receipt loading (fleet-receipt-loading/v1, additive on fleet-operations/v1) ──
// A trusted server-side loader reads the promoter's retained receipt files. The
// report carries only load METADATA (identity + state + gaps), never file
// contents. LOADED means a valid file was read and bound to its window summary —
// it is NOT promotion, verification, or served publication; a failed refresh
// RETAINS the last validated receipt as historical evidence with its ORIGINAL
// last-successful-read time, never restamped or re-verified; a truncated load is
// an evidence gap, never a complete history.

export const RECEIPT_NOTES = {
  loadedNotProof: "LOADED = a valid receipt file was read and bound to its window summary — not promotion, not verification, and never served publication.",
  retained: "A RETAINED receipt is the last validated one kept after a failed refresh; it is historical evidence, keeps its original read time, and is never current proof.",
  truncated: "Bounded loading omitted references; a truncated load is an evidence gap, never a complete receipt history.",
  notRecorded: "No receipt reading is available: no store was injected and the owner snapshot carries no historical-receipt extension yet (runner collection not connected).",
} as const;

/** One receipt LOAD entry, said plainly, never upgrading load state to proof. */
export function receiptLoadEntryLabel(entry: FleetReceiptLoadEntry): { readonly state: FleetReceiptLoadEntry["state"]; readonly text: string } {
  const map: Record<FleetReceiptLoadEntry["state"], string> = {
    LOADED: "loaded — valid file bound to its summary (not verified, not served)",
    RETAINED: `retained historical receipt — NOT current proof${entry.lastSuccessfulReadAt ? ` (last read ${entry.lastSuccessfulReadAt})` : ""}`,
    MISSING: "file missing — no receipt read this time",
    INVALID: "invalid — rejected before use, held history not replaced",
    UNAVAILABLE: "unreadable this time",
    LIMIT_REACHED: "omitted — receipt-count limit reached (evidence gap)",
  };
  const gaps = entry.gaps.length ? ` · ${entry.gaps.join(", ")}` : "";
  return { state: entry.state, text: `${entry.target} receipt ${entry.receiptId}: ${map[entry.state]}${gaps}` };
}

/** Top-level receipt-loading outcome, summarized. `unresolved` is true whenever
 *  anything short of a clean full load happened (store error, truncation, or any
 *  non-LOADED entry) — the same condition the producer uses to hold delivery
 *  freshness at UNKNOWN. */
export function receiptLoadingSummary(loading: FleetReceiptLoading): {
  readonly available: boolean;
  readonly unresolved: boolean;
  readonly text: string;
  readonly caveat: string | null;
} {
  if (loading.kind === "NOT_RECORDED") return { available: false, unresolved: false, text: RECEIPT_NOTES.notRecorded, caveat: null };
  if (loading.kind === "STORE_UNREACHABLE") return { available: false, unresolved: true, text: `Receipt store unreadable — ${loading.detail}`, caveat: null };
  const { entries, truncated, limits } = loading.value;
  const counts = entries.reduce<Record<FleetReceiptLoadEntry["state"], number>>((acc, e) => { acc[e.state] += 1; return acc; },
    { LOADED: 0, RETAINED: 0, MISSING: 0, INVALID: 0, UNAVAILABLE: 0, LIMIT_REACHED: 0 });
  const parts = (Object.entries(counts) as [FleetReceiptLoadEntry["state"], number][])
    .filter(([, n]) => n > 0).map(([state, n]) => `${n} ${state.toLowerCase().replace("_", " ")}`);
  const unresolved = truncated > 0 || entries.some((e) => e.state !== "LOADED");
  const truncNote = truncated > 0 ? ` · ${truncated} reference(s) omitted (${RECEIPT_NOTES.truncated})` : "";
  const text = entries.length === 0
    ? `No receipt references in the read windows (loader active, limits ${limits.maximumReceipts} files / ${limits.maxReceiptBytes} bytes).${truncNote}`
    : `${entries.length} receipt reference(s): ${parts.join(", ")}${truncNote}`;
  return { available: true, unresolved, text, caveat: RECEIPT_NOTES.loadedNotProof };
}

// ── Fleet operations MAP overlay (the operational surface, design 2026-09-13) ──
// The map lays the SAME report out as status lanes + expandable work items + panels.
// Every lane is DERIVED from the work item's own task states — never a stored flag —
// and each derivation is stated so the field-mapping view can show it. A live lease
// means activity, not proven progress; unavailable measurements stay unavailable.

export type FleetLane = "progressing" | "waiting" | "failing" | "recovering";

export interface FleetLaneMeta {
  readonly id: FleetLane;
  readonly label: string;
  readonly color: string;
  readonly blurb: string;
  /** How this lane is computed from the contract — shown in the field-mapping view. */
  readonly derivation: string;
}

/** The four operational lanes, with the exact colours and derivations from the design. */
export const FLEET_LANES: readonly FleetLaneMeta[] = [
  { id: "progressing", label: "Progressing", color: "#4FC9E8",
    blurb: "A lease is live, or a result was committed inside the last cycle.",
    derivation: "DERIVED — a task is CLAIMED or its admission is IN_FLIGHT, or its next action is LEASE_RECONCILIATION with an unexpired lease. A live lease means activity, not proven progress." },
  { id: "waiting", label: "Waiting", color: "#FFB000",
    blurb: "Due, or held by backoff, a policy recheck, or a decision that is yours.",
    derivation: "DERIVED — admission DUE or BACKOFF, a Scout timing/policy recheck, or a work-item owner decision. The residual lane when nothing is in flight, failing or recovering." },
  { id: "failing", label: "Failing", color: "#C2554A",
    blurb: "A refusal is on the record and the obligation is still owed.",
    derivation: "DERIVED — a task carries a blocker that is not a lease reason. The refusal is named and the obligation stays owed; nothing is retried blindly." },
  { id: "recovering", label: "Recovering", color: "#B57BFF",
    blurb: "A lease expired holding work. The sweep re-admits it and the retry resumes from the vault.",
    derivation: "DERIVED — a lease is EXPIRED with next action LEASE_RECONCILIATION. Recovery resumes from the preserved capture, not from the beginning." },
] as const;

export const fleetLaneMeta = (lane: FleetLane): FleetLaneMeta => FLEET_LANES.find((l) => l.id === lane)!;

/**
 * Which lane a work item is in, derived from its own tasks in strict precedence:
 * recovering (an expired lease is the most specific state) → failing (a named
 * blocker) → progressing (something in flight) → waiting (the residual). One lane
 * per item; the lane counts in the header are the envelope, not a per-item tally.
 */
export function fleetItemLane(op: FleetOperation): FleetLane {
  const tasks = op.tasks;
  if (tasks.some((t) => t.lease === "EXPIRED" && t.nextAutomaticAction === "LEASE_RECONCILIATION")) return "recovering";
  if (tasks.some((t) => t.blocker !== null && t.lease !== "ACTIVE")) return "failing";
  if (tasks.some((t) => t.state === "CLAIMED" || t.admission?.state === "IN_FLIGHT" || (t.nextAutomaticAction === "LEASE_RECONCILIATION" && t.lease === "ACTIVE"))) return "progressing";
  return "waiting";
}

/**
 * Provenance of the receipt reading (`receiptSource`, additive on
 * `fleet-operations/v1`; a report from before Fleet's owner-snapshot transport
 * omits it). The served surface reads receipts from the runner's OWNER_SNAPSHOT;
 * an INJECTED_STORE is only a runner/test-supplied store. This is historical
 * `promoter/1` archive provenance — it never upgrades to the permanent civic-data
 * authority. That permanent authority reads NOT_CONNECTED until PDC permanent-authority
 * publication evidence (a GOOD ValidationReceipt v2) is supplied to the read, when it reads
 * CONNECTED and names the validated publications; historical loading never becomes that.
 */
export function receiptSourceSummary(source: FleetOperationsReport["receiptSource"]): {
  readonly kind: "OWNER_SNAPSHOT" | "INJECTED_STORE";
  readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly permanentConnected: boolean;
  readonly text: string;
} | null {
  if (!source) return null;
  const origin = source.kind === "OWNER_SNAPSHOT" ? "owner snapshot" : "injected store (runner/test)";
  const observed = source.observedAt ? ` observed ${source.observedAt};` : "";
  const promotions = source.permanentAuthorityPromotions ?? [];
  const permanent = source.permanentAuthority === "CONNECTED"
    ? `permanent civic-data authority CONNECTED (${promotions.length} validated publication${promotions.length === 1 ? "" : "s"})`
    : "permanent receipt authority NOT CONNECTED";
  return {
    kind: source.kind,
    freshness: source.freshness,
    permanentConnected: source.permanentAuthority === "CONNECTED",
    text: `Receipt source: ${origin} — historical promoter/1 archive (${source.freshness.toLowerCase()});${observed} ${permanent}. Historical loading is not current civic-data delivery or served-publication proof.`,
  };
}
