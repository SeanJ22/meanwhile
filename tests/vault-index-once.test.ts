import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { observeCyclePhases } from "../lib/control-plane/scheduler/cycle-phases.ts";

test("a noted step is timed in the phases without moving the phase clock", () => {
  let clock = 0;
  const observed = observeCyclePhases({} as never, () => clock);
  clock = 100;
  observed.note("vault-index", 40);
  clock = 250;
  const phase = observed.finish("dispatch");
  assert.deepEqual(observed.phases.map(p => [p.name, p.durationMs]), [["vault-index", 40], ["dispatch", 250]]);
  assert.equal(phase.durationMs, 250);
});

test("the round lists the vault once; every later pass shares that index", () => {
  const source = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.equal(source.match(/\bindexVault\(/g)?.length, 1);
  assert.match(source, /cycleObservation\.note\("vault-index"/);
});
