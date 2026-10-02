import assert from "node:assert/strict";
import test from "node:test";
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
});
