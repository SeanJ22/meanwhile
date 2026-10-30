import assert from "node:assert/strict";
import test, { createMemoryRepositories } from "./helpers/playbooks.ts";
import { PGlite } from "@electric-sql/pglite";
import { capabilityLog } from "../lib/core/capability.ts";
import { hunterClaims } from "../lib/control-plane/workers/hunter-claims.ts";
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
const claimsOf = (list: ReturnType<typeof workList>, repos: ReturnType<typeof createMemoryRepositories>) =>
  hunterClaims({ list, repos, now: () => now, deadEndMs: async () => 5 * 86_400_000, capabilities: capabilityLog(async () => []), deadEndOf: async () => undefined, due: async () => true, log: () => {} });

test("an unanswered Ask question is handed to the hunter, reaches it with held place facts, and appears in the daily brief", async t => {
  const repos = createMemoryRepositories();
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const ddl of WORK_DDL) await pg.exec(ddl);
  const list = workList(async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows, { owner: "ask-test", now: () => new Date(now) });
  await recordQuestionWork({ question: "Who voted for the school budget?", divisions: [division],
    place: "85701", subjectId: `${division}#board`, runClass: "ORGANIC", now }, list);
  assert.equal((await repos.workItems.list()).length, 0, "the question waits as a row until a hunter's planner takes it");
  const claims = claimsOf(list, repos);
  await claims.select(["az"], false);
  assert.equal((await claims.claim(true))?.taskIds.length, 1);
  assert.equal(await claims.claim(true), null, "a question is claimed once");
  assert.deepEqual((await pg.query("SELECT status FROM work")).rows, [{ status: "taken" }], "the row stays the hunters' until the hunt is done");
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
  const claims = claimsOf(list, createMemoryRepositories());
  await claims.select(["az"], false);
  await claims.claim(true);
  assert.deepEqual(await unhandedQuestionRows({ query: rows }), [], "once a hunter has claimed it, their hunt carries it");
});

test("a claimed row is finished by what its hunt did: done when it ran, waiting again when it did not, handed back when never reached", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const ddl of WORK_DDL) await pg.exec(ddl);
  const rows = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const list = workList(rows, { owner: "claims-test", now: () => new Date(now) });
  const repos = createMemoryRepositories();
  for (const question of ["First question?", "Second question?", "Third question?"]) {
    await recordQuestionWork({ question, divisions: [division], place: "85701", subjectId: `${division}#board`, runClass: "ORGANIC", now: `${now}-${question}` }, list);
  }
  const claims = claimsOf(list, repos);
  await claims.select(["az"], false);
  const queue = (await claims.claim(true))!;
  assert.equal(queue.taskIds.length, 3);
  const result = (routeTaskId: string, outcome: "WORKED" | "FAILED") => ({ obligationId: routeTaskId, routeTaskId, outcome, detail: "ran" }) as never;
  await claims.settle(result(queue.taskIds[0]!, "WORKED"));
  await claims.settle(result(queue.taskIds[1]!, "FAILED"));
  await claims.endWave();
  const statuses = (await rows("SELECT status, attempts FROM work ORDER BY status, attempts")).map(row => `${row.status}:${row.attempts}`);
  assert.deepEqual(statuses, ["done:1", "waiting:0", "waiting:1"], "the third was never reached and is as if untouched; the failed one waits out its back-off");
});
