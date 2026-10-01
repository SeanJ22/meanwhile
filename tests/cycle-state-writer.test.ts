import assert from "node:assert/strict";
import test from "node:test";
import { cycleStateWriter } from "../lib/control-plane/scheduler/cycle-state-writer.ts";

test("overlapping worker starts share publication and final state follows the live write", async () => {
  let release!: () => void;
  let announce!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let active = 0, maximum = 0;
  const snapshots: (string | null)[] = [];
  const write = cycleStateWriter(async finished => {
    maximum = Math.max(maximum, ++active);
    snapshots.push(finished);
    if (snapshots.length === 1) { announce(); await held; }
    active--;
  });
  const first = write(null);
  await started;
  const starts = Array.from({ length: 20 }, () => write(null));
  const final = write("2026-09-30T20:30:00Z");
  release();
  await Promise.all([first, ...starts, final]);
  assert.equal(maximum, 1);
  assert.deepEqual(snapshots, [null, "2026-09-30T20:30:00Z"]);
});
