import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSnapshot, validateSnapshot } from "../meetings/snapshot.ts";
import { canonicalJson } from "./repository/types.ts";
import { deriveItemState } from "./promotion/pipeline.ts";
import type { FactItem } from "./promotion/fact-chain.ts";
import { isMeetingFactClass } from "./promotion/meeting-facts.ts";
import type { PromotionReceipt } from "./promotion/promoter.ts";
import { projectFactToReader, readerRendering, type ReaderRendering } from "./promotion/reader-projection.ts";
import type { PipelineStage, WindowRunRecord } from "./promotion/types.ts";
import type { AutonomousObligationActivity } from "./workers/activity.ts";
import type { ReadOutcome } from "./admin-data.ts";
import type { FleetReceiptLoadEntry, FleetReceiptLoadReport } from "./fleet-receipt-store.ts";

export const FLEET_DELIVERY_VERSION = "fleet-delivery/v1";

// An unread timestamp cannot silently sort behind known-good evidence.
function observationOrder(a: string, b: string): number {
  const left = Date.parse(a), right = Date.parse(b);
  if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
  if (!Number.isFinite(right)) return -1;
  return left - right;
}

/** A reading of an explicitly supplied local snapshot, never an HTTP/served-site proof. */
export interface FleetReceiptReadback {
  readonly receiptId: string;
  readonly target: PromotionReceipt["target"];
  readonly observedAt: string;
  readonly scope: "LOCAL_SNAPSHOT";
  readonly snapshotSha256: string | null;
  readonly matchesReceiptAfter: boolean;
  readonly items: readonly { readonly itemId: string; readonly factKey: string; readonly recordClass: string;
    readonly meetingId: string; readonly matchesProjection: boolean; readonly rendering: ReaderRendering | null; readonly gaps: readonly string[] }[];
  readonly gaps: readonly string[];
}

export interface FleetDeliveryItem {
  readonly itemId: string;
  readonly recordClass: string | null;
  readonly subjectId: string | null;
  readonly source: { readonly artifactIds: readonly string[]; readonly canonicalUrl: string | null;
    readonly factKey: string | null; readonly sourceKey: string | null; readonly workItemId: string | null };
  readonly recordedStage: PipelineStage | null;
  readonly approvalRecordId: string | null;
  readonly pipelineRefusalReasons: readonly string[];
  readonly windowDecisions: readonly { readonly windowId: string; readonly at: string; readonly mode: "SHADOW";
    readonly verdict: string; readonly reason: string;
    readonly receiptSummaryBinding: "WINDOW_ONLY_NOT_PER_ITEM";
    readonly receiptSummaries: NonNullable<WindowRunRecord["promotionReceipts"]> }[];
  readonly receipts: readonly { readonly receiptId: string; readonly target: "SHADOW" | "READER"; readonly windowId: string | null;
    readonly at: string; readonly identityMatch: boolean; readonly materialized: boolean; readonly reverted: boolean;
    readonly verification: PromotionReceipt["verification"]; readonly readback: FleetReceiptReadback["items"][number] | null;
    readonly readbackObservedAt: string | null; readonly readbackScope: "LOCAL_SNAPSHOT" | null;
    readonly refusal: string | null; readonly gaps: readonly string[] }[];
  readonly status: "HELD" | "SHADOW_READBACK_VERIFIED" | "READER_MATERIALIZED_UNPROVEN" | "UNKNOWN";
  /** Includes unresolved batch loads where per-item binding cannot yet be established. */
  readonly receiptLoads: readonly FleetReceiptLoadEntry[];
  readonly gaps: readonly string[];
}

export interface FleetDeliveryReport {
  readonly version: typeof FLEET_DELIVERY_VERSION;
  readonly receiptAvailability: "PROVIDED" | "NOT_PROVIDED";
  readonly items: readonly FleetDeliveryItem[];
}

/** Canonical per-item joins only. Window batch counts never prove an item's receipt or delivery. */
export function projectFleetDelivery(input: { readonly activity: AutonomousObligationActivity; readonly windows: readonly WindowRunRecord[];
  readonly receipts?: readonly PromotionReceipt[]; readonly readbacks?: readonly FleetReceiptReadback[];
  readonly receiptLoading?: ReadOutcome<Omit<FleetReceiptLoadReport, "receipts">> }): FleetDeliveryReport {
  const { activity } = input;
  const states = [...new Set(activity.facts.promotion.map(record => record.itemId))].sort()
    .map(id => deriveItemState(id, activity.facts.promotion.filter(record => record.itemId === id)));
  const items = states.map((state): FleetDeliveryItem => {
    const scouted = state.byStage.SCOUTED;
    const source = scouted?.source.kind === "FLEET_EXTRACTION" ? scouted.source : null;
    const approval = state.byStage.APPROVED_FOR_PROMOTION;
    const gaps: string[] = [];
    const identity = source !== null && source.workItemId === activity.workItem.id &&
      scouted!.artifactIds.includes(source.artifactId) && activity.facts.artifacts.some(artifact =>
        artifact.artifactId === source.artifactId && artifact.workItemId === source.workItemId);
    if (!identity) gaps.push("CANONICAL_FLEET_SOURCE_IDENTITY_UNPROVEN");
    if (!isMeetingFactClass(state.recordClass ?? "")) gaps.push("READER_PROJECTION_NOT_IMPLEMENTED_FOR_CLASS");
    if (!approval) gaps.push("APPROVAL_NOT_RECORDED");
    const windowDecisions = input.windows.flatMap(window => window.pipeline.verdicts.filter(verdict => verdict.itemId === state.itemId)
      .map(verdict => ({ windowId: window.windowId, at: window.finishedAt, mode: window.mode, verdict: verdict.verdict,
        reason: verdict.reason, receiptSummaryBinding: "WINDOW_ONLY_NOT_PER_ITEM" as const, receiptSummaries: window.promotionReceipts ?? [] })))
      .sort((a, b) => observationOrder(a.at, b.at) || a.windowId.localeCompare(b.windowId));
    if (!windowDecisions.length) gaps.push("WINDOW_DECISION_NOT_RECORDED");
    if (windowDecisions.some(window => !Number.isFinite(Date.parse(window.at)))) gaps.push("WINDOW_DECISION_CLOCK_INVALID");
    const receipts = (input.receipts ?? []).filter(receipt => receipt.items.some(item => item.itemId === state.itemId) ||
      receipt.refused.some(item => item.itemId === state.itemId)).map((receipt): FleetDeliveryItem["receipts"][number] => {
      const receiptGaps: string[] = [];
      const offered = receipt.items.filter(item => item.itemId === state.itemId);
      const refusal = receipt.refused.find(item => item.itemId === state.itemId);
      if (offered.length && refusal) receiptGaps.push("RECEIPT_ITEM_ACCEPTANCE_REFUSAL_CONTRADICTION");
      const identityMatch = identity && offered.length === 1 && offered[0].recordClass === state.recordClass && offered[0].factKey === source!.factKey;
      if (!identityMatch && offered.length) receiptGaps.push("RECEIPT_FACT_IDENTITY_MISMATCH");
      if (receipt.windowId !== null) {
        const window = input.windows.find(value => value.windowId === receipt.windowId);
        if (!window) receiptGaps.push("RECEIPT_WINDOW_NOT_JOINED");
        else if (!Number.isFinite(Date.parse(window.finishedAt))) receiptGaps.push("RECEIPT_WINDOW_CLOCK_INVALID");
        else if (offered.length && !window.pipeline.verdicts.some(verdict => verdict.itemId === state.itemId &&
          verdict.recordClass === state.recordClass && verdict.verdict === "PROMOTE_WOULD")) receiptGaps.push("WINDOW_RECEIPT_DECISION_MISMATCH");
      }
      // A later failed observation supersedes a prior successful one; never cherry-pick green readback.
      const reading = (input.readbacks ?? []).filter(readback => readback.receiptId === receipt.receiptId &&
        canonicalJson(readback.target) === canonicalJson(receipt.target)).sort((a, b) => observationOrder(a.observedAt, b.observedAt)).at(-1);
      if (reading && (!Number.isFinite(Date.parse(reading.observedAt)) || Date.parse(reading.observedAt) < Date.parse(receipt.at))) {
        receiptGaps.push("READBACK_PRECEDES_RECEIPT_OR_READBACK_CLOCK_INVALID");
      }
      if (reading && (reading.snapshotSha256 !== receipt.after.sha256 || !reading.matchesReceiptAfter || reading.gaps.length)) {
        receiptGaps.push(...reading.gaps, "EXACT_LOCAL_SNAPSHOT_READBACK_NOT_PASS");
      }
      const readback = reading?.items.find(item => item.itemId === state.itemId &&
        item.factKey === source?.factKey && item.recordClass === state.recordClass && item.meetingId === offered[0]?.meetingId) ?? null;
      if (!readback) receiptGaps.push("EXACT_LOCAL_SNAPSHOT_READBACK_NOT_PROVIDED");
      else if (!readback.matchesProjection || readback.gaps.length) receiptGaps.push(...readback.gaps, "LOCAL_READER_PROJECTION_MISMATCH");
      if (receipt.verification?.passed !== true || receipt.verification.exitCode !== 0) receiptGaps.push("RECEIPT_POST_WRITE_VERIFICATION_NOT_PASS");
      const reverted = receipt.reversal?.executed === true;
      if (reverted) receiptGaps.push("MATERIALIZATION_REVERTED");
      if (receipt.incident) receiptGaps.push(`PROMOTION_INCIDENT:${receipt.incident.code}`);
      if (!Number.isFinite(Date.parse(receipt.at))) receiptGaps.push("RECEIPT_CLOCK_INVALID");
      if (!approval || !Number.isFinite(Date.parse(approval.at)) || Date.parse(receipt.at) < Date.parse(approval.at)) receiptGaps.push("APPROVAL_NOT_BOUND_BEFORE_RECEIPT");
      if (!receipt.authority.enabled || !receipt.authority.openRecordClasses.includes(state.recordClass ?? "") ||
        (receipt.target.kind === "READER" && receipt.authority.basis !== "LIVE_ACTIVATION_GATE")) receiptGaps.push("RECEIPT_AUTHORITY_MISMATCH");
      return { receiptId: receipt.receiptId, target: receipt.target.kind, windowId: receipt.windowId, at: receipt.at, identityMatch,
        materialized: identityMatch && receipt.after.written, reverted, verification: receipt.verification, readback,
        readbackObservedAt: reading?.observedAt ?? null, readbackScope: reading?.scope ?? null,
        refusal: refusal ? `${refusal.code}: ${refusal.detail}` : null, gaps: [...new Set(receiptGaps)] };
    }).sort((a, b) => observationOrder(a.at, b.at) || a.receiptId.localeCompare(b.receiptId));
    if (!receipts.length) gaps.push(input.receipts === undefined ? "FULL_ITEM_RECEIPTS_NOT_PROVIDED" : "NO_IDENTITY_BOUND_ITEM_RECEIPT");
    const latest = receipts.at(-1);
    gaps.push(...(latest?.gaps ?? []));
    const receiptLoads = input.receiptLoading?.kind === "HELD" ? input.receiptLoading.value.entries.filter(entry =>
      receipts.some(receipt => receipt.receiptId === entry.receiptId) ||
      (entry.state !== "LOADED" && windowDecisions.some(window => window.windowId === entry.windowId))) : [];
    const loadUnproven = receiptLoads.some(entry => entry.state !== "LOADED") ||
      (input.receiptLoading?.kind === "HELD" && input.receiptLoading.value.truncated > 0) ||
      (input.receiptLoading !== undefined && input.receiptLoading.kind !== "HELD");
    if (input.receiptLoading?.kind === "HELD" && input.receiptLoading.value.truncated > 0) gaps.push("RECEIPT_LOADING_TRUNCATED");
    for (const entry of receiptLoads.filter(entry => entry.state !== "LOADED")) {
      gaps.push(`RECEIPT_LOAD_${entry.state}:${entry.receiptId}`, ...entry.gaps);
    }
    if (input.receiptLoading && input.receiptLoading.kind !== "HELD") gaps.push(`RECEIPT_LOADING_${input.receiptLoading.kind}`);
    const status: FleetDeliveryItem["status"] = !loadUnproven && latest?.materialized && latest.gaps.length === 0
      ? latest.target === "SHADOW" ? "SHADOW_READBACK_VERIFIED" : "READER_MATERIALIZED_UNPROVEN"
      : latest?.refusal || windowDecisions.at(-1)?.verdict === "REFUSE_WOULD" || !approval ? "HELD" : "UNKNOWN";
    gaps.push(latest?.target === "SHADOW" ? "SHADOW_DOES_NOT_PROVE_SERVED_READER" : "SERVED_READER_PROOF_NOT_OBSERVED");
    return { itemId: state.itemId, recordClass: state.recordClass, subjectId: state.subjectId,
      source: { artifactIds: scouted?.artifactIds ?? [], canonicalUrl: scouted?.canonicalUrl ?? null,
        factKey: source?.factKey ?? null, sourceKey: source?.sourceKey ?? null, workItemId: source?.workItemId ?? null },
      recordedStage: state.stage, approvalRecordId: approval?.recordId ?? null,
      pipelineRefusalReasons: state.refused?.reasons.map(reason => `${reason.code}: ${reason.detail}`) ?? [],
      windowDecisions, receipts, receiptLoads, status, gaps: [...new Set(gaps)] };
  });
  return { version: FLEET_DELIVERY_VERSION, receiptAvailability: input.receipts === undefined ? "NOT_PROVIDED" : "PROVIDED", items };
}

/**
 * Explicit caller-selected resource only; never follows persisted receipt paths to another root.
 * Reuses the actual Reader snapshot validator and projection, with exact receipt-byte binding.
 * This is a current local read, not an HTTP observation, new proof authority, or freshness clock.
 */
export function readFleetReceiptReadback(receipt: PromotionReceipt, input: { readonly root: string;
  readonly items: readonly FactItem[]; readonly observedAt: string }): FleetReceiptReadback {
  const gaps: string[] = [];
  let snapshotSha256: string | null = null;
  const items: FleetReceiptReadback["items"][number][] = [];
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("FLEET_DELIVERY_CLOCK_INVALID");
  if (!Number.isFinite(Date.parse(receipt.at)) || Date.parse(input.observedAt) < Date.parse(receipt.at)) gaps.push("READBACK_PRECEDES_RECEIPT_OR_RECEIPT_CLOCK_INVALID");
  if (resolve(input.root) !== resolve(receipt.target.root) ||
    resolve(receipt.before.path) !== resolve(input.root, "data", "meetings-snapshot.json")) gaps.push("EXPLICIT_TARGET_ROOT_MISMATCH");
  if (!gaps.length) {
    try {
      const bytes = readFileSync(receipt.before.path);
      snapshotSha256 = createHash("sha256").update(bytes).digest("hex");
      if (snapshotSha256 !== receipt.after.sha256) gaps.push("SNAPSHOT_CHANGED_SINCE_RECEIPT");
      const snapshot = readSnapshot(input.root);
      validateSnapshot(snapshot);
      if (canonicalJson(snapshot) !== canonicalJson(JSON.parse(bytes.toString("utf8")))) gaps.push("SNAPSHOT_CHANGED_DURING_READ");
      for (const offered of receipt.items) {
        const itemGaps: string[] = [];
        const candidates = input.items.filter(item => item.itemId === offered.itemId && item.fact.factKey === offered.factKey &&
          item.fact.recordClass === offered.recordClass && item.fact.meetingId === offered.meetingId);
        if (candidates.length !== 1) itemGaps.push("EXACT_SOURCE_FACT_NOT_LOADED");
        const fact = candidates.length === 1 ? candidates[0].fact : null;
        const change = fact === null ? null : projectFactToReader(fact, snapshot);
        if (change?.kind !== "UNCHANGED") itemGaps.push("LOCAL_READER_PROJECTION_MISMATCH");
        const rendering = change?.kind === "UNCHANGED" ? readerRendering(change) : null;
        if (rendering?.time === "unrenderable") itemGaps.push("LOCAL_READER_CLOCK_UNRENDERABLE");
        items.push({ itemId: offered.itemId, factKey: offered.factKey, recordClass: offered.recordClass, meetingId: offered.meetingId,
          matchesProjection: itemGaps.length === 0, rendering, gaps: itemGaps });
      }
    } catch { gaps.push("LOCAL_SNAPSHOT_UNREADABLE_OR_INVALID"); }
  }
  return { receiptId: receipt.receiptId, target: receipt.target, observedAt: input.observedAt, scope: "LOCAL_SNAPSHOT",
    snapshotSha256, matchesReceiptAfter: snapshotSha256 !== null && snapshotSha256 === receipt.after.sha256, items, gaps };
}
