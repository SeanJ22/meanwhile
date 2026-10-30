import assert from "node:assert/strict";
import test, { createMemoryRepositories } from "./helpers/playbooks.ts";
import { PGlite } from "@electric-sql/pglite";
import { hunterClaims } from "../lib/control-plane/workers/hunter-claims.ts";
import { hunterFor } from "../lib/hunt/runtime.ts";
import { recordQuestionWork } from "../lib/ask/question-work.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { WORK_COST_KINDS, workCostKindOf } from "../lib/core/work-kinds.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { dispatchAutonomousTask, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { MODEL_CHARGES_DDL, MODEL_CHARGE_KIND_DDL, pgSpendRepository } from "../lib/control-plane/repository/model-charges.ts";
import { readSpendWindow } from "../lib/control-plane/spend-window.ts";
import { readWorkKindSpend } from "../lib/control-plane/admin-view/v6-spend-read.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";

const division = "ocd-division/country:us/state:az/county:pima";

test("a row's kind is Ask question, Reader request, Sean's order or Planner, whichever way the row says it", () => {
  const row = (kind: "ask" | "hunt" | "fact", tier: "clock" | "order" | "reader" | "coverage", origin: Record<string, unknown>) => workCostKindOf({ kind, tier, origin });
  assert.equal(row("ask", "reader", { from: "ask" }), "ask");
  assert.equal(row("hunt", "reader", { from: "demand" }), "reader");
  assert.equal(row("hunt", "order", { from: "order" }), "order");
  assert.equal(row("hunt", "coverage", { from: "planner" }), "planner");
  assert.equal(row("fact", "clock", { from: "loader" }), "planner");
  assert.deepEqual([...WORK_COST_KINDS], ["ask", "reader", "order", "planner"]);
});

test("an Ask question and then a reader's request each hunt on the next tick, every charge carries its row's kind, and Admin sums it today inside the daily pot", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const ddl of [...WORK_DDL, ...MODEL_CHARGES_DDL, ...MODEL_CHARGE_KIND_DDL]) await pg.exec(ddl);
  const rows = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const sql: Sql = { query: async (text, params = []) => await rows(text, params) };
  const repos = { ...createMemoryRepositories(), spend: pgSpendRepository(sql) };
  const now = () => new Date().toISOString();
  const list = workList(rows, { owner: "kind-test" });
  const claims = hunterClaims({ list, repos, now, deadEndMs: async () => 5 * 86_400_000, log: () => {} });

  const hunt = async (item: WorkItem, task: RouteTask, blanks: boolean) => {
    const runtime = { repos, now, rollingCeilingUsd: 100, scoutFor: (found: WorkItem, found_task: RouteTask) => hunterFor({ repos, root: process.cwd(), now,
      tools: { repos, store: new MemoryEvidenceStore(), now, spaceOut: async () => {} },
      readPackets: async () => new Map([[item.subject.split("#")[0]!, { governmentId: item.subject, label: "Pima County",
        blanks: blanks ? [{ subjectId: item.subject, subjectLabel: "County board", checklistId: "GOV-02", family: "GOV", requirement: "Official name" }] : [],
        held: [{ subjectId: item.subject, subjectLabel: "County board", checklistId: "GOV-01", family: "GOV", requirement: "Name", value: "County board",
          sourceUrl: "https://pima.gov/", checkedAt: now() }] }]]),
      transport: async request => ({ id: "hunt", model: request.model, stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "finish", name: "finish", input: { summary: "Nothing new yet." } }],
        usage: { input_tokens: 2000, output_tokens: 500 } }) }, found, found_task) } as unknown as AutonomousCoordinatorRuntime;
    const result = await dispatchAutonomousTask(runtime, task);
    assert.equal(result.outcome, "WORKED", result.detail);
  };
  const newest = async () => {
    const items = (await repos.workItems.list()).map(row => row.value);
    const item = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
    const [task] = (await repos.routeTasks.listWhere(["workItemId"], item.id)).map(row => row.value);
    return { item, task: task! };
  };
  const kinds = async () => (await readWorkKindSpend(sql))!;

  // Tick one: an unanswered Ask question.
  await recordQuestionWork({ question: "Who voted for the school budget?", divisions: [division], place: "85701", subjectId: `${division}#board`,
    runClass: "ORGANIC", now: now() }, list);
  await claims.select(["az"], false);
  assert.equal((await claims.claim(true))?.taskIds.length, 1);
  const ask = await newest();
  assert.equal(ask.item.autonomousPlan?.workKind, "ask");
  await hunt(ask.item, ask.task, false);
  const charges = (await rows("SELECT work_kind, usd FROM cp_model_charges")) as { work_kind: string | null; usd: number }[];
  assert.ok(charges.length > 0 && charges.every(charge => charge.work_kind === "ask"), "every charge the hunt made says Ask question");
  const asked = charges.reduce((sum, charge) => sum + charge.usd, 0);
  assert.ok(asked > 0, "the hunt's model call was priced");
  assert.deepEqual((await kinds()).map(k => [k.label, k.usd]), [["Ask questions", Math.round(asked * 1e4) / 1e4], ["Reader requests", null], ["Your orders", null], ["Planner", null]]);
  const pot = await readSpendWindow(repos, now());
  assert.ok(Math.abs(pot.windowUsd - asked) < 1e-9, "the daily pot's spent total includes the Ask hunt");

  // Tick two: a reader pressed "Want us to get this sooner?" and the next planner pass hunts it.
  await list.sooner({ placeId: division, subjectId: `${division}#board`, subjectType: "body" });
  assert.equal((await claims.claim(true))?.taskIds.length, 1);
  const reader = await newest();
  assert.equal(reader.item.autonomousPlan?.workKind, "reader");
  await hunt(reader.item, reader.task, true);
  const after = await kinds();
  assert.equal(after[0]!.usd, Math.round(asked * 1e4) / 1e4, "the Ask total did not move");
  assert.ok(after[1]!.usd !== null && after[1]!.usd > 0, "the reader request's hunt is Reader requests");
  assert.deepEqual(after.slice(2).map(k => k.usd), [null, null]);
  const total = (await rows("SELECT sum(usd) AS usd FROM cp_model_charges"))[0]!.usd as number;
  assert.ok(Math.abs((await readSpendWindow(repos, now())).windowUsd - total) < 1e-9, "both kinds are in the one daily pot");
});
