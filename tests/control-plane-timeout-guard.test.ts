import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

const args = ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e"];
const run = (reason: string) => spawnSync(process.execPath, [...args, `
  import { keepRunningThroughControlPlaneTimeouts } from './lib/ops/control-plane-timeout-guard.ts';
  import { ControlPlaneRequestTimeout } from './lib/control-plane/repository/request-bounds.ts';
  keepRunningThroughControlPlaneTimeouts();
  void Promise.reject(${reason});
  setTimeout(() => console.log('STILL_RUNNING'), 50);
`], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 });

test("a control-plane read that did not answer in time ends its pass, never the runner", () => {
  const result = run(`new ControlPlaneRequestTimeout({ operation: "cp_hunt_orders.researchStopControls", callClass: "POINT", timeoutMs: 10000, kind: "REQUEST", budget: null })`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /STILL_RUNNING/);
  assert.match(result.stderr, /cp_hunt_orders\.researchStopControls \(POINT\) did not settle within its 10000 ms request bound; this pass ended and the next tick retries/);
});

test("any other unhandled rejection still ends the process", () => {
  const result = run(`new Error("something else broke")`);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /STILL_RUNNING/);
  assert.match(result.stderr, /something else broke/);
});
