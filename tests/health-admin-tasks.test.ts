import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { countWords, judgeAdminRun, judgeAdminTask, validateAdminTasks, type AdminTaskFile, type AdminTaskReading } from "../lib/health/admin-tasks.ts";

const file = JSON.parse(readFileSync("data/health/admin-tasks.json", "utf8")) as AdminTaskFile;
const good = (taskId: string): AdminTaskReading => ({ taskId, taps: 1, words: 100, decisionMs: 5000, firstOpenMs: 1200, reached: true, screenshot: `admin-tasks/${taskId}.png` });

describe("FE-37: Admin is reviewed by running Sean's tasks", () => {
  it("holds Sean's six tasks as data, each starting on a real Admin view", () => {
    assert.deepEqual(validateAdminTasks(file), []);
    assert.equal(file.tasks.length, 6);
  });
  it("counts words as a reader does", () => {
    assert.equal(countWords("  Start a   mission\nnow "), 4);
    assert.equal(countWords(""), 0);
  });
  it("is green inside every budget and red, in plain words, outside any one", () => {
    const t = file.tasks[0];
    assert.equal(judgeAdminTask(t, good(t.id)).verdict, "green");
    const slow = judgeAdminTask(t, { ...good(t.id), firstOpenMs: 3500 });
    assert.equal(slow.verdict, "red");
    assert.match(slow.reasons[0], /3\.5 seconds to open; 3\.0 seconds/);
    assert.equal(judgeAdminTask(t, { ...good(t.id), words: t.wordBudget + 1 }).verdict, "red");
    assert.equal(judgeAdminTask(t, { ...good(t.id), taps: t.tapBudget + 1 }).verdict, "red");
    assert.equal(judgeAdminTask(t, { ...good(t.id), reached: false }).verdict, "red");
  });
  it("never counts an unmeasured reading or a skipped task as green", () => {
    const t = file.tasks[0];
    assert.equal(judgeAdminTask(t, { ...good(t.id), decisionMs: null }).verdict, "red");
    assert.equal(judgeAdminTask(t, { ...good(t.id), words: null }).verdict, "red");
    const run = judgeAdminRun(file, file.tasks.slice(1).map((x) => good(x.id)));
    assert.equal(run.red, 1);
    assert.equal(run.green, 5);
    assert.deepEqual(run.flags[0].reasons, ["This task was not run."]);
  });
});
