import assert from "node:assert/strict";
import test from "node:test";
import { CAPTURE_DAYS, captureWindow, failuresView, headlineOf, readCaptureHealth } from "../lib/control-plane/admin-view/v6-capture-health.ts";
import { readCaptureFailures, type HistoryStore, type Query } from "../lib/control-plane/data-business/live.ts";
import { placeIndex } from "../lib/control-plane/data-business/places.ts";
import { defaultAdminConfig, withDataSwitch } from "../lib/control-plane/gateway/admin-config.ts";
import type { ReadDeps, Sources } from "../lib/control-plane/data-business/read.ts";
import type { TotalsRow } from "../lib/control-plane/data-business/types.ts";

const NOW = new Date("2026-10-01T12:00:00Z");
const NJ7 = "ocd-division/country:us/state:nj/cd:7";
const FL7 = "ocd-division/country:us/state:fl/cd:7";
const row = (r: Partial<TotalsRow> & Pick<TotalsRow, "period" | "topic" | "type" | "events" | "users">): TotalsRow => ({ grain: "day", zip: null, district: null, ...r });

const DAY_ROWS: TotalsRow[] = [
  row({ period: "2026-09-30", topic: "*", type: "ASK", events: 6, users: 3 }), row({ period: "2026-09-30", topic: "*", type: "ZIP_VIEW", events: 9, users: 5 }),
  row({ period: "2026-10-01", topic: "*", type: "ASK", events: 4, users: 2 }), row({ period: "2026-10-01", topic: "*", type: "REACTION", events: 3, users: 2 }),
  row({ period: "2026-09-30", topic: "housing", type: "ASK", events: 4, users: 2 }), row({ period: "2026-09-30", topic: "free-form", type: "ASK", events: 2, users: 1 }),
  row({ period: "2026-10-01", topic: "free-form", type: "ASK", events: 4, users: 2 }),
];
const WEEK_ROWS: TotalsRow[] = [
  row({ grain: "week", period: "2026-09-28", district: NJ7, topic: "*", type: "*", events: 20, users: 7 }),
  row({ grain: "week", period: "2026-09-28", district: FL7, topic: "*", type: "*", events: 5, users: 2 }),
];
const sources = (over: Partial<Sources> = {}): Sources => ({
  places: placeIndex(async () => null, async () => { throw new Error("Map unavailable"); }),
  totals: async (q) => ({ kind: "ROWS", rows: (q.grain === "week" ? WEEK_ROWS : DAY_ROWS).filter((r) => (q.family === "district" ? r.district !== null : r.district === null && r.zip === null)) }),
  cohorts: async () => ({ kind: "ROWS", rows: [{ grain: "day", period: "2026-09-30", readers: 8, newReaders: 5 }, { grain: "day", period: "2026-10-01", readers: 10, newReaders: 3 }] }),
  events: async () => ({ kind: "ROWS", rows: [] }),
  ...over,
});
const deps = (over: Partial<Sources> = {}): ReadDeps => ({ sources: sources(over), switchOn: () => true });
const measured = { kind: "MEASURED", batchesRecorded: 12, eventsRecorded: 22, eventsCounted: 22, archivedNotCounted: 0, archiveNote: null } as const;

test("THE WINDOW is the fourteen UTC days ending today", () => {
  assert.deepEqual(captureWindow(NOW), { from: "2026-09-18", to: "2026-10-01" });
  assert.equal(CAPTURE_DAYS, 14);
});

test("CAPTURE HEALTH: events per day by type, topics vs free-form, new vs returning, and a Florida district beside a New Jersey one", async () => {
  const v = await readCaptureHealth(deps(), null, measured, NOW);
  assert.equal(v.days.length, 14);
  assert.equal(v.days[13], "2026-10-01");
  assert.equal(v.headline.state, "recording");
  assert.match(v.headline.says, /7 events on 2026-10-01 so far today/);
  assert.equal(v.byType.kind, "READ");
  const types = v.byType.kind === "READ" ? v.byType.rows : [];
  assert.deepEqual(types.map((t) => [t.type, t.total, t.perDay.slice(-2)]), [["ASK", 10, [6, 4]], ["ZIP_VIEW", 9, [9, 0]], ["REACTION", 3, [0, 3]]]);
  const topics = v.topics.kind === "READ" ? v.topics.rows : [];
  assert.deepEqual(topics.slice(-2).map((t) => [t.day, t.inTopic, t.freeForm, t.percentInTopic]), [["2026-09-30", 4, 2, 66.7], ["2026-10-01", 0, 4, 0]]);
  assert.equal(topics[0].percentInTopic, null, "a day with no questions has no share, not 0%");
  const readers = v.readers.kind === "READ" ? v.readers.rows : [];
  assert.deepEqual(readers.slice(-2).map((r) => [r.day, r.readers, r.newReaders, r.returning]), [["2026-09-30", 8, 5, 3], ["2026-10-01", 10, 3, 7]]);
  const d = v.districts.kind === "READ" ? v.districts.rows : null;
  assert.equal(d?.week, "2026-09-28");
  assert.deepEqual(d?.rows.map((r) => [r.label, r.state, r.events, r.readers, r.percent]), [["NJ-7", "NJ", 20, 7, 80], ["FL-7", "FL", 5, 2, 20]]);
  assert.equal(v.failures.kind, "MEASURED");
  assert.doesNotMatch(JSON.stringify(v), /[0-9a-f]{64}|reader_hash|occurredAt/, "nothing in the view is an id or an exact time");
});

test("HEADLINE: recording, quiet, nothing yet, and unknown are four different sentences", () => {
  const days = ["2026-09-30", "2026-10-01"];
  assert.equal(headlineOf(days, new Map([["2026-10-01", 5]]), "2026-10-01").state, "recording");
  assert.equal(headlineOf(days, new Map([["2026-09-30", 5]]), "2026-10-01").state, "recording", "yesterday counts while today is young");
  const quiet = headlineOf(days, new Map([["2026-09-26", 5]]), "2026-10-01");
  assert.equal(quiet.state, "quiet");
  assert.match(quiet.says, /2026-09-26, 5 days ago/);
  assert.equal(headlineOf(days, new Map(), "2026-10-01").state, "none");
  const unknown = headlineOf(days, null, "2026-10-01");
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.says, "—");
});

test("A STORE THAT IS NOT INSTALLED is said in every block; a recipe switched off for Admin is shown as off, never as empty", async () => {
  const gone: Partial<Sources> = { totals: async () => ({ kind: "NOT_INSTALLED", detail: "Reader events need migration 0034." }), cohorts: async () => ({ kind: "NOT_INSTALLED", detail: "Reader events need migration 0034." }) };
  const v = await readCaptureHealth(deps(gone), null, null, NOW);
  assert.equal(v.headline.state, "unknown");
  for (const block of [v.byType, v.topics, v.readers, v.districts]) assert.deepEqual([block.kind, "says" in block && /migration 0034/.test(block.says)], ["UNAVAILABLE", true]);
  assert.equal(v.failures.kind, "UNAVAILABLE");
  const off = withDataSwitch(defaultAdminConfig("2026-10-01T00:00:00Z"), { recipe: "new-vs-returning", audience: "admin", on: false, decidedAt: "2026-10-01T00:00:00Z", decidedBy: "owner", receiptId: "r" });
  const switched = await readCaptureHealth(deps(), off, measured, NOW);
  assert.equal(switched.readers.kind, "OFF");
  assert.equal(switched.byType.kind, "READ");
});

test("DID ANYTHING FAIL TO RECORD: the totals must match the batches, and no batch may be archived and left uncounted", () => {
  const ok = failuresView(measured, "2026-09-18", "2026-10-01");
  assert.equal(ok.kind === "MEASURED" && ok.lines.every((l) => l.ok), true);
  const lost = failuresView({ ...measured, eventsCounted: 19, archivedNotCounted: 2 }, "2026-09-18", "2026-10-01");
  assert.deepEqual(lost.kind === "MEASURED" && lost.lines.map((l) => l.ok), [false, false]);
  assert.match(lost.kind === "MEASURED" ? lost.lines[0].says : "", /22 events but the counts hold 19: 3 were recorded and not counted/);
  assert.match(lost.kind === "MEASURED" ? lost.lines[1].says : "", /2 batches .* never reached the counts/);
  const unchecked = failuresView({ ...measured, archivedNotCounted: null, archiveNote: "The history store is not reachable from here, so batches archived but never counted were not checked." }, "a", "b");
  assert.equal(unchecked.kind === "MEASURED" && unchecked.lines[1].ok, false, "an unchecked archive is not a clean one");
});

test("THE MEASUREMENT: batches in the history store with no database row are the ones that failed to count", async () => {
  const query: Query = async (text) => text.includes("FROM reader_event_batches WHERE archive_key")
    ? [{ archive_key: "events/2026-10-01/aa.json.gz" }]
    : text.includes("FROM reader_event_batches") ? [{ batches: "2", events: "9" }] : [{ events: "7" }];
  const history: HistoryStore = { list: async (prefix) => (prefix === "events/2026-10-01/" ? ["events/2026-10-01/aa.json.gz", "events/2026-10-01/bb.json.gz"] : []), get: async () => null };
  const f = await readCaptureFailures({ query, history, from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(f, { kind: "MEASURED", batchesRecorded: 2, eventsRecorded: 9, eventsCounted: 7, archivedNotCounted: 1, archiveNote: null });
  const noStore = await readCaptureFailures({ query, history: null, from: "2026-10-01", to: "2026-10-01" });
  assert.equal(noStore.kind === "MEASURED" && noStore.archivedNotCounted, null);
  const broken: HistoryStore = { list: async () => { throw new Error("no credentials"); }, get: async () => null };
  const partial = await readCaptureFailures({ query, history: broken, from: "2026-10-01", to: "2026-10-01" });
  assert.equal(partial.kind === "MEASURED" && partial.archivedNotCounted, null, "a store that cannot be listed is unchecked, not clean");
  const missing: Query = async () => { throw Object.assign(new Error("gone"), { code: "42P01" }); };
  assert.equal((await readCaptureFailures({ query: missing, history: null, from: "a", to: "b" })).kind, "NOT_INSTALLED");
});
