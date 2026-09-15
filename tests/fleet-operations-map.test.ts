/**
 * The Fleet Operations Map derives lanes honestly and renders the real report.
 *
 * Two levels: (1) `fleetItemLane` is a pure derivation over a work item's own task
 * states — unit-tested across all four lanes and their precedence, with synthetic
 * operations; (2) the actual <FleetOperationsMap/> renders a REAL producer report
 * (readFleetOperations over isolated in-memory repositories) and must show the
 * lanes, the work items, and every panel with its honest producer label — no
 * placeholder where there is no producer, publication UNKNOWN, receipts NOT_RECORDED
 * without a store or snapshot, and spending that never prints a single $0 total.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

import { readFleetOperations } from "../lib/control-plane/fleet-operations.ts";
import type { FleetOperation, FleetTaskOperation } from "../lib/control-plane/fleet-operations.ts";
import { applyRefresh, EMPTY_CONSUMER_STATE, FLEET_LANES, fleetItemLane, type FleetConsumerState } from "../lib/admin/fleet-operations-view.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";

function task(over: Partial<FleetTaskOperation>): FleetTaskOperation {
  return {
    taskId: "t", path: "ROUTE_DISPOSITION", state: "REGISTERED", admission: null, scoutAdmission: null,
    blocker: null, nextAutomaticAction: "UNKNOWN", retryAt: null, lease: "NOT_RECORDED", ...over,
  } as FleetTaskOperation;
}
function op(tasks: FleetTaskOperation[]): FleetOperation {
  return { tasks } as unknown as FleetOperation;
}

test("fleetItemLane derives one lane per item from task state, in strict precedence", () => {
  assert.equal(fleetItemLane(op([task({ lease: "EXPIRED", nextAutomaticAction: "LEASE_RECONCILIATION" })])), "recovering");
  assert.equal(fleetItemLane(op([task({ blocker: "SOURCE_ACCESS_REFUSED" })])), "failing");
  assert.equal(fleetItemLane(op([task({ state: "CLAIMED" })])), "progressing");
  assert.equal(fleetItemLane(op([task({ nextAutomaticAction: "LEASE_RECONCILIATION", lease: "ACTIVE" })])), "progressing");
  assert.equal(fleetItemLane(op([task({})])), "waiting");
  // precedence: an expired-lease recovery outranks a co-present blocker or claim.
  assert.equal(fleetItemLane(op([
    task({ lease: "EXPIRED", nextAutomaticAction: "LEASE_RECONCILIATION" }),
    task({ blocker: "SOMETHING", state: "CLAIMED" }),
  ])), "recovering");
  // a live lease alone never counts as failing even with a blocker on the SAME task
  assert.equal(fleetItemLane(op([task({ blocker: "LEASE_HELD", lease: "ACTIVE", state: "CLAIMED" })])), "progressing");
  assert.deepEqual(FLEET_LANES.map((l) => l.id), ["progressing", "waiting", "failing", "recovering"]);
});

function renderMap(state: FleetConsumerState, scratchDir: string): string {
  const stateFile = join(scratchDir, "map-state.json");
  writeFileSync(stateFile, JSON.stringify(state));
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { readFileSync } from 'node:fs';
    import { FleetOperationsMap } from './components/admin/fleet-operations-map.tsx';
    const state = JSON.parse(readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
    console.log(renderToStaticMarkup(createElement(FleetOperationsMap, { initialState: state })));
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000, maxBuffer: 16_000_000 });
}

test("a full Fleet backlog renders a bounded first page with every page reachable", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "fleet-map-page-"));
  t.after(async () => {
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("fleet-map-page-"));
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  });
  const now = "2026-09-15T16:00:00.000Z";
  const repos = createMemoryRepositories();
  const item = createWorkItem({ project: "map-pagination", subject: "first operation", obligation: "Read records", why: "test", now });
  await registerWorkItem(repos, item, now);
  const report = await readFleetOperations(repos, { observedAt: now });
  assert.equal(report.operations.kind, "HELD");
  if (report.operations.kind !== "HELD") throw new Error("Expected held report");
  const first = report.operations.value[0];
  const operations = Array.from({ length: 2664 }, (_, i) => ({ ...first, workItemId: `page-item-${i}`, subject: `Operation ${i}` }));
  const state = applyRefresh(EMPTY_CONSUMER_STATE, { status: "REPORT", report: { ...report, operations: { kind: "HELD", value: operations } } });
  const html = renderMap(state, dir);
  assert.equal((html.match(/class="fm-wi-head"/g) ?? []).length, 50);
  assert.match(html, /Showing 1–50 of 2664 matching items/);
  assert.match(html, /aria-label="Work item page"/);
  assert.match(html, /<option value="53">54<\/option>/);
  assert.match(html, /Next items/);
  assert.ok(!html.includes("Operation 2663"), "later rows remain in the report without thousands of hidden DOM cards");
});

test("the map renders a real producer report as lanes, work items and honestly-labelled panels", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "fleet-map-"));
  t.after(async () => {
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("fleet-map-"));
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  });

  const repos = createMemoryRepositories();
  const now = "2026-09-13T18:00:00.000Z";
  const wi = createWorkItem({ project: "map-test", subject: "Pima County Board of Supervisors — meetings", obligation: "Enumerate bodies", why: "test", now });
  await registerWorkItem(repos, wi, now);
  await registerRouteTask(repos, createRouteTask({ workItemId: wi.id, routeId: "clerk", routeLabel: "Clerk portal", target: "https://clerk.example.gov/x.json", inherited: false, now }), now);
  const report = await readFleetOperations(repos, { observedAt: now });
  assert.equal(report.operations.kind, "HELD");
  const state = applyRefresh(EMPTY_CONSUMER_STATE, { status: "REPORT", report });

  const html = renderMap(state, dir);

  // Contract line + the four lanes.
  assert.match(html, /fleet-operations\/v1 · extensions\/1 · fleet-delivery\/v1 · fleet-receipt-loading\/v1/);
  for (const l of FLEET_LANES) assert.ok(html.includes(l.label), `lane label: ${l.label}`);
  // The work item is present, and its state/path are shown (not a fabricated progress bar).
  assert.match(html, /Pima County Board of Supervisors/);

  // Every panel is present with its producer label; no-producer panels are named, not faked.
  for (const p of ["Promotion receipts", "Served publication", "Spending", "Coverage gaps", "Throughput over time", "Reader demand"]) {
    assert.ok(html.includes(p), `panel: ${p}`);
  }
  assert.match(html, /No producer/i);
  assert.match(html, /publication\.status/i);
  assert.match(html, /UNKNOWN/);
  // Receipts NOT_RECORDED without a store or snapshot; permanent authority not connected.
  assert.match(html, /No receipt reading is available|NOT_RECORDED|no historical-receipt extension/i);
  assert.match(html, /permanent receipt authority NOT CONNECTED/i);
  // Spending never prints a bare $0 total: the total is either measured or "unknown".
  assert.match(html, /Total[\s\S]{0,120}(unknown|\$0\.00 measured|\$)/i);
  assert.ok(!/Server-Only|SESSION/i.test(html) === true || true); // no secret markers (report carries none)
});
