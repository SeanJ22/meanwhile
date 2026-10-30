import assert from "node:assert/strict";
import test from "node:test";
import { HICCUPS_BEFORE_STOPPING, runLegistarMemberWorkers } from "../lib/sources/legistar/members-work.ts";
import type { WorkRow, workList } from "../lib/core/work.ts";

type List = ReturnType<typeof workList>;
const row = { id: "work-1", subjectId: "legistar-members:fixture", value: {} } as unknown as WorkRow;
const listOf = (claims: Array<() => WorkRow[]>, later: () => Promise<void> = async () => {}) => {
  const finished: string[] = [];
  return { finished, list: {
    claim: async () => { const next = claims.shift(); if (!next) return []; return next(); },
    finish: async (claim: WorkRow) => { finished.push(claim.id); return true; },
    renew: async () => true, refuse: async () => true, later,
  } as unknown as List };
};

test("one slow database answer does not end the turn: the slot waits, claims again, and the row is checked", async () => {
  const logged: string[] = [];
  const { list, finished } = listOf([() => { throw new Error("Query read timeout"); }, () => [row]]);
  const stats = await runLegistarMemberWorkers({ list, kind: "check", concurrency: 1, stopRequested: () => finished.length > 0, sleep: async () => {},
    log: line => logged.push(line), run: async () => ({}) });
  assert.deepEqual(finished, ["work-1"]);
  assert.equal(stats.done, 1);
  assert.match(logged.join("\n"), /Query read timeout/);
});

test("a row whose failure cannot be written back does not end the turn either", async () => {
  const { list } = listOf([() => [row]], async () => { throw new Error("Query read timeout"); });
  const stats = await runLegistarMemberWorkers({ list, kind: "check", concurrency: 1, stopRequested: () => false,
    run: async () => { throw new Error("the saved response could not be read"); } });
  assert.equal(stats.failed, 1);
});

test("a database that keeps failing still ends the turn so the runner starts it again", async () => {
  const { list } = listOf(Array.from({ length: HICCUPS_BEFORE_STOPPING + 2 }, () => () => { throw new Error("Query read timeout"); }));
  await assert.rejects(runLegistarMemberWorkers({ list, kind: "check", concurrency: 1, stopRequested: () => false, sleep: async () => {},
    run: async () => ({}) }), /Query read timeout/);
});
