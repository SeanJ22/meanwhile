/**
 * TEST-ONLY historical promoter/1 receipt GENERATOR — not a runtime producer.
 *
 * PDC retired the runtime promotion producer (`lib/control-plane/promotion/promoter.ts`)
 * together with its snapshot writer, regression decision and verification-verdict type.
 * That deletion STANDS. This file is never imported by `lib/` or `app/`, never enters a
 * served bundle, is never scheduled, and never writes to any production target. It exists
 * only to synthesize valid historical `promoter/1` receipt fixtures so the SHIPPED fleet
 * receipt loader (fleet-receipt-store) and the committed Admin page's owner-snapshot seed
 * (fleet-operations-page) can be exercised against real receipts. It reconstructs just enough
 * of the retired producer to emit those fixtures — inlining the three pieces PDC removed
 * (`writeSnapshot`, `decideRegression`, `VerificationVerdict`) and reusing every surviving
 * projection/validation module — and must never be moved into `lib/` or wired to a runner.
 * The immutable receipt CONTRACT still lives in the zero-import leaf
 * `lib/control-plane/promotion/historical-receipt.ts`; this only produces evidence in it.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { formatMeetingTime } from "../../lib/map/format.ts";
import { readSnapshot, validateSnapshot, type MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";
import { fingerprint } from "../../lib/control-plane/ids.ts";
import { isMeetingFactClass, type MeetingFact } from "../../lib/control-plane/promotion/meeting-facts.ts";
import { projectionLines, proposeSnapshot } from "../../lib/control-plane/promotion/reader-projection.ts";
import type { ActivationGateReading, ItemVerdict } from "../../lib/control-plane/promotion/types.ts";

// Compatibility surface for the tests: the immutable receipt contract lives in the leaf.
export { PROMOTER_VERSION, RECEIPTS_DIR, PROMOTION_REFUSALS, receiptSummary } from "../../lib/control-plane/promotion/historical-receipt.ts";
export type { PromotionAuthority, PromotionTarget, PromotionRefusalCode, PromotionRefusal, PromotionReceipt } from "../../lib/control-plane/promotion/historical-receipt.ts";
import { PROMOTER_VERSION, RECEIPTS_DIR, type PromotionAuthority, type PromotionRefusalCode, type PromotionRefusal, type PromotionReceipt, type PromotionTarget, type HistoricalWindowIncident, type HistoricalVerificationVerdict } from "../../lib/control-plane/promotion/historical-receipt.ts";

/** PDC removed the runtime VerificationVerdict with the promotion pipeline; the leaf's frozen shape is identical. */
export type VerificationVerdict = HistoricalVerificationVerdict;

/** PDC removed decideRegression from window.ts; inlined here for fixtures only (verbatim from the retired producer). */
type RegressionAction = "NONE" | "REVERT_AND_INCIDENT" | "INCIDENT_WITHOUT_REVERT";
function decideRegression(input: { readonly promotedCount: number; readonly verifications: readonly VerificationVerdict[] }): { readonly action: RegressionAction; readonly reason: string } {
  if (input.promotedCount === 0) return { action: "NONE", reason: "nothing was promoted, so there is nothing to revert" };
  const failed = input.verifications.filter((v) => v.passed === false);
  if (failed.length > 0) return { action: "REVERT_AND_INCIDENT", reason: `${failed.length} of ${input.verifications.length} verification(s) FAILED on the served surface: ${failed.map((f) => f.instrument).join(", ")}` };
  const unknown = input.verifications.filter((v) => v.passed === null);
  if (unknown.length > 0 || input.verifications.length === 0) return { action: "INCIDENT_WITHOUT_REVERT", reason: input.verifications.length === 0 ? "no verification ran after a promotion; an incident is opened and nothing further promotes until one does" : `${unknown.length} of ${input.verifications.length} verification(s) could not tell; a revert on a guess would be a second unverified change` };
  return { action: "NONE", reason: `${input.verifications.length} of ${input.verifications.length} verification(s) passed` };
}

/** PDC removed openIncident's runtime WindowIncident; inlined here to emit the leaf's frozen HistoricalWindowIncident. */
function openIncident(input: { readonly windowId: string; readonly stage: HistoricalWindowIncident["stage"]; readonly code: string; readonly detail: string; readonly openedAt: string; readonly missedScope: readonly string[] }): HistoricalWindowIncident {
  return { formatVersion: 1, incidentId: `wi-${fingerprint([input.windowId, input.stage, input.code])}`, windowId: input.windowId, stage: input.stage, code: input.code, detail: input.detail, openedAt: input.openedAt, missedScope: input.missedScope };
}

/** PDC removed the snapshot WRITER (the runner writes Postgres now); inlined for SHADOW fixture materialization only. */
function writeSnapshotFixture(snapshot: MeetingsSnapshot, root: string): string {
  validateSnapshot(snapshot);
  const path = join(root, "data", "meetings-snapshot.json");
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 1) + "\n", "utf8");
  renameSync(tmp, path);
  return path;
}

/** The live gate as the promoter reads it. OFF today, and OFF is what this returns. */
export function liveAuthority(gate: Pick<ActivationGateReading, "promotionEnabled" | "openRecordClasses" | "reason">): PromotionAuthority {
  return { enabled: gate.promotionEnabled, openRecordClasses: gate.openRecordClasses, basis: "LIVE_ACTIVATION_GATE", reason: gate.reason };
}

/** An as-if authority for the shadow canary. It can never drive the READER target. */
export function shadowAuthority(openRecordClasses: readonly string[], reason: string): PromotionAuthority {
  return { enabled: true, openRecordClasses, basis: "SHADOW_CANARY_AS_IF", reason };
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
  writeSnapshotFixture(proposal.snapshot, target.root);
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
  let incident: HistoricalWindowIncident | null = null;
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
 * sitting present and renderable.
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
