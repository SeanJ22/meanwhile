import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectFleetDelivery, readFleetReceiptReadback } from "../lib/control-plane/fleet-delivery.ts";
import { readFleetOperations } from "../lib/control-plane/fleet-operations.ts";
import { collectFactChains, projectFactChains, readFactItemStates } from "../lib/control-plane/promotion/fact-chain.ts";
import { factSubjectsFromStates } from "../lib/control-plane/promotion/fact-freshness.ts";
import { readActivationGate, ACTIVATION_GATE } from "../lib/control-plane/promotion/activation-gate.ts";
import { liveAuthority, promoteFacts, shadowAuthority, verifyMaterialization } from "../lib/control-plane/promotion/promoter.ts";
import { evaluateItems } from "../lib/control-plane/promotion/window.ts";
import { promotedFactsProvider } from "../lib/control-plane/scheduler/providers/promoted-facts.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { makeSnapshotSource } from "../lib/sources/snapshot/index.ts";
import { factChainHarness, PIMA_CONTRACT } from "./fact-chain-harness.ts";
import type { WindowRunRecord } from "../lib/control-plane/promotion/types.ts";

test("recorded research progresses through unchanged approval into verified isolated SHADOW reader output; joined reporting cannot claim live delivery", async t => {
  const h = await factChainHarness();
  const root = mkdtempSync(join(tmpdir(), "fleet-delivery-shadow-"));
  t.after(() => { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); rmSync(h.vaultRoot, { recursive: true, force: true, maxRetries: 3 }); });
  const committedPath = join(process.cwd(), "data", "meetings-snapshot.json");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const committedBefore = hash(committedPath);
  mkdirSync(join(root, "data"));
  copyFileSync(committedPath, join(root, "data", "meetings-snapshot.json"));
  const text = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
  const research = await h.hold(text, { role: "SCOUT" });
  await h.hold(text, { role: "ACQUIRER" });
  await h.chain(research);
  const options = { readArtifactText: h.readArtifactText, now: h.now(), registryBodyIds: new Set([PIMA_CONTRACT.subjectId]) };
  const held = await projectFactChains(h.repos, options);
  assert.equal(held.states.filter(state => state.stage === "AUDITED").length, 36);
  assert.ok(held.states.every(state => state.refused?.reasons.some(reason => /FRESHNESS_NOT_STALE: NOT_SCHEDULED/.test(reason.detail))));
  const subjects = factSubjectsFromStates(await readFactItemStates(h.repos), options.now);
  const registry = buildRegistry([promotedFactsProvider(subjects)], { root: process.cwd(), nowIso: options.now });
  await syncObligations(h.repos, registry.obligations, options.now);
  assert.equal(registry.obligations.length, 2, "existing source/body fact cadence is reused");
  const approved = await projectFactChains(h.repos, options);
  assert.equal(approved.states.filter(state => state.stage === "APPROVED_FOR_PROMOTION").length, 36);
  assert.ok(approved.states.every(state => state.byStage.APPROVED_FOR_PROMOTION?.burdens?.every(burden => burden.result === "PASS")));
  const gate = readActivationGate(process.cwd());
  assert.equal(gate.promotionEnabled, false);
  const liveDecisions = evaluateItems(approved.states, ACTIVATION_GATE);
  assert.ok(liveDecisions.verdicts.every(verdict => verdict.verdict === "REFUSE_WOULD"));
  const collection = await collectFactChains(h.repos, options);
  const facts = new Map(collection.items.map(item => [item.itemId, item.fact]));
  const refused = await promoteFacts({ target: { kind: "READER", root }, authority: liveAuthority(gate),
    verdicts: liveDecisions.verdicts, facts, now: h.now() });
  assert.equal(refused.after.written, false);
  assert.ok(refused.refused.every(item => item.code === "PROMOTION_OFF"));
  const authority = shadowAuthority(["meeting-times", "agendas"], "Explicit isolated offline fleet delivery control; no live activation");
  const shadowDecisions = evaluateItems(approved.states, authority);
  assert.ok(shadowDecisions.verdicts.every(verdict => verdict.verdict === "PROMOTE_WOULD"));
  const receipt = await promoteFacts({ target: { kind: "SHADOW", root }, authority, verdicts: shadowDecisions.verdicts,
    facts, now: h.now(), verify: verifyMaterialization });
  assert.equal(receipt.items.length, 36);
  assert.equal(receipt.after.written, true);
  assert.equal(receipt.verification?.passed, true);
  assert.equal(receipt.regression?.action, "NONE");
  const readback = readFleetReceiptReadback(receipt, { root, items: collection.items, observedAt: h.now() });
  assert.deepEqual(readback.gaps, []);
  assert.equal(readback.items.length, 36);
  assert.ok(readback.items.every(item => item.matchesProjection && item.rendering?.time !== "unrenderable"));
  const source = makeSnapshotSource({ load: () => readSnapshot(root) });
  const readerRows = source.normalize(await source.fetch({ lat: 32.22, lng: -110.97, radiusKm: 100 }), new Date(options.now));
  const deliveredMeetingIds = new Set(receipt.items.map(item => item.meetingId));
  const deliveredRows = readerRows.filter(row => deliveredMeetingIds.has(row.id));
  assert.equal(deliveredRows.length, 18);
  assert.ok(deliveredRows.every(row => row.bodyId === PIMA_CONTRACT.subjectId && row.agendaUrl && row.provenance.sourceUrl));
  const activity = (await readAutonomousActivity(h.repos, undefined, { observedAt: h.now() })).find(value => value.workItem.id === h.itemId)!;

  await t.test("per-item report joins exact source, approval, receipt and local readback", async () => {
    const report = projectFleetDelivery({ activity, windows: [], receipts: [receipt], readbacks: [readback] });
    assert.equal(report.items.length, 36);
    assert.ok(report.items.every(item => item.status === "SHADOW_READBACK_VERIFIED"));
    assert.ok(report.items.every(item => item.source.workItemId === h.itemId && item.approvalRecordId));
    assert.ok(report.items.every(item => item.receipts[0].readbackObservedAt === readback.observedAt && item.receipts[0].readbackScope === "LOCAL_SNAPSHOT"));
    assert.ok(report.items.every(item => item.gaps.includes("SHADOW_DOES_NOT_PROVE_SERVED_READER")));
    assert.ok(report.items.every(item => item.gaps.includes("WINDOW_DECISION_NOT_RECORDED")), "the direct shadow canary does not invent a scheduler window");
    const service = await readFleetOperations(h.repos, { observedAt: h.now(), deliveryEvidence: { receipts: [receipt], readbacks: [readback] } });
    assert.equal(service.operations.kind, "HELD");
    if (service.operations.kind !== "HELD") throw new Error("FLEET_SERVICE_FIXTURE_READ_FAILED");
    const operation = service.operations.value.find(item => item.workItemId === h.itemId)!;
    assert.equal(operation.publication.status, "UNKNOWN", "local output never becomes served-reader proof");
    assert.equal(operation.publication.delivery.kind, "HELD");
    if (operation.publication.delivery.kind !== "HELD") throw new Error("FLEET_SERVICE_DELIVERY_READ_FAILED");
    assert.equal(operation.publication.delivery.value.items.length, 36);
    assert.ok(operation.publication.delivery.value.items.every(item => item.status === "SHADOW_READBACK_VERIFIED"));
  });

  await t.test("batch window receipts alone never become per-item materialization proof", async () => {
    const at = h.now();
    // A reporting-only recorded-window fixture, with the real gate's refusal decisions.
    const window: WindowRunRecord = { formatVersion: 1, windowId: "fixture-window-summary", localDate: "2026-09-05", zone: "America/New_York",
      scheduledFor: at, trigger: "MANUAL", mode: "SHADOW", startedAt: at, finishedAt: at, host: "fixture", testedSha: null,
      provider: "fixture", caughtUp: [], lock: { leaseId: "fixture", holder: "fixture", claimedAt: at, expiresAt: at, releasedAt: at },
      activationGate: gate, stages: [], legacyRefresh: null,
      pipeline: { items: 36, byStage: approved.counts.byStage, refused: 36, verdicts: liveDecisions.verdicts, byRecordClass: liveDecisions.byRecordClass },
      promoted: 0, postPromotionVerification: null, controls: null, incidents: [], digestPath: null, mirrored: null, recordPath: null,
      promotionReceipts: [{ receiptId: receipt.receiptId, target: "SHADOW", promoted: 36, refused: 0, reverted: false, incidentId: null, path: receipt.receiptPath }] };
    const report = projectFleetDelivery({ activity, windows: [window] });
    assert.ok(report.items.every(item => item.status === "HELD" && item.receipts.length === 0));
    assert.ok(report.items.every(item => item.windowDecisions[0].receiptSummaryBinding === "WINDOW_ONLY_NOT_PER_ITEM"));
    assert.ok(report.items.every(item => item.gaps.includes("FULL_ITEM_RECEIPTS_NOT_PROVIDED")));
    const reportingRepos = { ...h.repos, windowRuns: { ...h.repos.windowRuns, readAll: async () => [window] } };
    const service = await readFleetOperations(reportingRepos, { observedAt: h.now() });
    assert.equal(service.operations.kind, "HELD");
    if (service.operations.kind !== "HELD") throw new Error("FLEET_WINDOW_FIXTURE_READ_FAILED");
    const delivery = service.operations.value.find(operation => operation.workItemId === h.itemId)!.publication.delivery;
    assert.equal(delivery.kind, "HELD");
    if (delivery.kind !== "HELD") throw new Error("FLEET_WINDOW_DELIVERY_FIXTURE_READ_FAILED");
    assert.ok(delivery.value.items.every(item => item.status === "HELD" && item.windowDecisions[0].windowId === window.windowId &&
      item.windowDecisions[0].verdict === "REFUSE_WOULD" && item.receipts.length === 0));
    const contradictory = projectFleetDelivery({ activity, windows: [window], receipts: [{ ...receipt, windowId: window.windowId }], readbacks: [readback] });
    assert.ok(contradictory.items.every(item => item.gaps.includes("WINDOW_RECEIPT_DECISION_MISMATCH") && item.status === "HELD"));
    const later: WindowRunRecord = { ...window, windowId: "fixture-later-defer", finishedAt: h.now(), pipeline: { ...window.pipeline,
      verdicts: window.pipeline.verdicts.map(verdict => ({ ...verdict, verdict: "DEFER", reason: "fixture later deferral" })) } };
    const unordered = projectFleetDelivery({ activity, windows: [later, window] });
    assert.ok(unordered.items.every(item => item.windowDecisions.at(-1)?.windowId === later.windowId && item.status === "UNKNOWN"));
  });

  await t.test("missing readback, mismatched fact identity and failed or reversed receipts remain unproven", () => {
    const missing = projectFleetDelivery({ activity, windows: [], receipts: [receipt] });
    assert.ok(missing.items.every(item => item.status === "UNKNOWN"));
    const changed = { ...receipt, items: receipt.items.map(item => ({ ...item, factKey: "wrong-fact-key" })) };
    const mismatch = projectFleetDelivery({ activity, windows: [], receipts: [changed], readbacks: [readback] });
    assert.ok(mismatch.items.every(item => item.status === "UNKNOWN" && item.gaps.includes("RECEIPT_FACT_IDENTITY_MISMATCH")));
    const reversed = { ...receipt, reversal: { executed: true, at: h.now(), restoredSha256: receipt.before.sha256, matchesBefore: true, detail: "negative-control reversal" } };
    assert.ok(projectFleetDelivery({ activity, windows: [], receipts: [reversed], readbacks: [readback] }).items.every(item => item.status === "UNKNOWN"));
    const failed = { ...receipt, verification: { instrument: "negative control", exitCode: 1, passed: false, detail: "failed" } };
    assert.ok(projectFleetDelivery({ activity, windows: [], receipts: [failed], readbacks: [readback] }).items.every(item => item.status === "UNKNOWN"));
    const conflict = { ...receipt, refused: receipt.items.map(item => ({ itemId: item.itemId, recordClass: item.recordClass,
      code: "NOT_PROMOTE_WOULD" as const, detail: "negative control: conflicting duplicate verdict refused this same item" })) };
    const conflicting = projectFleetDelivery({ activity, windows: [], receipts: [conflict], readbacks: [readback] });
    assert.ok(conflicting.items.every(item => item.status === "HELD" &&
      item.gaps.includes("RECEIPT_ITEM_ACCEPTANCE_REFUSAL_CONTRADICTION")));
    const badClock = { ...receipt, at: "invalid-clock" };
    const invalid = projectFleetDelivery({ activity, windows: [], receipts: [badClock], readbacks: [readback] });
    assert.ok(invalid.items.every(item => item.status === "UNKNOWN" && item.gaps.includes("RECEIPT_CLOCK_INVALID")));
    const off = projectFleetDelivery({ activity, windows: [], receipts: [refused] });
    assert.ok(off.items.every(item => item.status === "HELD" && item.receipts[0].refusal?.startsWith("PROMOTION_OFF")));
  });

  await t.test("readback refuses another root, missing exact facts and snapshot drift", () => {
    assert.ok(readFleetReceiptReadback(receipt, { root: h.vaultRoot, items: collection.items, observedAt: h.now() }).gaps.includes("EXPLICIT_TARGET_ROOT_MISMATCH"));
    const noFacts = readFleetReceiptReadback(receipt, { root, items: [], observedAt: h.now() });
    assert.ok(noFacts.items.every(item => !item.matchesProjection));
    const path = join(root, "data", "meetings-snapshot.json");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
    const drift = readFleetReceiptReadback(receipt, { root, items: collection.items, observedAt: h.now() });
    assert.ok(drift.gaps.includes("SNAPSHOT_CHANGED_SINCE_RECEIPT"));
    const report = projectFleetDelivery({ activity, windows: [], receipts: [receipt], readbacks: [readback, drift] });
    assert.ok(report.items.every(item => item.status === "UNKNOWN"));
    assert.ok(report.items.every(item => item.receipts[0].readbackObservedAt === drift.observedAt));
    const changed = JSON.parse(readFileSync(path, "utf8"));
    changed.meetings.find((meeting: { id: string }) => meeting.id === receipt.items[0].meetingId).title = "Injected wrong title";
    writeFileSync(path, JSON.stringify(changed));
    const wrongFact = readFleetReceiptReadback(receipt, { root, items: collection.items, observedAt: h.now() });
    assert.ok(wrongFact.items.some(item => !item.matchesProjection && item.gaps.includes("LOCAL_READER_PROJECTION_MISMATCH")));
  });
  assert.equal(hash(committedPath), committedBefore);
  assert.deepEqual(await h.repos.windowRuns.readAll(), []);
  t.diagnostic(JSON.stringify({ approved: 36, shadowMaterializedFacts: receipt.items.length, shadowReaderMeetings: deliveredRows.length,
    sourceMatchedReadbacks: readback.items.filter(item => item.matchesProjection).length, liveGate: "OFF", readerPublished: 0,
    liveWindowRuns: 0, firstReaderOutput: readback.items[0].rendering }));
});
