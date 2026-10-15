import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runMeetingBatchPass, type MeetingBatchMember } from "../lib/civic-data/meeting-batch.ts";
import { runBoundedChildPass, type BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";

const finished = (id: string): BoundedChildResult => ({ id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null });
const member = (id: string): MeetingBatchMember => ({ id, dueAt: "2026-10-15T12:00:00.000Z", nextDueAt: "2026-10-15T13:00:00.000Z" });

test("meeting members settle independently before their persistent worker ends", async () => {
  const events: string[] = [];
  const results = await runMeetingBatchPass([member("one"), member("two"), member("three")], {
    cwd: process.cwd(), env: process.env, concurrency: 1,
    onMemberStarted: id => { events.push(`started:${id}`); },
    onSettled: (task, result) => { events.push(`settled:${task.id}`); assert.equal(result.id, task.id); },
    onWorkerSettled: () => { events.push("worker:end"); },
  }, async command => {
    const tasks = JSON.parse(await readFile(command.args.at(-1)!.split("=")[1]!, "utf8")) as MeetingBatchMember[];
    assert.deepEqual(tasks, [member("one"), member("two"), member("three")]);
    for (const task of tasks) {
      await command.onStdoutLine!(`RCD_MEETING_PARTITION_STARTED=${JSON.stringify({ id: task.id })}`);
      await command.onStdoutLine!(task.id === "two"
        ? `RCD_MEETING_PARTITION_ERROR=${JSON.stringify({ id: task.id, detail: "publisher unavailable" })}`
        : `RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ source: task.id })}`);
      assert.equal(events.at(-1), `settled:${task.id}`);
    }
    return finished(command.id);
  });
  assert.deepEqual(results.map(result => [result.id, result.status, result.stdout]), [["one", 0, ""], ["two", 1, ""], ["three", 0, ""]]);
  assert.equal(events.at(-1), "worker:end");
});

test("a killed meeting worker preserves completed members and leaves unstarted work due", async () => {
  const results = await runMeetingBatchPass([member("saved"), member("running"), member("queued")], {
    cwd: process.cwd(), env: process.env, concurrency: 1,
    onMemberStarted: () => {}, onSettled: () => {}, onWorkerSettled: () => {},
  }, async command => {
    await command.onStdoutLine!('RCD_MEETING_PARTITION_STARTED={"id":"saved"}');
    await command.onStdoutLine!('RCD_MEETING_PARTITION_RECEIPT={"source":"saved"}');
    await command.onStdoutLine!('RCD_MEETING_PARTITION_STARTED={"id":"running"}');
    return { ...finished(command.id), status: null, signal: "SIGTERM", termination: "TIMED_OUT", errorMessage: "source quiet" };
  });
  assert.equal(results[0]!.status, 0);
  assert.equal(results[1]!.termination, "TIMED_OUT");
  assert.equal(results[2]!.termination, "SPAWN_FAILED");
  assert.match(results[2]!.errorMessage!, /^PASS_TIME_BUDGET:/);
});

test("streamed member output exceeds the retained stream cap without accumulating it", async () => {
  let lines = 0;
  const [result] = await runBoundedChildPass([{
    id: "stream", executable: process.execPath,
    args: ["-e", "for(let i=0;i<10000;i++)console.log(JSON.stringify({i,text:'x'.repeat(100)}));"],
    onStdoutLine: async line => { assert.equal(JSON.parse(line).i, lines++); },
  }], { cwd: process.cwd(), env: process.env, maxBufferBytes: 1024, timeoutMs: 5000 });
  assert.equal(lines, 10000);
  assert.equal(result!.status, 0);
  assert.equal(result!.stdout, "");
});
