import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { freshnessConditions } from "../lib/control-plane/freshness-conditions.ts";
import { spoolFreshnessCycleLines, visitFreshnessCycleDetails } from "../lib/control-plane/freshness-cycle-details.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createPlannerSpool } from "../lib/control-plane/scheduler/planner-spool.ts";
import { writeStreamedJsonSync } from "../lib/control-plane/scheduler/streamed-json.ts";

const cycle = { cycleId: "freshness-cycle:conditions:2026-10-20T12:00:00.000Z", finishedAt: "2026-10-20T12:00:00.000Z", testedSha: null };

test("condition state keeps twelve examples while exact duplicate strings and native order survive incremental pages", async () => {
  const planner = await createPlannerSpool(), repos = createMemoryRepositories();
  try {
    const conditions = freshnessConditions(planner, cycle), expected = (n: number) => n % 9 ? `place:${n} source failed` : "same exact source failure";
    for (let n = 0; n < 10_003; n++) conditions.push(expected(n));
    assert.equal(conditions.length, 10_003);
    assert.deepEqual(conditions.snapshot().runtimeConditions, Array.from({ length: 12 }, (_, n) => expected(n)));
    assert.equal(conditions.snapshot().runtimeConditionCount, 10_003);
    assert.equal(conditions.snapshot().runtimeConditionDetails.rows, 0);
    await conditions.flush(repos);
    assert.equal(conditions.localPending(), null);
    let visited = 0;
    await visitFreshnessCycleDetails<string>(repos, conditions.snapshot().runtimeConditionDetails, row => { assert.equal(row, expected(visited++)); });
    assert.equal(visited, 10_003);
    const previous = conditions.snapshot().runtimeConditionDetails;
    conditions.push("deferred: next place remains owed");
    await conditions.flush(repos);
    assert.equal(conditions.hasDeferred, true);
    assert.equal(conditions.snapshot().runtimeConditionDetails.rows, 10_004);
    assert.equal(conditions.snapshot().runtimeConditionDetails.pages, previous.pages + 1);
    assert.equal(conditions.snapshot().runtimeConditions.length, 12);
    assert.equal(conditions.snapshot().runtimeConditionDetailsUnavailable, null);
    await conditions.flush(repos);
    assert.equal(conditions.snapshot().runtimeConditionDetails.pages, previous.pages + 1, "an unchanged state publication writes no new page");
  } finally { await planner.close(); }
});

test("an ambiguous page append retries the identical frozen page before appending newly arrived conditions", async () => {
  const planner = await createPlannerSpool(), repos = createMemoryRepositories();
  try {
    const conditions = freshnessConditions(planner, cycle), append = repos.ownerDigests.append.bind(repos.ownerDigests);
    let fail = true, failedBody = "", retriedBody = "";
    repos.ownerDigests.append = async (...args) => {
      const result = await append(...args);
      if (args[2].freshnessDetails?.page === 1) {
        if (fail) { fail = false; failedBody = JSON.stringify(args); throw new Error("ACK_LOST_AFTER_COMMIT"); }
        retriedBody = JSON.stringify(args);
      }
      return result;
    };
    for (let n = 0; n < 35; n++) conditions.push(`condition:${n}`);
    await conditions.flush(repos);
    assert.equal(conditions.snapshot().runtimeConditionDetails.rows, 32);
    assert.equal(conditions.localPending()?.retryThrough, 35);
    assert.match(conditions.snapshot().runtimeConditionDetailsUnavailable!, /ACK_LOST_AFTER_COMMIT/);
    conditions.push("arrived while the prior page awaited acknowledgement");
    await conditions.flush(repos);
    assert.equal(retriedBody, failedBody, "the immutable page timestamp, key and rows stay identical after an ambiguous append");
    assert.equal(conditions.snapshot().runtimeConditionDetails.rows, 35);
    assert.equal(conditions.localPending()?.pendingRuntimeConditions.length, 1);
    await conditions.flush(repos);
    assert.equal(conditions.localPending(), null);
    const result: string[] = [];
    await visitFreshnessCycleDetails<string>(repos, conditions.snapshot().runtimeConditionDetails, row => { result.push(row); });
    assert.deepEqual(result, [...Array.from({ length: 35 }, (_, n) => `condition:${n}`), "arrived while the prior page awaited acknowledgement"]);
  } finally { await planner.close(); }
});

test("the existing streamed local run record preserves only pending exact conditions across planner cleanup", async () => {
  const planner = await createPlannerSpool(), repos = createMemoryRepositories();
  const directory = mkdtempSync(join(tmpdir(), "rh01-condition-diagnostic-")), path = join(directory, "cycle.json");
  let closed = false;
  try {
    const conditions = freshnessConditions(planner, cycle), append = repos.ownerDigests.append.bind(repos.ownerDigests);
    repos.ownerDigests.append = async (...args) => {
      if (args[2].freshnessDetails?.page === 1) throw new Error("STORE_OFFLINE");
      return append(...args);
    };
    for (let n = 0; n < 70; n++) conditions.push(`exact condition:${n}\nincluding original text`);
    await conditions.flush(repos);
    writeStreamedJsonSync(path, { runtimeConditionPublication: conditions.localPending() });
    await planner.close(); closed = true;
    const saved = JSON.parse(readFileSync(path, "utf8")).runtimeConditionPublication;
    assert.equal(saved.runtimeConditionCount, 70);
    assert.equal(saved.runtimeConditionDetails.rows, 32);
    assert.equal(saved.retryThrough, 70);
    assert.equal(saved.pendingRuntimeConditions.length, 38);
    assert.deepEqual(saved.pendingRuntimeConditions, Array.from({ length: 38 }, (_, n) => `exact condition:${n + 32}\nincluding original text`));
    assert.deepEqual(saved.cycle, cycle);
    assert.match(saved.runtimeConditionDetailsUnavailable, /STORE_OFFLINE/);
  } finally { if (!closed) await planner.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("cycle logs freeze every native line in order while the digest example remains finite", async () => {
  const planner = await createPlannerSpool(), repos = createMemoryRepositories();
  try {
    const native = { *[Symbol.iterator]() { for (let n = 0; n < 10_003; n++) yield n % 9 ? `  owner dispatch ${n}: exact native line` : ""; } };
    const log = spoolFreshnessCycleLines(planner, native);
    assert.equal(log.count, 10_003); assert.equal(log.examples.length, 12);
    assert.deepEqual(log.examples, [...native].slice(0, 12));
    let n = 0; for (const line of log.rows) assert.equal(line, n++ % 9 ? `  owner dispatch ${n - 1}: exact native line` : "");
    assert.equal(n, 10_003);
    const { appendFreshnessCycleDetails } = await import("../lib/control-plane/freshness-cycle-details.ts");
    const ref = await appendFreshnessCycleDetails(repos, cycle, "lines", log.rows);
    assert.equal(ref.rows, log.count);
    n = 0; await visitFreshnessCycleDetails<string>(repos, ref, line => { assert.equal(line, n++ % 9 ? `  owner dispatch ${n - 1}: exact native line` : ""); });
    assert.equal(n, 10_003);
  } finally { await planner.close(); }
});
