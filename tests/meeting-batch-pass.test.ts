import assert from "node:assert/strict";
import test from "node:test";
import { MEETING_PREFETCH_BYTES, MEETING_PREFETCH_CONCURRENCY, MEETING_STATE_TURN_MS, runMeetingBatchPass, type MeetingBatchMember } from "../lib/civic-data/meeting-batch.ts";
import { RUNTIME_AUTHORITY_ENV, runtimeAuthorityEnvironment } from "../lib/civic-data/runtime-authority.ts";

const previousCapability = process.env[RUNTIME_AUTHORITY_ENV.capability];
test.beforeEach(() => { process.env[RUNTIME_AUTHORITY_ENV.capability] = "ROUTINE_SUPERVISOR"; });
test.after(() => { if (previousCapability === undefined) delete process.env[RUNTIME_AUTHORITY_ENV.capability]; else process.env[RUNTIME_AUTHORITY_ENV.capability] = previousCapability; });
const member = (id: string): MeetingBatchMember => ({ id, dueAt: "2026-10-15T12:00:00.000Z", nextDueAt: "2026-10-15T13:00:00.000Z" });

test("meeting members settle independently in the state process with exact source authority", async () => {
  const events: string[] = [];
  const results = await runMeetingBatchPass([member("one"), member("two"), member("three")], {
    onMemberStarted: id => { events.push(`started:${id}`); },
    onSettled: (task, result) => {
      events.push(`settled:${task.id}`); assert.equal(result.id, task.id);
      assert.equal(runtimeAuthorityEnvironment()[RUNTIME_AUTHORITY_ENV.capability], "ROUTINE_SUPERVISOR");
    },
  }, async (id, options) => {
    assert.equal(runtimeAuthorityEnvironment()[RUNTIME_AUTHORITY_ENV.contract], id);
    assert.equal(process.env[RUNTIME_AUTHORITY_ENV.capability], "ROUTINE_SUPERVISOR");
    assert.equal(options.dueAt, member(id).dueAt);
    assert.equal(options.nextDueAt, member(id).nextDueAt);
    if (id === "two") throw new Error("publisher unavailable");
    options.onReceipt!(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ source: id })}`);
  });
  assert.deepEqual(results.map(result => [result.id, result.status, result.stdout]), [["one", 0, ""], ["two", 1, ""], ["three", 0, ""]]);
  assert.deepEqual(events, ["started:one", "settled:one", "started:two", "settled:two", "started:three", "settled:three"]);
});

test("a state turn yields between bodies and leaves every unstarted member due", async () => {
  let now = 0;
  const started: string[] = [];
  const results = await runMeetingBatchPass([member("saved"), member("queued"), member("also-queued")], {
    now: () => now, onMemberStarted: id => { started.push(id); }, onSettled: () => {},
  }, async (id, options) => { options.onReceipt!(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ source: id })}`); now += MEETING_STATE_TURN_MS; });
  assert.deepEqual(started, ["saved"]);
  assert.equal(results[0]!.status, 0);
  for (const result of results.slice(1)) {
    assert.equal(result.termination, "SPAWN_FAILED");
    assert.match(result.errorMessage!, /^PASS_TIME_BUDGET:/);
  }
});

test("a failure after saving a receipt keeps the saved source result and reports the later failure", async () => {
  const results = await runMeetingBatchPass([member("saved")], { onMemberStarted: () => {}, onSettled: () => {} }, async (id, options) => {
    options.onReceipt!(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ source: id })}`);
    throw new Error("later mirror failed");
  });
  assert.equal(results[0]!.status, 0);
  assert.equal(results[0]!.settlementErrorMessage, "later mirror failed");
});

test("bounded source prefetch overlaps waiting roots without starting or settling unprocessed bodies", async () => {
  let now = 0, active = 0, peak = 0, aborted = 0;
  let firstReady: () => void = () => {};
  const prepared: string[] = [], started: string[] = [];
  const tasks = Array.from({ length: MEETING_PREFETCH_CONCURRENCY + 2 }, (_, index) => member(String(index)));
  const work = runMeetingBatchPass(tasks, {
    now: () => now,
    prefetch: (task, signal) => new Promise<void>((resolve, reject) => {
      prepared.push(task.id); peak = Math.max(peak, ++active);
      const abort = () => { active--; aborted++; reject(new Error("prefetch turn ended")); };
      signal.addEventListener("abort", abort, { once: true });
      if (task.id === "0") firstReady = () => { signal.removeEventListener("abort", abort); active--; resolve(); };
    }),
    onMemberStarted: id => { started.push(id); }, onSettled: () => {},
  }, async (id, options) => {
    options.onReceipt!(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ source: id })}`);
    now += MEETING_STATE_TURN_MS;
  });
  for (let index = 0; index < 12; index++) await Promise.resolve();
  assert.equal(prepared.length, MEETING_PREFETCH_CONCURRENCY);
  assert.deepEqual(started, []);
  firstReady();
  const results = await work;
  assert.deepEqual(started, ["0"]);
  assert.equal(peak, MEETING_PREFETCH_CONCURRENCY);
  assert.equal(aborted, MEETING_PREFETCH_CONCURRENCY - 1);
  assert.equal(active, 0);
  assert.ok(results.slice(1).every(result => result.status === null && result.settlementErrorMessage === null));
});

test("a speculative request failure leaves the ordinary source check authoritative", async t => {
  const warnings = t.mock.method(console, "warn", () => {});
  const results = await runMeetingBatchPass([member("source")], {
    prefetch: async () => { throw new Error("prefetch request failed"); },
    onMemberStarted: () => {}, onSettled: () => {},
  }, async (id, options) => { options.onReceipt!(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ source: id })}`); });
  assert.equal(results[0]!.status, 0);
  assert.equal(results[0]!.settlementErrorMessage, null);
  assert.equal(warnings.mock.callCount(), 1);
});

test("root prefetch holds at most 32 MiB of known responses and aborts waiting reservations", async () => {
  let now = 0, bytes = 0, peak = 0, admitted = 0;
  let firstReady: () => void = () => {};
  const tasks = Array.from({ length: MEETING_PREFETCH_CONCURRENCY }, (_, index) => member(String(index)));
  const work = runMeetingBatchPass(tasks, {
    now: () => now,
    prefetch: async (task, signal, acquire) => {
      const count = 1024 * 1024, release = await acquire(count, signal);
      admitted++; bytes += count; peak = Math.max(peak, bytes);
      try {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (task.id === "0") firstReady = () => { signal.removeEventListener("abort", abort); resolve(); };
        });
      } finally { bytes -= count; release(); release(); }
    },
    onMemberStarted: () => {}, onSettled: () => {},
  }, async (id, options) => {
    options.onReceipt!(`RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ source: id })}`);
    now += MEETING_STATE_TURN_MS;
  });
  for (let index = 0; index < 20; index++) await Promise.resolve();
  assert.equal(admitted, MEETING_PREFETCH_BYTES / (1024 * 1024));
  firstReady();
  const results = await work;
  assert.equal(peak, MEETING_PREFETCH_BYTES);
  assert.equal(bytes, 0);
  assert.equal(results.filter(result => result.status === 0).length, 1);
  assert.ok(admitted < tasks.length);
});
