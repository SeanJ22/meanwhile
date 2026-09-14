/**
 * Producer → consumer compatibility (contract §Implemented: "A real
 * producer-to-consumer compatibility test is required when wired").
 *
 * Drives the REAL read service (lib/control-plane/fleet-operations.ts) against
 * canonical in-memory repositories and feeds its output through the Admin
 * consumer's pure projection (lib/admin/fleet-operations-view.ts). No copied
 * fixture JSON: the report is produced by the service on each run.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  FLEET_OPERATIONS_EXTENSION_VERSION,
  FLEET_OPERATIONS_VERSION,
  readFleetOperations,
} from "../lib/control-plane/fleet-operations.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { FIXTURE_NOW } from "./helpers/autonomous-fleet.ts";
import {
  anySectionUnavailable,
  applyRefresh,
  deliveryItemStatusLabel,
  deliverySummary,
  EMPTY_CONSUMER_STATE,
  extensionCapability,
  isKnownVersion,
  nextActionDisplay,
  scoutPrerequisite,
  spendingDisplay,
} from "../lib/admin/fleet-operations-view.ts";
import type { FleetDeliveryItem } from "../lib/control-plane/fleet-delivery.ts";

test("the consumer folds a real empty report and matches the version", async () => {
  const repos = createMemoryRepositories();
  const report = await readFleetOperations(repos, { observedAt: FIXTURE_NOW });
  const state = applyRefresh(EMPTY_CONSUMER_STATE, { status: "REPORT", report });
  assert.equal(state.unknownVersion, false);
  assert.equal(state.lastError, null);
  assert.equal(state.shown?.observedAt, FIXTURE_NOW);
  assert.equal(state.shown?.operations.kind, "HELD");
});

test("a real op with no cost ledger renders 'not measured', never $0", async () => {
  const repos = createMemoryRepositories();
  const item = createWorkItem({ project: "consumer-test", subject: "fixture:no-cost", obligation: "Inspect", why: "Spending honesty", now: FIXTURE_NOW });
  await registerWorkItem(repos, item, FIXTURE_NOW);
  await registerRouteTask(repos, createRouteTask({ workItemId: item.id, routeId: "r", routeLabel: "R", target: "https://x.example.gov", inherited: true, now: FIXTURE_NOW }), FIXTURE_NOW);
  const report = await readFleetOperations(repos, { observedAt: FIXTURE_NOW });
  assert.equal(report.operations.kind, "HELD");
  if (report.operations.kind !== "HELD") throw new Error("expected HELD");
  const op = report.operations.value[0];
  const spend = spendingDisplay(op.spending);
  assert.equal(spend.known, false);
  assert.doesNotMatch(spend.text, /\$0\b/, "unknown spending must never read as $0");
  assert.match(spend.text, /not measured/i);
  // Every task's next-action line is a prerequisite, never a promised dispatch time.
  for (const task of op.tasks) {
    const line = nextActionDisplay(task);
    assert.match(line, /not a (scheduled )?dispatch/i, `next action must disclaim a dispatch promise: ${line}`);
  }
});

test("a failed refresh retains the last report and its original observedAt (no restamp)", async () => {
  const repos = createMemoryRepositories();
  const report = await readFleetOperations(repos, { observedAt: FIXTURE_NOW });
  const loaded = applyRefresh(EMPTY_CONSUMER_STATE, { status: "REPORT", report });
  const later = applyRefresh(loaded, { status: "CONTROL_PLANE_UNAVAILABLE", observedAt: "2026-09-04T00:00:00.000Z", detail: "env FLEET_DSN missing" });
  assert.equal(later.shown?.observedAt, FIXTURE_NOW, "the retained report keeps its original observedAt");
  assert.equal(later.shown, loaded.shown, "the previously shown report object is retained unchanged");
  assert.match(later.lastError ?? "", /control plane unavailable/i);
  // A subsequent transport failure also retains.
  const later2 = applyRefresh(later, { status: "TRANSPORT_ERROR", detail: "HTTP 500" });
  assert.equal(later2.shown?.observedAt, FIXTURE_NOW);
});

test("a store-unreachable section is surfaced even though other sections are held", async () => {
  const repos = createMemoryRepositories();
  const broken = {
    ...repos,
    workerResults: { ...repos.workerResults, readAll: async () => { throw new Error("secret-dsn"); } },
  };
  const report = await readFleetOperations(broken, { observedAt: FIXTURE_NOW });
  assert.equal(report.operations.kind, "STORE_UNREACHABLE");
  assert.equal(anySectionUnavailable(report), true);
  assert.ok(!JSON.stringify(report).includes("secret-dsn"), "no secret leaks through the report");
  const state = applyRefresh(EMPTY_CONSUMER_STATE, { status: "REPORT", report });
  // A report whose operations are unreachable is still a REPORT the consumer shows,
  // with the section marked unavailable rather than empty.
  assert.equal(state.shown?.operations.kind, "STORE_UNREACHABLE");
});

test("the v1.1 extension capability is PRESENT from this producer, UNAVAILABLE when omitted", async () => {
  const repos = createMemoryRepositories();
  const report = await readFleetOperations(repos, { observedAt: FIXTURE_NOW });
  assert.equal(extensionCapability(report), "PRESENT");
  // An older producer omits extensionVersion → unavailable capability, not empty.
  const older = { ...report, extensionVersion: undefined as unknown as typeof report.extensionVersion };
  assert.equal(extensionCapability(older), "UNAVAILABLE");
});

test("a shadow readback is never labelled served, and HTTP delivery discloses receipts-not-provided", () => {
  const item = { status: "SHADOW_READBACK_VERIFIED", gaps: ["SHADOW_DOES_NOT_PROVE_SERVED_READER"] } as unknown as FleetDeliveryItem;
  const label = deliveryItemStatusLabel(item);
  assert.equal(label.served, false);
  assert.match(label.text, /not served/i);
  const held = deliverySummary({ kind: "HELD", value: { version: "fleet-delivery/v1", receiptAvailability: "NOT_PROVIDED", items: [item] } });
  assert.match(held.text, /not provided/i);
  // A window-store failure is surfaced, not shown as empty.
  const broken = deliverySummary({ kind: "STORE_UNREACHABLE", detail: "window store down" });
  assert.match(broken.text, /unreadable/i);
});

test("a Scout admission reads as a prerequisite with a boundary, never a dispatch", () => {
  const line = scoutPrerequisite({
    kind: "AUTONOMOUS_SCOUT", familyRouteId: "f", familyTaskIds: [], attemptIds: [], latestAttemptId: null,
    state: "BACKOFF", retryAt: "2026-09-13T19:00:00.000Z", debt: null, nextTaskId: null,
    requiresPolicyRecheck: false, selection: "COORDINATOR_REEVALUATION_REQUIRED", reason: "offline denied attempt",
  });
  assert.match(line, /prerequisite/i);
  assert.match(line, /not a dispatch/i);
  assert.match(line, /coordinator re-evaluation/i);
});

test("an unknown format version is refused rather than mis-rendered", async () => {
  const repos = createMemoryRepositories();
  const report = await readFleetOperations(repos, { observedAt: FIXTURE_NOW });
  const good = applyRefresh(EMPTY_CONSUMER_STATE, { status: "REPORT", report });
  const future = applyRefresh(good, { status: "REPORT", report: { ...report, formatVersion: "fleet-operations/v2" as typeof report.formatVersion } });
  assert.equal(future.unknownVersion, true);
  assert.equal(future.shown, good.shown, "the prior good report is retained when the version is unknown");
});

test("the client-safe version mirror in the consumer cannot drift from the contract", () => {
  // The consumer holds a client-safe COPY of these two strings so the browser
  // bundle never imports the server read-service (which reaches node:fs). This
  // asserts the copy still equals the contract's own exports — through the
  // consumer's public helpers, which are what actually use the mirror.
  assert.equal(isKnownVersion(FLEET_OPERATIONS_VERSION), true, "consumer version mirror matches the contract");
  assert.equal(isKnownVersion("fleet-operations/v0"), false);
  const withExt = { extensionVersion: FLEET_OPERATIONS_EXTENSION_VERSION } as unknown as Parameters<typeof extensionCapability>[0];
  assert.equal(extensionCapability(withExt), "PRESENT", "consumer extension-version mirror matches the contract");
});
