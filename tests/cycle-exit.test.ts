/**
 * A finished research cycle exits; the drain grace never keeps the process alive itself, names what does, and exits
 * with the cycle's own code once the grace ends.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  CYCLE_DRAIN_GRACE_MS,
  chosenExitCode,
  describeActiveResources,
  exitAfterDrainGrace,
} from "../lib/control-plane/scheduler/cycle-exit.ts";

function fakeTimer() {
  const armed: { fn: (() => void) | null; ms: number | null; unrefed: boolean } = { fn: null, ms: null, unrefed: false };
  const setTimer = (fn: () => void, ms: number) => {
    armed.fn = fn;
    armed.ms = ms;
    return { unref: () => { armed.unrefed = true; } };
  };
  return { armed, setTimer };
}

test("the grace timer is unref'd, so a drained loop still exits the moment it drains", () => {
  const { armed, setTimer } = fakeTimer();
  const exits: number[] = [];
  exitAfterDrainGrace({
    graceMs: CYCLE_DRAIN_GRACE_MS,
    finishedAt: "2026-09-24T07:59:02.762Z",
    exitCode: () => 0,
    activeResources: () => [],
    log: () => undefined,
    exit: (code) => exits.push(code),
    setTimer,
  });
  assert.equal(armed.unrefed, true, "a ref'd grace timer would itself hold the process open for the grace");
  assert.equal(armed.ms, CYCLE_DRAIN_GRACE_MS);
  assert.deepEqual(exits, [], "nothing exits before the grace ends");
});

test("a process still alive after the grace names what holds it open and exits with the cycle's own code", () => {
  const { armed, setTimer } = fakeTimer();
  const lines: string[] = [];
  const exits: number[] = [];
  exitAfterDrainGrace({
    graceMs: 15_000,
    finishedAt: "2026-09-24T07:59:02.762Z",
    exitCode: () => 0,
    activeResources: () => ["TCPSocketWrap", "Timeout", "TCPSocketWrap", "FSReqCallback"],
    log: (line) => lines.push(line),
    exit: (code) => exits.push(code),
    setTimer,
  });
  armed.fn?.();
  assert.deepEqual(exits, [0], "a cycle that recorded SUCCEEDED exits 0, never the wall's SIGTERM");
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /finished at 2026-09-24T07:59:02\.762Z/);
  assert.match(lines[0]!, /15 s later the process was still alive/);
  assert.match(lines[0]!, /held open by: TCPSocketWrap x2, FSReqCallback x1, Timeout x1/);
  assert.match(lines[0]!, /the recorded outcome stands/);
});

test("the exit code is the one the cycle chose when the grace ends, not when it was armed", () => {
  const { armed, setTimer } = fakeTimer();
  let code = 0;
  const exits: number[] = [];
  exitAfterDrainGrace({
    graceMs: 1_000,
    finishedAt: "2026-09-24T08:00:00.000Z",
    exitCode: () => code,
    activeResources: () => ["Timeout"],
    log: () => undefined,
    exit: (c) => exits.push(c),
    setTimer,
  });
  code = 1;
  armed.fn?.();
  assert.deepEqual(exits, [1]);
});

test("resource names are counted types only, and an empty list says so", () => {
  assert.equal(describeActiveResources([]), "nothing the runtime reports");
  assert.equal(describeActiveResources(["Timeout", "Immediate", "Timeout"]), "Timeout x2, Immediate x1");
});

test("the exit code reads Node's own process.exitCode shapes", () => {
  assert.equal(chosenExitCode(undefined), 0);
  assert.equal(chosenExitCode(null), 0);
  assert.equal(chosenExitCode(0), 0);
  assert.equal(chosenExitCode(3), 3);
  assert.equal(chosenExitCode("2"), 2);
  assert.equal(chosenExitCode("not-a-code"), 0);
});

test("the research cycle arms the grace as its last statement, after the stall worker stops", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "freshness-shadow.mts"), "utf8");
  const stopAt = source.lastIndexOf("await (stallDiagnostic as CycleStallDiagnostic | null)?.stop();");
  const digestAt = source.indexOf('await finalStep("digest:append"');
  assert.ok(digestAt >= 0 && stopAt > digestAt,
    "the stall worker stops after the canonical cycle outcome is written");
  const tail = source.slice(stopAt);
  assert.match(tail, /await \(stallDiagnostic as CycleStallDiagnostic \| null\)\?\.stop\(\);[\s\S]*exitAfterDrainGrace\(\{/);
  assert.match(tail, /await runAdminEvidenceMirror\(/,
    "the optional mirror remains a final step before exit grace");
  assert.doesNotMatch(tail, /runBoundedStep|withinWallTime/, "finalization has no cycle wall");
  assert.match(tail, /activeResources: \(\) => process\.getActiveResourcesInfo\(\)/);
  assert.match(tail, /exitCode: \(\) => chosenExitCode\(process\.exitCode\)/);
  assert.ok(source.trimEnd().endsWith("});"), "nothing may run after the grace is armed");
});
