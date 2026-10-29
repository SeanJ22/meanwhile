import assert from "node:assert/strict";
import test, { createMemoryRepositories } from "./helpers/playbooks.ts";
import { PGlite } from "@electric-sql/pglite";
import { openQuestionHunts } from "../lib/ask/question-hunt.ts";
import { recordQuestionWork } from "../lib/ask/question-work.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { nextAutonomousOperation, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { readerQuestionRows, projectBrief, unhandedQuestionRows } from "../lib/control-plane/admin-view/brief.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import { hunterFor } from "../lib/hunt/runtime.ts";

const now = "2026-10-18T00:00:00Z";
const division = "ocd-division/country:us/state:az/county:pima";

test("an unanswered Ask question is handed to the hunter, reaches it with held place facts, and appears in the daily brief", async t => {
  const repos = createMemoryRepositories();
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const ddl of WORK_DDL) await pg.exec(ddl);
  const list = workList(async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows, { owner: "ask-test", now: () => new Date(now) });
  await recordQuestionWork({ question: "Who voted for the school budget?", divisions: [division],
    place: "85701", subjectId: `${division}#board`, runClass: "ORGANIC", now }, list);
  assert.equal((await repos.workItems.list()).length, 0, "the question waits as a row until a hunter's planner takes it");
  assert.equal(await openQuestionHunts({ list, repos, now }), 1);
  assert.equal(await openQuestionHunts({ list, repos, now }), 0, "a question is handed over once");
  assert.deepEqual((await pg.query("SELECT status FROM work")).rows, [{ status: "done" }]);
  const item = (await repos.workItems.list())[0]!.value;
  const decision = await nextAutonomousOperation({ repos, now: () => now } as AutonomousCoordinatorRuntime, item.id);
  assert.equal(decision.action, "SCOUT");
  assert.ok(decision.task);
  const messages: string[] = [];
  const executor = await hunterFor({ repos, root: process.cwd(), now: () => now,
    tools: { repos, store: new MemoryEvidenceStore(), now: () => now, spaceOut: async () => {} },
    readPackets: async ids => {
      assert.deepEqual(ids, [division]);
      return new Map([[division, { governmentId: division, label: "Pima County", blanks: [],
        held: [{ subjectId: item.subject, subjectLabel: "County board", checklistId: "GOV-02", family: "GOV",
          requirement: "Official name", value: "County board", sourceUrl: "https://pima.gov/", checkedAt: now }] }]]);
    },
    transport: async request => {
      messages.push(JSON.stringify(request.messages));
      return { id: "answer-hunt", model: request.model, stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "finish", name: "finish", input: { summary: "The requested vote still needs a source." } }],
        usage: { input_tokens: 20, output_tokens: 10 } };
    },
  }, item, decision.task);
  const scheduled = scheduleObligation({ id: item.id, recordClass: "HUNT_PACKET", subjectId: item.subject,
    routeId: decision.task.routeId, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, Date.parse(now));
  assert.ok(isScheduled(scheduled));
  const outcome = await executor.run({ obligation: scheduled, routeTaskId: decision.task.id, workItemId: item.id,
    attemptId: "question-hunt", executor: "BOUNDED_MODEL_WORKER", bound: { maxAttempts: 1, maxWallMs: 0 }, holder: "test" });
  assert.equal(outcome.kind, "DISPOSED", outcome.detail);
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /Who voted for the school budget/);
  assert.match(messages[0]!, /WHAT WE ALREADY HOLD/);
  const brief = projectBrief(defaultAdminConfig(now), await readerQuestionRows(repos), now);
  assert.equal(brief.problems.length, 1);
  assert.match(brief.problems[0]!.what, /85701.*Who voted/);
  assert.equal(brief.alerts.length, 0);
  assert.equal((await repos.workItems.mustRead(item.id)).value.state, "OPEN", "a finished hunt is not proof that its answer was published");
});

test("a question waiting in the work list is already owed in the daily brief", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const ddl of WORK_DDL) await pg.exec(ddl);
  const rows = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const list = workList(rows, { owner: "ask-test", now: () => new Date(now) });
  await recordQuestionWork({ question: "Who voted for the school budget?", divisions: [division], place: "85701", subjectId: `${division}#board`, runClass: "ORGANIC", now }, list);
  const waiting = await unhandedQuestionRows({ query: rows });
  assert.equal(waiting.length, 1);
  assert.match(waiting[0]!.what, /85701.*Who voted/);
  await openQuestionHunts({ list, repos: createMemoryRepositories(), now });
  assert.deepEqual(await unhandedQuestionRows({ query: rows }), [], "once handed to the hunters, their queue carries it");
});
