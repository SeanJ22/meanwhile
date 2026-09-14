import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, signSession } from "../lib/control-plane/admin-auth.ts";
import { SNAPSHOT_ID } from "../lib/control-plane/admin-data.ts";
import { withFleetReceiptSnapshot } from "../lib/control-plane/fleet-receipt-publisher.ts";
import { gap, type OwnerSnapshot } from "../lib/control-plane/owner-surface.ts";
import { readFleetReceiptReadback } from "../lib/control-plane/fleet-delivery.ts";
import { readFleetOperations, type FleetOperationsReport } from "../lib/control-plane/fleet-operations.ts";
import { handleFleetOperationsRequest } from "../lib/control-plane/fleet-operations-http.ts";
import { createFleetReceiptStore } from "../lib/control-plane/fleet-receipt-store.ts";
import { ACTIVATION_GATE, readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { collectFactChains, projectFactChains, readFactItemStates } from "../lib/control-plane/promotion/fact-chain.ts";
import { factSubjectsFromStates } from "../lib/control-plane/promotion/fact-freshness.ts";
import { liveAuthority, promoteFacts, receiptSummary, shadowAuthority, verifyMaterialization, type PromotionReceipt } from "../lib/control-plane/promotion/promoter.ts";
import type { WindowRunRecord } from "../lib/control-plane/promotion/types.ts";
import { evaluateItems } from "../lib/control-plane/promotion/window.ts";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { promotedFactsProvider } from "../lib/control-plane/scheduler/providers/promoted-facts.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { SESSION_KEY, withAdminSessionKey } from "./admin-session.ts";
import { factChainHarness, PIMA_CONTRACT } from "./fact-chain-harness.ts";

function request(origin: string, cookie?: string) {
  return new NextRequest(`${origin}/api/admin/fleet/operations`, {
    headers: { host: new URL(origin).host, ...(cookie ? { cookie } : {}) },
  });
}

function delivery(report: FleetOperationsReport, workItemId: string) {
  assert.equal(report.operations.kind, "HELD");
  if (report.operations.kind !== "HELD") throw new Error("ACTIVITY_NOT_HELD");
  const row = report.operations.value.find(item => item.workItemId === workItemId);
  assert.ok(row);
  assert.equal(row.publication.status, "UNKNOWN", "Local proof must never certify a served production page");
  assert.equal(row.publication.delivery.kind, "HELD");
  if (row.publication.delivery.kind !== "HELD") throw new Error("DELIVERY_NOT_HELD");
  return row.publication.delivery.value;
}

test("real promoter receipts reach the authenticated Admin consumer through the file loader, retaining failures without claiming current proof", async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("OFFLINE_FLEET_RECEIPT_CONTROL_NETWORK_REFUSED"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const h = await factChainHarness();
  const root = mkdtempSync(join(tmpdir(), "fleet-receipt-admin-"));
  t.after(() => {
    for (const [path, prefix] of [[root, "fleet-receipt-admin-"], [h.vaultRoot, "wtp-isolated-plane-"]]) {
      assert.equal(dirname(resolve(path)), resolve(tmpdir()));
      assert.ok(basename(path).startsWith(prefix));
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    }
  });
  const committedPath = join(process.cwd(), "data", "meetings-snapshot.json");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const originalHash = hash(committedPath);
  mkdirSync(join(root, "data"));
  copyFileSync(committedPath, join(root, "data", "meetings-snapshot.json"));
  const text = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
  const observation = await h.hold(text, { role: "SCOUT" });
  await h.hold(text, { role: "ACQUIRER" });
  await h.chain(observation);
  const options = { readArtifactText: h.readArtifactText, now: h.now(), registryBodyIds: new Set([PIMA_CONTRACT.subjectId]) };
  await projectFactChains(h.repos, options);
  const subjects = factSubjectsFromStates(await readFactItemStates(h.repos), options.now);
  const registry = buildRegistry([promotedFactsProvider(subjects)], { root: process.cwd(), nowIso: options.now });
  await syncObligations(h.repos, registry.obligations, options.now);
  const approved = await projectFactChains(h.repos, options);
  assert.ok(approved.states.length > 0);
  assert.ok(approved.states.every(state => state.stage === "APPROVED_FOR_PROMOTION"));
  const collection = await collectFactChains(h.repos, options);
  const facts = new Map(collection.items.map(item => [item.itemId, item.fact]));
  const gate = readActivationGate(process.cwd());
  assert.equal(gate.promotionEnabled, false);
  const authority = shadowAuthority(["meeting-times", "agendas"], "Isolated offline Admin receipt compatibility control");
  const decisions = evaluateItems(approved.states, authority);
  const windows: WindowRunRecord[] = [];
  const repos = { ...h.repos, windowRuns: { ...h.repos.windowRuns, readAll: async () => [...windows] } };
  const store = createFleetReceiptStore({ targets: [{ kind: "SHADOW", root }] });

  // Reporting fixture only: no window runner or production operation executes here.
  function recordWindow(receipt: PromotionReceipt, verdicts = decisions.verdicts): void {
    assert.ok(receipt.windowId);
    const at = h.now();
    windows.push({ formatVersion: 1, windowId: receipt.windowId, localDate: "2026-09-05", zone: "America/New_York",
      scheduledFor: receipt.at, trigger: "MANUAL", mode: "SHADOW", startedAt: receipt.at, finishedAt: at,
      host: "offline-reporting-fixture", testedSha: null, provider: "fixture", caughtUp: [],
      lock: { leaseId: "fixture", holder: "fixture", claimedAt: receipt.at, expiresAt: at, releasedAt: at },
      activationGate: gate, stages: [], legacyRefresh: null,
      pipeline: { items: approved.states.length, byStage: approved.counts.byStage, refused: verdicts.filter(v => v.verdict === "REFUSE_WOULD").length,
        verdicts, byRecordClass: decisions.byRecordClass }, promoted: 0, postPromotionVerification: null, controls: null,
      incidents: receipt.incident ? [receipt.incident] : [], digestPath: null, mirrored: null, recordPath: null,
      promotionReceipts: [receiptSummary(receipt)] });
  }

  const receipt = await promoteFacts({ target: { kind: "SHADOW", root }, authority, verdicts: decisions.verdicts,
    facts, now: h.now(), windowId: "fixture-receipt-success", verify: verifyMaterialization });
  assert.equal(receipt.after.written, true);
  assert.equal(receipt.verification?.passed, true);
  assert.ok(receipt.receiptPath);
  recordWindow(receipt);
  const readback = readFleetReceiptReadback(receipt, { root, items: collection.items, observedAt: h.now() });
  assert.deepEqual(readback.gaps, []);
  const readWithProof = () => readFleetOperations(repos, { observedAt: h.now(), receiptStore: store, deliveryEvidence: { readbacks: [readback] } });

  await withAdminSessionKey(async () => {
    const issuedAt = Math.floor(Date.parse(h.now()) / 1000);
    const signed = await signSession({ sid: "adm_receipt_fixture", iat: issuedAt, exp: issuedAt + 3600, via: "google" }, SESSION_KEY);
    const cookie = `${ADMIN_SESSION_COOKIE}=${signed}`;
    const http = async () => {
      const at = h.now(), nothing = gap<never>("OURS", "Not measured in this receipt fixture");
      const base: OwnerSnapshot = { formatVersion: 1, publishedAt: at, publishedFromSha: null, publisher: "offline-fixture",
        pilotGreen: null, contracts: [], decisionCards: [], obligationsByState: [], obligationsByProvider: [], freshnessDebtRows: nothing,
        incidents: [], costByRole: [], costByModel: [], cacheHitRateByCaller: [], deterministicShare: nothing, costPerVerifiedRecord: nothing,
        intakeFolder: nothing, intakeItemsFound: nothing, intakeItemsProcessed: nothing, intakeUnidentifiable: nothing, zipRows: nothing };
      const previous = await repos.ownerSnapshots.read(SNAPSHOT_ID);
      const snapshot = await withFleetReceiptSnapshot(base, { store, readWindows: repos.windowRuns.readAll, previous: previous?.value.fleetReceipts });
      // Actual existing aggregate, one revision per publication. No extra ledger, runner or live database.
      if (previous) await repos.ownerSnapshots.compareAndSet(SNAPSHOT_ID, previous.revision, snapshot, at);
      else await repos.ownerSnapshots.put(SNAPSHOT_ID, snapshot, at);
      const response = await handleFleetOperationsRequest(request(ADMIN_ORIGIN, cookie), { open: async () => ({ ok: true, repos }), now: h.now });
      const projected = await response.clone().json() as FleetOperationsReport;
      assert.equal(projected.receiptSource?.kind, "OWNER_SNAPSHOT");
      assert.equal(projected.receiptSource?.authority, "HISTORICAL_PROMOTER_1");
      assert.equal(projected.receiptSource?.permanentAuthority, "NOT_CONNECTED");
      return response;
    };

    await t.test("runner receipt loader → owner snapshot → authenticated HTTP supplies exact historical identity without an HTTP filesystem store", async () => {
      const response = await http();
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control")!, /no-store/);
      const report = await response.json() as FleetOperationsReport;
      const read = delivery(report, h.itemId);
      assert.equal(read.items.length, receipt.items.length);
      assert.ok(read.items.every(item => item.status === "UNKNOWN"));
      assert.ok(read.items.every(item => item.receipts.some(r => r.receiptId === receipt.receiptId && r.materialized && r.verification?.passed)));
      assert.ok(read.items.every(item => item.gaps.includes("EXACT_LOCAL_SNAPSHOT_READBACK_NOT_PROVIDED")));
      assert.ok(delivery(await readWithProof(), h.itemId).items.every(item => item.status === "SHADOW_READBACK_VERIFIED"));
      assert.ok(!JSON.stringify(report).includes(SESSION_KEY));
    });

    await t.test("a missing receipt retains last trustworthy history but its older readback cannot prove current loading", async () => {
      const displaced = `${receipt.receiptPath}.missing-control`;
      renameSync(receipt.receiptPath!, displaced);
      try {
        const response = await http();
        assert.equal(response.status, 200);
        const read = delivery(await response.json() as FleetOperationsReport, h.itemId);
        assert.ok(read.items.every(item => item.receipts.some(r => r.receiptId === receipt.receiptId)), "Missing file must not discard historical receipt evidence");
        const withOlderProof = delivery(await readWithProof(), h.itemId);
        assert.ok(withOlderProof.items.every(item => item.status !== "SHADOW_READBACK_VERIFIED"));
        assert.ok(withOlderProof.items.every(item => item.gaps.some(gap => gap.startsWith("RECEIPT_LOAD_RETAINED:"))));
      } finally { renameSync(displaced, receipt.receiptPath!); }
      assert.ok(delivery(await readWithProof(), h.itemId).items.every(item => item.status === "SHADOW_READBACK_VERIFIED"));
    });

    await t.test("a receipt identity mismatch cannot replace held history or keep prior proof green", async () => {
      const original = readFileSync(receipt.receiptPath!);
      writeFileSync(receipt.receiptPath!, JSON.stringify({ ...receipt, receiptId: "pr-wrong-fixture-identity" }));
      try {
        const response = await http();
        assert.equal(response.status, 200);
        const read = delivery(await response.json() as FleetOperationsReport, h.itemId);
        assert.ok(read.items.every(item => item.receipts.some(r => r.receiptId === receipt.receiptId)));
        assert.ok(read.items.every(item => item.receipts.every(r => r.receiptId !== "pr-wrong-fixture-identity")));
        const withOlderProof = delivery(await readWithProof(), h.itemId);
        assert.ok(withOlderProof.items.every(item => item.status !== "SHADOW_READBACK_VERIFIED"));
        assert.ok(withOlderProof.items.every(item => item.gaps.some(gap => gap.startsWith("RECEIPT_LOAD_RETAINED:"))));
      } finally { writeFileSync(receipt.receiptPath!, original); }
    });

    await t.test("real failed verification and governed reversal receipts remain visible through HTTP", async () => {
      for (const reverse of [false, true]) {
        const failed = await promoteFacts({ target: { kind: "SHADOW", root }, authority, verdicts: decisions.verdicts, facts,
          now: h.now(), windowId: `fixture-failed-receipt-${reverse}`, revertOnFailure: reverse,
          verify: produced => {
            writeFileSync(produced.before.path, "{invalid snapshot fixture");
            return verifyMaterialization(produced);
          } });
        assert.equal(failed.verification?.passed, false);
        assert.equal(failed.reversal?.executed, reverse);
        assert.ok(failed.incident);
        recordWindow(failed);
        const response = await http();
        assert.equal(response.status, 200);
        const read = delivery(await response.json() as FleetOperationsReport, h.itemId);
        assert.ok(read.items.every(item => item.receipts.some(r => r.receiptId === failed.receiptId && r.verification?.passed === false && r.reverted === reverse)));
        assert.ok(read.items.every(item => item.status !== "SHADOW_READBACK_VERIFIED"));
        assert.ok(failed.before.copy);
        copyFileSync(failed.before.copy, failed.before.path);
      }
    });

    await t.test("real promotion-off refusals are loaded as holds, not empty successes", async () => {
      const liveDecisions = evaluateItems(approved.states, ACTIVATION_GATE);
      const refused = await promoteFacts({ target: { kind: "SHADOW", root }, authority: liveAuthority(gate),
        verdicts: liveDecisions.verdicts, facts, now: h.now(), windowId: "fixture-gate-refusal" });
      assert.equal(refused.after.written, false);
      assert.ok(refused.refused.length > 0);
      recordWindow(refused, liveDecisions.verdicts);
      const response = await http();
      assert.equal(response.status, 200);
      const read = delivery(await response.json() as FleetOperationsReport, h.itemId);
      assert.ok(read.items.every(item => item.status === "HELD" && item.receipts.some(r => r.receiptId === refused.receiptId && r.refusal?.startsWith("PROMOTION_OFF:"))));
    });

    await t.test("receipt-store failure preserves readable activity and cannot be covered by injected old receipts", async () => {
      const secretPath = "unpublishable-fixture-store-path";
      const brokenStore = { read: async () => { throw new Error(secretPath); } };
      const response = await handleFleetOperationsRequest(request(ADMIN_ORIGIN, cookie), {
        open: async () => ({ ok: true, repos }), receiptStore: brokenStore, now: h.now,
      });
      assert.equal(response.status, 200);
      const report = await response.json() as FleetOperationsReport;
      assert.equal(report.receiptLoading.kind, "STORE_UNREACHABLE");
      assert.equal(report.deliveryFreshness, "UNKNOWN");
      assert.ok(delivery(report, h.itemId).items.length > 0);
      assert.ok(!JSON.stringify(report).includes(secretPath));
      const withOldProof = await readFleetOperations(repos, { observedAt: h.now(), receiptStore: brokenStore,
        deliveryEvidence: { receipts: [receipt], readbacks: [readback] } });
      assert.ok(delivery(withOldProof, h.itemId).items.every(item => item.receipts.length === 0 && item.status !== "SHADOW_READBACK_VERIFIED"));
    });

    await t.test("bounded receipt loading names omitted evidence and marks delivery freshness unknown", async () => {
      const limitedStore = createFleetReceiptStore({ targets: [{ kind: "SHADOW", root }], maximumReceipts: 1 });
      const response = await handleFleetOperationsRequest(request(ADMIN_ORIGIN, cookie), {
        open: async () => ({ ok: true, repos }), receiptStore: limitedStore, now: h.now,
      });
      assert.equal(response.status, 200);
      const report = await response.json() as FleetOperationsReport;
      assert.equal(report.receiptLoading.kind, "HELD");
      if (report.receiptLoading.kind !== "HELD") throw new Error("LOADING_NOT_HELD");
      assert.ok(report.receiptLoading.value.truncated > 0);
      assert.equal(report.deliveryFreshness, "UNKNOWN");
      assert.ok(delivery(report, h.itemId).items.every(item => item.gaps.includes("RECEIPT_LOADING_TRUNCATED") && item.status !== "SHADOW_READBACK_VERIFIED"));
    });

    await t.test("public and unauthenticated requests reject before opening repositories or consulting receipt storage", async () => {
      let opens = 0;
      let storageAccesses = 0;
      const guardedStore = new Proxy(store, { get(target, property, receiver) { storageAccesses++; return Reflect.get(target, property, receiver); } });
      const dependencies = { open: async () => { opens++; return { ok: true as const, repos }; }, receiptStore: guardedStore, now: h.now };
      assert.equal((await handleFleetOperationsRequest(request(PUBLIC_SITE_ORIGIN, cookie), dependencies)).status, 404);
      assert.equal((await handleFleetOperationsRequest(request(ADMIN_ORIGIN), dependencies)).status, 401);
      assert.equal(opens, 0);
      assert.equal(storageAccesses, 0);
    });
  });
  assert.equal(hash(committedPath), originalHash);
  assert.deepEqual(await h.repos.windowRuns.readAll(), [], "Only a reporting fixture supplied windows; no canonical window was executed");
});
