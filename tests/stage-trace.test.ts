import assert from "node:assert/strict";
import { test } from "node:test";

import { runBoundedChildPass } from "../lib/civic-data/bounded-child-pass.ts";
import { stageLine, traceMethodCalls } from "../lib/ops/stage-trace.ts";

/**
 * A killed child says where it stopped: a Reader-repair child writes stage
 * lines to stderr through `traceMethodCalls`, and the runner keeps a killed
 * child's last output lines as the failure detail.
 */

function clock(...readings: number[]): () => number {
  let index = 0;
  return () => readings[Math.min(index++, readings.length - 1)]!;
}

test("a stage line names the process time and the step", () => {
  assert.equal(stageLine("READER_REPAIR_STAGE", "store.events", 12.345), "READER_REPAIR_STAGE +12.3s store.events");
});

test("a traced call writes a line when it starts and when it settles, and passes its result through", async () => {
  const lines: string[] = [];
  const store = traceMethodCalls({ async events(id: string) { return [id]; } }, "store", (what) => lines.push(what), clock(1_000, 1_450));
  assert.deepEqual(await store.events("cv-1"), ["cv-1"]);
  assert.deepEqual(lines, ["store.events", "store.events settled in 0.5s"]);
});

test("a failing call writes a failed line and rethrows the same error", async () => {
  const lines: string[] = [];
  const failure = new Error("NeonDbError: Error connecting to database");
  const store = traceMethodCalls({ async readPromotion() { throw failure; } }, "store", (what) => lines.push(what), clock(0, 30_000));
  await assert.rejects(store.readPromotion(), (error) => error === failure);
  assert.deepEqual(lines, ["store.readPromotion", "store.readPromotion failed in 30.0s"]);
});

test("the method runs on the original object, and plain values and synchronous results pass through", async () => {
  class Store {
    #reads = 0;
    readonly name = "production";
    async readPromotionIdentity(): Promise<number> {
      this.#reads += 1;
      return this.#reads;
    }
    count(): number {
      return this.#reads;
    }
  }
  const lines: string[] = [];
  const store = traceMethodCalls(new Store(), "store", (what) => lines.push(what));
  assert.equal(await store.readPromotionIdentity(), 1);
  assert.equal(store.count(), 1);
  assert.equal(store.name, "production");
  assert.deepEqual(lines.map((line) => line.replace(/ in \d+\.\ds$/, "")), [
    "store.readPromotionIdentity",
    "store.readPromotionIdentity settled",
    "store.count",
  ]);
});

test("a child killed mid-call leaves that call, started and never settled, as its last stderr line", async () => {
  const child = [
    "const { stageLine, traceMethodCalls } = await import('./lib/ops/stage-trace.ts');",
    "const stage = (what) => process.stderr.write(stageLine('READER_REPAIR_STAGE', what) + '\\n');",
    "stage('modules loaded for nj-state-rollcalls');",
    "const store = traceMethodCalls({ async readPromotionIdentity() { return {}; }, readPromotion: () => new Promise(() => {}) }, 'store', stage);",
    "await store.readPromotionIdentity();",
    "setInterval(() => {}, 1000);",
    "await store.readPromotion();",
  ].join("\n");
  const [result] = await runBoundedChildPass([
    {
      id: "reader-readback:nj-state-rollcalls",
      executable: process.execPath,
      args: ["--experimental-strip-types", "--input-type=module", "-e", child],
    },
  ], { cwd: process.cwd(), env: process.env, timeoutMs: 4_000 });
  assert.equal(result?.termination, "TIMED_OUT");
  const lines = (result?.stderr ?? "").split(/\r?\n/).filter(Boolean);
  assert.match(lines[0] ?? "", /^READER_REPAIR_STAGE \+\d+\.\ds modules loaded for nj-state-rollcalls$/);
  assert.match(lines.at(-2) ?? "", /^READER_REPAIR_STAGE \+\d+\.\ds store\.readPromotionIdentity settled in \d+\.\ds$/);
  assert.match(lines.at(-1) ?? "", /^READER_REPAIR_STAGE \+\d+\.\ds store\.readPromotion$/);
  assert.match(result?.errorMessage ?? "", /store\.readPromotion$/m, "the kill's own message lost the stage lines");
});
