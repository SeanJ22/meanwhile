import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admittedAsyncRunCommand } from "../lib/ops/runtime-release-stage.ts";
import type { WorkerMemoryRelease } from "../lib/control-plane/workers/worker-slots.ts";

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
