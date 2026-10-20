import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import ts from "typescript";
import { resumeRuntimeReleaseInstall, RUNTIME_RELEASE_HOLD_RELATIVE_PATH } from "../lib/ops/runtime-release-handoff.ts";
import { admittedAsyncRunCommand } from "../lib/ops/runtime-release-stage.ts";
import type { WorkerMemoryRelease, WorkerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";

test("release commands acquire their job reservation before spawning and retain it until the child closes", async () => {
  let admit!: (release: WorkerMemoryRelease) => void;
  const events: string[] = [];
  const run = admittedAsyncRunCommand({ acquire: async entry => {
    events.push(`acquire:${entry}`); return new Promise(resolve => { admit = resolve; });
  } });
  let settled = false;
  const result = run(process.execPath, ["-e", "process.stdout.write('completed')"], { cwd: process.cwd(), timeoutMs: 5000,
    memoryEntry: "runtime-release-install.mjs" }).then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(settled, false); assert.deepEqual(events, ["acquire:runtime-release-install.mjs"]);
  admit(Object.assign(() => { events.push("release"); }, { observe: (pid: number) => { assert.ok(pid > 0); events.push("observe"); } }));
  const completed = await result;
  assert.equal(completed.status, 0); assert.equal(completed.stdout, "completed");
  assert.deepEqual(events, ["acquire:runtime-release-install.mjs", "observe", "release"]);
});

test("a release command refused at the memory deadline starts no child", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-admission-")), marker = join(root, "started");
  const run = admittedAsyncRunCommand({ acquire: async () => { throw new Error("WORKER_MEMORY_DEADLINE: work remains owed"); } });
  const result = await run(process.execPath, ["--input-type=module", "-e", `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'started')`],
    { cwd: root, timeoutMs: 5000 });
  assert.equal(result.status, null); assert.match(result.stderr, /WORKER_MEMORY_DEADLINE/); assert.equal(existsSync(marker), false);
});

const TARGET = "a".repeat(40);
type InstallMemoryWork = <T>(work: () => T) => Promise<T>;
/** Load only the repository's real wrapper and boundary body; no pilot clocks, DB or provider is started. */
function pilotInstallFixture(root: string, slots: WorkerProcessSlots, overrides: Readonly<Record<string, unknown>> = {}): {
  readonly work: InstallMemoryWork; readonly reconcile: () => Promise<number | null>;
} {
  const source = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
  const start = source.indexOf("async function withRuntimeInstallMemory<T>");
  const end = source.indexOf("\nconst runtimeContractsApplied", start);
  assert.ok(start >= 0 && end > start, "load the actual admission wrapper and release boundary");
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const bindings: Record<string, unknown> = {
    runtimeInstallMemory: slots, AUTO_RELEASE_HANDOFF: true, ROOT: root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH,
    existsSync, join, resumeRuntimeReleaseInstall, RUNNING_CODE_SHA: TARGET,
    inspectRuntimeRelease: async () => ({ state: "CURRENT", targetSha: TARGET }),
    applyRuntimeContracts: async () => true, startStandingRuntimeClock: () => {}, startAdminCopyClock: () => {},
    standingRuntimeTimer: null, adminCopyTimer: null, RELEASE_QUICK_SWITCH: false,
    advanceStagedRelease: async () => "DRAIN", holdStandingRuntimeAtQuiescence: async () => {},
    persistRuntimeBoundaryFailure: async () => {},
    releaseInspectionRefusal: (code: string, detail: string, targetSha: string | null) => ({ code, detail, targetSha }),
    applyRuntimeRelease: () => { throw new Error("unexpected synchronous release application"); },
    discardStagedReleases: async () => {}, console: { log: () => {} }, ...overrides,
  };
  const load = new Function(...Object.keys(bindings), `let runtimeAdmissionsHeld = false; ${compiled}
    return {work:withRuntimeInstallMemory,reconcile:reconcileRuntimeReleaseAtBoundary};`);
  return load(...Object.values(bindings)) as { work: InstallMemoryWork; reconcile: () => Promise<number | null> };
}

test("the actual synchronous install wrapper waits for admission before work and releases without a fake PID", async () => {
  const events: string[] = []; let admit!: (release: WorkerMemoryRelease) => void;
  const fixture = pilotInstallFixture(process.cwd(), { acquire: entry => {
    events.push(`acquire:${entry}`); return new Promise(resolve => { admit = resolve; });
  } });
  const running = fixture.work(() => { events.push("work"); return 41; });
  await nextTurn(); assert.deepEqual(events, ["acquire:runtime-release-install.mjs"]);
  const release = () => { events.push("release"); };
  Object.defineProperty(release, "observe", { get: () => { throw new Error("no synthetic installer PID may be observed"); } });
  admit(release); assert.equal(await running, 41);
  assert.deepEqual(events, ["acquire:runtime-release-install.mjs", "work", "release"]);
});

test("the actual synchronous install wrapper releases when native work throws", async () => {
  const events: string[] = [], failure = new Error("native frozen install failed");
  const fixture = pilotInstallFixture(process.cwd(), { acquire: async () => {
    events.push("acquire"); return () => { events.push("release"); };
  } });
  await assert.rejects(fixture.work(() => { events.push("work"); throw failure; }), error => error === failure);
  assert.deepEqual(events, ["acquire", "work", "release"]);
});

test("an absent native recovery hold reaches CURRENT without waiting for installer memory", async () => {
  const root = mkdtempSync(join(tmpdir(), "pilot-install-no-hold-")), events: string[] = [];
  try {
    assert.equal(resumeRuntimeReleaseInstall({ root }), null, "the real unchanged native recovery API proves the absent-hold no-op");
    const fixture = pilotInstallFixture(root, { acquire: async () => { throw new Error("a native no-op waited for install memory"); } }, {
      resumeRuntimeReleaseInstall: () => { throw new Error("the already-absent native hold should be skipped"); },
      inspectRuntimeRelease: async () => { events.push("inspect"); return { state: "CURRENT", targetSha: TARGET }; },
      applyRuntimeContracts: async () => { events.push("contracts"); return true; },
      startStandingRuntimeClock: () => { events.push("standing"); }, startAdminCopyClock: () => { events.push("admin"); },
    });
    assert.equal(await fixture.reconcile(), null);
    assert.deepEqual(events, ["inspect", "contracts", "standing", "admin"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the actual recovery call cannot run before its held installer reservation", async () => {
  const root = mkdtempSync(join(tmpdir(), "pilot-install-held-")), events: string[] = [];
  let admit!: (release: WorkerMemoryRelease) => void;
  try {
    const hold = join(root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH);
    mkdirSync(dirname(hold), { recursive: true }); writeFileSync(hold, JSON.stringify({ switched: true, targetSha: TARGET }));
    const fixture = pilotInstallFixture(root, { acquire: entry => {
      events.push(`acquire:${entry}`); return new Promise(resolve => { admit = resolve; });
    } }, {
      resumeRuntimeReleaseInstall: () => { events.push("native-recovery"); return { state: "UPDATED", detail: "installed" }; },
      inspectRuntimeRelease: () => { throw new Error("recovered dependencies must restart before other release work"); },
    });
    const running = fixture.reconcile(); await nextTurn();
    assert.deepEqual(events, ["acquire:runtime-release-install.mjs"]);
    admit(() => { events.push("release"); }); assert.equal(await running, 0);
    assert.deepEqual(events, ["acquire:runtime-release-install.mjs", "native-recovery", "release"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the actual fallback retains drain and exact-release checks before waiting for install admission", async () => {
  const root = mkdtempSync(join(tmpdir(), "pilot-install-fallback-")), events: string[] = [];
  let finishDrain!: () => void, admit!: (release: WorkerMemoryRelease) => void;
  const drain = new Promise<void>(resolve => { finishDrain = resolve; });
  try {
    const fixture = pilotInstallFixture(root, { acquire: entry => {
      events.push(`acquire:${entry}`); return new Promise(resolve => { admit = resolve; });
    } }, {
      inspectRuntimeRelease: async () => { events.push("inspect"); return { state: "UPDATE_REQUIRED", targetSha: TARGET }; },
      holdStandingRuntimeAtQuiescence: async () => { events.push("drain"); await drain; },
      applyRuntimeRelease: (input: { root: string; targetSha: string }) => {
        assert.deepEqual(input, { root, targetSha: TARGET }); events.push("native-apply"); return { state: "UPDATED", detail: "installed" };
      },
      applyRuntimeContracts: async () => { events.push("contracts"); return true; },
      discardStagedReleases: async () => { events.push("discard"); },
    });
    const running = fixture.reconcile(); await nextTurn(); assert.deepEqual(events, ["inspect", "drain"]);
    finishDrain(); await nextTurn();
    assert.deepEqual(events, ["inspect", "drain", "inspect", "acquire:runtime-release-install.mjs"]);
    admit(() => { events.push("release"); }); assert.equal(await running, 0);
    assert.deepEqual(events, ["inspect", "drain", "inspect", "acquire:runtime-release-install.mjs", "native-apply", "release", "contracts", "discard"]);
  } finally { finishDrain(); rmSync(root, { recursive: true, force: true }); }
});

test("a changed fallback target is refused before installer admission or native apply", async () => {
  const root = mkdtempSync(join(tmpdir(), "pilot-install-changed-target-")), refusals: string[] = []; let inspections = 0;
  try {
    const fixture = pilotInstallFixture(root, { acquire: async () => { throw new Error("refused target must not acquire installer memory"); } }, {
      inspectRuntimeRelease: async () => ({ state: "UPDATE_REQUIRED", targetSha: ++inspections === 1 ? TARGET : "b".repeat(40) }),
      persistRuntimeBoundaryFailure: async (value: { code: string }) => { refusals.push(value.code); },
    });
    assert.equal(await fixture.reconcile(), 2); assert.deepEqual(refusals, ["DEPLOYED_TARGET_CHANGED_DURING_DRAIN"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
