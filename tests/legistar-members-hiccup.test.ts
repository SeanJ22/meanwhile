import assert from "node:assert/strict";
import test from "node:test";
import { progressLines } from "../lib/control-plane/scheduler/round-progress.ts";
import { laneTurn } from "../lib/ops/lane-turn.ts";
import { HICCUPS_BEFORE_STOPPING, newMemberStats, runLegistarMemberWorkers } from "../lib/sources/legistar/members-work.ts";
import { RUNTIME_NO_PROGRESS_MS } from "../scripts/pilot-runtime-child.mts";
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

test("a release drain lets the row in hand finish, claims nothing more, and the minute line has moved on", async () => {
  const { list, finished, released } = listOf(["a", "b"].map(id => () => [{ ...row, id } as WorkRow])), stats = newMemberStats();
  const turn = laneTurn(() => `m ${stats.claimed} ${stats.done}`), lines: string[] = [];
  turn.beat(line => lines.push(line));
  await runLegistarMemberWorkers({ list, kind: "check", concurrency: 1, stats, stopRequested: turn.asked, run: async () => { turn.ask(); return {}; } });
  turn.beat(line => lines.push(line));
  assert.deepEqual([finished, released, stats.done, stats.failed], [["a"], [], 1, 0]);
  assert.ok(lines[0] !== lines[1] && progressLines()(`${lines[1]}\n`) === 1);
});

test("an idle lane ends its turn itself before the runner's limit, and a lane holding a row with no progress is left to the runner", async () => {
  let at = 0;
  const minute = (turn: ReturnType<typeof laneTurn>) => { at += 60_000; turn.beat(() => {}); };
  const idleStats = newMemberStats(), counted = progressLines();
  counted("m 0\n");
  const idle = laneTurn(() => { const line = `m ${idleStats.claimed}`; assert.equal(counted(`${line}\n`), 0, "an unchanged line is not progress"); return line; }, () => at);
  await runLegistarMemberWorkers({ list: listOf([]).list, kind: "check", concurrency: 2, stats: idleStats, stopRequested: idle.stop, sleep: async () => minute(idle), run: async () => ({}) });
  assert.ok(at > 0 && at < RUNTIME_NO_PROGRESS_MS, `the turn ended on its own after ${at}ms`);

  at = 0;
  const stuckStats = newMemberStats(), stuck = laneTurn(() => `m ${stuckStats.claimed}`, () => at), end = new AbortController();
  let ended = false;
  const pool = runLegistarMemberWorkers({ list: listOf([() => [row]]).list, kind: "check", concurrency: 1, stats: stuckStats, stopRequested: stuck.stop, turnEnd: end.signal,
    run: () => new Promise(() => {}) }).finally(() => { ended = true; });
  await new Promise(done => setTimeout(done, 20));
  for (let n = 0; n < 8; n++) minute(stuck);
  assert.deepEqual([stuckStats.claimed, ended], [1, false], "it holds the row and does not end itself; the runner's limit ends it");
  end.abort();
  await pool;
});
