import assert from "node:assert/strict";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { runRuntimeChildren, waitForRuntimeQuiescence } from "../scripts/pilot-runtime-child.mts";
import { workerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";

test("optional slot admission closure cancels queued work after the active worker finishes", async () => {
  let open = true;
  const slots = workerProcessSlots(() => 1, { admissionsOpen: () => open,
    availableBytes: () => 1024 ** 3, headroomBytes: 0, peakBytes: () => 1 });
  const release = await slots.acquire();
  let admitted = false;
  const queued = slots.acquire().then(() => { admitted = true; }, error => {
    assert.match(error.message, /RUNTIME_RELEASE_DRAINED/);
  });
  open = false;
  assert.equal(admitted, false);
  release();
  await queued;
  assert.equal(admitted, false);
  await assert.rejects(slots.acquire(), /RUNTIME_RELEASE_DRAINED/);
});

test("the standing launcher delivers the parent drain over IPC and retains child output and exit", async () => {
  const [result] = await runRuntimeChildren([{ id: "research", executable: process.execPath,
    args: ["--input-type=module", "-e", "process.on('message',m=>{console.log(m.kind);console.error('last error line');process.disconnect();process.exitCode=0})"] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 4096,
    onStarted: (_id, child) => { child.send({ kind: "RUNTIME_RELEASE_DRAIN" }); },
  });
  assert.ok(result);
  assert.equal(result.status, 0);
  assert.equal(result.termination, "EXITED");
  assert.match(result.stdout, /RUNTIME_RELEASE_DRAIN/);
  assert.match(result.stderr, /last error line/);
});

test("the launcher retains its output bound with IPC enabled", async () => {
  const [result] = await runRuntimeChildren([{ id: "verbose", executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(2048));setTimeout(()=>{},1000)"] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 128,
  });
  assert.ok(result);
  assert.equal(result.termination, "OUTPUT_LIMIT_EXCEEDED");
  assert.equal(result.status, null);
  assert.equal(result.stdout.length, 128);
});

test("a real research child finishes its queued current wave and starts no new wave after drain", async () => {
  let child: ChildProcess | null = null;
  const source = `
    import { workerProcessSlots } from ${JSON.stringify(new URL("../lib/control-plane/workers/worker-slots.ts", import.meta.url).href)};
    let drainRequested = false;
    process.on('message', m => { if (m.kind === 'RUNTIME_RELEASE_DRAIN') { drainRequested = true; release(); } });
    const slots = workerProcessSlots(() => 1, { availableBytes: () => 1024, headroomBytes: 0, peakBytes: () => 1 });
    const release = await slots.acquire();
    const queued = slots.acquire().then(done => { console.log('queued-worker-finished'); done(); });
    console.log('queued');
    await queued;
    console.log('active-finished');
    if (!drainRequested) console.log('UNEXPECTED_NEXT_WAVE');
    process.disconnect();
  `;
  const [result] = await runRuntimeChildren([{ id: "research", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", source] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 4096,
    onStarted: (_id, started) => { child = started; },
    onStdout: (_id, output) => { if (output.trim() === "queued") child?.send({ kind: "RUNTIME_RELEASE_DRAIN" }); },
  });
  assert.ok(result);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /queued-worker-finished/);
  assert.match(result.stdout, /active-finished/);
  assert.doesNotMatch(result.stdout, /UNEXPECTED_NEXT_WAVE|RUNTIME_RELEASE_DRAINED/);
});

test("the launcher keeps the existing output limit separate for stdout and stderr", async () => {
  const [result] = await runRuntimeChildren([{ id: "both", executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(80));process.stderr.write('y'.repeat(80))"] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 128,
  });
  assert.ok(result);
  assert.equal(result.termination, "EXITED");
  assert.equal(result.status, 0);
});

test("the research idle guard kills its tree despite repeated beats and release notices", async () => {
  let descendant = 0;
  const [result] = await runRuntimeChildren([{ id: "stalled-research", executable: process.execPath,
    args: ["--input-type=module", "-e", `
      import { spawn } from 'node:child_process';
      const worker = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio:'ignore' });
      console.log('worker admitted pid '+worker.pid);
      setInterval(()=>{console.log('heartbeat '+Date.now());console.log('runtime release drain '+Date.now());},40);
      setInterval(()=>console.log('same unchanged output'),40);
    `] }], { cwd: process.cwd(), env: process.env, maxBufferBytes: 4096, noProgressMs: 400,
    onStdout: (_id, output) => { const pid = output.match(/worker admitted pid (\d+)/); if (pid) descendant = Number(pid[1]); },
  });
  assert.equal(result.termination, "TIMED_OUT");
  assert.equal(result.status, null);
  assert.match(result.errorMessage!, /RESEARCH_CHILD_NO_PROGRESS/);
  assert.match(result.stderr, /ending owned child stalled-research process tree/);
  assert.ok(descendant);
  // Linux may briefly retain a reparented zombie; Windows taskkill removes it.
  if (process.platform === "win32") assert.throws(() => process.kill(descendant, 0));
});

test("new completed phases and admissions keep a child alive beyond one quiet allowance and stream before exit", async () => {
  let streamed = false;
  const [result] = await runRuntimeChildren([{ id: "progressing", executable: process.execPath,
    args: ["-e", `let n=0;const t=setInterval(()=>{console.log(n%2?'phase done '+n:'worker admitted '+n);if(++n===12){clearInterval(t);}},60)`] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 4096, noProgressMs: 400,
    onStdout: () => { streamed = true; }, onStarted: () => { assert.equal(streamed, false); },
  });
  assert.equal(result.termination, "EXITED");
  assert.equal(result.status, 0);
  assert.ok(streamed);
});

test("each coordination await in a drain is bounded even without a child", async () => {
  for (const step of ["stopAdminCopyClock", "activeControlRead", "scheduler.waitForIdle", "shutdown.waitForIdle"]) {
    await assert.rejects(waitForRuntimeQuiescence(() => new Promise(() => {}), {
      reason: step, noProgressMs: 20,
    }), new RegExp(`RUNTIME_DRAIN_NO_PROGRESS: ${step.replaceAll('.', '\\.')}`));
  }
});

test("a release drain ends only its owned idle routine child while an unrelated process survives", async () => {
  const { spawn } = await import("node:child_process");
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  try {
    let entered!: () => void;
    const childEntered = new Promise<void>(resolve => { entered = resolve; });
    const running = runRuntimeChildren([{ id: "idle-routine", executable: process.execPath,
      args: ["-e", "console.log('routine entered');setInterval(()=>{},1000)"] }], {
      cwd: process.cwd(), env: process.env, maxBufferBytes: 4096,
      onStdout: (_id, output) => { if (output.includes("routine entered")) entered(); },
    });
    await childEntered;
    await assert.rejects(waitForRuntimeQuiescence(async () => { await running; }, {
      reason: "release", noProgressMs: 400,
    }), /RUNTIME_DRAIN_NO_PROGRESS/);
    const [result] = await running;
    assert.equal(result.termination, "TIMED_OUT");
    assert.match(result.errorMessage!, /RUNTIME_DRAIN_NO_PROGRESS/);
    assert.doesNotThrow(() => process.kill(unrelated.pid!, 0));
  } finally { unrelated.kill(); }
});
