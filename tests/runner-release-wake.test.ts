import assert from "node:assert/strict";
import {createMemoryRepositories} from "../lib/control-plane/repository/memory.ts";
import {readPlanningContinuation} from "../lib/control-plane/scheduler/state-planning.ts";
import {ADMIN_CONFIG_ID,defaultAdminConfig} from "../lib/control-plane/gateway/admin-config.ts";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { spawnSync } from "node:child_process";
import ts from "typescript";
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
    readPlanningContinuation: async () => null,
    RUNNER_ID: "test", console: { log: () => {}, error: () => {} }, ...overrides,
  });
  return runInContext(stripTypeScriptTypes(wait) + "\nnextCycleWaitMs;", context);
}

test("failed research rounds retry within ten minutes on every ordinary fallback", async () => {
  for (const overrides of [ {}, { provider: "file" }, { canary: true },
    { ownerRepositories: async () => null },
    { ownerRepositories: async () => { throw new Error("unavailable"); } },
    { readRunnerControls: async () => { throw new Error("control read failed"); } },
    { readPlanningContinuation: async () => { throw new Error("planning read failed"); } },
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
    const next = nextWait({ readPlanningContinuation: async () => ({hunt:{label:"funded place",due:20,dispatched:0},
      lifetime:{reason:"ELIGIBLE_ZERO_DISPATCH",delayMs},
    }) });
    assert.equal(await next(false), Math.min(delayMs, 600_000));
    assert.equal(await next(true), delayMs);
  }
});

test("a paid pause or a stopped hunt clears the prior directed-hunt reason before the next wait",async()=>{
  for(const paused of [true,false]) {
    const repos=createMemoryRepositories();
    const at="2026-10-16T11:00:00.000Z";
    await repos.adminConfig.put(ADMIN_CONFIG_ID,defaultAdminConfig(at),at);
    await repos.runnerHeartbeat.put("test",{testedSha:"code",nextCycleReason:"Directed hunt ZIP 85122"} as never,at);
    await repos.researchState.put("level-1:az",{expansion:{scopes:[{key:"zcta:2020/85122",work:{dueThisCycle:79,dispatchedThisCycle:0}}]}} as never,at);
    const next=nextWait({ownerRepositories:async()=>repos,readPlanningContinuation,
      readIntents:()=>({paused,runnerPause:{paused:false}})});
    assert.equal(await next(true),60*60_000);
    assert.equal((await repos.runnerHeartbeat.mustRead("test")).value.nextCycleReason,null);
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

test("runtime contract initialization precedes every startup path that can use it", () => {
  const tree = ts.createSourceFile("pilot-runner.mts", source, ts.ScriptTarget.Latest, true);
  const initialization = tree.statements.find(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => declaration.name.getText(tree) === "runtimeContracts"));
  assert.ok(initialization);
  const functions = new Map(tree.statements.filter(ts.isFunctionDeclaration)
    .filter(fn => fn.name && fn.body).map(fn => [fn.name!.text, fn.body!]));
  const visited = new Set<string>();
  const inspect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) return; // declarations run only when referenced
    if (ts.isIdentifier(node)) {
      assert.notEqual(node.text, "runtimeContracts", "startup must initialize the helper before using it");
      const body = functions.get(node.text);
      if (body && !visited.has(node.text)) { visited.add(node.text); inspect(body); }
    }
    ts.forEachChild(node, inspect);
  };
  for (const statement of tree.statements) {
    if (statement === initialization) break;
    inspect(statement);
  }
  const firstBoundary = source.indexOf("let handoffExitCode = await reconcileRuntimeReleaseAtBoundary();");
  assert.ok(firstBoundary > initialization.end, "the first release boundary runs after helper construction");
});

test("CURRENT uses initialized contracts with the running SHA and directory while both clocks keep running", async () => {
  const fn = source.match(/async function reconcileRuntimeReleaseAtBoundary\([\s\S]*?\n\}/)?.[0];
  const initialization = source.match(/const runtimeContracts = runtimeContractRetry\(\{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(fn);
  assert.ok(initialization);
  for (const contractsOk of [false, true]) {
    const calls: string[] = [];
    const requests: [string, string][] = [];
    let initialized = false;
    let resolved = false;
    let finish!: (ok: boolean) => void;
    const contractWork = new Promise<boolean>(resolve => { finish = resolve; });
    const applyRuntimeContracts = async () => {
      calls.push("contracts");
      const ok = await contractWork;
      resolved = true;
      return ok;
    };
    const context = createContext({ AUTO_RELEASE_HANDOFF: true, ROOT: ".", CODE_ROOT: "/running-release", RUNNING_CODE_SHA: "a".repeat(40),
      runtimeAdmissionsHeld: true, resumeRuntimeReleaseInstall: () => { calls.push("install recovery"); return null; },
      inspectRuntimeRelease: async () => { calls.push("inspect"); return { state: "CURRENT" }; },
      applyRuntimeContracts,
      runtimeContractRetry: ({ run }: { run: typeof applyRuntimeContracts }) => {
        assert.equal(run, applyRuntimeContracts);
        initialized = true;
        calls.push("contracts initialized");
        return { request: (sha: string, directory: string) => {
          assert.equal(initialized, true);
          assert.equal(context.runtimeAdmissionsHeld, false);
          assert.deepEqual(calls.slice(-2), ["routine clock", "Admin copy clock"]);
          requests.push([sha, directory]);
          calls.push("contracts requested");
          void run();
        } };
      },
      startStandingRuntimeClock: () => calls.push("routine clock"), startAdminCopyClock: () => calls.push("Admin copy clock"),
    });
    const result = await runInContext(stripTypeScriptTypes(`${fn}\n${initialization}`) + "\nreconcileRuntimeReleaseAtBoundary()", context);
    assert.equal(result, null);
    assert.equal(context.runtimeAdmissionsHeld, false);
    assert.equal(resolved, false, "a pending migration cannot block collection");
    assert.deepEqual(requests, [["a".repeat(40), "/running-release"]]);
    assert.deepEqual(calls, ["contracts initialized", "install recovery", "inspect", "routine clock", "Admin copy clock", "contracts requested", "contracts"]);
    finish(contractsOk);
    await contractWork;
    assert.equal(resolved, true);
    assert.equal(context.runtimeAdmissionsHeld, false, "a failed migration cannot close collection");
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

test("console children use the research idle guard", async () => {
  for (const name of ["publishConsoleChildren"]) {
    const fn = source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(fn);
    let observed: number | undefined;
    const context = createContext({ CONSOLE_PUBLISHERS: [{ name: "fixture", args: [] }], TS_CHILD: [], ROOT: ".", CODE_ROOT: ".", process,
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
