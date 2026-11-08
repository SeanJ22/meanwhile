import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { spawn } from "node:child_process";
import { runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";
import { runResearchLoop } from "../lib/control-plane/scheduler/research-loop.ts";
import { PLANNING_STATES, RESEARCH_CYCLE_BUDGET_MS, ROUND_NEW_STATE_CUTOFF_MS, planningStateOrder, roundAllowsNewState, runStatePlanningRound } from "../lib/control-plane/scheduler/state-planning.ts";

const MIN = 60_000;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a planner that answers its supervisor's messages still exits once its work is done: it closes its channel", async () => {
  const planner = "process.on('message', () => {}); setTimeout(() => { process.disconnect(); }, 100);";
  const started = Date.now();
  const child = spawn(process.execPath, ["-e", planner], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const code = await new Promise(resolve => child.once("exit", resolve));
  assert.equal(code, 0);
  assert.ok(Date.now() - started < 5_000, "a ref'd channel with a message listener would hold it open");
  const round = read("../scripts/freshness-shadow.mts");
  assert.match(round, /if \(process\.connected\) process\.disconnect\(\);\nexitAfterDrainGrace\(\{/);
});

test("a research cycle that outlives its budget is ended by the runner even when a grandchild holds its pipes, and recorded with the reason", async () => {
  const hold = "process.getBuiltinModule('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); setInterval(()=>{},1000);";
  const [result] = await runRuntimeChildren([{ id: "research-cycle", executable: process.execPath, args: ["-e", hold] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, deadlineMs: Date.now() + 700 });
  assert.equal(result!.termination, "TIMED_OUT");
  assert.match(result!.errorMessage!, /PASS_TIME_BUDGET: research-cycle reached its lane deadline/);
  assert.match(read("../scripts/pilot-runner.mts"), /deadlineMs: Date\.now\(\) \+ RESEARCH_CYCLE_BUDGET_MS/);
  assert.ok(RESEARCH_CYCLE_BUDGET_MS > ROUND_NEW_STATE_CUTOFF_MS + 30 * MIN, "the hard stop leaves a started state room to finish");
});

test("controlled clock: a round of states that take ~20 min each ends inside its hour, and the next hourly turn starts on time with the states left over first", async () => {
  let clock = Date.parse("2026-11-08T13:04:56.751Z");
  const turnStarts: number[] = [];
  const turnEnds: number[] = [];
  const planned: string[][] = [];
  const done = new Map<string, string | null>();
  const states = PLANNING_STATES;
  const result = await runResearchLoop({
    cycles: 3,
    waitForOwner: async () => ({}),
    releaseExit: async () => null,
    hold: () => null,
    held: async () => undefined,
    recover: async error => { throw error; },
    sleep: async ms => { clock += ms; },
    cycle: async () => {
      const startedAt = new Date(clock).toISOString();
      const startMs = clock;
      turnStarts.push(clock);
      const thisTurn: string[] = [];
      planned.push(thisTurn);
      const round = await runStatePlanningRound(async state => {
        clock += 20 * MIN;
        done.set(state, new Date(clock).toISOString());
        thisTurn.push(state);
        return true;
      }, planningStateOrder(states, done), () => roundAllowsNewState(startedAt, clock));
      turnEnds.push(clock);
      assert.ok(round.deferred.length > 0 && round.failed.length === 0);
      return { ok: true, waitMs: async () => Math.max(0, 60 * MIN - (clock - startMs)) };
    },
  });
  assert.equal(result.cycles, 3);
  assert.ok(roundAllowsNewState("2026-11-08T13:00:00.000Z", Date.parse("2026-11-08T13:29:00.000Z")));
  assert.ok(!roundAllowsNewState("2026-11-08T13:00:00.000Z", Date.parse("2026-11-08T13:30:00.000Z")));
  for (const [i, start] of turnStarts.entries()) assert.equal(start, turnStarts[0]! + i * 60 * MIN, `turn ${i} starts on the hour`);
  turnEnds.forEach((end, i) => assert.ok(end - turnStarts[i]! <= 60 * MIN, `turn ${i} ends inside its hour`));
  const flat = planned.flat();
  assert.equal(new Set(flat).size, flat.length, "no state is planned twice before every state has had a turn");
});
