/** Every resident task has scripted taps that name no place, runs at a newly published place first, passes only within budget with every part shown, and reads in Admin as a pass or fail with its screenshot strip. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readLatestTaskPass, readTaskZips, recordTaskPass } from "../lib/control-plane/live-audit-log.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  chooseTaskZips, judgeTask, residentTaskView, saysGathering, shotKey, TASK_SCRIPTS, taskPass, taskTargets, WORDS,
  type ResidentTaskFile, type TaskRunInput,
} from "../lib/health/resident-tasks.ts";
import { storeRunScreenshot } from "../lib/photos/store.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const file = JSON.parse(readFileSync("data/health/resident-tasks.json", "utf8")) as ResidentTaskFile;
const task = (id: string) => file.tasks.find((t) => t.id === id)!;
const step = (says: string, ms: number | null = 400) => ({ says, ms, shot: `resident-tasks/x/${says}.png`, issues: {} });
const input = (over: Partial<TaskRunInput> = {}): TaskRunInput => ({
  taskId: "council-meeting-and-comment", zip: "00001", profile: "phone",
  steps: [step("Opened the home page", 1200), step("Tapped Who governs here?"), step("Tapped the city or town government"), step("Tapped the body's meetings", 3400)],
  taps: 3, deadEnd: null, missing: [], ...over,
});

test("every task in the FE-17 file has a script, and no script names a place", () => {
  for (const t of file.tasks) assert.ok(TASK_SCRIPTS[t.id], `${t.id} has no script`);
  assert.deepEqual(Object.keys(TASK_SCRIPTS).sort(), file.tasks.map((t) => t.id).sort());
  const words = JSON.stringify(TASK_SCRIPTS);
  assert.doesNotMatch(words, /\b\d{5}\b/, "no ZIP code");
  assert.doesNotMatch(words, /Tucson|Pima|Vail|Rockaway|Newbury|Arizona|New Jersey|New Hampshire/i, "no particular place");
  for (const [id, script] of Object.entries(TASK_SCRIPTS)) {
    assert.ok(script.checks.length > 0, `${id} checks something`);
    const taps = script.steps.reduce((n, s) => n + (s.kind === "ask" ? 2 : 1), 0);
    assert.ok(taps - script.steps.filter((s) => s.kind === "tap" && s.optional).length <= task(id).tapBudget, `${id}'s required taps fit its budget`);
  }
});

test("an Ask task counts only an answer from our records, never the general-knowledge fallback", () => {
  const first = TASK_SCRIPTS["ask-next-council-meeting"].checks[0];
  assert.match(first.css ?? "", /data-ask-grounded-mode='GROUNDED_CLAUDE'/);
  assert.ok(!(first.css ?? "").split(", ").includes("[data-ask-grounded]"), "a bare grounded marker also wraps the fallback");
});

test("a task passes only when every tap landed, every part was shown and the taps stayed within budget", () => {
  const ok = judgeTask(task("council-meeting-and-comment"), input());
  assert.equal(ok.verdict, "PASS");
  assert.equal(ok.worstMs, 3400, "the slowest step is kept");
  assert.match(ok.says, /done in 3 taps; slowest step 3\.4 seconds, over three seconds\./);

  const dead = judgeTask(task("council-meeting-and-comment"), input({ taps: 1, deadEnd: "could not find the city or town government" }));
  assert.equal(dead.verdict, "FAIL");
  assert.match(dead.says, /dead end after 1 tap: could not find the city or town government\./);

  const missing = judgeTask(task("council-meeting-and-comment"), input({ missing: ["how to attend or comment", "the source"] }));
  assert.equal(missing.verdict, "FAIL");
  assert.match(missing.says, /did not show how to attend or comment and the source/);

  const over = judgeTask(task("council-meeting-and-comment"), input({ taps: 4 }));
  assert.equal(over.verdict, "FAIL");
  assert.match(over.says, /took 4 taps, over the 3-tap budget/);
});

test("a newly published place is queued for its first run and is never dropped from the sample", () => {
  const published = ["00001", "00002", "00003", "00004", "00005"];
  const first = chooseTaskZips(published, new Set(["00001", "00002", "00003"]), 3, NOW);
  assert.deepEqual(first.queued, ["00004", "00005"]);
  assert.deepEqual(first.zips.slice(0, 2), ["00004", "00005"]);
  assert.equal(first.zips.length, 3);
  const many = chooseTaskZips(published, new Set(), 2, NOW);
  assert.deepEqual(many.zips, published, "every never-run ZIP runs even past the sample size");
  const none = chooseTaskZips(published, new Set(published), 2, NOW);
  assert.deepEqual(none.queued, []);
  assert.equal(none.zips.length, 2);
});

test("every task runs on phone and desktop; Ask tasks only at the first Ask ZIP, on a phone", () => {
  const targets = taskTargets(file.tasks, ["00001", "00002"], 1);
  const ask = targets.filter((t) => t.task.start === "ask");
  assert.ok(ask.length >= 5);
  assert.ok(ask.every((t) => t.zip === "00001" && t.profile === "phone"));
  const other = targets.filter((t) => t.task.start !== "ask");
  assert.equal(other.length, file.tasks.filter((t) => t.start !== "ask").length * 2 * 2);
  assert.equal(taskTargets(file.tasks, ["00001"], 0).filter((t) => t.task.start === "ask").length, 0, "0 leaves Ask out");
});

test("a 'still being gathered' line answers only for its own part", () => {
  const card = "Positions\nCommittees\nOffices near you\nCampaign money\nWe're working on getting this info.\nPublic statements";
  assert.equal(saysGathering(card, { orGathering: true, part: "campaign money|funding" }), true);
  assert.equal(saysGathering(card, { orGathering: true, part: "positions|votes" }), false, "money's gap is not an answer about votes");
  assert.equal(saysGathering("We're working on getting this info.", { orGathering: true }), true);
  assert.equal(saysGathering("We're working on getting this info.", {}), false);
});

test("the reader words match what live pages show", () => {
  const re = (k: keyof typeof WORDS) => new RegExp(WORDS[k], "i");
  assert.match("Tue, October 6th, 2026", re("date"));
  assert.match("November 3rd, 2026", re("date"));
  assert.match("5:30 PM MST", re("time"));
  assert.match("Tucson City Hall · 255 W. Alameda St, Tucson", re("address"));
  assert.doesNotMatch("254 meetings · 17 venues", re("address"));
  assert.match("MAKE YOUR VOICE HEARD", re("attendOrComment"));
  assert.match("We’re working on getting this info.", re("gathering"));
  assert.match("Register to vote by October 5th, 2026", re("registration"));
  assert.match("Election Day", re("votingDeadline"));
});

test("screenshots keep to their own prefix in the portrait store", async () => {
  const key = shotKey(NOW, "resident-tasks@2026-10-05T12:00:00.000Z", "mayor-vote", "00001", "desktop", 2);
  assert.match(key, /^resident-tasks\/2026-10-05\/[a-zA-Z0-9._-]+\/mayor-vote-00001-desktop-2\.png$/);
  const put: string[] = [];
  await storeRunScreenshot(key, new Uint8Array([1]), { put: async (k) => { put.push(k); } });
  assert.deepEqual(put, [key]);
  await assert.rejects(storeRunScreenshot("officials/x.png", new Uint8Array([1]), { put: async () => {} }), /OUTSIDE_PREFIX/);
});

test("a pass is kept in the live-audit log, its ZIPs stop being queued, and Admin reads failures first with the strip", async () => {
  const repos = createMemoryRepositories();
  const runs = [
    judgeTask(task("council-meeting-and-comment"), input()),
    judgeTask(task("mayor-vote"), input({ taskId: "mayor-vote", profile: "desktop", missing: ["a recent vote"] })),
  ];
  const pass = taskPass(runs, NOW, "run-1", ["00001"]);
  await recordTaskPass(repos, pass);
  assert.deepEqual([...(await readTaskZips(repos))], ["00001"]);
  assert.deepEqual(chooseTaskZips(["00001", "00009"], await readTaskZips(repos), 2, NOW).queued, ["00009"]);
  const latest = await readLatestTaskPass(repos, "2026-10-06T01:00:00.000Z");
  assert.equal(latest?.runId, "run-1");

  const view = residentTaskView(latest, (k) => `/img/${k}`)!;
  assert.equal(view.summary, "1 of 2 resident tasks passed at 00001. First run for newly published ZIP 00001.");
  assert.deepEqual(view.rows.map((r) => [r.task, r.device, r.result]), [["See how my mayor voted", "Desktop", "Failed"], [task("council-meeting-and-comment").title, "Phone", "Passed"]]);
  assert.equal(view.rows[1].strip.length, 4);
  assert.equal(view.rows[1].strip[0].image, "/img/resident-tasks/x/Opened the home page.png");
  assert.equal(view.rows[1].strip[3].took, "3.4 seconds");
  assert.doesNotMatch(JSON.stringify(view), /FAIL|PASS|council-meeting-and-comment/, "plain words in Admin, no codes");
  assert.equal(residentTaskView(null, (k) => k), null);
});
