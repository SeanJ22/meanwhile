/**
 * CH-22: local-jurisdiction rows that reach the paid model path get the work plan a Send's do, with its
 * reader door, so their findings go through the coordinator and the builders instead of staying staged.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { installOperationalReferenceBundle, operationalReferenceBundle } from "../lib/civic-data/operational-references.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { openOccurrence, syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { UNREAD_MEETING_PARTITIONS, type MeetingPartitionOwnership } from "../lib/control-plane/scheduler/provider-inputs.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import type { FleetRuntime } from "../lib/control-plane/workers/runtime.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";

const ROOT = join(import.meta.dirname, "..");
const T = "2026-10-06T14:00:00.000Z";
const registry = (state: string) => JSON.parse(readFileSync(join(ROOT, `data/states/${state}/jurisdictions/${state}.json`), "utf8")) as JurisdictionRegistry;
installOperationalReferenceBundle(operationalReferenceBundle({ az: registry("az"), nh: registry("nh"), nj: registry("nj") }));

const joined: MeetingPartitionOwnership = { ...UNREAD_MEETING_PARTITIONS, bodyIdFor: (id) => `${id}#governing-body` };
const registryFor = (meetingPartitions: MeetingPartitionOwnership) => buildRegistry([localJurisdictionsProvider({
  trackedStates: { read: () => ({ states: ["az"], source: "test" }) }, meetingPartitions })], { root: ROOT, nowIso: T });

test("every tracked government's paid row carries a work plan; a joined body gives it a reader door", () => {
  const pass = registryFor(joined);
  const paid = pass.units.filter((u) => u.route.executorClass === "BOUNDED_MODEL_WORKER");
  assert.ok(paid.length > 100, "Arizona's tracked governments owe paid discovery");
  assert.ok(paid.every((u) => u.obligation.autonomousPlan), "no paid local row is left without a plan");
  const doors = paid.filter((u) => u.obligation.autonomousPlan?.publication);
  assert.equal(doors.length, paid.length, "with the body joined, each plan publishes through a door");
  const contest = paid.find((u) => u.obligation.autonomousPlan?.contract.recordClass === "BALLOT_CONTEST")!;
  assert.deepEqual(contest.obligation.autonomousPlan?.publication, { contractId: "ballot-contests", bodyId: `${contest.obligation.subjectId}#governing-body` });
  assert.equal(contest.obligation.autonomousPlan?.contract.subjectId, contest.obligation.subjectId);
  assert.ok(pass.units.filter((u) => u.route.executorClass === "DETERMINISTIC").every((u) => !u.obligation.autonomousPlan),
    "a deterministic route is not paid work and gets no plan");
  const unjoined = registryFor(UNREAD_MEETING_PARTITIONS).units.filter((u) => u.route.executorClass === "BOUNDED_MODEL_WORKER");
  assert.ok(unjoined.every((u) => u.obligation.autonomousPlan && !u.obligation.autonomousPlan.publication),
    "with no body joined the plan still routes findings to builders, and the door waits on the join");
});

test("a plan reaches a row registered before it, once, and never replaces a plan the row already holds", async () => {
  const repos = createMemoryRepositories();
  const unit = registryFor(joined).units.find((u) => u.route.executorClass === "BOUNDED_MODEL_WORKER")!;
  const { autonomousPlan: plan, ...bare } = unit.obligation;
  await syncObligations(repos, [bare], T);
  assert.equal((await repos.obligations.mustRead(bare.id)).value.autonomousPlan, undefined);

  const attached = await syncObligations(repos, [unit.obligation], "2026-10-06T14:05:00.000Z");
  assert.deepEqual(attached.refreshed, [{ id: bare.id, changed: ["autonomousPlan"] }]);
  assert.deepEqual((await repos.obligations.mustRead(bare.id)).value.autonomousPlan, plan);
  assert.deepEqual((await syncObligations(repos, [unit.obligation], "2026-10-06T14:10:00.000Z")).refreshed, [], "an idle pass writes nothing");

  const held = await repos.obligations.mustRead(bare.id);
  const repaired = { ...plan!, seedUrls: ["https://repaired.example.gov/"] };
  await repos.obligations.compareAndSet(held.id, held.revision, { ...held.value, autonomousPlan: repaired }, T);
  await syncObligations(repos, [unit.obligation], "2026-10-06T14:15:00.000Z");
  assert.deepEqual((await repos.obligations.mustRead(bare.id)).value.autonomousPlan, repaired, "the held plan with its repair stays");
});

test("an opened local row is planned work: the coordinator queues its Scout for the hunter lane", async () => {
  const repos = createMemoryRepositories();
  const unit = registryFor(joined).units.find((u) => u.obligation.autonomousPlan?.contract.recordClass === "BALLOT_CONTEST")!;
  const { all } = await syncObligations(repos, [unit.obligation], T);
  const opened = await openOccurrence(repos, { obligation: all[0]!, dueAt: T, now: T });
  const item = await repos.workItems.mustRead(opened!.occurrence.workItemId);
  assert.equal(item.value.autonomousPlan?.publication?.contractId, "ballot-contests");

  let clock = Date.parse(T);
  const runtime = { repos, methodVersion: 56, now: () => new Date(clock += 1000).toISOString() } as unknown as FleetRuntime;
  const planned = await runAutonomousCoordinator(runtime, { planOnly: true });
  const decision = planned.decisions.find((row) => row.workItemId === item.id);
  assert.equal(decision?.action, "SCOUT", "the local row's first Scout is a queued worker task, not a round-only Scout");
  assert.ok(decision?.task, "the queued task exists for the lane to claim");
});

test("with paid work in the hunter lane the round opens a due planned row instead of only deferring it", () => {
  const round = readFileSync(join(ROOT, "scripts/freshness-shadow.mts"), "utf8");
  assert.match(round, /const queuesForHunterLane = laneClosure !== null && CONTINUOUS_HUNTERS &&\s+modelLaneClosure\(\{ \.\.\.laneClosureInput, paidWorkInHunterLane: false \}\) === null;/,
    "only the hunter-lane closure queues; a pause, hold or unread control still holds the row");
  assert.match(round, /if \(queuesForHunterLane && row\.obligation\.autonomousPlan && await openOccurrenceInStep\(row\) === true\) \{\s+return \{ admit: false, code: "QUEUED_FOR_HUNTER_LANE"/);
  assert.match(round, /local research rows: \$\{local\.length\} paid; \$\{planned\.length\} carry a work plan/);
});
