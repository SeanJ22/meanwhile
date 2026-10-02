import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
const { stripTypeScriptTypes } = nodeModule as typeof nodeModule & {
  stripTypeScriptTypes(source: string): string;
};

function nextWait(overrides: Record<string, unknown> = {}): (ok: boolean) => Promise<number> {
  const wait = source.match(/async function nextCycleWaitMs\(cycleOk: boolean\): Promise<number> \{[\s\S]*?\n\}/)?.[0];
  assert.ok(wait);
  const context = createContext({ INTERVAL_MIN: 60, provider: "postgres", canary: false, POLL_MS: 60_000,
    lifetimeHuntStalledCycles: 0, ownerRepositories: async () => ({ runnerHeartbeat: { read: async () => null } }),
    readRunnerControls: async () => ({ config: null, state: null, research: [] }),
    readIntents: () => ({ paused: false, runnerPause: { paused: false } }),
    expansionScopesOf: () => ({ malformed: 0, scopes: [] }),
    isAdminConfig: () => false, isExpansionCycleReading: () => false, isAssignmentCycleReading: () => false,
    originalLifetimeHuntContinuation: () => null, continuingDirectedHunt: () => null,
    RUNNER_ID: "test", console: { log: () => {}, error: () => {} }, ...overrides,
  });
  return runInContext(stripTypeScriptTypes(wait) + "\nnextCycleWaitMs;", context);
}

test("failed research rounds retry within ten minutes on every ordinary fallback", async () => {
  for (const overrides of [ {}, { provider: "file" }, { canary: true },
    { ownerRepositories: async () => null },
    { ownerRepositories: async () => { throw new Error("unavailable"); } },
    { readRunnerControls: async () => { throw new Error("control read failed"); } },
    { expansionScopesOf: () => ({ malformed: 1, scopes: [] }) },
    { readIntents: () => ({ paused: true, runnerPause: { paused: false } }) },
    { readIntents: () => ({ paused: false, runnerPause: { paused: true } }) },
  ]) {
    assert.equal(await nextWait(overrides)(false), 10 * 60_000);
    assert.equal(await nextWait(overrides)(true), 60 * 60_000);
  }
  assert.equal(await nextWait({ INTERVAL_MIN: 5 })(false), 5 * 60_000);
  const failedBeat = source.match(/async function writeFailedCycleBeat\([\s\S]*?\n\}/)?.[0];
  assert.ok(failedBeat);
  assert.match(failedBeat, /intervalMin: Math\.min\(INTERVAL_MIN, 10\)/);
});

test("failed round continuation caps a long lifetime delay and retains shorter waits", async () => {
  for (const delayMs of [60_000, 600_000, 3_600_000]) {
    const next = nextWait({ originalLifetimeHuntContinuation: () => ({
      label: "funded place", due: 20, dispatched: 0, reason: "ELIGIBLE_ZERO_DISPATCH", delayMs,
    }) });
    assert.equal(await next(false), Math.min(delayMs, 600_000));
    assert.equal(await next(true), delayMs);
  }
});

test("a wake reconciles the deployed release before admitting another research cycle", () => {
  const loop = source.slice(source.indexOf("while (cycle < CYCLES) {"));
  const held = loop.indexOf("const owner = await holdWhilePaused();");
  const reconciled = loop.indexOf("const wakeReleaseExit = await reconcileRuntimeReleaseAtBoundary();");
  const releaseExit = loop.indexOf("if (wakeReleaseExit !== null) {", reconciled);
  const breakOnRelease = loop.indexOf("break;", releaseExit);
  const incremented = loop.indexOf("cycle += 1;", held);
  const child = loop.indexOf("const result = await runOneCycle(owner)", incremented);
  const slept = loop.indexOf("await sleepUnlessRunNow(result.failedAtMs", child);
  assert.ok(held >= 0 && held < reconciled);
  assert.ok(reconciled < releaseExit && releaseExit < breakOnRelease && breakOnRelease < incremented);
  assert.ok(incremented < child && child < slept);
});

test("both release and shutdown bound coordination and idle waits, and never await a timed-out drain again", () => {
  const hold = source.match(/async function holdStandingRuntimeAtQuiescence\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0];
  assert.ok(hold);
  assert.match(hold, /waitForRuntimeQuiescence\(async \(\) => \{\s*await stopAdminCopyClock\(\);\s*await activeControlRead;\s*await standingRuntimeScheduler.waitForIdle\(\);/);
  const shutdown = source.slice(source.lastIndexOf("if (standingRuntimeTimer !== null) clearInterval"));
  assert.match(shutdown, /if \(!standingDrainFailed\) \{[\s\S]*waitForRuntimeQuiescence\(async \(\) => \{\s*await stopAdminCopyClock\(\);\s*await activeControlRead;\s*await standingRuntimeScheduler.waitForIdle\(\);/);
  assert.match(shutdown, /if \(standingDrainFailed\) process.exit\(handoffExitCode \?\? 2\)/);
});
