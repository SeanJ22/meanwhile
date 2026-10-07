/** Speed is judged by the worst visit, an unfinished visit fails, every surface and Ask question is covered on phone and desktop, and the Scoreboard shows each verdict. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildLearningTrends } from "../lib/control-plane/admin-view/learning-trends.ts";
import { buildScoreboard, speedRow, v6LearningView } from "../lib/control-plane/admin-view/scoreboard-read.ts";
import { readLatestSpeedPass, recordSpeedPass } from "../lib/control-plane/live-audit-log.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { judgeSpeed, sampleZips, speedTargets, type ResidentTaskSet, type SpeedRun } from "../lib/health/worst-case-speed.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const tasks = JSON.parse(readFileSync("data/health/resident-tasks.json", "utf8")) as ResidentTaskSet;
const run = (surface: string, ms: number | null, over: Partial<SpeedRun> = {}): SpeedRun => ({ surface, zip: "00001", profile: "phone", ms, ...over });

test("the worst visit decides, not the median; one unfinished visit fails the row", () => {
  const pass = judgeSpeed([run("ballot", 900), run("ballot", 1000), run("ballot", 3400), run("map", 1200), run("map", null, { note: "it never became usable within 20 seconds" }), run("home", 2999)], NOW);
  const by = new Map(pass.rows.map((r) => [r.surface, r]));
  assert.equal(by.get("ballot")!.verdict, "FAIL", "the median passes, the worst does not");
  assert.equal(by.get("ballot")!.worstMs, 3400);
  assert.equal(by.get("map")!.verdict, "FAIL");
  assert.match(by.get("map")!.says, /1 of 2 visits never finished \(it never became usable within 20 seconds\)/);
  assert.equal(by.get("home")!.verdict, "PASS");
  assert.deepEqual([pass.passed, pass.failed], [1, 2]);
});

test("every surface in the resident-task set and every Ask question is measured, at each ZIP, on phone and desktop", () => {
  const targets = speedTargets(tasks, ["00001", "00002"]);
  const questions = new Set(tasks.tasks.flatMap((t) => (t.start === "ask" && t.question ? [t.question] : [])));
  assert.ok(questions.size >= 5);
  for (const surface of tasks.surfaces.filter((s) => s !== "ask")) assert.equal(targets.filter((t) => t.surface === surface).length, 4, surface);
  for (const q of questions) assert.equal(targets.filter((t) => t.question === q).length, 4, q);
  assert.deepEqual([...new Set(targets.map((t) => t.profile))].sort(), ["desktop", "phone"]);
});

test("the ZIP sample is drawn from the published places and moves day to day", () => {
  const zips = Array.from({ length: 40 }, (_, i) => String(10000 + i));
  const today = sampleZips(zips, 3, NOW);
  assert.equal(today.length, 3);
  for (const z of today) assert.ok(zips.includes(z));
  assert.notDeepEqual(today, sampleZips(zips, 3, "2026-10-06T12:00:00.000Z"));
  assert.deepEqual(sampleZips(["2", "1"], 3, NOW), ["1", "2"]);
});

test("a recorded pass reaches the Scoreboard row with each surface's verdict; with none, the row says so", async () => {
  const repos = createMemoryRepositories();
  assert.equal(await readLatestSpeedPass(repos, NOW), null);
  assert.match(speedRow(null).notMeasured!, /No speed check/);
  await recordSpeedPass(repos, judgeSpeed([run("ballot", 900), run("ask", 4100, { question: "Who gives money to my member of Congress?" })], "2026-10-05T11:00:00.000Z"));
  const pass = await readLatestSpeedPass(repos, NOW);
  const row = buildScoreboard({ places: null, placesUnread: 0, orders: null, publication: null, shutDoors: null, returning: null, doors: null, gates: null, readiness: [],
    learning: v6LearningView(buildLearningTrends([], NOW), null), speed: pass }).rows.find((r) => r.id === "Site speed and reliability")!;
  assert.equal(row.value, "1 of 2");
  assert.equal(row.items?.[0], "Ask: 1 of 1 visits over 3 seconds");
  assert.equal(row.items?.[1], "The ballot page: 0 of 1 visits over 3 seconds");
  assert.equal(row.items?.[2], 'Too slow: Ask "Who gives money to my member of Congress?" at 00001 on a phone: slowest of 1 visit took 4.1 seconds, over the 3.0 seconds limit.');
  assert.match(row.items?.[3] ?? "", /^Within the limit: The ballot page at 00001 on a phone/);
});
