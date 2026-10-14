/**
 * The "is it learning" view states only what is measured. A week with no
 * record is a gap, never a zero; a question nothing measures is listed as
 * "not measured yet" with what it needs.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildLearningTrends, type WeekLearningRow } from "../lib/control-plane/admin-view/learning-trends.ts";
import { v6LearningView } from "../lib/control-plane/admin-view/scoreboard-read.ts";

const week = (wk: string, over: Partial<WeekLearningRow> = {}): WeekLearningRow => ({
  week: wk, walks: 10, pairRecorded: 10, handed: 4, usedRecorded: 4, usedWalks: 2, reusedDoors: 3,
  rebuiltRecorded: 10, rebuiltRoutes: 1, resumed: 5, resumedFound: 3, fresh: 5, freshFound: 1, found: 4, usd: 2, unpriced: 0, ...over,
});

test("measured weeks become columns, a week between them is a gap, and the numbers keep their denominators", () => {
  const trends = buildLearningTrends([week("2026-09-14"), week("2026-09-28")], "2026-09-30T12:00:00.000Z");
  const view = v6LearningView(trends, { walks: 6, given: 12, used: 5, since: "2026-09-25" });
  const manual = view.trends.find((t) => t.question.startsWith("Are ways in learned"));
  assert.ok(manual, "the manual trend is drawn");
  assert.deepEqual(manual.weeks.map((w) => w.week), ["2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.equal(manual.weeks[1].values, null, "the week with no walk is a gap, not a zero");
  assert.deepEqual(manual.weeks[0].values, [40, 50]);
  assert.equal(manual.format, "pct");
  assert.equal(view.readings[0].big, "5 of 12");
});

test("nothing recorded yields no trend and says what each unmeasured question needs", () => {
  const view = v6LearningView(buildLearningTrends([], "2026-09-30T12:00:00.000Z"), null);
  assert.equal(view.trends.length, 0);
  assert.equal(view.readings.length, 0);
  assert.ok(view.notMeasured.length >= 5);
  for (const n of view.notMeasured) assert.ok(n.why.length > 0 && n.needs.length > 0, n.question);
});

test('Bank write errors show a measured zero, a count, or an unavailable number', () => {
  const trends = buildLearningTrends([], '2026-10-04T00:00:00Z');
  for (const count of [0, 3, null]) {
    const view = v6LearningView(trends, null, count);
    assert.equal(view.readings.find(r => r.bigNote === 'Bank write errors')!.big, count === null ? '—' : String(count));
  }
});

import { buildScoreboard, publicationCountsOf, type ScoreboardReadings } from "../lib/control-plane/admin-view/scoreboard-read.ts";
import type { V6HistoryReceipt } from "../lib/control-plane/admin-view/admin-v6-history.ts";
import { readGateHealth } from "../lib/control-plane/admin-view/gate-health.ts";
import { readinessCounts } from "../lib/coverage/readiness-counts.ts";
import type { PipelineRead } from "../lib/control-plane/admin-view/v6-results-read.ts";

const order = (status: V6HistoryReceipt["status"], says = ""): V6HistoryReceipt => ({ status, says } as V6HistoryReceipt);
const empty = v6LearningView(buildLearningTrends([], "2026-10-05T00:00:00Z"), null);
const readings = (over: Partial<ScoreboardReadings> = {}): ScoreboardReadings => ({
  places: null, placesUnread: 0, orders: null, publication: null, shutDoors: null, returning: null, learning: empty, doors: null, gates: null, readiness: readinessCounts({}), ...over,
});

test("the Scoreboard has one row for every number in the design, in order, and unread rows say so with no value", () => {
  const view = buildScoreboard(readings());
  assert.equal(view.rows.length, 25);
  assert.deepEqual(view.rows.map((r) => r.id).slice(0, 3), ["Orders", "Mission progress", "Checklist completeness"]);
  for (const r of view.rows) {
    assert.equal(r.value, null, `${r.id} shows — with nothing read`);
    assert.ok(r.notMeasured && r.notMeasured.length > 0, `${r.id} says why`);
  }
  assert.equal(view.gates, null);
});

test("wired rows show a value with the counts behind it, and shares never round up", () => {
  const approved = [
    { prefix: "x", recordClass: "a", n: 199, witness: "CONFIRMED_FRESH", approvedAt: null, checkedAt: null, url: null },
    { prefix: "x", recordClass: "a", n: 1, witness: "NOT_OBSERVED", approvedAt: null, checkedAt: null, url: null },
  ] as unknown as PipelineRead["approved"];
  const pipeline = { state: "READ", publishedAt: null, revision: null, pending: [], approved } as PipelineRead;
  const view = buildScoreboard(readings({
    orders: [order("done"), order("done"), order("running"), order("queued"), order("failed", "The place is not set up.")],
    publication: publicationCountsOf(pipeline, { readBack: 3, total: 4 }),
    shutDoors: { shut: 2, open: 40, setAside: 1, unreadable: 0 },
    returning: { days: 14, readerDays: 30, returningDays: 10 },
    doors: { walks: 6, given: 12, used: 5, since: "2026-09-25" },
    factoryLearning: { secondCoverage: { pairs: 1, firstMs: 3600000, secondMs: 900000, ratio: 0.25 }, headStart: { solved: 5, measured: 12, share: 5/12 }, detectiveReuse: 2, factsByWeek: [] },
  }));
  const by = (id: string) => view.rows.find((r) => r.id === id)!;
  assert.equal(by("Orders").value, "5");
  assert.match(by("Orders").counts!, /2 done · 1 in progress · 1 waiting · 1 could not be done/);
  assert.match(by("Orders").says, /The place is not set up/);
  assert.equal(by("Public delivery").value, "99%", "199 of 200 is 99%, not 100%");
  assert.match(by("Public delivery").counts!, /199 of 200/);
  assert.match(by("Public delivery").says, /3 of 4 kinds of record/);
  assert.equal(by("Shut doors").value, "2");
  assert.equal(by("Return visits").value, "33%");
  assert.equal(by("Head-start hit rate").value, "41%");
  assert.match(by("Head-start hit rate").counts!, /5 of 12/);
  assert.equal(by("Second-time coverage").value, "25%");
});

test("freshness, delivery and readiness stay separate rows and groups, and a read that failed is not a zero", () => {
  const view = buildScoreboard(readings({
    publication: { seen: 8, stale: 2, notFound: 0, unread: 0, contractsReadBack: null, contracts: null },
    gates: readGateHealth({ nowIso: "2026-10-05T00:00:00Z", heartbeat: null, databaseReachable: null, lastDispatch: null, spend: null }),
  }));
  const fresh = view.rows.find((r) => r.id === "Freshness")!;
  assert.equal(fresh.value, "80%");
  assert.match(fresh.counts!, /2 overdue/);
  assert.equal(view.rows.find((r) => r.id === "Public delivery")!.value, "80%");
  assert.ok(view.gates && view.gates.notMeasured > 0 && view.gates.pass === 0, "gates with no reading are not measured, never a pass");
  assert.equal(view.readiness.length, 4);
  assert.equal(buildScoreboard(readings({ orders: [] })).rows[0].value, "0", "an empty order history is a real zero");
});

import { defaultAdminConfig, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { sentPlaces, scoreboardPlaceOf, readScoreboardPlaces } from "../lib/control-plane/admin-view/scoreboard-places.ts";
import type { PlaceOwedRead } from "../lib/control-plane/admin-view/place-owed-read.ts";
import { buildPlaceOwedList, type HeldPlaceField, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { timeToCore } from "../lib/coverage/time-to-core.ts";
import { CORE_ITEMS_DEFAULT } from "../lib/control-plane/settings.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const nowIso = "2026-10-05T12:00:00Z";
const start = "2026-10-05T08:00:00Z";
const divisions = [{ id: county, label: "Cochise County" }];
const board: PlaceSubject = { id: "body:board", kind: "body", divisionIds: [county], label: "Board of Supervisors" };
const inventory = `${county}#inventory:body`;
const heldAt = (checklistId: string, checkedAt: string, subjectId = "body:board"): HeldPlaceField => ({ subjectId, checklistId, state: "published", sourceUrl: "https://x.gov", checkedAt, freshUntil: "2026-10-20T00:00:00Z" });
const readOf = (held: HeldPlaceField[]): PlaceOwedRead => ({ state: "READ", placeKey: "geo:az.county.04003", label: "Cochise County", covers: "x", divisions,
  rows: buildPlaceOwedList({ divisions, subjects: [board], held, now: nowIso }), observedAt: nowIso, readMs: { geography: 0, held: 0 } });
const CORE = new Set(["GOV-01", "GOV-02"]);

test("time to core information live: the last core blank to be held, from the mission start, and not yet while one is missing", () => {
  const rows = readOf([heldAt("GOV-01", "2026-10-05T08:20:00Z")]).rows;
  const waiting = timeToCore(rows, CORE, start)!;
  assert.equal(waiting.minutes, null, "GOV-02 is not held, so it is not live");
  assert.equal(waiting.n, 1);
  // The discovery row ("every body is found") is core too: the time waits for it.
  const withoutInventory = timeToCore(readOf([heldAt("GOV-01", "2026-10-05T08:20:00Z"), heldAt("GOV-02", "2026-10-05T08:42:00Z")]).rows, CORE, start)!;
  assert.equal(withoutInventory.minutes, null);
  const live = timeToCore(readOf([heldAt("GOV-01", "2026-10-05T08:20:00Z"), heldAt("GOV-02", "2026-10-05T08:42:00Z"), heldAt("GOV-01", "2026-10-05T08:30:00Z", inventory)]).rows, CORE, start)!;
  assert.equal(live.minutes, 42);
  assert.equal(live.alreadyHeld, false);
  const early = timeToCore(readOf([heldAt("GOV-01", "2026-10-01T00:00:00Z"), heldAt("GOV-02", "2026-10-02T00:00:00Z"), heldAt("GOV-01", "2026-10-01T00:00:00Z", inventory)]).rows, CORE, start)!;
  assert.equal(early.minutes, 0);
  assert.equal(early.alreadyHeld, true, "held before the mission started");
  assert.equal(timeToCore(rows, CORE, null), null, "a place never sent has no mission to time");
  assert.deepEqual([...CORE_ITEMS_DEFAULT], ["GOV-01", "GOV-02", "OFF-04", "MTG-06"]);
});

test("the Scoreboard rows read the Scorecard's measures with counts, a trend sentence and the mission figures", () => {
  const read = readOf([heldAt("GOV-01", "2026-10-05T08:20:00Z"), heldAt("GOV-02", "2026-10-05T08:42:00Z"), heldAt("GOV-01", "2026-10-05T08:30:00Z", inventory)]);
  const earlier = { day: "2026-10-04", at: "2026-10-04T12:00:00Z", completeness: { n: 1, of: 40 }, freshness: { n: 1, of: 1 }, delivery: { n: 0, of: 1 }, families: [] };
  const place = scoreboardPlaceOf(read, [earlier], start, CORE);
  const view = buildScoreboard(readings({ places: [place] }));
  const by = (id: string) => view.rows.find((r) => r.id === id)!;
  const completeness = by("Checklist completeness");
  assert.match(completeness.counts!, /owed items held across 1 sent place/);
  assert.match(completeness.says, /^Up from 2% on Oct 4 · good/, "the direction and its word, from the earlier day's counts");
  assert.match(by("Mission progress").counts!, /Starting list .* grown list .*1 mission/);
  assert.match(by("Time to core information live").counts!, /1 of 1 mission had core information live within an hour/);
  assert.equal(view.missions[0].coreLive, "42 minutes");
  assert.equal(view.missions[0].withinHour, true);
  assert.match(by("Freshness").counts!, /held items in sent places are current/);
  assert.equal(view.byPlace[0].label, "Cochise County");
  assert.ok(view.byFamily.length > 0 && view.byFamily.every((f) => f.completeness.of > 0));
  assert.equal(by("Coverage").value !== undefined, true);
});

test("with no place sent a Scorecard row says so and shows no value; with places unread it says so, never zero", () => {
  const none = buildScoreboard(readings({ places: [] }));
  assert.equal(none.rows.find((r) => r.id === "Checklist completeness")!.value, null);
  assert.match(none.rows.find((r) => r.id === "Checklist completeness")!.notMeasured!, /No place has been sent yet/);
  const unread = buildScoreboard(readings({ places: null }));
  assert.match(unread.rows.find((r) => r.id === "Checklist completeness")!.notMeasured!, /could not be read/);
  const place = scoreboardPlaceOf(readOf([]), [], start, CORE);
  const some = buildScoreboard(readings({ places: [place], placesUnread: 2 }));
  assert.match(some.rows.find((r) => r.id === "Checklist completeness")!.says, /2 sent places were not read in time/);
});

test("the sent places are the saved missions, newest first, each once, read within a time budget", async () => {
  const scope = (geoid: string, decidedAt: string) => ({ key: `v/${geoid}`, geography: { type: "county", geoid, stateAbbr: "AZ", label: geoid }, priority: 1, budgetUsd: 5, note: null, decidedAt, decidedBy: "x", receiptId: `r${geoid}`, previous: null });
  const config = { ...defaultAdminConfig(nowIso), expansionScopes: [scope("04003", "2026-10-01T00:00:00Z"), scope("04019", "2026-10-03T00:00:00Z"), scope("04003", "2026-10-02T00:00:00Z")] } as unknown as AdminConfig;
  assert.deepEqual(sentPlaces(config).map((p) => p.placeKey), ["geo:az.county.04019", "geo:az.county.04003"]);
  assert.deepEqual(sentPlaces(null), []);
  const read = readOf([]);
  const out = await readScoreboardPlaces(config, CORE, { readOwed: async (key) => (key.endsWith("04003") ? read : await new Promise<never>(() => {})), readHistory: async () => [], budgetMs: 30 });
  assert.equal(out.places.length, 1);
  assert.equal(out.unread, 1, "the place that did not answer in time is counted as unread");
});

test("using handed doors alone does not claim targets solved from the Bank", () => {
  const view = buildScoreboard(readings({ doors: { walks: 6, given: 12, used: 5, since: "2026-09-25" } }));
  assert.equal(view.rows.find(r => r.id === "Head-start hit rate")!.value, null);
});

test("four direct learning measures replace the old weekly Scout panel when connected", () => {
  const factory = { secondCoverage: { pairs: 1, firstMs: 3600000, secondMs: 900000, ratio: 0.25 },
    headStart: { solved: 2, measured: 4, share: 0.5 }, detectiveReuse: 3,
    factsByWeek: [{ week: "2026-10-05T00:00:00Z", facts: 24, observedHours: 12, perHour: 2 }] };
  const view = v6LearningView(buildLearningTrends([], "2026-10-06T00:00:00Z"), null, undefined, factory);
  assert.equal(view.trends.length, 0);
  assert.deepEqual(view.readings.map(r => r.big), ["3", "50%", "25%", "2.00"]);
});

test("the replacement learning panel retains failed Bank writes and unknown counts", () => {
  const factory = { secondCoverage: { pairs: 0, firstMs: 0, secondMs: 0, ratio: null }, headStart: { solved: 0, measured: 0, share: null }, detectiveReuse: null, factsByWeek: [] };
  for (const count of [null, 0, 3]) {
    const view = v6LearningView(buildLearningTrends([], "2026-10-06T00:00:00Z"), null, count, factory);
    assert.equal(view.readings.find(r => r.bigNote === "Bank write errors")!.big, count === null ? "—" : String(count));
  }
});

test("the fact store's facts live per hour sit beside the older count, and its blanks say where each stopped in plain words", () => {
  const view = buildScoreboard(readings({ factStore: {
    hours: [{ hour: "2026-10-13T17:00:00.000Z", live: 4 }, { hour: "2026-10-13T18:00:00.000Z", live: 12 }],
    lastHour: 12, last24: 16, liveNow: 340,
    blanks: [{ stage: "CHECK", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY", n: 3 }, { stage: "ACQUIRE", reason: "NOT_YET_ACQUIRED", n: 2 }],
  } }));
  const ids = view.rows.map((r) => r.id);
  assert.equal(ids.indexOf("Facts live per hour (fact store)"), ids.indexOf("Facts live per hour") + 1);
  const live = view.rows.find((r) => r.id === "Facts live per hour (fact store)")!;
  assert.equal(live.value, "12");
  assert.equal(live.counts, "16 facts went live in the last 24 hours · 340 live now");
  const stuck = view.rows.find((r) => r.id === "Stuck facts by reason")!;
  assert.deepEqual(stuck.items, ["3 failed the source check: the quoted words are not on the saved page", "2 not found yet"]);
  assert.ok(!stuck.items!.some((line) => /[A-Z]{2,}_/.test(line)), "no codes on the screen");
});

