import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { DEFAULT_HANG_KILL_MS } from "../scripts/runner-hang-watchdog.mts";
import { RUNTIME_RELEASE_MAX_BLOCKING_MS } from "../lib/ops/runtime-release-handoff.ts";

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
  assert.match(hold, /waitForRuntimeQuiescence\(async \(\) => \{\s*await stopAdminCopyClock\(\);\s*await stopScheduledOrderClock\(\);\s*await activeControlRead;\s*await standingRuntimeScheduler.waitForIdle\(\);/);
  const shutdown = source.slice(source.lastIndexOf("if (standingRuntimeTimer !== null) clearInterval"));
  assert.match(shutdown, /if \(!standingDrainFailed\) \{[\s\S]*waitForRuntimeQuiescence\(async \(\) => \{\s*await stopAdminCopyClock\(\);\s*await stopScheduledOrderClock\(\);\s*await activeControlRead;\s*await standingRuntimeScheduler.waitForIdle\(\);/);
  assert.match(shutdown, /if \(handoffExitCode !== null\) process.exit\(handoffExitCode\)/);
});

test("every completed handoff exits despite a retained timer or socket", () => {
  const tail = source.slice(source.lastIndexOf("if (handoffExitCode === null) {"));
  for (const code of [0, 2]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import net from 'node:net';let handoffExitCode=${code};setInterval(()=>{},1000);net.createServer().listen(0);${tail}`],
    { timeout: 3000, encoding: "utf8" });
    assert.equal(child.error, undefined);
    assert.equal(child.status, code);
    console.log(`handoff ${code}: open timer/socket exited ${child.status}`);
  }
});

test("CURRENT reopens held admissions and both clocks only after contracts succeed", async () => {
  const fn = source.match(/async function reconcileRuntimeReleaseAtBoundary\([\s\S]*?\n\}/)?.[0];
  assert.ok(fn);
  for (const contractsOk of [false, true]) {
    const calls: string[] = [];
    const context = createContext({ AUTO_RELEASE_HANDOFF: true, ROOT: ".", RUNNING_CODE_SHA: "a".repeat(40),
      runtimeAdmissionsHeld: true, resumeRuntimeReleaseInstall: () => { calls.push("install recovery"); return null; },
      inspectRuntimeRelease: async () => { calls.push("inspect"); return { state: "CURRENT" }; },
      applyRuntimeContracts: async () => { calls.push("contracts"); return contractsOk; },
      startStandingRuntimeClock: () => calls.push("routine clock"), startAdminCopyClock: () => calls.push("Admin copy clock"),
    });
    const result = await runInContext(stripTypeScriptTypes(fn) + "\nreconcileRuntimeReleaseAtBoundary()", context);
    assert.equal(result, contractsOk ? null : 2);
    assert.equal(context.runtimeAdmissionsHeld, !contractsOk);
    assert.deepEqual(calls, contractsOk ? ["install recovery", "inspect", "contracts", "routine clock", "Admin copy clock"]
      : ["install recovery", "inspect", "contracts"]);
    console.log(`CURRENT contracts=${contractsOk}: admissionsHeld=${context.runtimeAdmissionsHeld}; ${calls.join(" -> ")}`);
  }
});

test("recovered install exits for freshly loaded dependencies before inspecting or opening clocks", async () => {
  const fn = source.match(/async function reconcileRuntimeReleaseAtBoundary\([\s\S]*?\n\}/)?.[0];
  assert.ok(fn);
  const context = createContext({ AUTO_RELEASE_HANDOFF: true, ROOT: ".", console: { log: () => {} },
    resumeRuntimeReleaseInstall: () => ({ state: "UPDATED", detail: "installed" }),
    inspectRuntimeRelease: () => { throw new Error("must reload dependencies before inspecting"); },
  });
  assert.equal(await runInContext(stripTypeScriptTypes(fn) + "\nreconcileRuntimeReleaseAtBoundary()", context), 0);
  assert.ok(DEFAULT_HANG_KILL_MS > RUNTIME_RELEASE_MAX_BLOCKING_MS);
});

test("console and nightly children use the research idle guard", async () => {
  for (const name of ["publishConsoleChildren", "runNightlyWindow"]) {
    const fn = source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(fn);
    let observed: number | undefined;
    const context = createContext({ CONSOLE_PUBLISHERS: [{ name: "fixture", args: [] }], ROOT: ".", process,
      RUNTIME_NO_PROGRESS_MS: 600_000, standingChildEnvironment: () => process.env,
      recoverExitedWindowHolder: async () => {}, console: { log: () => {}, error: () => {} },
      runRuntimeChildren: async (_children: unknown, options: { noProgressMs?: number }) => {
        observed = options.noProgressMs;
        return [{ status: 0, stdout: "", stderr: "" }];
      },
    });
    await runInContext(stripTypeScriptTypes(fn) + `\n${name}('fixture')`, context);
    assert.equal(observed, 600_000);
    console.log(`${name}: noProgressMs=${observed}`);
  }
});
