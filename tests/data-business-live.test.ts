import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { cohortsSql, eventsOfBatch, historyEvents, HISTORY_BATCH_LIMIT, liveCohorts, liveSources, liveTotals, totalsSql, type HistoryStore, type Query } from "../lib/control-plane/data-business/live.ts";
import { readRecipe } from "../lib/control-plane/data-business/read.ts";

const batch = (events: object[], extra: object = {}) => JSON.stringify({ version: 1, batchId: "b", reader: "f".repeat(64), events, ...extra });
const stored = (over: object) => ({ id: "e", type: "ASK", occurredAt: "2026-10-02T23:59:58.000Z", zip: "07090", district: null, residencyRelation: "HOME", cardId: null, cardKind: null, durationMs: null,
  question: "Where do I vote?", selfDisclosureFlags: [], topic: "free-form", reaction: null, ballotPick: null, ...over });

test("A STORED BATCH BECOMES EVENTS WITH A DAY AND NO TIME: the exact time is reduced to its UTC day before any recipe sees it", () => {
  const events = eventsOfBatch(batch([stored({}), stored({ id: "f", occurredAt: "2026-10-03T00:00:01.000Z", type: "REACTION", reaction: "YES", cardId: "jane-doe" }), stored({ type: "NOPE" }), stored({ occurredAt: "garbage" })]));
  assert.deepEqual(events.map((e) => [e.type, e.day, e.zip, e.text, e.reaction, e.cardId, e.tester]), [
    ["ASK", "2026-10-02", "07090", "Where do I vote?", null, null, false], ["REACTION", "2026-10-03", "07090", "Where do I vote?", "YES", "jane-doe", false]], "unknown types and bad times are skipped");
  assert.ok(events.every((e) => !("occurredAt" in e)), "no event carries a time");
  assert.equal(eventsOfBatch(batch([stored({})], { tester: true }))[0].tester, true, "a batch labelled tester stays labelled");
  assert.deepEqual(eventsOfBatch("{\"events\":[]}"), [], "a batch with no reader is not read");
});

test("TESTER AND NON-ORGANIC EVENTS ARE LABELLED, AND NEVER REACH A RECIPE: before the cutoff, a tester flag, and any run class but ORGANIC", async () => {
  const mixed = batch([
    stored({ id: "old", occurredAt: "2026-10-01T06:59:59.000Z", question: "before the cutoff" }),
    stored({ id: "new", occurredAt: "2026-10-01T07:00:00.000Z", question: "organic" }),
    stored({ id: "t", occurredAt: "2026-10-02T09:00:00Z", runClass: "TESTER", question: "tester" }),
    stored({ id: "a", occurredAt: "2026-10-02T09:00:00Z", runClass: "AUTHOR", question: "author" }),
    stored({ id: "m", occurredAt: "2026-10-02T09:00:00Z", runClass: "ORGANIC", question: "organic in a mixed batch" }),
    stored({ id: "f", occurredAt: "2026-10-02T09:00:00Z", tester: true, question: "flagged" }),
  ], { runClass: "UNKNOWN" });
  const events = eventsOfBatch(mixed);
  assert.deepEqual(events.map((e) => [e.text, e.tester]), [["before the cutoff", true], ["organic", false], ["tester", true], ["author", true], ["organic in a mixed batch", false], ["flagged", true]]);
  assert.equal(eventsOfBatch(batch([stored({ occurredAt: "2026-10-02T09:00:00Z" })], { runClass: "TESTER" }))[0].tester, true, "a batch label applies to events without their own");
  const { store } = memoryStore({ "events/2026-10-01/aa.json.gz": mixed, "events/2026-10-02/bb.json.gz": mixed });
  const read = await historyEvents(store)({ from: "2026-10-01", to: "2026-10-02" });
  assert.deepEqual((read.kind === "ROWS" ? read.rows : []).map((e) => e.text), ["organic", "organic in a mixed batch", "organic", "organic in a mixed batch"], "only ORGANIC events after the cutoff come back");
});

test("EVERY DATABASE READ IS CUT TO ORGANIC: totals, the cohort's own rows and its earlier-period subquery", () => {
  const totals = totalsSql({ grain: "day", from: "2026-10-02", to: "2026-10-02", family: "all" }, 10);
  assert.match(totals.text, /run_class = 'ORGANIC'/);
  const cohort = cohortsSql({ grain: "day", from: "2026-10-02", to: "2026-10-03", family: "zip", key: "07090" });
  assert.match(cohort.text, /m.run_class = 'ORGANIC'/);
  assert.match(cohort.text, /p.run_class = 'ORGANIC'/);
});

test("A STORE WITHOUT MIGRATION 0036 (no run_class column) answers NOT_INSTALLED, never a count of everything", async () => {
  const noColumn: Query = async () => { throw Object.assign(new Error("column run_class does not exist"), { code: "42703" }); };
  assert.equal((await liveTotals(noColumn)({ grain: "day", from: "2026-10-02", to: "2026-10-02", family: "all" })).kind, "NOT_INSTALLED");
  assert.equal((await liveCohorts(noColumn)({ grain: "day", from: "2026-10-02", to: "2026-10-02", family: "all" })).kind, "NOT_INSTALLED");
});

test("TOTALS SQL: one family of rows, the window at its grain, and the places and topics asked for, as parameters never text", () => {
  const all = totalsSql({ grain: "week", from: "2026-10-01", to: "2026-10-04", family: "all", topics: ["housing"] }, 50);
  assert.deepEqual(all.params.slice(0, 3), ["WEEK", "2026-09-28", "2026-10-04"], "a week reads from its Monday");
  assert.match(all.text, /zip = ''\s+AND district = ''|zip = '' AND district = ''/);
  assert.match(all.text, /topic = '\*' OR topic = ANY\(\$4::text\[\]\)/);
  assert.match(all.text, /LIMIT 51/);
  const zips = totalsSql({ grain: "day", from: "2026-10-01", to: "2026-10-01", family: "zip", zips: ["07090", "07091"] }, 10);
  assert.match(zips.text, /zip <> '' AND district = '' AND zip = ANY\(\$4::text\[\]\)/);
  assert.deepEqual(zips.params[3], ["07090", "07091"]);
  const district = totalsSql({ grain: "day", from: "2026-10-01", to: "2026-10-01", family: "district", districtState: "nj" }, 10);
  assert.match(district.text, /zip = '' AND district <> '' AND district LIKE \$4/);
  assert.equal(district.params[3], "%/state:nj/%");
  for (const q of [all, zips, district]) assert.ok(!/07090|housing|nj/.test(q.text), "a value never sits in the SQL text");
  const cohort = cohortsSql({ grain: "day", from: "2026-10-01", to: "2026-10-02", family: "zip", key: "07090" });
  assert.deepEqual(cohort.params, ["DAY", "2026-10-01", "2026-10-02", "07090", ""]);
  assert.match(cohort.text, /p\.period_start < m\.period_start/);
});

test("LIVE TOTALS AND COHORTS map rows, say 'not installed' for a missing table and for no database, and flag a read that hit the row limit", async () => {
  const rows: Query = async () => [{ period: "2026-09-30", zip: "", district: "ocd-division/country:us/state:nj/cd:7", topic: "*", type: "*", events: "10", users: "4" }];
  const read = await liveTotals(rows)({ grain: "day", from: "2026-09-30", to: "2026-09-30", family: "district" });
  assert.deepEqual(read, { kind: "ROWS", truncated: false, rows: [{ grain: "day", period: "2026-09-30", zip: null, district: "ocd-division/country:us/state:nj/cd:7", topic: "*", type: "*", events: 10, users: 4 }] });
  const missing: Query = async () => { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); };
  assert.equal((await liveTotals(missing)({ grain: "day", from: "2026-09-30", to: "2026-09-30", family: "all" })).kind, "NOT_INSTALLED");
  assert.equal((await liveCohorts(missing)({ grain: "day", from: "2026-09-30", to: "2026-09-30", family: "all" })).kind, "NOT_INSTALLED");
  assert.equal((await liveTotals(null)({ grain: "day", from: "2026-09-30", to: "2026-09-30", family: "all" })).kind, "NOT_INSTALLED");
  const broken: Query = async () => { throw new Error("connection reset"); };
  await assert.rejects(liveTotals(broken)({ grain: "day", from: "2026-09-30", to: "2026-09-30", family: "all" }), /connection reset/, "a real failure is not turned into an empty answer");
  const cohorts = await liveCohorts(async () => [{ period: "2026-09-30", readers: "8", newReaders: "5" }])({ grain: "day", from: "2026-09-30", to: "2026-09-30", family: "all" });
  assert.deepEqual(cohorts, { kind: "ROWS", rows: [{ grain: "day", period: "2026-09-30", readers: 8, newReaders: 5 }] });
});

function memoryStore(files: Record<string, string>) {
  const gets: string[] = [];
  const store: HistoryStore = {
    list: async (prefix) => Object.keys(files).filter((k) => k.startsWith(prefix)).sort(),
    get: async (key) => { gets.push(key); return key in files ? new Uint8Array(gzipSync(files[key])) : null; },
  };
  return { store, gets };
}

test("THE HISTORY: a batch is read once and kept, the day before the window is read for batches that ran past midnight, and events outside the window are dropped", async () => {
  const { store, gets } = memoryStore({
    "events/2026-10-02/aa.json.gz": batch([stored({ occurredAt: "2026-10-02T23:59:00Z" }), stored({ id: "g", occurredAt: "2026-10-03T00:02:00Z", question: "Next day" })]),
    "events/2026-10-03/bb.json.gz": batch([stored({ id: "h", occurredAt: "2026-10-03T09:00:00Z", question: "Window day" })], { reader: "e".repeat(64) }),
    "events/2026-10-07/cc.json.gz": batch([stored({ id: "i", occurredAt: "2026-10-07T09:00:00Z" })]),
  });
  const read = historyEvents(store);
  const first = await read({ from: "2026-10-03", to: "2026-10-03" });
  assert.equal(first.kind, "ROWS");
  assert.deepEqual((first.kind === "ROWS" ? first.rows : []).map((e) => e.text).sort(), ["Next day", "Window day"]);
  assert.deepEqual(gets.sort(), ["events/2026-10-02/aa.json.gz", "events/2026-10-03/bb.json.gz"], "the 7th is not opened");
  await read({ from: "2026-10-03", to: "2026-10-03" });
  assert.equal(gets.length, 2, "an immutable batch is not read twice");
});

test("A HISTORY WINDOW WITH TOO MANY BATCHES is flagged truncated, never cut short and passed off as whole", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i <= HISTORY_BATCH_LIMIT; i += 1) files[`events/2026-10-01/${String(i).padStart(5, "0")}.json.gz`] = "{}";
  const read = await historyEvents(memoryStore(files).store)({ from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(read, { kind: "ROWS", rows: [], truncated: true });
});

test("THE LIVE SOURCES RUN THE RECIPES: word cloud over a stored batch, new vs returning over the database's counts", async () => {
  const { store } = memoryStore({ "events/2026-10-03/aa.json.gz": batch([stored({ id: "a", occurredAt: "2026-10-03T09:00:00Z", question: "Union County property tax appeal" })]) });
  const sources = liveSources({ history: store, query: async () => [{ period: "2026-10-03", readers: "10", newReaders: "3" }] });
  const deps = { sources, switchOn: () => true };
  const slice = { from: "2026-10-03", to: "2026-10-03", grain: "day" };
  const cloud = await readRecipe({ recipe: "word-cloud", slice, audience: "admin" }, deps);
  assert.equal(cloud.kind === "READ" && cloud.body.shape === "words" && cloud.body.rows.some((r) => r.word === "property" && r.readers === 1), true);
  const cohort = await readRecipe({ recipe: "new-vs-returning", slice, audience: "admin" }, deps);
  assert.equal(cohort.kind === "READ" && cohort.body.shape === "totals" && cohort.body.rows.map((r) => r.value).join(), "7,3");
});
