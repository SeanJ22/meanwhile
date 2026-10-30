import assert from "node:assert/strict";
import test, { createMemoryRepositories } from "./helpers/playbooks.ts";
import { PGlite } from "@electric-sql/pglite";
import { hunterLane } from "../lib/control-plane/workers/hunter-lane.ts";
import { capabilityLog } from "../lib/core/capability.ts";
import { hunterClaims } from "../lib/control-plane/workers/hunter-claims.ts";
import type { ArmedHunterLane } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { dispatchAutonomousTask, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { hunterFor } from "../lib/hunt/runtime.ts";
import { HUNT_PACKET_ROUTE_ID } from "../lib/hunt/packet.ts";
import { huntPacketPlan } from "../lib/hunt/packet-plan.ts";
import { recordQuestionWork } from "../lib/ask/question-work.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { MODEL_CHARGES_DDL, MODEL_CHARGE_KIND_DDL, pgSpendRepository } from "../lib/control-plane/repository/model-charges.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";

const division = "ocd-division/country:us/state:az/county:pima";
const failing = "ocd-division/country:us/state:az/county:failing";
const spare = "ocd-division/country:us/state:az/county:spare";

test("the hunter lane works each claimed row once through the daily-pot dispatcher, settles it by what the hunt did, hands back what it never reached, and double-works nothing on its next turn", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const ddl of [...WORK_DDL, ...MODEL_CHARGES_DDL, ...MODEL_CHARGE_KIND_DDL]) await pg.exec(ddl);
  const rows = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const sql: Sql = { query: async (text, params = []) => await rows(text, params) };
  const repos = { ...createMemoryRepositories(), spend: pgSpendRepository(sql) };
  const at = new Date("2026-10-29T12:00:00Z");
  const now = () => at.toISOString();
  const list = workList(rows, { owner: "lane-test", now: () => at });

  // A reader's question, a reader's request, and two tasks a research round planned (one whose provider fails, one that will not be reached).
  await recordQuestionWork({ question: "Who voted for the school budget?", divisions: [division], place: "85701", subjectId: `${division}#board`, runClass: "ORGANIC", now: now() }, list);
  await list.sooner({ placeId: division, subjectId: `${division}#board`, subjectType: "body" });
  const planned = async (subject: string, priority: number) => {
    const work = createWorkItem({ project: "freshness", subject, obligation: `planned ${subject}`, why: "planned by a round", now: now() });
    await registerWorkItem(repos, { ...work, autonomousPlan: huntPacketPlan(subject) }, now());
    const task = createRouteTask({ workItemId: work.id, routeId: HUNT_PACKET_ROUTE_ID, routeLabel: "planned", target: subject, inherited: false, now: now() });
    await registerRouteTask(repos, task, now());
    await list.ensure([{ kind: "hunt", tier: "coverage", state: "AZ", placeId: subject, subjectId: task.id, series: `task:${task.id}`, claimKey: now(), priority,
      value: { routeTaskId: task.id, plain: false }, origin: { from: "planner" }, source: { source: "research round" } }]);
    return task.id;
  };
  const failingTask = await planned(failing, 2);
  const spareTask = await planned(spare, 1);

  const runtime = { repos, now, rollingCeilingUsd: 100, scoutFor: (item: WorkItem, task: RouteTask) => hunterFor({ repos, root: process.cwd(), now,
    tools: { repos, store: new MemoryEvidenceStore(), now, spaceOut: async () => {} },
    readPackets: async ids => new Map(ids.map(id => [id, { governmentId: id, label: "Pima County",
      blanks: [{ subjectId: id, subjectLabel: "County board", checklistId: "GOV-02", family: "GOV", requirement: "Official name" }],
      held: [{ subjectId: id, subjectLabel: "County board", checklistId: "GOV-01", family: "GOV", requirement: "Name", value: "County board", sourceUrl: "https://pima.gov/", checkedAt: now() }] }])),
    transport: async request => {
      if (item.subject === failing) throw new Error("The provider is down");
      return { id: "hunt", model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "finish", name: "finish", input: { summary: "Nothing new yet." } }],
        usage: { input_tokens: 2000, output_tokens: 500 } };
    } }, item, task) } as unknown as AutonomousCoordinatorRuntime;

  const claims = hunterClaims({ list, repos, now, deadEndMs: async () => 5 * 86_400_000, capabilities: capabilityLog(async () => []), deadEndOf: async () => undefined, funded: () => [], due: async () => true, log: () => {} });
  const armed = { closed: null, armedAt: now(), fleetSafety: null, guards: { openJobs: () => [] } as never, arming: null,
    spendHolds: { settle: async () => null } as never, ceilingUsd: 100, discoverySearchOn: false } as ArmedHunterLane;
  let clock = at.getTime();
  const waves: string[][] = [];
  const dispatched: string[] = [];
  const WAVE_CAPACITY = 3;
  const lane = hunterLane({
    clock: () => clock,
    // The guards' five-minute refresh never fires inside this test; every other wait moves the clock.
    sleep: async ms => { if (ms >= 5 * 60_000) return new Promise<void>(() => {}); clock += ms; await new Promise(done => setImmediate(done)); },
    arm: async () => armed,
    selectState: () => claims.select(["az"], false),
    claim: paidOpen => claims.claim(paidOpen),
    endWave: () => claims.endWave(),
    // The worker's loop: take each task in the order handed over, run it through the dispatcher, settle its row. Only so many fit in a wave.
    runWave: async ({ queue }) => {
      waves.push([...queue.taskIds]);
      const results = [];
      for (const id of queue.taskIds.slice(0, WAVE_CAPACITY)) {
        const task = (await repos.routeTasks.mustRead(id)).value;
        const result = await dispatchAutonomousTask(runtime, task);
        dispatched.push(id);
        await claims.settle(result);
        results.push(result);
      }
      return results;
    },
    stopRequested: () => false,
    log: () => {},
    lifeMs: 3 * 60_000,
  });
  const run = await lane.run();

  // Turn one claimed all four rows in tier order, reader's request ahead of Ask, then the planned tasks by priority; turn two took only the one handed back.
  assert.equal(waves.length, 2);
  assert.equal(waves[0]!.length, 4);
  assert.deepEqual(waves[0]!.slice(2), [failingTask, spareTask]);
  assert.deepEqual(waves[1], [spareTask], "the unreached row was handed back untouched and worked on the next turn");
  assert.equal(run.dispatched, 4);

  // Every task was dispatched exactly once, and has exactly one attempt.
  assert.equal(new Set(dispatched).size, 4);
  assert.equal(dispatched.length, 4);
  for (const id of dispatched) assert.equal((await repos.attempts.listWhere(["routeTaskId"], id)).length, 1, id);

  // The hunts that ran are done; the one that failed waits out a back-off and was not tried again.
  const states = await rows("SELECT kind, tier, status, attempts, subject_id, due_at, refusal FROM work ORDER BY kind, priority DESC");
  assert.deepEqual(states.map(row => `${row.kind}:${row.tier}:${row.status}:${row.attempts}`).sort(),
    ["ask:reader:done:1", "hunt:coverage:done:1", "hunt:coverage:waiting:1", "hunt:reader:done:1"]);
  const failed = states.find(row => row.status === "waiting")!;
  assert.ok(new Date(failed.due_at as string).getTime() > at.getTime(), "a failed hunt waits out a back-off");
  assert.match(String(failed.refusal), /./);

  // Each charge says which kind of row its hunt ran from, and all of it is in the one daily pot.
  const charges = await rows("SELECT work_kind, usd FROM cp_model_charges");
  assert.deepEqual([...new Set(charges.map(charge => charge.work_kind))].sort(), [null, "ask", "reader"].sort());
  assert.ok(charges.some(charge => charge.work_kind === "ask") && charges.some(charge => charge.work_kind === "reader"));
});
