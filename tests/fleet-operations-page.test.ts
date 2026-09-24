/**
 * The committed `/admin/fleet` PAGE composition — not the endpoint alone, and not
 * a screenshot. It drives the page's exact server read (`readFleetSeedState`,
 * lib/admin/fleet-seed.ts) with isolated in-memory repositories, a REAL receipt
 * store over a TEMPORARY root, and a real promoter receipt, then renders the
 * page's exact view (`FleetOperationsView`, the panel's pure projection) with
 * `react-dom/server` to prove the rendered page shows the loaded receipt evidence
 * accurately. Refresh is exercised through the real guarded handler with fixture
 * authentication, folded exactly as the client panel folds it. A failed receipt
 * refresh must retain the historical receipt WITHOUT upgrading its state or
 * timestamp. Guard tests and preview screenshots do not establish this path.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, signSession } from "../lib/control-plane/admin-auth.ts";
import { readFleetSeedState } from "../lib/admin/fleet-seed.ts";
import { applyRefresh, type FleetConsumerState } from "../lib/admin/fleet-operations-view.ts";
import { createFleetReceiptStore } from "../lib/control-plane/fleet-receipt-store.ts";
import { handleFleetOperationsRequest } from "../lib/control-plane/fleet-operations-http.ts";
import type { FleetOperationsReport } from "../lib/control-plane/fleet-operations.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { SNAPSHOT_ID } from "../lib/control-plane/admin-data.ts";
import { withFleetReceiptSnapshot } from "../lib/control-plane/fleet-receipt-publisher.ts";
import { gap, type OwnerSnapshot } from "../lib/control-plane/owner-surface.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { liveAuthority, promoteFacts, receiptSummary, type PromotionReceipt } from "./helpers/legacy-promoter.ts";
import type { HistoricalWindowRun } from "../lib/control-plane/fleet-delivery.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { SESSION_KEY, withAdminSessionKey } from "./admin-session.ts";

const AT = "2026-09-05T18:00:00.000Z";
const LATER = "2026-09-05T18:01:00.000Z";

function request(origin: string, cookie?: string) {
  return new NextRequest(`${origin}/api/admin/fleet/operations`, {
    headers: { host: new URL(origin).host, ...(cookie ? { cookie } : {}) },
  });
}

function windowFor(receipt: PromotionReceipt, finishedAt: string): HistoricalWindowRun {
  return { formatVersion: 1, windowId: receipt.windowId!, localDate: "2026-09-05", zone: "America/New_York", scheduledFor: AT,
    trigger: "MANUAL", mode: "SHADOW", startedAt: AT, finishedAt, host: "offline-page-fixture", testedSha: null, provider: "fixture",
    caughtUp: [], lock: { leaseId: "fixture", holder: "fixture", claimedAt: AT, expiresAt: finishedAt, releasedAt: finishedAt },
    activationGate: readActivationGate(process.cwd()), stages: [],
    pipeline: { items: 1, byStage: { SCOUTED: 0, CONFIRMED: 0, VERIFIED: 0, AUDITED: 0, APPROVED_FOR_PROMOTION: 0 }, refused: 1,
      verdicts: [{ itemId: "fixture-item", recordClass: "meeting-times", stage: null, verdict: "REFUSE_WOULD", reason: "isolated page fixture" }], byRecordClass: [] },
    promoted: 0, controls: null, incidents: [], digestPath: null, mirrored: null, recordPath: null,
    promotionReceipts: [receiptSummary(receipt)] };
}

/** Render the page's exact view component out-of-process (tsx handles the JSX/TSX
 *  the strip-types test loader does not); returns the static HTML. */
function renderPageView(state: FleetConsumerState, scratchDir: string): string {
  const stateFile = join(scratchDir, "seed-state.json");
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { readFileSync, writeFileSync } from 'node:fs';
    import { FleetOperationsView } from './components/admin/fleet-operations-panel.tsx';
    writeFileSync(${JSON.stringify(stateFile)}, ${JSON.stringify(JSON.stringify(state))});
    const state = JSON.parse(readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
    console.log(renderToStaticMarkup(createElement(FleetOperationsView, { state })));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000, maxBuffer: 8_000_000 });
}

test("the committed /admin/fleet page loads receipts from a temporary root, renders them, and retains a failed refresh without upgrading it", async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("OFFLINE_FLEET_PAGE_CONTROL_NETWORK_REFUSED"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const root = await mkdtemp(join(tmpdir(), "fleet-page-"));
  t.after(async () => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("fleet-page-"));
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  });

  // A real promoter refusal receipt on a temporary SHADOW root — no live source,
  // scheduler, production repository or deployment. The store the page injects
  // targets that temporary root instead of the production READER cwd.
  const receipt = await promoteFacts({ target: { kind: "SHADOW", root }, authority: liveAuthority(readActivationGate(process.cwd())),
    verdicts: [{ itemId: "fixture-item", recordClass: "meeting-times", stage: null, verdict: "REFUSE_WOULD", reason: "isolated page fixture" }],
    facts: new Map(), now: AT, windowId: "fixture-page-window" });
  assert.ok(receipt.receiptPath);
  const window = windowFor(receipt, LATER);
  const base = createMemoryRepositories();
  const repos = { ...base, windowRuns: { ...base.windowRuns, readAll: async () => [window] } };
  const store = createFleetReceiptStore({ targets: [{ kind: "SHADOW", root }] });
  const open = async () => ({ ok: true as const, repos });

  // ── Initial page paint: the page's server read loads the receipt. ────────────
  const seed = await readFleetSeedState({ open, receiptStore: store, now: () => LATER });
  assert.equal(seed.shown?.receiptLoading.kind, "HELD");
  if (seed.shown?.receiptLoading.kind !== "HELD") throw new Error("LOADING_NOT_HELD");
  const loadedEntry = seed.shown.receiptLoading.value.entries.find(e => e.receiptId === receipt.receiptId);
  assert.ok(loadedEntry, "the page read surfaces the receipt reference");
  assert.equal(loadedEntry.state, "LOADED");
  assert.equal(loadedEntry.lastSuccessfulReadAt, LATER);

  const markup = renderPageView(seed, root);
  assert.match(markup, /receipt loading/i, "the rendered page shows the receipt-loading block");
  assert.match(markup, /loaded/i);
  assert.match(markup, /not .* served publication/i, "the page states LOADED is not served publication");
  assert.ok(!markup.includes(root), "no filesystem root leaks into the rendered page");
  assert.ok(!markup.includes(SESSION_KEY));

  // ── Failed refresh: the receipt file vanishes; history is retained, not upgraded. ─
  await unlink(receipt.receiptPath!);
  const retainedSeed = await readFleetSeedState({ open, receiptStore: store, now: () => "2026-09-05T18:05:00.000Z" });
  assert.equal(retainedSeed.shown?.receiptLoading.kind, "HELD");
  if (retainedSeed.shown?.receiptLoading.kind !== "HELD") throw new Error("RETAINED_NOT_HELD");
  const retained = retainedSeed.shown.receiptLoading.value.entries.find(e => e.receiptId === receipt.receiptId);
  assert.ok(retained);
  assert.equal(retained.state, "RETAINED", "a vanished receipt is retained, not dropped");
  assert.equal(retained.lastSuccessfulReadAt, LATER, "the retained receipt keeps its ORIGINAL successful read time, never restamped");
  assert.ok(retained.gaps.includes("RETAINED_HISTORICAL_RECEIPT_NOT_CURRENT_PROOF"));
  assert.equal(retainedSeed.shown.deliveryFreshness, "UNKNOWN", "a retained (non-LOADED) refresh holds delivery freshness at UNKNOWN");

  const retainedMarkup = renderPageView(retainedSeed, root);
  assert.match(retainedMarkup, /retained historical receipt — NOT current proof/i, "the page renders the retained receipt as historical, not current proof");

  // ── Refresh through the real guarded handler with fixture authentication. ────
  await withAdminSessionKey(async () => {
    const iat = Math.floor(Date.parse(LATER) / 1000);
    const signed = await signSession({ sid: "adm_fleet_page_fixture", iat, exp: iat + 3600, via: "google" }, SESSION_KEY);
    const cookie = `${ADMIN_SESSION_COOKIE}=${signed}`;
    const now = () => "2026-09-05T18:06:00.000Z";
    // Unauthenticated / public callers are refused before any read (guard lives in the handler).
    assert.equal((await handleFleetOperationsRequest(request(PUBLIC_SITE_ORIGIN, cookie), { open, receiptStore: store, now })).status, 404);
    assert.equal((await handleFleetOperationsRequest(request(ADMIN_ORIGIN), { open, receiptStore: store, now })).status, 401);
    const response = await handleFleetOperationsRequest(request(ADMIN_ORIGIN, cookie), { open, receiptStore: store, now });
    assert.equal(response.status, 200);
    const report = await response.json() as FleetOperationsReport;
    // Fold exactly as the client panel folds a fetched report, then render.
    const refreshed = applyRefresh(retainedSeed, { status: "REPORT", report });
    assert.equal(refreshed.shown?.observedAt, now());
    const refreshedMarkup = renderPageView(refreshed, root);
    assert.match(refreshedMarkup, /receipt loading/i, "the refreshed page still renders the receipt-loading block");
  });
});

/** The base owner snapshot the real publisher writes — only the fields the fleet read
 *  consults; every measured aggregate is an explicit gap, never a fabricated zero. */
function baseSnapshot(publishedAt: string): OwnerSnapshot {
  const nothing = gap<never>("OURS", "Not measured in this page snapshot fixture");
  return { formatVersion: 1, publishedAt, publishedFromSha: null, publisher: "offline-page-fixture",
    pilotGreen: null, contracts: [], decisionCards: [], obligationsByState: [], obligationsByProvider: [], freshnessDebtRows: nothing,
    incidents: [], costByRole: [], costByModel: [], cacheHitRateByCaller: [], deterministicShare: nothing, costPerVerifiedRecord: nothing,
    intakeFolder: nothing, intakeItemsFound: nothing, intakeItemsProcessed: nothing, intakeUnidentifiable: nothing, zipRows: nothing };
}

test("the committed /admin/fleet page and its Refresh read the SAME owner-snapshot receipt transport — populated and missing parity, no filesystem store", async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("OFFLINE_FLEET_PAGE_SNAPSHOT_NETWORK_REFUSED"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const root = await mkdtemp(join(tmpdir(), "fleet-page-snap-"));
  t.after(async () => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("fleet-page-snap-"));
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  });

  // Runner-side: a real receipt on a temp root, composed into the existing owner
  // snapshot by Fleet's withFleetReceiptSnapshot — no live publisher, database or dispatch.
  const receipt = await promoteFacts({ target: { kind: "SHADOW", root }, authority: liveAuthority(readActivationGate(process.cwd())),
    verdicts: [{ itemId: "fixture-item", recordClass: "meeting-times", stage: null, verdict: "REFUSE_WOULD", reason: "isolated page snapshot fixture" }],
    facts: new Map(), now: AT, windowId: "fixture-page-snap-window" });
  assert.ok(receipt.receiptPath);
  const window = windowFor(receipt, LATER);
  const store = createFleetReceiptStore({ targets: [{ kind: "SHADOW", root }] });
  const composed = await withFleetReceiptSnapshot(baseSnapshot(LATER), { store, readWindows: async () => [window], previous: null });
  assert.ok(composed.fleetReceipts, "runner composed the receipt snapshot into the owner aggregate");

  await withAdminSessionKey(async () => {
    const iat = Math.floor(Date.parse(LATER) / 1000);
    const signed = await signSession({ sid: "adm_fleet_page_snap", iat, exp: iat + 3600, via: "google" }, SESSION_KEY);
    const cookie = `${ADMIN_SESSION_COOKIE}=${signed}`;
    const now = () => LATER;

    // ── Populated snapshot: page seed and Refresh both surface the loaded receipt, WITHOUT a store. ──
    await t.test("a populated owner snapshot feeds the page seed and Refresh identically", async () => {
      const base = createMemoryRepositories();
      const repos = { ...base, windowRuns: { ...base.windowRuns, readAll: async () => [window] } };
      await repos.ownerSnapshots.put(SNAPSHOT_ID, composed, LATER);
      const open = async () => ({ ok: true as const, repos });

      const seed = await readFleetSeedState({ open, now });   // NO store injected
      assert.equal(seed.shown?.receiptLoading.kind, "HELD", "the page seed loads receipts from the owner snapshot");
      if (seed.shown?.receiptLoading.kind !== "HELD") throw new Error("SNAP_SEED_NOT_HELD");
      const seedEntry = seed.shown.receiptLoading.value.entries.find(e => e.receiptId === receipt.receiptId);
      assert.ok(seedEntry, "the snapshot-sourced page read surfaces the receipt reference");
      assert.equal(seedEntry.state, "LOADED");
      assert.equal(seed.shown.receiptSource?.kind, "OWNER_SNAPSHOT");
      assert.equal(seed.shown.receiptSource?.authority, "HISTORICAL_PROMOTER_1");
      assert.equal(seed.shown.receiptSource?.permanentAuthority, "NOT_CONNECTED");
      assert.equal(seed.shown.receiptSource?.freshness, "FRESH");

      const response = await handleFleetOperationsRequest(request(ADMIN_ORIGIN, cookie), { open, now });  // NO store injected
      assert.equal(response.status, 200);
      const report = await response.json() as FleetOperationsReport;
      // page ↔ Refresh parity: identical receipt loading + provenance from the same snapshot.
      assert.deepEqual(report.receiptLoading, seed.shown.receiptLoading, "Refresh receipt loading equals the page seed's");
      assert.deepEqual(report.receiptSource, seed.shown.receiptSource, "Refresh receipt source equals the page seed's");

      const markup = renderPageView(seed, root);
      assert.match(markup, /receipt loading/i);
      assert.match(markup, /Receipt source: owner snapshot/i, "the page names the owner-snapshot receipt source");
      assert.match(markup, /permanent receipt authority NOT CONNECTED/i, "the page states the permanent authority is not connected");
      assert.ok(!markup.includes(root), "no filesystem root leaks into the rendered page");
      assert.ok(!markup.includes(SESSION_KEY));
    });

    // ── Missing extension: NOT_RECORDED, unknown freshness, no empty-success; parity holds. ──
    await t.test("an owner snapshot with no receipt extension is NOT_RECORDED on both the page seed and Refresh", async () => {
      const base = createMemoryRepositories();
      const repos = { ...base, windowRuns: { ...base.windowRuns, readAll: async () => [window] } };
      await repos.ownerSnapshots.put(SNAPSHOT_ID, baseSnapshot(LATER), LATER);   // no fleetReceipts extension
      const open = async () => ({ ok: true as const, repos });

      const seed = await readFleetSeedState({ open, now });   // NO store injected
      assert.equal(seed.shown?.receiptLoading.kind, "NOT_RECORDED", "an absent extension is NOT_RECORDED, never an empty success");
      assert.equal(seed.shown?.receiptSource?.kind, "OWNER_SNAPSHOT");
      assert.equal(seed.shown?.receiptSource?.observedAt, null);
      assert.equal(seed.shown?.receiptSource?.freshness, "UNKNOWN");
      assert.equal(seed.shown?.receiptSource?.permanentAuthority, "NOT_CONNECTED");

      const response = await handleFleetOperationsRequest(request(ADMIN_ORIGIN, cookie), { open, now });
      assert.equal(response.status, 200);
      const report = await response.json() as FleetOperationsReport;
      assert.deepEqual(report.receiptLoading, seed.shown!.receiptLoading, "missing-snapshot Refresh matches the page seed");
      assert.deepEqual(report.receiptSource, seed.shown!.receiptSource);

      const markup = renderPageView(seed, root);
      assert.match(markup, /Receipt source: owner snapshot/i);
      assert.match(markup, /permanent receipt authority NOT CONNECTED/i);
    });
  });
});
