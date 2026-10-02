import assert from "node:assert/strict";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";
import { workerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";

test("release drain cancels queued admissions after the active worker finishes", async () => {
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

test("a real research child drains its waiting slot, finishes active work and exits for handoff", async () => {
  let child: ChildProcess | null = null;
  const source = `
    import { workerProcessSlots } from ${JSON.stringify(new URL("../lib/control-plane/workers/worker-slots.ts", import.meta.url).href)};
    let open = true;
    process.on('message', m => { if (m.kind === 'RUNTIME_RELEASE_DRAIN') { open = false; release(); } });
    const slots = workerProcessSlots(() => 1, { admissionsOpen: () => open, availableBytes: () => 1024, headroomBytes: 0, peakBytes: () => 1 });
    const release = await slots.acquire();
    const queued = slots.acquire().then(() => console.log('UNEXPECTED_ADMISSION'), e => console.log(e.message));
    console.log('queued');
    await queued;
    console.log('active-finished');
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
  assert.match(result.stdout, /RUNTIME_RELEASE_DRAINED/);
  assert.match(result.stdout, /active-finished/);
  assert.doesNotMatch(result.stdout, /UNEXPECTED_ADMISSION/);
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
