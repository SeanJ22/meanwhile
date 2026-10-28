import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { RECIPES, wordsIn, type Recipe } from "../lib/control-plane/data-business/recipes.ts";
import { readRecipe, leavable, RecipeShapeError, type ReadDeps, type Sources, type TotalsQuery } from "../lib/control-plane/data-business/read.ts";
import { placeIndex } from "../lib/control-plane/data-business/places.ts";
import { districtLabel, parseSlice, periodOf, weekOf } from "../lib/control-plane/data-business/slice.ts";
import type { CapturedEvent, CohortRow, ResultBody, TotalsRow } from "../lib/control-plane/data-business/types.ts";

const hash = (s: string) => createHash("sha256").update(`reader:${s}`).digest("hex");
const NJ7 = "ocd-division/country:us/state:nj/cd:7";
const FL7 = "ocd-division/country:us/state:fl/cd:7";
const UNION = "ocd-division/country:us/state:nj/county:union";

const ev = (over: Partial<CapturedEvent> & Pick<CapturedEvent, "reader" | "day">): CapturedEvent => ({
  type: "ASK", zip: null, district: null, residency: "HOME", cardId: null, cardKind: null, durationMs: null, text: null, topic: "free-form", reaction: null, ballotPick: null, tester: false, ...over,
});
const A = hash("a"), B = hash("b"), C = hash("c");
const EVENTS: CapturedEvent[] = [
  ev({ reader: A, day: "2026-09-29", zip: "07090", district: NJ7, topic: "housing", text: "How do I appeal my property tax assessment?" }),
  ev({ reader: A, day: "2026-09-30", zip: "07090", district: NJ7, topic: "housing", text: "Property tax appeal deadline in Union County" }),
  ev({ reader: B, day: "2026-09-30", zip: "07090", district: NJ7, residency: "BROWSING", text: "Who is on the school board and when do they meet?" }),
  ev({ reader: C, day: "2026-10-01", zip: "32708", district: FL7, topic: "housing", text: "Property tax homestead exemption deadline" }),
  ev({ reader: A, day: "2026-09-30", type: "REACTION", zip: "07090", cardId: "jane-doe", reaction: "YES" }),
  ev({ reader: B, day: "2026-09-30", type: "REACTION", zip: "07090", residency: "BROWSING", cardId: "jane-doe", reaction: "NO" }),
  ev({ reader: C, day: "2026-10-01", type: "REACTION", zip: "32708", cardId: "jane-doe", reaction: "LIKE" }),
  ev({ reader: C, day: "2026-10-01", type: "REACTION", zip: "32708", cardId: "measure-4", reaction: "UNSURE" }),
  ev({ reader: C, day: "2026-10-01", type: "ZIP_VIEW", zip: "32708", residency: "UNKNOWN" }),
  ev({ reader: B, day: "2026-10-01", text: "tester typed this", tester: true }),
];

const row = (r: Partial<TotalsRow> & Pick<TotalsRow, "period" | "topic" | "type" | "events" | "users">): TotalsRow => ({ grain: "day", zip: null, district: null, ...r });
const TOTALS: TotalsRow[] = [
  row({ period: "2026-09-30", topic: "housing", type: "ASK", events: 3, users: 2 }),
  row({ period: "2026-09-30", topic: "free-form", type: "ASK", events: 1, users: 1 }),
  row({ period: "2026-09-30", topic: "*", type: "ASK", events: 4, users: 3 }),
  row({ period: "2026-09-30", topic: "*", type: "ZIP_VIEW", events: 9, users: 5 }),
  row({ period: "2026-09-30", topic: "*", type: "*", events: 13, users: 6 }),
  row({ period: "2026-09-30", zip: "07090", topic: "housing", type: "ASK", events: 2, users: 1 }),
  row({ period: "2026-09-30", zip: "07090", topic: "*", type: "ASK", events: 2, users: 1 }),
  row({ period: "2026-09-30", zip: "07091", topic: "housing", type: "ASK", events: 1, users: 1 }),
  row({ period: "2026-09-30", zip: "07091", topic: "*", type: "ASK", events: 2, users: 2 }),
  row({ period: "2026-09-30", zip: "32708", topic: "*", type: "ASK", events: 7, users: 3 }),
  row({ period: "2026-09-30", district: NJ7, topic: "*", type: "*", events: 10, users: 4 }),
  row({ period: "2026-09-30", district: FL7, topic: "*", type: "*", events: 6, users: 2 }),
  row({ period: "2026-09-30", district: "ocd-division/country:us/state:nj/cd:12", topic: "*", type: "*", events: 5, users: 2 }),
];
const COHORTS: CohortRow[] = [
  { grain: "day", period: "2026-09-30", readers: 8, newReaders: 5 },
  { grain: "day", period: "2026-10-01", readers: 10, newReaders: 3 },
];

const mapRows = new Map([
  ["07090", {ids:["ocd-division/country:us/state:nj", UNION],partial:[],samples:0,states:["NJ"]}],
  ["07091", {ids:["ocd-division/country:us/state:nj", UNION, "ocd-division/country:us/state:nj/county:essex"],partial:[],samples:0,states:["NJ"]}],
  ["32708", {ids:["ocd-division/country:us/state:fl", "ocd-division/country:us/state:fl/county:seminole"],partial:[],samples:0,states:["FL"]}],
]);
const places = placeIndex(async zip => mapRows.get(zip) ?? null,
  async state => new Map([...mapRows].filter(([, entry]) => entry.states.includes(state.toUpperCase()))));

const sources: Sources = {
  places,
  totals: async (q: TotalsQuery) => ({ kind: "ROWS", rows: TOTALS.filter((r) => r.grain === q.grain && r.period >= periodOf(q.from, q.grain) && r.period <= q.to
    && (q.family === "all" ? r.zip === null && r.district === null : q.family === "zip" ? r.zip !== null && r.district === null && (q.zips == null || q.zips.includes(r.zip)) : r.zip === null && r.district !== null
      && (q.districts == null || q.districts.includes(r.district)) && (q.districtState == null || r.district.includes(`/state:${q.districtState}/`)))
    && (q.topics == null || r.topic === "*" || q.topics.includes(r.topic))) }),
  cohorts: async (q) => ({ kind: "ROWS", rows: COHORTS.filter((r) => r.grain === q.grain && r.period >= q.from && r.period <= q.to) }),
  events: async (w) => ({ kind: "ROWS", rows: EVENTS.filter((e) => e.day >= w.from && e.day <= w.to) }),
};
const deps = (over: Partial<ReadDeps> = {}): ReadDeps => ({ sources, switchOn: () => true, now: () => new Date("2026-10-02T00:00:00Z"), ...over });
const ask = (recipe: string, slice: Record<string, unknown> = {}, audience: unknown = "admin", d: ReadDeps = deps()) =>
  readRecipe({ recipe, slice: { from: "2026-09-29", to: "2026-10-01", grain: "day", ...slice }, audience }, d);
const body = async (recipe: string, slice: Record<string, unknown> = {}, audience: unknown = "admin", d: ReadDeps = deps()): Promise<ResultBody> => {
  const r = await ask(recipe, slice, audience, d);
  assert.equal(r.kind, "READ", JSON.stringify(r));
  return (r as Extract<typeof r, { kind: "READ" }>).body;
};
const totalsRows = (b: ResultBody) => { assert.equal(b.shape, "totals"); return (b as Extract<ResultBody, { shape: "totals" }>).rows; };

test("the menu: every recipe has a unique plain id, says what it is, and runs to the shape it promised", async () => {
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length, "ids are unique");
  const required = ["topic-share", "support-vs-oppose", "word-cloud", "verbatim-messages", "usage-by-district", "new-vs-returning"];
  for (const id of required) assert.ok(RECIPES.some((r) => r.id === id), `${id} is on the menu`);
  for (const recipe of RECIPES) {
    assert.match(recipe.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(recipe.says.endsWith(".") && recipe.label.length > 3, `${recipe.id} says what it is`);
    const result = await ask(recipe.id);
    assert.equal(result.kind, "READ", `${recipe.id}: ${JSON.stringify(result)}`);
    assert.equal((result as { body: ResultBody }).body.shape, recipe.shape);
  }
});

test("NOTHING LEAVING CARRIES THE ANONYMOUS ID, AN EXACT TIME OR A TRAIL: every recipe's result, fed events that carry them", async () => {
  const loud = EVENTS.map((e, i) => ({ ...e, text: e.text === null ? null : `${e.text} ${new Date(Date.UTC(2026, 8, 30, 14, 5, i)).toISOString()}`, occurredAt: new Date(Date.UTC(2026, 8, 30, 14, 5, i)).toISOString() }));
  const d = deps({ sources: { ...sources, events: async () => ({ kind: "ROWS", rows: loud }) } });
  for (const recipe of RECIPES) {
    const result = await ask(recipe.id, {}, "admin", d);
    assert.equal(result.kind, "READ");
    const json = JSON.stringify((result as { body: ResultBody }).body);
    for (const reader of [A, B, C]) assert.ok(!json.includes(reader), `${recipe.id} carries a reader hash`);
    assert.doesNotMatch(json, /\b[0-9a-f]{64}\b/i, `${recipe.id} carries something shaped like a hash`);
    assert.doesNotMatch(json, /\d{2}:\d{2}:\d{2}|T14:05|occurredAt|"reader"/, `${recipe.id} carries an exact time or a reader field`);
  }
});

test("leavable() rebuilds each row from its shape's fields: extras are dropped, a hash or a time in a label refuses, a wrong shape refuses", () => {
  const sneaky = { shape: "totals", rows: [{ period: "2026-09-30", label: "Housing", series: null, value: 3, percent: 50, readers: 2, reader: A, occurredAt: "2026-09-30T14:05:00Z" }] } as unknown as ResultBody;
  const clean = leavable(sneaky, "totals");
  assert.deepEqual(Object.keys(((clean as unknown) as { rows: object[] }).rows[0]).sort(), ["label", "percent", "period", "readers", "series", "value"]);
  assert.throws(() => leavable({ shape: "totals", rows: [{ period: null, label: A, series: null, value: 1, percent: null, readers: null }] }, "totals"), RecipeShapeError);
  assert.throws(() => leavable({ shape: "totals", rows: [{ period: null, label: "at 2026-09-30T14:05", series: null, value: 1, percent: null, readers: null }] }, "totals"), RecipeShapeError);
  assert.throws(() => leavable({ shape: "words", rows: [] }, "totals"), RecipeShapeError);
  assert.throws(() => leavable({ shape: "totals", rows: [{ period: null, label: "x", series: null, value: 1.5, percent: null, readers: null }] }, "totals"), RecipeShapeError);
  const said = leavable({ shape: "verbatim", rows: [{ day: "2026-09-30", topic: "housing", place: "07090", text: `asked at 2026-09-30T14:05:00Z, id ${A}` }] }, "verbatim") as unknown as { rows: { text: string }[] };
  assert.equal(said.rows[0].text, "asked at [removed]:00Z, id [removed]");
});

test("ONE RECIPE IS ONE OBJECT: a new number plugs in beside the menu with nothing else changed", async () => {
  const eventCount: Recipe = { id: "event-count", label: "All events", says: "Every event recorded.", shape: "totals", source: "events",
    run: (events) => ({ shape: "totals", rows: [{ period: null, label: "Events", series: null, value: events.length, percent: null, readers: new Set(events.map((e) => e.reader)).size }] }) };
  const b = await body("event-count", { place: { kind: "zip", id: "32708" } }, "admin", deps({ book: [...RECIPES, eventCount] }));
  assert.deepEqual(totalsRows(b).map((r) => [r.value, r.readers]), [[4, 1]]);
  const wrong: Recipe = { id: "wrong", label: "Wrong shape", says: "Promises words, returns totals.", shape: "words", source: "events", run: () => ({ shape: "totals", rows: [] }) };
  await assert.rejects(ask("wrong", {}, "admin", deps({ book: [wrong] })), RecipeShapeError);
});

test("SHARE OF QUESTIONS BY TOPIC: from the store's totals, as a share of the day's questions", async () => {
  const rows = totalsRows(await body("topic-share", { from: "2026-09-30", to: "2026-09-30" }));
  assert.deepEqual(rows.map((r) => [r.period, r.label, r.value, r.percent, r.readers]), [["2026-09-30", "Housing", 3, 75, 2], ["2026-09-30", "Free-form question", 1, 25, 1]]);
  const housing = totalsRows(await body("topic-share", { from: "2026-09-30", to: "2026-09-30", topics: ["housing"] }));
  assert.deepEqual(housing.map((r) => [r.label, r.percent]), [["Housing", 75]], "a topic slice keeps the whole-day denominator");
});

test("A COUNT BY PLACE: a ZIP, a county and a state each take the rows of the ZIPs inside them, and readers are not added across ZIPs", async () => {
  const zip = totalsRows(await body("topic-share", { from: "2026-09-30", to: "2026-09-30", place: { kind: "zip", id: "07090" } }));
  assert.deepEqual(zip.map((r) => [r.label, r.value, r.percent, r.readers]), [["Housing", 2, 100, 1]]);
  const county = totalsRows(await body("topic-share", { from: "2026-09-30", to: "2026-09-30", place: { kind: "county", id: UNION } }));
  assert.deepEqual(county.map((r) => [r.label, r.value, r.percent, r.readers]), [["Housing", 3, 75, null]], "two ZIPs merged: readers cannot be summed");
  const nj = totalsRows(await body("topic-share", { from: "2026-09-30", to: "2026-09-30", place: { kind: "state", id: "nj" } }));
  assert.equal(nj[0].value, 3);
  const fl = totalsRows(await body("events-by-type", { from: "2026-09-30", to: "2026-09-30", place: { kind: "state", id: "fl" } }));
  assert.deepEqual(fl.map((r) => [r.label, r.value]), [["ASK", 7]], "Florida takes only its own ZIP, never New Jersey's");
});

test("USAGE BY DISTRICT: a Florida district sits beside a New Jersey one, and a state slice keeps only its own", async () => {
  const all = totalsRows(await body("usage-by-district", { from: "2026-09-30", to: "2026-09-30" }));
  assert.deepEqual(all.map((r) => [r.label, r.value, r.readers]), [["NJ-7", 10, 4], ["FL-7", 6, 2], ["NJ-12", 5, 2]]);
  const nj = totalsRows(await body("usage-by-district", { from: "2026-09-30", to: "2026-09-30", place: { kind: "state", id: "nj" } }));
  assert.deepEqual(nj.map((r) => r.label), ["NJ-7", "NJ-12"]);
  const refusal = await ask("usage-by-district", { place: { kind: "zip", id: "07090" } });
  assert.equal(refusal.kind === "REFUSED" && refusal.why, "SLICE_UNSUPPORTED");
  assert.equal(districtLabel(FL7), "FL-7");
});

test("NEW VS RETURNING: the database's own exact counts, per day or week", async () => {
  const rows = totalsRows(await body("new-vs-returning", { from: "2026-09-30", to: "2026-10-01" }));
  assert.deepEqual(rows.map((r) => [r.period, r.label, r.value, r.percent]), [
    ["2026-10-01", "Returning readers", 7, 70], ["2026-10-01", "New readers", 3, 30], ["2026-09-30", "New readers", 5, 62.5], ["2026-09-30", "Returning readers", 3, 37.5]]);
});

test("SUPPORT VS OPPOSE PER NAME: reactions grouped by name, with the distinct readers behind each side", async () => {
  const rows = totalsRows(await body("support-vs-oppose"));
  assert.deepEqual(rows.map((r) => [r.label, r.series, r.value, r.percent, r.readers]).sort(), [
    ["Jane doe", "Oppose", 1, 33.3, 1], ["Jane doe", "Support", 2, 66.7, 2], ["Measure 4", "Not sure", 1, 100, 1]]);
  const outsiders = totalsRows(await body("support-vs-oppose", { residency: "outsider" }));
  assert.deepEqual(outsiders.map((r) => [r.series, r.value]), [["Oppose", 1]], "residents and outsiders are separable by the residency stamp");
  const residents = totalsRows(await body("support-vs-oppose", { residency: "resident" }));
  assert.deepEqual(residents.map((r) => [r.label, r.series, r.value]).sort(), [["Jane doe", "Support", 2], ["Measure 4", "Not sure", 1]]);
});

test("RESIDENTS VS OUTSIDERS and a card slice", async () => {
  const rows = totalsRows(await body("residents-vs-outsiders", { from: "2026-09-30", to: "2026-09-30" }));
  assert.deepEqual(rows.map((r) => [r.label, r.value, r.percent]).sort(), [["Outsiders", 2, 50], ["Residents", 2, 50]]);
  const card = totalsRows(await body("support-vs-oppose", { card: "measure-4" }));
  assert.deepEqual(card.map((r) => r.label), ["Measure 4"]);
});

test("WORD CLOUD counts distinct readers per word, so one person repeating a word cannot make it large; VERBATIM keeps the day and topic, never the time", async () => {
  const words = (await body("word-cloud")) as Extract<ResultBody, { shape: "words" }>;
  const property = words.rows.find((r) => r.word === "property");
  assert.equal(property?.readers, 2, "A asked twice, C once: two readers");
  assert.ok(!words.rows.some((r) => r.word === "the" || r.word === "when"), "small words are not in the cloud");
  const said = (await body("verbatim-messages", { from: "2026-09-30", to: "2026-09-30" })) as Extract<ResultBody, { shape: "verbatim" }>;
  assert.deepEqual(said.rows.map((r) => [r.day, r.topic, r.place]), [["2026-09-30", "housing", "07090"], ["2026-09-30", "free-form", "07090"]]);
  assert.deepEqual(wordsIn("What's the Union County budget?"), new Set(["union", "county", "budget"]));
});

test("A SWITCH PER RECIPE PER AUDIENCE: a recipe switched off for an audience is refused before any data is read", async () => {
  let reads = 0;
  const counting: Sources = { ...sources, events: async (w) => { reads += 1; return sources.events(w); }, totals: async (q) => { reads += 1; return sources.totals(q); } };
  const d = deps({ sources: counting, switchOn: (recipe, audience) => audience === "admin" || (audience === "customer:acme" && recipe === "topic-share") });
  assert.equal((await ask("word-cloud", {}, "dashboard", d)).kind, "REFUSED");
  assert.equal((await ask("verbatim-messages", {}, "customer:acme", d)).kind, "REFUSED");
  assert.equal(reads, 0, "no data was read for a refused audience");
  assert.equal((await ask("topic-share", {}, "customer:acme", d)).kind, "READ");
  assert.equal((await ask("word-cloud", {}, "admin", d)).kind, "READ");
  assert.equal(((await ask("word-cloud", {}, "someone", d)) as { why: string }).why, "BAD_AUDIENCE");
  assert.equal(((await ask("nope", {}, "admin", d)) as { why: string }).why, "UNKNOWN_RECIPE");
});

test("A BUYER HOLDS A SLICE, NEVER A SIDE: the request is confined to the held place, topics and window, and never widened", async () => {
  const held = { place: { kind: "state", id: "nj" } as const, topics: ["housing"], from: "2026-09-30", to: "2026-10-01" };
  const d = deps({ heldSlice: (a) => (a === "customer:acme" ? held : null) });
  const confined = (await ask("verbatim-messages", {}, "customer:acme", d)) as Extract<Awaited<ReturnType<typeof ask>>, { kind: "READ" }>;
  assert.equal(confined.kind, "READ");
  assert.deepEqual([confined.slice.from, confined.slice.to, confined.slice.place?.id, confined.slice.topics], ["2026-09-30", "2026-10-01", "nj", ["housing"]], "the window is clamped, place and topics filled in");
  assert.deepEqual((confined.body as Extract<ResultBody, { shape: "verbatim" }>).rows.map((r) => [r.day, r.place]), [["2026-09-30", "07090"]], "only New Jersey housing in the window");
  const florida = await ask("verbatim-messages", { place: { kind: "zip", id: "32708" } }, "customer:acme", d);
  assert.equal(florida.kind === "REFUSED" && florida.why, "OUTSIDE_HELD_SLICE");
  const nj = await ask("verbatim-messages", { place: { kind: "zip", id: "07090" } }, "customer:acme", d);
  assert.equal(nj.kind, "READ", "a ZIP inside the held state is allowed");
  const topic = await ask("verbatim-messages", { topics: ["schools"] }, "customer:acme", d);
  assert.equal(topic.kind === "REFUSED" && topic.why, "OUTSIDE_HELD_SLICE");
  const early = await ask("verbatim-messages", { from: "2026-01-01", to: "2026-09-01" }, "customer:acme", d);
  assert.equal(early.kind === "REFUSED" && early.why, "OUTSIDE_HELD_SLICE");
  assert.equal((await ask("verbatim-messages", { place: { kind: "zip", id: "32708" } }, "admin", d)).kind, "READ", "Admin holds no slice");
  const keys = Object.keys({ place: 1, topics: 1, from: 1, to: 1 } satisfies Record<keyof typeof held, 1>);
  assert.ok(!keys.some((k) => /side|sentiment|support|oppose|stance/i.test(k)), "a buyer slice has no field for a side");
});

test("SLICES: the day range, the grain and the place are checked, and a bad one is refused in words", () => {
  assert.equal(weekOf("2026-10-01"), "2026-09-28", "Thursday → its Monday");
  assert.equal(periodOf("2026-10-04", "week"), "2026-09-28", "Sunday belongs to the week that began the Monday before");
  const bad = (slice: unknown) => { const p = parseSlice(slice); assert.equal(p.ok, false, JSON.stringify(slice)); };
  bad(null); bad({ from: "2026-10-01" }); bad({ from: "2026-10-02", to: "2026-10-01" }); bad({ from: "2026-02-30", to: "2026-03-01" });
  bad({ from: "2024-01-01", to: "2026-10-01" }); bad({ from: "2026-10-01", to: "2026-10-01", grain: "hour" });
  bad({ from: "2026-10-01", to: "2026-10-01", place: { kind: "zip", id: "7090" } }); bad({ from: "2026-10-01", to: "2026-10-01", place: { kind: "city", id: "x" } });
  bad({ from: "2026-10-01", to: "2026-10-01", residency: "tourist" }); bad({ from: "2026-10-01", to: "2026-10-01", topics: [] });
  const ok = parseSlice({ from: "2026-09-29", to: "2026-10-01", grain: "week", place: { kind: "state", id: "NJ" }, topics: ["b", "a", "a"], residency: "resident" });
  assert.ok(ok.ok && ok.slice.place?.id === "nj" && ok.slice.grain === "week" && ok.slice.topics?.join() === "a,b");
});

test("A SLICE THE SOURCE CANNOT COUNT is refused in words, not answered with a wrong number; a store that is not installed is said, not shown as zero", async () => {
  const r = await ask("topic-share", { residency: "resident" });
  assert.equal(r.kind === "REFUSED" && r.why, "SLICE_UNSUPPORTED");
  const state = await ask("new-vs-returning", { place: { kind: "state", id: "nj" } });
  assert.equal(state.kind === "REFUSED" && state.why, "SLICE_UNSUPPORTED");
  const gone: Sources = { ...sources, totals: async () => ({ kind: "NOT_INSTALLED", detail: "Reader events need migration 0034." }) };
  const n = await ask("topic-share", {}, "admin", deps({ sources: gone }));
  assert.equal(n.kind, "NOT_INSTALLED");
  const broken = placeIndex(async () => null, async () => { throw new Error("Map unavailable"); });
  const u = await ask("topic-share", { place: { kind: "state", id: "nj" } }, "admin", deps({ sources: { ...sources, places: broken } }));
  assert.equal(u.kind === "REFUSED" && u.why, "PLACE_UNKNOWN", "a shard that could not be read is unknown, not an empty state");
  const wide: Sources = { ...sources, totals: async () => ({ kind: "ROWS", rows: [], truncated: true }) };
  assert.equal(((await ask("topic-share", {}, "admin", deps({ sources: wide }))) as { why: string }).why, "TOO_WIDE");
});
