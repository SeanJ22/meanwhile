import assert from "node:assert/strict";
import test from "node:test";
import { fleetReadFreshness, projectFleetOperation, readFleetOperations } from "../lib/control-plane/fleet-operations.ts";
import { PULSE_STALE_MS } from "../lib/control-plane/live-pulse.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { projectAutonomousActivity, readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { nextAutonomousOperation, runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { autonomousHarness, FIXTURE_NOW } from "./helpers/autonomous-fleet.ts";
import { gap, type OwnerDecisionCard, type OwnerSnapshot } from "../lib/control-plane/owner-surface.ts";
import type { ScoutedRecord } from "../lib/control-plane/promotion/types.ts";
import { DECISION_LOG_KEY, SNAPSHOT_ID } from "../lib/control-plane/admin-data.ts";

test("read service distinguishes empty, unavailable and unrecorded without writing", async () => {
  const repos = createMemoryRepositories();
  const empty = await readFleetOperations(repos, { observedAt: FIXTURE_NOW });
  assert.deepEqual(empty.operations, { kind: "HELD", value: [] });
  assert.equal(empty.coverageGaps.kind, "NOT_RECORDED");
  const broken = await readFleetOperations({ ...repos, workerResults: { ...repos.workerResults, readAll: async () => { throw new Error("secret-connection-value"); } } }, { observedAt: FIXTURE_NOW });
  assert.equal(broken.operations.kind, "STORE_UNREACHABLE");
  assert.ok(!JSON.stringify(broken).includes("secret-connection-value"));
  assert.deepEqual(await repos.workItems.list(), []);
  assert.deepEqual(await repos.ownerSnapshots.list(), []);
});

test("legacy registered route never gets worker TERMINAL admission or invented Scout retry", async () => {
  const repos = createMemoryRepositories();
  const item = createWorkItem({ project: "fleet-report-controls", subject: "fixture:legacy", obligation: "Inspect fixture", why: "Path distinction", now: FIXTURE_NOW });
  await registerWorkItem(repos, item, FIXTURE_NOW);
  await registerRouteTask(repos, createRouteTask({ workItemId: item.id, routeId: "fixture-route", routeLabel: "Fixture", target: "https://fixture.example.gov", inherited: true, now: FIXTURE_NOW }), FIXTURE_NOW);
  const result = await readFleetOperations(repos, { observedAt: FIXTURE_NOW });
  assert.equal(result.operations.kind, "HELD");
  if (result.operations.kind !== "HELD") throw new Error("missing report");
  const row = result.operations.value[0];
  assert.equal(row.path, "OTHER_REGISTERED_WORK");
  assert.equal(row.tasks[0].admission, null);
  assert.equal(row.tasks[0].nextAutomaticAction, "UNKNOWN");
  assert.equal(row.lastProgress, null);
  assert.equal(row.spending.usd.total, null);
  assert.equal(row.publication.status, "UNKNOWN");
});

test("committed acquisition stays inventory and parent stage stays open; uncommitted evidence cannot claim acquisition", async () => {
  const h = await autonomousHarness();
  await runAutonomousCoordinator(h.runtime, { maximum: 1, concurrency: 1 });
  const activity = (await readAutonomousActivity(h.repos, undefined, { observedAt: h.now() }))[0];
  const row = projectFleetOperation(activity, h.now());
  assert.equal(row.path, "AUTONOMOUS_PLAN");
  assert.equal(row.stage, "OPEN");
  assert.ok(row.sourceHealth.lastAcquired?.artifactIds.length);
  assert.equal(row.publication.status, "UNKNOWN");
  const result = activity.facts.workers[0];
  const uncommitted = projectAutonomousActivity({ ...activity.facts, attempts: activity.facts.attempts.map(a => a.id === result.attemptId ? { ...a, outcome: null, endedAt: null } : a) }, { observedAt: h.now() })[0];
  const rejected = projectFleetOperation(uncommitted, h.now());
  assert.equal(rejected.sourceHealth.lastAcquired, null);
  assert.ok(rejected.sourceHealth.evidenceGaps.includes(`WORKER_RESULT_UNPROVEN:${result.id}`));
});

test("admission reporting reuses canonical due calculation and preserves missing cost entries", async () => {
  const h = await autonomousHarness();
  const next = await nextAutonomousOperation(h.runtime, h.item.id);
  assert.ok(next.task?.workerTask);
  const observedAt = h.now();
  const row = projectFleetOperation((await readAutonomousActivity(h.repos, undefined, { observedAt }))[0], observedAt);
  const task = row.tasks.find(t => t.taskId === next.task!.id)!;
  assert.equal(task.admission?.state, "DUE");
  assert.equal(task.nextAutomaticAction, "ADMISSION_CHECK");
  assert.ok(row.spending.attemptsWithoutCostEntry.length > 0);
});

test("owner decisions exclude machine blockers, acknowledgements and already answered cards; coverage keeps its original gap", async () => {
  const repos = createMemoryRepositories();
  const card: OwnerDecisionCard = { rowId: "ask", title: "Fixture owner choice", whatIsNeeded: "Choose", whyNoMachineCanDecide: "Owner preference", options: [], blockedDescendants: null, openedOn: null, ageDays: null, priority: "P2", verifiability: "NOT_MACHINE_VERIFIABLE", kind: "DECISION" };
  // Same full, gap-bearing OwnerSnapshot fixture shape used by operator-chat.test.ts.
  const nothing = gap<never>("OURS", "Not measured in this fixture");
  const snapshot: OwnerSnapshot = { formatVersion: 1, publishedAt: FIXTURE_NOW, publishedFromSha: null, publisher: "fixture",
    pilotGreen: null, contracts: [], obligationsByState: [], obligationsByProvider: [], freshnessDebtRows: nothing, incidents: [],
    costByRole: [], costByModel: [], cacheHitRateByCaller: [], deterministicShare: nothing, costPerVerifiedRecord: nothing,
    intakeFolder: nothing, intakeItemsFound: nothing, intakeItemsProcessed: nothing, intakeUnidentifiable: nothing,
    decisionCards: [card, { ...card, rowId: "answered" }, { ...card, rowId: "machine", kind: "BLOCKED_WHILE" }, { ...card, rowId: "read", kind: "ACKNOWLEDGE" }],
    zipRows: gap("OURS", "ZIP attribution was not recorded") };
  await repos.ownerSnapshots.put(SNAPSHOT_ID, snapshot, FIXTURE_NOW);
  await repos.ownerDecisions.append(DECISION_LOG_KEY, "fixture-decision", { formatVersion: 1, intentId: "fixture-decision", subjectId: "answered", chosenOption: "A", consequenceShown: "Fixture", decidedAt: FIXTURE_NOW, state: "RECORDED", canonicalRef: null, refusedReason: null, adminSessionRef: "fixture" }, FIXTURE_NOW);
  const result = await readFleetOperations(repos, { observedAt: FIXTURE_NOW });
  assert.equal(result.ownerDecisions.kind, "HELD");
  if (result.ownerDecisions.kind === "HELD") assert.deepEqual(result.ownerDecisions.value.cards.map(c => c.rowId), ["ask"]);
  if (result.coverageGaps.kind === "HELD") assert.deepEqual(result.coverageGaps.value.zipRows, snapshot.zipRows);
});

test("recorded funnel preserves append order of tied refusal times without claiming publication", async () => {
  const h = await autonomousHarness();
  const seed = (await h.repos.attempts.list())[0].value;
  const scouted: ScoutedRecord = { formatVersion: 1, recordId: "fixture:scouted", itemId: "fixture:publication", at: h.now(),
    actor: { role: "SCOUT", lane: "DETERMINISTIC", instance: seed.worker.instance }, stage: "SCOUTED",
    source: { kind: "SCOUT_RESULT", attemptId: seed.id, obligationId: h.item.id, outcome: "EVIDENCE_FOUND", routeId: "fixture-route" },
    recordClass: "OFFICIAL_ROSTER", subjectId: h.item.subject, canonicalUrl: null, artifactIds: seed.artifactIds,
    scoutAttemptId: seed.id, summary: "Fixture source observation" };
  await h.repos.promotionPipeline.append(scouted.itemId, scouted.recordId, scouted, scouted.at);
  const refusedAt = h.now();
  for (const id of ["fixture:z-refused", "fixture:a-refused"]) {
    await h.repos.promotionPipeline.append(scouted.itemId, id, { formatVersion: 1, recordId: id, itemId: scouted.itemId, at: refusedAt, actor: scouted.actor,
      stage: "REFUSED", atStage: "SCOUTED", reasons: [{ code: "STAGE_ALREADY_REACHED", detail: "Fixture duplicate stage refused" }], offered: scouted }, h.now());
  }
  const report = await readFleetOperations(h.repos, { observedAt: h.now() });
  assert.equal(report.operations.kind, "HELD");
  if (report.operations.kind !== "HELD") return;
  const publication = report.operations.value[0].publication;
  assert.equal(publication.recordedItems[0].stage, "SCOUTED");
  assert.equal(publication.recordedItems[0].refused?.reasons[0].code, "STAGE_ALREADY_REACHED");
  assert.equal(publication.recordedItems[0].refused?.recordId, "fixture:a-refused", "Latest means canonical append order, not lexical ID order");
  assert.equal(publication.recordedItems[0].refusals, 2);
  assert.equal(publication.recordedItemStageCounts.byStage.SCOUTED, 1);
  assert.equal(publication.recordedItemStageCounts.items, 1);
  assert.equal(publication.status, "UNKNOWN");
});

test("an acquisition failure advances activity but not successful evidence progress", async () => {
  const h = await autonomousHarness({ response: { transportError: "fixture socket timeout" } });
  const before = await readFleetOperations(h.repos, { observedAt: h.now() });
  await runAutonomousCoordinator(h.runtime, { maximum: 1, concurrency: 1 });
  const after = await readFleetOperations(h.repos, { observedAt: h.now() });
  assert.equal(before.operations.kind, "HELD");
  assert.equal(after.operations.kind, "HELD");
  if (before.operations.kind !== "HELD" || after.operations.kind !== "HELD") return;
  assert.equal(after.operations.value[0].lastProgress?.id, before.operations.value[0].lastProgress?.id);
  assert.notEqual(after.operations.value[0].lastActivity?.id, before.operations.value[0].lastActivity?.id);
  assert.equal(after.operations.value[0].sourceHealth.lastAcquired, null);
});

test("delivery freshness reuses pulse tolerance and never treats missing or future observations as fresh", () => {
  assert.equal(fleetReadFreshness(FIXTURE_NOW, FIXTURE_NOW), "FRESH");
  assert.equal(fleetReadFreshness(FIXTURE_NOW, new Date(Date.parse(FIXTURE_NOW) + PULSE_STALE_MS).toISOString()), "STALE");
  assert.equal(fleetReadFreshness(null, FIXTURE_NOW), "UNKNOWN");
  assert.equal(fleetReadFreshness("invalid", FIXTURE_NOW), "UNKNOWN");
  assert.equal(fleetReadFreshness(FIXTURE_NOW, "2020-01-01"), "UNKNOWN");
});
