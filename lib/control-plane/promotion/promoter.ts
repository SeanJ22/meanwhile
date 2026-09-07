/**
 * **THE GOVERNED PROMOTER — REAL, WIRED, AND UNREACHABLE WHILE THE GATE IS OFF.**
 * (Fleet Promotion Readiness, PRDY-6, 2026-09-06.)
 *
 * ## What it replaces
 *
 * The nightly window's promoter was a placeholder that THREW if it was ever
 * called — correct while promotion is OFF, and also proof that no promotion
 * mechanism existed (ACT-7). This module is the mechanism. It stays behind the
 * same gate: `runPromotionStep` never calls it while `promotionEnabled` is
 * false, and it refuses on its own when its authority is not enabled.
 *
 * ## What it accepts, in order
 *
 * ```
 *   authority        LIVE_ACTIVATION_GATE for the READER target, always;
 *                    SHADOW_CANARY_AS_IF may drive only an isolated SHADOW root
 *   enabled          otherwise every item is refused PROMOTION_OFF and nothing is written
 *   verdict          PROMOTE_WOULD only
 *   record class     open at the authority, and a meeting-fact class
 *   fact             loaded from the chain, not superseded, not on a freshness hold
 *   projection       the canonical Reader projection validates
 * ```
 *
 * ## Materialization, receipt, reversal
 *
 * The proposed snapshot is written through the Reader's own `writeSnapshot`
 * (validate, temp file, atomic rename). Before it is, the exact bytes of the
 * current snapshot are copied beside the receipt; the receipt names the
 * before hash, the after hash, every item and its change, the verification
 * verdict and the regression decision. `executeRevert` puts the before bytes
 * back through the same atomic rename and proves the hash — a deterministic
 * reversal, no shell, no guess. A failed or unanswerable verification opens an
 * incident through the window's own `openIncident`.
 *
 * No git command lives here. Shipping a READER materialization to `main`
 * remains the existing push door's job (`scripts/push-main.mjs`, allowlisted
 * to the snapshot path), invoked by the caller that owns that step; this
 * module's receipt is what that step would carry.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { formatMeetingTime } from "../../map/format.ts";
import { readSnapshot, validateSnapshot, writeSnapshot } from "../../meetings/snapshot.ts";
import { fingerprint } from "../ids.ts";
import { isMeetingFactClass, type MeetingFact } from "./meeting-facts.ts";
import { projectionLines, proposeSnapshot, type ReaderChangeKind } from "./reader-projection.ts";
import type { ActivationGateReading, ItemVerdict, WindowIncident } from "./types.ts";
import { decideRegression, openIncident, type RegressionAction, type VerificationVerdict } from "./window.ts";

export const PROMOTER_VERSION = "promoter/1";
export const RECEIPTS_DIR = ["data", "health", "promotion-receipts"] as const;

export interface PromotionAuthority {
  readonly enabled: boolean;
  readonly openRecordClasses: readonly string[];
  readonly basis: "LIVE_ACTIVATION_GATE" | "SHADOW_CANARY_AS_IF";
  readonly reason: string;
}

/** The live gate as the promoter reads it. OFF today, and OFF is what this returns. */
export function liveAuthority(gate: Pick<ActivationGateReading, "promotionEnabled" | "openRecordClasses" | "reason">): PromotionAuthority {
  return { enabled: gate.promotionEnabled, openRecordClasses: gate.openRecordClasses, basis: "LIVE_ACTIVATION_GATE", reason: gate.reason };
}

/** An as-if authority for the shadow canary. It can never drive the READER target. */
export function shadowAuthority(openRecordClasses: readonly string[], reason: string): PromotionAuthority {
  return { enabled: true, openRecordClasses, basis: "SHADOW_CANARY_AS_IF", reason };
}

export type PromotionTarget = { readonly kind: "SHADOW"; readonly root: string } | { readonly kind: "READER"; readonly root: string };

export const PROMOTION_REFUSALS = [
  "PROMOTION_OFF",
  "SHADOW_AUTHORITY_CANNOT_TARGET_READER",
  "NOT_PROMOTE_WOULD",
  "RECORD_CLASS_CLOSED",
  "RECORD_CLASS_NOT_A_MEETING_FACT",
  "FACT_NOT_LOADED",
  "FACT_HELD",
  /** An agenda for a sitting the Reader does not serve and this batch does not promote the time of. */
  "AGENDA_WITHOUT_SITTING",
  "NO_CURRENT_SNAPSHOT",
  "PROJECTION_INVALID",
] as const;
export type PromotionRefusalCode = (typeof PROMOTION_REFUSALS)[number];

export interface PromotionRefusal {
  readonly itemId: string;
  readonly recordClass: string;
  readonly code: PromotionRefusalCode;
  readonly detail: string;
}

export interface PromotionReceipt {
  readonly formatVersion: 1;
  readonly version: typeof PROMOTER_VERSION;
  readonly receiptId: string;
  readonly at: string;
  readonly windowId: string | null;
  readonly target: PromotionTarget;
  readonly authority: PromotionAuthority;
  readonly items: readonly { readonly itemId: string; readonly recordClass: string; readonly factKey: string; readonly meetingId: string; readonly change: ReaderChangeKind; readonly changedFields: readonly string[] }[];
  readonly refused: readonly PromotionRefusal[];
  readonly before: { readonly path: string; readonly existed: boolean; readonly sha256: string | null; readonly copy: string | null };
  readonly after: { readonly sha256: string | null; readonly meetings: number | null; readonly written: boolean };
  readonly verification: VerificationVerdict | null;
  readonly regression: { readonly action: RegressionAction; readonly reason: string } | null;
  readonly reversal: { readonly executed: boolean; readonly at: string | null; readonly restoredSha256: string | null; readonly matchesBefore: boolean | null; readonly detail: string } | null;
  readonly incident: WindowIncident | null;
  readonly receiptPath: string | null;
  readonly lines: readonly string[];
}

export interface PromoteInput {
  readonly target: PromotionTarget;
  readonly authority: PromotionAuthority;
  readonly verdicts: readonly ItemVerdict[];
  /** Facts by item id, loaded from the chain by the caller. */
  readonly facts: ReadonlyMap<string, MeetingFact>;
  /** Items the caller holds back at promotion time (a freshness hold, a superseded fact), with the reason. */
  readonly holds?: ReadonlyMap<string, string>;
  readonly now: string;
  readonly windowId?: string | null;
  /** The post-promotion verification contract; absent means NO verification ran, which is an incident. */
  readonly verify?: (receipt: PromotionReceipt) => Promise<VerificationVerdict> | VerificationVerdict;
  readonly revertOnFailure?: boolean;
}

function sha256File(path: string): string | null {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex"); } catch { return null; }
}

function snapshotPath(root: string): string {
  return join(root, "data", "meetings-snapshot.json");
}

function receiptsDir(root: string): string {
  return join(root, ...RECEIPTS_DIR);
}

function writeReceipt(receipt: PromotionReceipt): PromotionReceipt {
  const dir = receiptsDir(receipt.target.root);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${receipt.receiptId}.json`);
  const withPath: PromotionReceipt = { ...receipt, receiptPath: path };
  writeFileSync(path, `${JSON.stringify(withPath, null, 2)}\n`, "utf8");
  return withPath;
}

/** Promote PROMOTE_WOULD facts into the target through the canonical Reader data path. */
export async function promoteFacts(input: PromoteInput): Promise<PromotionReceipt> {
  const { target, authority, now } = input;
  const path = snapshotPath(target.root);
  const ids = input.verdicts.map((v) => v.itemId).sort();
  const receiptId = `pr-${fingerprint([target.kind, target.root, now, ...ids])}`;
  const refused: PromotionRefusal[] = [];
  const base: PromotionReceipt = {
    formatVersion: 1, version: PROMOTER_VERSION, receiptId, at: now, windowId: input.windowId ?? null, target, authority,
    items: [], refused, before: { path, existed: existsSync(path), sha256: sha256File(path), copy: null },
    after: { sha256: null, meetings: null, written: false }, verification: null, regression: null, reversal: null, incident: null, receiptPath: null, lines: [],
  };
  const refuseAll = (code: PromotionRefusalCode, detail: string): PromotionReceipt => {
    for (const v of input.verdicts) refused.push({ itemId: v.itemId, recordClass: v.recordClass, code, detail });
    return writeReceipt({ ...base, lines: [`  promoter          refused ${refused.length} of ${input.verdicts.length} item(s): ${code} — ${detail}; nothing was written`] });
  };
  if (target.kind === "READER" && authority.basis !== "LIVE_ACTIVATION_GATE") {
    return refuseAll("SHADOW_AUTHORITY_CANNOT_TARGET_READER", `a ${authority.basis} authority may drive only an isolated SHADOW root`);
  }
  if (!authority.enabled) return refuseAll("PROMOTION_OFF", `promotion is OFF at the ${authority.basis}: ${authority.reason}`);
  const current = readSnapshot(target.root);
  if (current === null) return refuseAll("NO_CURRENT_SNAPSHOT", `${path} holds no snapshot to promote into; an absent corpus is not an empty one`);

  const open = new Set(authority.openRecordClasses);
  const eligible: { verdict: ItemVerdict; fact: MeetingFact }[] = [];
  for (const verdict of input.verdicts) {
    const hold = input.holds?.get(verdict.itemId);
    if (verdict.verdict !== "PROMOTE_WOULD") refused.push({ itemId: verdict.itemId, recordClass: verdict.recordClass, code: "NOT_PROMOTE_WOULD", detail: `${verdict.verdict}: ${verdict.reason}` });
    else if (!open.has(verdict.recordClass)) refused.push({ itemId: verdict.itemId, recordClass: verdict.recordClass, code: "RECORD_CLASS_CLOSED", detail: `${verdict.recordClass} is not open at the ${authority.basis}` });
    else if (!isMeetingFactClass(verdict.recordClass)) refused.push({ itemId: verdict.itemId, recordClass: verdict.recordClass, code: "RECORD_CLASS_NOT_A_MEETING_FACT", detail: `${verdict.recordClass} has no canonical Reader projection in this promoter` });
    else if (hold !== undefined) refused.push({ itemId: verdict.itemId, recordClass: verdict.recordClass, code: "FACT_HELD", detail: hold });
    else {
      const fact = input.facts.get(verdict.itemId);
      if (!fact) refused.push({ itemId: verdict.itemId, recordClass: verdict.recordClass, code: "FACT_NOT_LOADED", detail: "the chain produced no fact for this item at promotion time" });
      else if (fact.recordClass !== verdict.recordClass) refused.push({ itemId: verdict.itemId, recordClass: verdict.recordClass, code: "FACT_NOT_LOADED", detail: `the loaded fact is ${fact.recordClass}, not ${verdict.recordClass}` });
      else eligible.push({ verdict, fact });
    }
  }
  /*
   * An agenda is a fact ABOUT a sitting. Where the Reader does not serve the
   * sitting and this batch does not carry its time, the agenda would write
   * the sitting on the agenda fact's authority alone — a time no meeting-time
   * item approved. It waits for its sitting instead.
   */
  for (const entry of [...eligible]) {
    if (entry.fact.recordClass !== "agendas") continue;
    const served = current.meetings.some((m) => m.id === entry.fact.meetingId);
    const withTime = eligible.some((e) => e.fact.recordClass === "meeting-times" && e.fact.meetingId === entry.fact.meetingId);
    if (served || withTime) continue;
    eligible.splice(eligible.indexOf(entry), 1);
    refused.push({ itemId: entry.verdict.itemId, recordClass: entry.verdict.recordClass, code: "AGENDA_WITHOUT_SITTING", detail: `${entry.fact.meetingId} is not served and this batch promotes no meeting time for it` });
  }
  if (eligible.length === 0) {
    return writeReceipt({ ...base, lines: [`  promoter          0 of ${input.verdicts.length} item(s) eligible; ${refused.length} refused; nothing was written`] });
  }
  const proposal = proposeSnapshot(current, eligible.map((e) => e.fact), now);
  if (!proposal.validation.ok) return refuseAll("PROJECTION_INVALID", `the Reader's validator refuses the proposal: ${proposal.validation.error}`);

  /* Before-state: the exact bytes, copied beside the receipt. */
  const dir = receiptsDir(target.root);
  mkdirSync(dir, { recursive: true });
  const copy = join(dir, `${receiptId}.before.json`);
  copyFileSync(path, copy);
  const beforeSha = sha256File(path);
  writeSnapshot(proposal.snapshot, target.root);
  const afterSha = sha256File(path);
  const changeByKey = new Map(proposal.changes.map((c) => [c.factKey, c]));
  let receipt: PromotionReceipt = writeReceipt({
    ...base,
    items: eligible.map(({ verdict, fact }) => {
      const change = changeByKey.get(fact.factKey)!;
      return { itemId: verdict.itemId, recordClass: fact.recordClass, factKey: fact.factKey, meetingId: fact.meetingId, change: change.kind, changedFields: change.changedFields };
    }),
    before: { path, existed: true, sha256: beforeSha, copy },
    after: { sha256: afterSha, meetings: proposal.snapshot.meetings.length, written: true },
    lines: [`  promoter          ${eligible.length} of ${input.verdicts.length} item(s) materialized into ${target.kind} ${path} (before ${beforeSha?.slice(0, 12)}, after ${afterSha?.slice(0, 12)}); ${refused.length} refused`, ...projectionLines(proposal)],
  });

  /* Post-promotion verification, the regression decision, and the governed reversal. */
  let verification: VerificationVerdict | null = null;
  if (input.verify) {
    try {
      verification = await input.verify(receipt);
    } catch (error) {
      verification = { instrument: "post-promotion verification", exitCode: null, passed: null, detail: `the verifier threw: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const regression = decideRegression({ promotedCount: eligible.length, verifications: verification ? [verification] : [] });
  let reversal: PromotionReceipt["reversal"] = null;
  let incident: WindowIncident | null = null;
  if (regression.action === "REVERT_AND_INCIDENT") {
    reversal = input.revertOnFailure === false
      ? { executed: false, at: null, restoredSha256: null, matchesBefore: null, detail: "the caller disabled reversal; the incident carries the change" }
      : executeRevert(receipt, now);
    incident = openIncident({ windowId: input.windowId ?? receiptId, stage: "PROMOTION", code: "POST_PROMOTION_VERIFICATION_FAILED", detail: `${regression.reason}; reversal ${reversal.executed ? (reversal.matchesBefore ? "restored the before-state bytes" : "ran but the restored bytes differ") : "not executed"}`, openedAt: now,
      missedScope: eligible.map((e) => `${e.fact.recordClass} ${e.fact.meetingId}`) });
  } else if (regression.action === "INCIDENT_WITHOUT_REVERT") {
    incident = openIncident({ windowId: input.windowId ?? receiptId, stage: "PROMOTION", code: "POST_PROMOTION_VERIFICATION_UNANSWERED", detail: regression.reason, openedAt: now,
      missedScope: eligible.map((e) => `${e.fact.recordClass} ${e.fact.meetingId}`) });
  }
  receipt = writeReceipt({
    ...receipt, verification, regression, reversal, incident,
    lines: [...receipt.lines,
      `  verification      ${verification ? `${verification.instrument}: ${verification.passed === null ? "COULD NOT TELL" : verification.passed ? "PASS" : "FAIL"} (exit ${verification.exitCode ?? "none"}) — ${verification.detail}` : "NONE RAN"}`,
      `  regression        ${regression.action} — ${regression.reason}`,
      ...(reversal ? [`  reversal          ${reversal.executed ? `executed at ${reversal.at}; restored ${reversal.restoredSha256?.slice(0, 12)} ${reversal.matchesBefore ? "== before" : "!= before"}` : "not executed"} — ${reversal.detail}`] : []),
      ...(incident ? [`  incident          ${incident.incidentId} ${incident.code}: ${incident.detail}`] : [])],
  });
  return receipt;
}

/**
 * Put the before-state bytes back, atomically, and prove it by hash. The
 * receipt's copy is the ONLY source; nothing is recomputed from facts, so the
 * reversal is deterministic whatever the promoter did.
 */
export function executeRevert(receipt: PromotionReceipt, now: string): NonNullable<PromotionReceipt["reversal"]> {
  const copy = receipt.before.copy;
  if (copy === null || !existsSync(copy)) {
    return { executed: false, at: now, restoredSha256: null, matchesBefore: null, detail: "no before-state copy is held for this receipt, so nothing can be restored deterministically" };
  }
  const path = receipt.before.path;
  const tmp = `${path}.revert.tmp`;
  copyFileSync(copy, tmp);
  renameSync(tmp, path);
  const restored = sha256File(path);
  const matches = receipt.before.sha256 !== null && restored === receipt.before.sha256;
  return { executed: true, at: now, restoredSha256: restored, matchesBefore: matches,
    detail: matches ? `the before-state bytes (${restored?.slice(0, 12)}) are back at ${path}` : `restored ${restored?.slice(0, 12)} does not equal the before hash ${receipt.before.sha256?.slice(0, 12)}` };
}

/**
 * The local half of the post-promotion verification contract: the written
 * file re-read through the Reader's own reader and validator, every promoted
 * sitting present and renderable. The served-surface half stays with the
 * observer the window already runs; a materialization is not a deploy.
 */
export function verifyMaterialization(receipt: PromotionReceipt): VerificationVerdict {
  const instrument = "reader readback of the materialized snapshot (readSnapshot, validateSnapshot, formatMeetingTime)";
  try {
    const written = readSnapshot(receipt.target.root);
    if (written === null) return { instrument, exitCode: 2, passed: false, detail: `${receipt.before.path} holds no readable snapshot after materialization` };
    validateSnapshot(written);
    const missing = receipt.items.filter((item) => !written.meetings.some((m) => m.id === item.meetingId)).map((item) => item.meetingId);
    if (missing.length > 0) return { instrument, exitCode: 1, passed: false, detail: `${missing.length} of ${receipt.items.length} promoted sitting(s) are not in the written snapshot: ${missing.join(", ")}` };
    for (const item of receipt.items) formatMeetingTime(written.meetings.find((m) => m.id === item.meetingId)!);
    return { instrument, exitCode: 0, passed: true, detail: `${receipt.items.length} promoted sitting(s) re-read from ${receipt.before.path}, validated, and rendered` };
  } catch (error) {
    return { instrument, exitCode: 1, passed: false, detail: `the readback refused: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The window record's summary of one receipt. */
export function receiptSummary(receipt: PromotionReceipt): { receiptId: string; target: "SHADOW" | "READER"; promoted: number; refused: number; reverted: boolean; incidentId: string | null; path: string | null } {
  return { receiptId: receipt.receiptId, target: receipt.target.kind, promoted: receipt.items.length, refused: receipt.refused.length,
    reverted: receipt.reversal?.executed === true && receipt.reversal.matchesBefore === true, incidentId: receipt.incident?.incidentId ?? null, path: receipt.receiptPath };
}
