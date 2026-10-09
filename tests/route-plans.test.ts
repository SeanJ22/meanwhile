import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { openOccurrence, syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { buildRegistry, type ProvidedObligation } from "../lib/control-plane/scheduler/registry.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { isRoutePlan, plannedForHunters, routeWorkPlan } from "../lib/control-plane/workers/route-plan.ts";
import type { FleetRuntime } from "../lib/control-plane/workers/runtime.ts";

const ROOT = join(import.meta.dirname, "..");
const T = "2026-10-06T16:30:00.000Z";
const pass = () => buildRegistry([campaignFinanceProvider()], { root: ROOT, nowIso: T });

test("every paid route carries a plan with the row's own class and subject; plain routes get none", () => {
  const units = pass().units;
  const paid = units.filter(u => u.route.executorClass === "BOUNDED_MODEL_WORKER");
  assert.ok(paid.length > 0, "the provider owes paid work");
  for (const u of paid) {
    const plan = u.obligation.autonomousPlan;
    assert.ok(plan && isRoutePlan(plan), `${u.obligation.id} carries a route plan`);
    assert.equal(plan.contract.recordClass, u.obligation.recordClass, "results stay readable by class");
    assert.equal(plan.contract.subjectId, u.obligation.subjectId, "results stay readable by subject");
    assert.equal(plan.capability, "route-scout:campaign-finance");
    assert.ok(plan.contract.completenessScope.startsWith(u.route.label), "the Scout is briefed from the route");
    assert.equal(plan.publication, undefined, "no reader door is guessed");
  }
  assert.ok(units.filter(u => u.route.executorClass !== "BOUNDED_MODEL_WORKER").every(u => !u.obligation.autonomousPlan));
});

test("no address is invented: a host target is described, an https address is seeded", () => {
  const record: ProvidedObligation = { recordClass: "campaign-finance", subjectId: "nh-sos-cfs-2026", scopeDivisions: ["ocd-division/country:us/state:nh"],
    readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null, routes: [] };
  const host = routeWorkPlan({ providerId: "p", record, route: { routeId: "r1", label: "Detail", executorClass: "BOUNDED_MODEL_WORKER",
    executorReason: "x", open: { kind: "NOT_MACHINE_EXECUTABLE", target: "www.pima.gov", reason: "a host, not an address" }, citation: "c" } })!;
  assert.deepEqual(host.seedUrls, []);
  assert.match(host.contract.completenessScope, /Target: www\.pima\.gov\..*a host, not an address/);
  assert.equal(host.jurisdiction, "NH");
  const url = routeWorkPlan({ providerId: "p", record, route: { routeId: "r2", label: "API", executorClass: "BOUNDED_MODEL_WORKER",
    executorReason: "x", open: { kind: "NOT_MACHINE_EXECUTABLE", target: "https://cfsapi.sos.nh.gov/api/", reason: "unread" }, citation: "c" } })!;
  assert.deepEqual(url.seedUrls, ["https://cfsapi.sos.nh.gov/api/"]);
  const planned = routeWorkPlan({ providerId: "p", record: { ...record, autonomousPlans: { r3: url } }, route: { routeId: "r3", label: "Own",
    executorClass: "BOUNDED_MODEL_WORKER", executorReason: "x", open: { kind: "HTTP_GET", url: "https://example.gov/" }, citation: "c" } });
  assert.equal(planned, null, "a provider's own plan is never replaced");
});

test("route plans and Send plans use the same coordinator", () => {
  const plan = pass().units.find(u => u.obligation.autonomousPlan)!.obligation.autonomousPlan!;
  assert.equal(plannedForHunters(plan), true);
  assert.equal(plannedForHunters({ ...plan, capability: "officials/offices" }), true);
  assert.equal(plannedForHunters(undefined), false);
});

test("an opened paid row is planned work: the coordinator queues its Scout as a worker task", async () => {
  const repos = createMemoryRepositories();
  const unit = pass().units.find(u => u.obligation.autonomousPlan)!;
  const { all } = await syncObligations(repos, [unit.obligation], T);
  const opened = await openOccurrence(repos, { obligation: all[0]!, dueAt: T, now: T });
  const item = await repos.workItems.mustRead(opened!.occurrence.workItemId);
  assert.ok(isRoutePlan(item.value.autonomousPlan));
  let clock = Date.parse(T);
  const runtime = { repos, methodVersion: 56, now: () => new Date(clock += 1000).toISOString() } as unknown as FleetRuntime;
  const planned = await runAutonomousCoordinator(runtime, { planOnly: true });
  const decision = planned.decisions.find(row => row.workItemId === item.id);
  assert.equal(decision?.action, "SCOUT");
  assert.ok(decision?.task, "the queued task exists for the hunter lane to claim");

});
