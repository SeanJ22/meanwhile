/** DP-26: a fix in Testing is a Queue row; proving out, a lesson, and a proven fix breaking each write one update; then it goes quiet. */
import assert from "node:assert/strict";
import test from "node:test";

import { buildQueue } from "../app/(admin)/_mw/admin-v6/queue.ts";
import { buildScoreboard, provenFixesRow, type ScoreboardReadings } from "../lib/control-plane/admin-view/scoreboard-read.ts";
import { updatesView } from "../lib/control-plane/admin-view/updates-read.ts";
import { v6FixesView } from "../lib/control-plane/admin-view/v6-fixes-read.ts";
import { recordAttemptsKeepingHistory } from "../lib/control-plane/fix-history.ts";
import { fixQueueView } from "../lib/control-plane/fix-queue.ts";
import { fixesInTesting, methodStandings, noteMethodLesson, provenFixesReading } from "../lib/control-plane/fix-standing.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { takeUnshownUpdates, updateRecords } from "../lib/control-plane/updates.ts";
import { memoryFixMap, type MethodAttempt } from "../lib/method/fix-map-record.ts";
import { DEFAULT_FIX_PROOF_BAR, FIX_PROOF_PLACES, fixProof, nextStanding } from "../lib/method/fix-status.ts";

const PLACES = ["az/county:a", "az/county:b", "nm/county:c", "nm/county:d", "nm/county:e", "nm/county:f"].map((p) => {
  const [state, county] = p.split("/");
  return `ocd-division/country:us/state:${state}/${county}`;
});
const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`;
const attempt = (place: string, outcome: "SUCCEEDED" | "FAILED", day: number, method = "m-agenda"): MethodAttempt =>
  ({ kind: "ROUTE_RUN", attemptId: `${method}:${place}:${day}`, placeId: place, methodIds: [method], outcome, cause: outcome === "FAILED" ? "The page moved." : null, at: at(day) });
const title = () => "the agenda-listing route";

async function config(repos: ReturnType<typeof createMemoryRepositories>): Promise<AdminConfig> {
  return (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value as AdminConfig;
}

test("a fix is a Queue row while testing, writes one Proven update when it proves out, then leaves the Queue", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  await recordAttemptsKeepingHistory(map, repos, [attempt(PLACES[0], "SUCCEEDED", 1), attempt(PLACES[1], "SUCCEEDED", 1)], title);
  let c = await config(repos);
  assert.equal(updateRecords(c).filter((u) => u.id.startsWith("fix-status:")).length, 0, "entering Testing writes no update");
  const testing = v6FixesView(fixQueueView([]), [], at(1), { standings: fixesInTesting(c), bar: DEFAULT_FIX_PROOF_BAR }).testing!;
  assert.equal(testing.length, 1);
  const rows = buildQueue({ receipts: null, sends: null, hunts: null, stuck: null, doors: null, scheduled: null, fixes: { open: [], closed: [], returned: [], testing } });
  assert.deepEqual(rows.map((r) => [r.what, r.chip, r.filter, r.progress?.done, r.progress?.of]), [["Testing: the agenda-listing route", "Testing", "in-progress", 2, 5]]);
  assert.doesNotMatch(rows[0].what + rows[0].next, /m-agenda|ocd-division/, "no ids on Admin");

  await recordAttemptsKeepingHistory(map, repos, [attempt(PLACES[2], "SUCCEEDED", 2), attempt(PLACES[3], "SUCCEEDED", 2), attempt(PLACES[4], "SUCCEEDED", 2)], title);
  c = await config(repos);
  const proven = updateRecords(c).filter((u) => u.id.startsWith("fix-status:"));
  assert.deepEqual(proven.map((u) => [u.what, u.label]), [["Proven: the agenda-listing route worked in 5 places, failed in 0 places.", "PROVEN"]]);
  assert.equal(fixesInTesting(c).length, 0, "a proven fix drops out of the Queue");

  // Quiet: more successes write nothing more, and Now shows the Proven update once.
  await recordAttemptsKeepingHistory(map, repos, [attempt(PLACES[5], "SUCCEEDED", 3)], title);
  c = await config(repos);
  assert.equal(updateRecords(c).filter((u) => u.id.startsWith("fix-status:")).length, 1);
  assert.equal((await takeUnshownUpdates(repos, at(4))).filter((u) => u.id.startsWith("fix-status:")).length, 1);
  assert.equal((await takeUnshownUpdates(repos, at(4))).length, 0);
});

test("a proven fix that breaks says so once, never as a win, and the Scoreboard names it", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  await recordAttemptsKeepingHistory(map, repos, PLACES.map((p) => attempt(p, "SUCCEEDED", 1)), title);
  await recordAttemptsKeepingHistory(map, repos, [attempt(PLACES[0], "FAILED", 5)], title);
  const c = await config(repos);
  const broke = updateRecords(c).filter((u) => u.id.includes(":broke:"));
  assert.equal(broke.length, 1);
  assert.match(broke[0].what, /^A proven fix broke: the agenda-listing route stopped working in 1 place where it had worked\. It is back in testing: works in 5 places of 6 places tried\.$/);
  assert.equal(updatesView(broke, at(5)).updates[0].isWin, false);
  assert.equal(fixesInTesting(c).length, 1, "below the bar, it is back in the Queue");
  const reading = provenFixesReading(c, at(6));
  assert.deepEqual([reading.proven, reading.testing, reading.broke.length], [0, 1, 1]);
  const r = provenFixesRow(reading);
  assert.equal(r.value, "0");
  assert.match(r.counts ?? "", /1 broke in the last 30 days/);
  assert.match(r.items?.[0] ?? "", /^Broke Sep 5: the agenda-listing route \(back in testing\)$/);
  // Thirty days on, the break no longer shows.
  assert.equal(provenFixesReading(c, "2026-10-20T00:00:00.000Z").broke.length, 0);
});

test("a lesson that changes a method puts it back in Testing with one update", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  await recordAttemptsKeepingHistory(map, repos, PLACES.map((p) => attempt(p, "SUCCEEDED", 1)), title);
  const told = await noteMethodLesson(map, repos, "m-agenda", "Both failures were sites posting agendas as images; a version that reads them was built", at(7), "the agenda-listing route");
  assert.equal(told?.kind, "LESSON");
  const c = await config(repos);
  assert.match(updateRecords(c).find((u) => u.id === told!.id)!.what, /^A lesson changed the agenda-listing route: Both failures .* built\. It is being tested again\.$/);
  assert.deepEqual(methodStandings(c).map((s) => [s.status, s.lessonAt]), [["TESTING", at(7)]]);
});

test("the bar is the Admin setting: raising it keeps a fix in Testing", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { apiFallback: { enabled: false }, settings: { [FIX_PROOF_PLACES]: 10 }, updatedAt: at(1) } as unknown as AdminConfig, at(1));
  await recordAttemptsKeepingHistory(map, repos, PLACES.map((p) => attempt(p, "SUCCEEDED", 1)), title);
  const c = await config(repos);
  assert.equal(fixesInTesting(c).length, 1);
  assert.equal(updateRecords(c).filter((u) => u.id.startsWith("fix-status:")).length, 0);
});

test("pure transitions: no change, no update", () => {
  const rows = PLACES.slice(0, 2).map((p) => ({ methodId: "m", placeId: p, state: "WORKS" as const, triedAt: at(1), attemptId: p, cause: null, updatedAt: at(1) }));
  const first = nextStanding("m", null, fixProof(rows), "x", at(1));
  assert.equal(first.update, null);
  assert.equal(nextStanding("m", first.standing, fixProof(rows), "x", at(2)).update, null);
});

test("the Scoreboard's Proven fixes row is wired, not a placeholder", () => {
  const empty = { trends: [], readings: [], notMeasured: [] };
  const base: ScoreboardReadings = { places: null, placesUnread: 0, orders: null, publication: null, shutDoors: null, returning: null, learning: empty, doors: null, gates: null, readiness: [] };
  const rowOf = (r: ScoreboardReadings) => buildScoreboard(r).rows.find((x) => x.id === "Proven fixes")!;
  assert.equal(rowOf(base).value, null);
  assert.equal(rowOf({ ...base, provenFixes: { proven: 3, testing: 2, broke: [] } }).value, "3");
  assert.match(rowOf({ ...base, provenFixes: { proven: 3, testing: 2, broke: [] } }).counts ?? "", /^3 proven · 2 testing$/);
});
