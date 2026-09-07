import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseLegistarEvents, PARSER_VERSION } from "../lib/control-plane/workers/parser.ts";
import type { LegacyCivicExtractionContract, ParserWorkerInput } from "../lib/control-plane/workers/types.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { bridgeMeetingFacts, type MeetingFact } from "../lib/control-plane/promotion/meeting-facts.ts";
import { factItemId } from "../lib/control-plane/promotion/fact-chain.ts";
import { executeRevert, liveAuthority, promoteFacts, receiptSummary, shadowAuthority, type PromotionReceipt } from "../lib/control-plane/promotion/promoter.ts";
import { ACTIVATION_GATE, readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { runPromotionStep } from "../lib/control-plane/promotion/window.ts";
import type { ItemVerdict } from "../lib/control-plane/promotion/types.ts";
import { readSnapshot, validateSnapshot } from "../lib/meetings/snapshot.ts";

/**
 * **PRDY-6 — THE GOVERNED PROMOTER, ITS RECEIPT, AND ITS REVERSAL.** (2026-09-06.)
 *
 * Every run writes into an isolated copy of the real committed snapshot; the
 * committed file's hash is asserted unchanged at the end of every test.
 */

const TEXT = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
const NOW = "2026-09-06T12:00:00.000Z";
const REAL_SNAPSHOT = join(process.cwd(), "data", "meetings-snapshot.json");
const REAL_SHA = createHash("sha256").update(readFileSync(REAL_SNAPSHOT)).digest("hex");
const CONTRACT: LegacyCivicExtractionContract = {
  recordClass: "LEGISTAR_EVENTS", schemaVersion: 1, subjectId: "ocd-division/country:us/state:az/county:pima#governing",
  sourceBodyId: 138, sourceBodyName: "Board of Supervisors", publisherSlug: "pima",
  requiredFields: ["EventId", "EventBodyId", "EventBodyName", "EventDate"], completenessScope: "The held capture.", expectedSourceDate: null,
};

function facts(): readonly MeetingFact[] {
  const art: ArtifactRecord = { artifactId: "ar-pima", workItemId: "wi", routeTaskId: null, attemptId: "at-1", tier: "A1" as never, contentHash: contentHash(TEXT),
    byteLength: Buffer.byteLength(TEXT), contentType: "application/json", canonicalUrl: "https://webapi.legistar.com/v1/pima/events", partial: false, recordedAt: "2026-09-05T18:00:00.000Z" };
  const input: ParserWorkerInput = { attemptId: "at-p", worker: { role: "PARSER", provider: "d", version: PARSER_VERSION, instance: "p-1" },
    evidence: { artifactId: art.artifactId, contentHash: art.contentHash, text: TEXT, acquiredByAttemptId: "at-1", canonicalUrl: art.canonicalUrl, retrievedAt: art.recordedAt, sourceId: "legistar", methodRouteId: "r" }, contract: CONTRACT };
  const parser = { id: "wr-p", attemptId: "at-p", result: parseLegistarEvents(input), completion: { completedTask: { workerTask: { contract: CONTRACT } } } } as never;
  return bridgeMeetingFacts({ parser, validator: null, auditor: null, artifact: art, text: TEXT, now: NOW }).facts;
}

function isolatedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "wtp-promoter-"));
  mkdirSync(join(root, "data"), { recursive: true });
  copyFileSync(REAL_SNAPSHOT, join(root, "data", "meetings-snapshot.json"));
  return root;
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verdictFor(fact: MeetingFact, verdict: ItemVerdict["verdict"] = "PROMOTE_WOULD"): ItemVerdict {
  return { itemId: factItemId(fact.recordClass, fact.factKey), recordClass: fact.recordClass, stage: "APPROVED_FOR_PROMOTION", verdict, reason: "seeded" };
}

test("PRDY-6: with the LIVE gate the promoter refuses everything PROMOTION_OFF and writes nothing; runPromotionStep never even calls it", async (t) => {
  const root = isolatedRoot();
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const all = facts();
  const current = readSnapshot(root)!;
  const fresh = all.find((f) => f.recordClass === "meeting-times" && !current.meetings.some((m) => m.id === f.meetingId))!;
  const byItem = new Map(all.map((f) => [factItemId(f.recordClass, f.factKey), f]));
  const before = sha(join(root, "data", "meetings-snapshot.json"));
  const gate = readActivationGate(process.cwd());
  assert.equal(gate.promotionEnabled, false);
  assert.deepEqual([...gate.openRecordClasses], []);
  let called = 0;
  const step = await runPromotionStep({ gate: { promotionEnabled: ACTIVATION_GATE.promotionEnabled }, verdicts: [verdictFor(fresh)], promote: async () => { called += 1; } });
  assert.equal(called, 0, "the step never reaches the promoter while promotion is OFF");
  assert.deepEqual(step.promoted, []);
  const receipt = await promoteFacts({ target: { kind: "READER", root }, authority: liveAuthority(gate), verdicts: [verdictFor(fresh)], facts: byItem, now: NOW });
  assert.equal(receipt.items.length, 0);
  assert.deepEqual(receipt.refused.map((r) => r.code), ["PROMOTION_OFF"]);
  assert.equal(receipt.after.written, false);
  assert.equal(sha(join(root, "data", "meetings-snapshot.json")), before, "nothing was written");
  assert.ok(existsSync(receipt.receiptPath!), "even a refusal leaves a receipt");
  const shadowOnReader = await promoteFacts({ target: { kind: "READER", root }, authority: shadowAuthority(["meeting-times", "agendas"], "test"), verdicts: [verdictFor(fresh)], facts: byItem, now: NOW });
  assert.deepEqual(shadowOnReader.refused.map((r) => r.code), ["SHADOW_AUTHORITY_CANNOT_TARGET_READER"]);
  assert.equal(sha(REAL_SNAPSHOT), REAL_SHA);
});

test("PRDY-6: an as-if authority on an isolated SHADOW root materializes PROMOTE_WOULD meeting facts through writeSnapshot, refuses closed classes, holds and non-verdicts by name, and leaves a receipt with before/after hashes", async (t) => {
  const root = isolatedRoot();
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const all = facts();
  const current = readSnapshot(root)!;
  const newTimes = all.filter((f) => f.recordClass === "meeting-times" && !current.meetings.some((m) => m.id === f.meetingId));
  const newAgendas = all.filter((f) => f.recordClass === "agendas" && newTimes.some((n) => n.meetingId === f.meetingId));
  const held = all.find((f) => f.recordClass === "meeting-times" && current.meetings.some((m) => m.id === f.meetingId))!;
  const byItem = new Map(all.map((f) => [factItemId(f.recordClass, f.factKey), f]));
  const verdicts: ItemVerdict[] = [
    ...newTimes.map((f) => verdictFor(f)), ...newAgendas.map((f) => verdictFor(f)),
    verdictFor(held, "REFUSE_WOULD"),
    { itemId: "pp-canary-excluded", recordClass: "published-minutes", stage: "APPROVED_FOR_PROMOTION", verdict: "PROMOTE_WOULD", reason: "seeded" },
    { itemId: "pp-canary-inventory", recordClass: "OFFICIAL_MEETING_DOCUMENT_INVENTORY", stage: "APPROVED_FOR_PROMOTION", verdict: "PROMOTE_WOULD", reason: "seeded" },
    { itemId: "pp-canary-unloaded", recordClass: "meeting-times", stage: "APPROVED_FOR_PROMOTION", verdict: "PROMOTE_WOULD", reason: "seeded" },
  ];
  const heldId = factItemId(newTimes[0].recordClass, newTimes[0].factKey);
  const before = sha(join(root, "data", "meetings-snapshot.json"));
  let verified: PromotionReceipt | null = null;
  const receipt = await promoteFacts({
    target: { kind: "SHADOW", root }, authority: shadowAuthority(["meeting-times", "agendas"], "canary as-if"), verdicts, facts: byItem, now: NOW, windowId: "nw-test",
    holds: new Map([[heldId, "FACT_SUPERSEDED: a later reading moved this sitting"]]),
    verify: (r) => { verified = r; const written = readSnapshot(root)!; validateSnapshot(written); return { instrument: "canary readback", exitCode: 0, passed: written.meetings.some((m) => m.id === newTimes[1].meetingId), detail: "the promoted sitting is served by the isolated snapshot" }; },
  });
  const agendaOfHeld = newAgendas.find((f) => f.meetingId === newTimes[0].meetingId)!;
  assert.equal(receipt.items.length, newTimes.length - 1 + newAgendas.length - 1, "every eligible fact but the held sitting and its agenda materialized");
  assert.deepEqual(receipt.refused.map((r) => `${r.itemId}:${r.code}`).sort(), [
    `${heldId}:FACT_HELD`, `${factItemId("agendas", agendaOfHeld.factKey)}:AGENDA_WITHOUT_SITTING`, `${verdictFor(held).itemId}:NOT_PROMOTE_WOULD`,
    "pp-canary-excluded:RECORD_CLASS_CLOSED", "pp-canary-inventory:RECORD_CLASS_CLOSED", "pp-canary-unloaded:FACT_NOT_LOADED",
  ].sort());
  assert.equal(receipt.before.sha256, before);
  assert.notEqual(receipt.after.sha256, before);
  assert.equal(receipt.after.written, true);
  assert.equal(sha(join(root, "data", "meetings-snapshot.json")), receipt.after.sha256);
  assert.ok(existsSync(receipt.before.copy!), "the before-state bytes are kept beside the receipt");
  assert.equal(sha(receipt.before.copy!), before);
  assert.equal(receipt.verification?.passed, true);
  assert.equal(receipt.regression?.action, "NONE");
  assert.equal(receipt.reversal, null);
  assert.equal(receipt.incident, null);
  assert.ok(verified !== null);
  const written = readSnapshot(root)!;
  assert.ok(written.meetings.some((m) => m.id === newTimes[1].meetingId));
  assert.ok(!written.meetings.some((m) => m.id === newTimes[0].meetingId), "the held fact was not written");
  assert.equal(written.meetings.length, current.meetings.length + newTimes.length - 1);
  const summary = receiptSummary(receipt);
  assert.deepEqual({ ...summary, path: null }, { receiptId: receipt.receiptId, target: "SHADOW", promoted: receipt.items.length, refused: 6, reverted: false, incidentId: null, path: null });
  assert.ok(receipt.lines.some((l) => /materialized into SHADOW/.test(l)));
  assert.equal(sha(REAL_SNAPSHOT), REAL_SHA);
});

test("PRDY-6: a failed post-promotion verification reverts the exact before-state bytes and opens an incident; an unanswerable one opens an incident without a revert", async (t) => {
  const root = isolatedRoot();
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const all = facts();
  const current = readSnapshot(root)!;
  const newTimes = all.filter((f) => f.recordClass === "meeting-times" && !current.meetings.some((m) => m.id === f.meetingId));
  const byItem = new Map(all.map((f) => [factItemId(f.recordClass, f.factKey), f]));
  const path = join(root, "data", "meetings-snapshot.json");
  const before = sha(path);
  const failed = await promoteFacts({
    target: { kind: "SHADOW", root }, authority: shadowAuthority(["meeting-times", "agendas"], "canary as-if"), verdicts: newTimes.map((f) => verdictFor(f)), facts: byItem, now: NOW, windowId: "nw-test",
    verify: () => ({ instrument: "seeded observer", exitCode: 1, passed: false, detail: "served commit mismatch" }),
  });
  assert.equal(failed.items.length, newTimes.length);
  assert.equal(failed.regression?.action, "REVERT_AND_INCIDENT");
  assert.equal(failed.reversal?.executed, true);
  assert.equal(failed.reversal?.matchesBefore, true);
  assert.equal(failed.reversal?.restoredSha256, before);
  assert.equal(sha(path), before, "the before-state bytes are back");
  assert.equal(failed.incident?.code, "POST_PROMOTION_VERIFICATION_FAILED");
  assert.equal(failed.incident?.stage, "PROMOTION");
  assert.ok(failed.incident!.missedScope.length === newTimes.length);
  assert.equal(receiptSummary(failed).reverted, true);
  assert.ok(!readSnapshot(root)!.meetings.some((m) => m.id === newTimes[0].meetingId));

  const unanswered = await promoteFacts({
    target: { kind: "SHADOW", root }, authority: shadowAuthority(["meeting-times", "agendas"], "canary as-if"), verdicts: newTimes.map((f) => verdictFor(f)), facts: byItem, now: "2026-09-06T12:01:00.000Z", windowId: "nw-test",
    verify: () => ({ instrument: "seeded observer", exitCode: null, passed: null, detail: "could not tell" }),
  });
  assert.equal(unanswered.regression?.action, "INCIDENT_WITHOUT_REVERT");
  assert.equal(unanswered.reversal, null);
  assert.equal(unanswered.incident?.code, "POST_PROMOTION_VERIFICATION_UNANSWERED");
  assert.notEqual(sha(path), before, "an unanswerable verification does not guess a second unverified change");
  const manual = executeRevert(unanswered, "2026-09-06T12:02:00.000Z");
  assert.equal(manual.matchesBefore, true);
  assert.equal(sha(path), before);

  const none = await promoteFacts({ target: { kind: "SHADOW", root }, authority: shadowAuthority(["meeting-times", "agendas"], "canary as-if"), verdicts: newTimes.slice(0, 1).map((f) => verdictFor(f)), facts: byItem, now: "2026-09-06T12:03:00.000Z" });
  assert.equal(none.regression?.action, "INCIDENT_WITHOUT_REVERT", "no verification at all is an incident, never a pass");
  assert.equal(sha(REAL_SNAPSHOT), REAL_SHA);
});
