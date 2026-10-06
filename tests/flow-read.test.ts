import assert from "node:assert/strict";
import test from "node:test";
import { projectFlow, readFlow, type FlowRows } from "../lib/control-plane/admin-view/flow-read.ts";
import { recordPublicationFlow, PUBLICATION_FLOW_LOG_KEY } from "../lib/civic-data/publication-flow.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
const hour = "2026-10-05T12:00:00.000Z", through = "2026-10-05T13:00:00.000Z";
const stages: FlowRows["stages"] = [
  { hour, stage: "findings", count: 8 }, { hour, stage: "builtFindings", count: 6 },
  { hour, stage: "checkedRecords", count: 4 }, { hour, stage: "liveRecords", count: 2 },
];
test("a stopped stage changes that stage's hourly count, not earlier observations", () => {
  const normal = projectFlow({ stages, spend: [{ hour, usd: 1, unpriced: 0 }] }, hour, through);
  const stopped = projectFlow({ stages: stages.filter(row => row.stage !== "liveRecords"), spend: [{ hour, usd: 1, unpriced: 0 }] }, hour, through);
  assert.equal(normal.factsLivePerHour, 2);
  assert.equal(normal.costPerFactUsd, 0.5);
  assert.deepEqual({ ...stopped.hours[0], liveRecords: 2 }, normal.hours[0]);
  assert.equal(stopped.costPerFactUsd, null, "no facts is not free facts");
  assert.equal(projectFlow({ stages, spend: [{ hour, usd: 1, unpriced: 1 }] }, hour, through).settledSpendUsd, null);
});
test("deployment boundary clips an uninstrumented hour; a failed read never turns into zeros", async () => {
  const calls: unknown[][] = [];
  const control = { query: async (_sql: string, args?: readonly unknown[]) => { calls.push([...args ?? []]); return []; } };
  const value = await readFlow({ control, from: hour, through, recordingSince: "2026-10-05T12:30:00Z" });
  assert.equal(value.from, "2026-10-05T12:30:00.000Z");
  assert.equal(calls.length, 3);
  assert.ok(calls.every(args => args[0] === value.from && args[1] === through));
  await assert.rejects(readFlow({ control: { query: async () => { throw Error("unavailable"); } }, from: hour, through, recordingSince: hour }), /unavailable/);
});
test("publication stage observations deduplicate restarts and shared Sends without changing fact authority", async () => {
  const repos = createMemoryRepositories();
  const checked = { workerResultId: "result", stage: "CHECKED" as const, records: 4, changedRecords: 2, versionId: null };
  await recordPublicationFlow(repos, "candidate", checked, hour);
  await recordPublicationFlow(repos, "candidate", checked, through);
  assert.equal((await repos.ownerDigests.read(PUBLICATION_FLOW_LOG_KEY)).length, 1);
  await Promise.all([recordPublicationFlow(repos, "candidate", { ...checked, stage: "LIVE", versionId: "candidate" }, hour),
    recordPublicationFlow(repos, "candidate", { ...checked, stage: "LIVE", versionId: "candidate" }, through)]);
  assert.equal((await repos.ownerDigests.read(PUBLICATION_FLOW_LOG_KEY)).length, 2);
  await assert.rejects(recordPublicationFlow(repos, "missing", { ...checked, stage: "LIVE" }, hour), /INVALID/);
});


test("the authoritative week uses Eastern yesterday without overlapping the prior day on a clock change", async () => {
  const {readFlowWeek} = await import("../lib/control-plane/admin-view/flow-read.ts");
  const {yesterdayWindow} = await import("../lib/control-plane/admin-view/cost-reporting-view.ts");
  for (const [at,hours] of [["2026-03-09T12:00:00Z",23],["2026-11-02T12:00:00Z",25]] as const) {
    const window = yesterdayWindow(at);
    const calls:unknown[][]=[];
    const sql=Object.assign(async()=>[],{query:async(...args:unknown[])=>{calls.push(args);return String(args[0]).includes("min(recorded_at)")?[{since:"2026-01-01T00:00:00Z"}]:[];}});
    const week = await readFlowWeek({control:sql as never,through:window.through,lastDay:window});
    assert.equal(week?.days.at(-1)?.from,window.from);
    assert.equal(week?.days.at(-1)?.through,window.through);
    assert.equal(week?.days.at(-1)?.read?.hours.length,hours);
    for(let i=1;i<7;i++)assert.equal(week!.days[i-1].through,week!.days[i].from);
    assert.equal(calls.length,22,"same bounded reads; no second source for the spend topic");
  }
});
