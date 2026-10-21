import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { memoryReading } from "../lib/control-plane/workers/worker-slots.ts";

const mib = 1024 ** 2;

test("the real planner memory hold follows its state measurements and releases on a crash", async () => {
  const source = readFileSync("scripts/freshness-shadow.mts", "utf8");
  const block = source.slice(source.indexOf("const plannerMemoryHost ="), source.indexOf("const hostWorkerSlots ="));
  assert.ok(block.length > 0);
  assert.doesNotMatch(source, /RESEARCH_PARENT_PEAK_MIB|withReaderRoute|withReaderSelection/);
  let peak = 427 * mib;
  const state = { parents: [{ pid: 925313, peak: 2928 * mib, entry: "freshness-shadow.mts:il" }],
    reservations: [], peaks: { "freshness-shadow.mts:nh": [1200 * mib] } as Record<string, number[]> };
  let exit: (code: number) => void = () => { throw new Error("no exit handler"); };
  let sample: () => void = () => { throw new Error("no sampler"); };
  const context = createContext({ PLANNING_STATE: "il", argv: [], console,
    workerMemoryHost: () => ({ transact: (operation: (held: typeof state) => void) => { operation(state); return true; } }),
    setInterval: (callback: () => void) => { sample = callback; return { unref() {} }; }, clearInterval: () => {},
    process: { pid: 925313, resourceUsage: () => ({ maxRSS: peak / 1024 }),
      on: (event: string, callback: typeof exit) => { assert.equal(event, "exit"); exit = callback; } },
  });
  await runInContext(`(async () => { ${block} })()`, context);
  assert.equal(state.parents[0].peak, 449 * mib, "no whole-research reservation or another state's measurement");
  peak = 650 * mib;
  sample();
  assert.equal(state.parents[0].peak, 683 * mib);
  exit(1);
  assert.equal(state.parents.length, 0);
  assert.equal(state.peaks["freshness-shadow.mts:il"], undefined, "a startup crash cannot replace a completed planning measurement");

  await runInContext(`(async () => { ${block} })()`, context);
  exit(0);
  assert.deepEqual([...state.peaks["freshness-shadow.mts:il"]], [650 * mib]);
  peak = 300 * mib;
  await runInContext(`(async () => { ${block} })()`, context);
  assert.equal(state.parents[0].peak, 683 * mib, "the same state's completed peak covers future growth");
  exit(0);
});

test("measured planner memory admits workers at the unchanged 0.75 GiB margin", () => {
  const input = { at: "2026-10-20T23:09:49Z", totalBytes: 8326938624, availableBytes: 5717168128, rootPid: 876022,
    rows: [{ pid: 876022, parentPid: 0, rss: 230027264 }, { pid: 923370, parentPid: 876022, rss: 374734848 },
      { pid: 924070, parentPid: 876022, rss: 281899008 }, { pid: 925313, parentPid: 924070, rss: 447660032 },
      { pid: 100, parentPid: 876022, rss: 149188608 }, { pid: 101, parentPid: 876022, rss: 296165376 }] };
  const state = { parents: [{ pid: 925313, peak: 3070230528 }],
    reservations: [{ pid: 100, entry: "ingest.ts", peak: 390070272 }, { pid: 101, entry: "platform-census-runner.mts", peak: 328204288 }] };
  const before = memoryReading({ ...input, state });
  const measured = memoryReading({ ...input, state: { ...state, parents: [{ pid: 925313, peak: 449 * mib }] } });
  assert.equal(before.fitLeaseWorkers, 5);
  assert.ok(measured.fitLeaseWorkers > before.fitLeaseWorkers);
  assert.equal(measured.headroomBytes, 768 * mib);
  console.log(`RN-02 production-snapshot replay: ${before.fitLeaseWorkers} -> ${measured.fitLeaseWorkers} lease workers at 768 MiB margin; actual host must be read separately.`);
});
