import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { runRuntimeChildren, waitForRuntimeQuiescence } from "../scripts/pilot-runtime-child.mts";
import { workerMemoryHost, workerProcessSlots, type WorkerMemoryRelease } from "../lib/control-plane/workers/worker-slots.ts";

test("runtime jobs acquire host memory before spawning, observe the child and release on exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-child-admission-"));
  const events: string[] = [];
  let admit!: (release: WorkerMemoryRelease) => void;
  let admittedEntry = "";
  let admittedDeadline: number | undefined;
  const deadlineMs = Date.now() + 5000;
  try {
    await writeFile(join(root, "loader.mjs"), "");
    await writeFile(join(root, "job.mjs"), "console.log('completed');");
    const release: WorkerMemoryRelease = Object.assign(() => { events.push("release"); }, {
      observe: (pid: number) => { assert.ok(pid > 0); events.push("observe"); },
    });
    const pending = runRuntimeChildren([{ id: "routine-job", executable: process.execPath,
      args: ["--import", join(root, "loader.mjs"), join(root, "job.mjs")],
      onStarted: () => { events.push("command-started"); },
    }], { cwd: root, env: process.env, maxBufferBytes: 4096, deadlineMs,
      slots: { acquire: (entry, deadline) => {
        events.push("acquire"); admittedEntry = entry!; admittedDeadline = deadline;
        return new Promise(resolve => { admit = resolve; });
      } }, onStarted: () => { events.push("started"); },
    });
    await yieldToEventLoop();
    assert.deepEqual(events, ["acquire"], "queued admission cannot start a process");
    assert.equal(admittedEntry, "routine-job/job.mjs", "the Node loader is not the job");
    assert.equal(admittedDeadline, deadlineMs);
    admit(release);
    const [result] = await pending;
    assert.equal(result!.status, 0);
    assert.match(result!.stdout, /completed/);
    assert.deepEqual(events, ["acquire", "observe", "command-started", "started", "release"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runtime admission refusal leaves work owed without starting a child", async () => {
  let started = false;
  const [result] = await runRuntimeChildren([{ id: "held-job", executable: process.execPath,
    args: ["-e", "throw new Error('must not run');"] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 4096,
    slots: { acquire: async () => { throw new Error("WORKER_MEMORY_DEADLINE: memory wait deferred; work remains owed"); } },
    onStarted: () => { started = true; },
  });
  assert.equal(started, false);
  assert.equal(result!.termination, "SPAWN_FAILED");
  assert.equal(result!.status, null);
  assert.equal(result!.stdout, "");
  assert.match(result!.errorMessage!, /^WORKER_MEMORY_DEADLINE:/);
});

test("a runtime job admitted after its pass deadline releases memory without spawning", async () => {
  let releases = 0, started = false;
  const [result] = await runRuntimeChildren([{ id: "late-job", executable: process.execPath,
    args: ["-e", "throw new Error('must not run');"] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 4096, deadlineMs: Date.now() - 1,
    slots: { acquire: async () => () => { releases++; } }, onStarted: () => { started = true; },
  });
  assert.equal(started, false);
  assert.equal(releases, 1);
  assert.equal(result!.termination, "SPAWN_FAILED");
  assert.match(result!.errorMessage!, /^PASS_TIME_BUDGET:/);
});

test("a drain cancels native queued memory admission before any child can start", async () => {
  const slots = workerProcessSlots(() => 1, { host: workerMemoryHost({ processes: () => [] }),
    availableBytes: () => 1024, headroomBytes: 0, peakBytes: () => 1 });
  const occupied = await slots.acquire();
  let started = false;
  try {
    const running = runRuntimeChildren([{ id: "queued-at-drain", executable: process.execPath,
      args: ["-e", "throw new Error('must not start');"] }], {
      cwd: process.cwd(), env: process.env, maxBufferBytes: 4096, slots,
      onStarted: () => { started = true; },
    });
    await assert.rejects(waitForRuntimeQuiescence(async () => { await running; }, {
      reason: "pending admission", noProgressMs: 20,
    }), /RUNTIME_DRAIN_NO_PROGRESS/);
    const [result] = await running;
    assert.equal(started, false);
    assert.equal(result!.termination, "SPAWN_FAILED");
    assert.match(result!.errorMessage!, /RUNTIME_DRAIN_NO_PROGRESS/);
    occupied();
    const next = await slots.acquire();
    next();
  } finally { occupied(); }
});

test("an admission answer arriving after a drain releases memory and starts no child", async () => {
  let admit!: (release: WorkerMemoryRelease) => void;
  let releases = 0, started = false;
  const running = runRuntimeChildren([{ id: "late-drained", executable: process.execPath,
    args: ["-e", "throw new Error('must not start');"] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 4096,
    slots: { acquire: () => new Promise(resolve => { admit = resolve; }) },
    onStarted: () => { started = true; },
  });
  await assert.rejects(waitForRuntimeQuiescence(async () => { await running; }, {
    reason: "late admission", noProgressMs: 20,
  }), /RUNTIME_DRAIN_NO_PROGRESS/);
  admit(() => { releases++; });
  const [result] = await running;
  assert.equal(started, false);
  assert.equal(releases, 1);
  assert.equal(result!.termination, "SPAWN_FAILED");
  assert.match(result!.errorMessage!, /RUNTIME_DRAIN_NO_PROGRESS/);
});

test("independent runtime jobs share reservations and start queued work as running jobs finish", async () => {
  const slots = workerProcessSlots(() => Number.MAX_SAFE_INTEGER, {
    host: workerMemoryHost({ processes: () => [] }), availableBytes: () => 700, headroomBytes: 100, peakBytes: () => 300,
  });
  let active = 0, peak = 0;
  const trackedSlots = { acquire: async (entry?: string, deadlineMs?: number) => {
    const release = await slots.acquire(entry, deadlineMs);
    return Object.assign(() => { active--; release(); }, { observe: () => {} });
  } };
  const jobs = ["routine", "publish-now", "audit"].map(id => ({ id, executable: process.execPath,
    args: ["-e", "setTimeout(() => console.log('completed'), 80);"] }));
  const results = await runRuntimeChildren(jobs, { cwd: process.cwd(), env: process.env, maxBufferBytes: 4096,
    slots: trackedSlots, onStarted: () => { active++; peak = Math.max(peak, active); },
  });
  assert.deepEqual(results.map(result => result.status), [0, 0, 0]);
  assert.equal(peak, 2);
  assert.equal(active, 0);
});
