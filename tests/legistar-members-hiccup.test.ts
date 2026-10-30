import assert from "node:assert/strict";
import test from "node:test";
import { HICCUPS_BEFORE_STOPPING, runLegistarMemberWorkers } from "../lib/sources/legistar/members-work.ts";
import type { WorkRow, workList } from "../lib/core/work.ts";

const row = { id: "work-1", subjectId: "legistar-members:fixture", value: {} } as unknown as WorkRow;
const listOf = (claims: Array<() => WorkRow[]>, later: () => Promise<void> = async () => {}) => {
  const finished: string[] = [], released: string[] = [];
  return { finished, released, list: { claim: async () => claims.shift()?.() ?? [], renew: async () => true, refuse: async () => true, later,
    finish: async (claim: WorkRow) => { finished.push(claim.id); return true; }, release: async (claim: WorkRow) => { released.push(claim.id); return true; },
  } as unknown as ReturnType<typeof workList> };
};
const slow = () => { throw new Error("Query read timeout"); };

test("one slow database answer does not end the turn: the slot waits, claims again, and the row is checked", async () => {
  const logged: string[] = [], { list, finished } = listOf([slow, () => [row]]);
  const stats = await runLegistarMemberWorkers({ list, kind: "check", concurrency: 1, stopRequested: () => finished.length > 0, sleep: async () => {}, log: line => logged.push(line), run: async () => ({}) });
  assert.deepEqual([finished, stats.done], [["work-1"], 1]);
  assert.match(logged.join("\n"), /Query read timeout/);
});

test("a row whose failure cannot be written back does not end the turn either", async () => {
  const { list } = listOf([() => [row]], async () => { throw new Error("Query read timeout"); });
  const stats = await runLegistarMemberWorkers({ list, kind: "check", concurrency: 1, stopRequested: () => false, run: async () => { throw new Error("the saved response could not be read"); } });
  assert.equal(stats.failed, 1);
});

test("a database that keeps failing still ends the turn so the runner starts it again", async () => {
  const { list } = listOf(Array.from({ length: HICCUPS_BEFORE_STOPPING + 2 }, () => slow));
  await assert.rejects(runLegistarMemberWorkers({ list, kind: "check", concurrency: 1, stopRequested: () => false, sleep: async () => {}, run: async () => ({}) }), /Query read timeout/);
});

test("a turn whose end arrives mid-batch ends cleanly: unfinished rows go back to waiting, each worked once, none marked failed", async () => {
  const { list, finished, released } = listOf(["a", "b", "c"].map(id => () => [{ ...row, id } as WorkRow]));
  const end = new AbortController(), worked: string[] = [];
  const stats = await runLegistarMemberWorkers({ list, kind: "check", concurrency: 3, turnEnd: end.signal, stopRequested: () => end.signal.aborted,
    run: async claim => { worked.push(claim.id); if (claim.id === "a") return {}; if (worked.length === 3) end.abort(); await new Promise(() => {}); } });
  assert.deepEqual([worked.sort(), finished, released.sort()], [["a", "b", "c"], ["a"], ["b", "c"]]);
  assert.deepEqual([stats.done, stats.released, stats.failed], [1, 2, 0]);
});
