import assert from "node:assert/strict";
import test from "node:test";
import { PLACE_HISTORY_DAYS, appendPoint, isPlaceHistory, pointOf, trendOf, type PlaceHistoryPoint } from "../lib/coverage/place-history.ts";
import { measuresByFamily, placeMeasures } from "../lib/coverage/place-measures.ts";
import { collectPlaceHistory } from "../lib/control-plane/admin-view/place-history-collect.ts";
import { PLACE_HISTORY_SQL } from "../lib/control-plane/admin-view/place-history-read.ts";
import { v6PlaceSection } from "../lib/control-plane/admin-view/v6-place-section.ts";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const divisions = [{ id: county, label: "Cochise County" }];
const rowsAt = (now: string, captured: boolean) => buildPlaceOwedList({ divisions, now, subjects: [],
  held: captured ? [{ subjectId: county, checklistId: "GEO-03", state: "published", sourceUrl: "https://x.gov", checkedAt: now, freshUntil: "2099-01-01T00:00:00Z" }] : [] });
const point = (day: string, n: number, of: number): PlaceHistoryPoint => ({ day, at: `${day}T12:00:00Z`, completeness: { n, of }, freshness: { n: 0, of: 0 }, delivery: { n: 0, of: 0 }, families: [] });

test("one point per day, the newest days kept", () => {
  let history: PlaceHistoryPoint[] = [];
  for (let i = 0; i < PLACE_HISTORY_DAYS + 5; i++) history = appendPoint(history, point(`2026-${i < 20 ? "08" : "09"}-${String((i % 20) + 1).padStart(2, "0")}`, i, 100));
  assert.equal(history.length, PLACE_HISTORY_DAYS);
  assert.deepEqual(history.map(p => p.day), [...history.map(p => p.day)].sort());
  const same = appendPoint([point("2026-10-03", 1, 10)], point("2026-10-03", 2, 10));
  assert.deepEqual(same.map(p => p.completeness.n), [2], "a later point on the same day replaces it");
});

test("the trend compares with the last earlier day and shows the previous value", () => {
  const history = [point("2026-10-01", 3, 10), point("2026-10-03", 5, 10), point("2026-10-04", 9, 10)];
  assert.deepEqual(trendOf(history, 70, "2026-10-04"), { direction: "up", previousPercent: 50, previousDay: "2026-10-03" });
  assert.equal(trendOf(history, 40, "2026-10-04")?.direction, "down");
  assert.equal(trendOf(history, 50, "2026-10-04")?.direction, "same");
  assert.equal(trendOf([point("2026-10-04", 9, 10)], 90, "2026-10-04"), null, "no earlier day, no arrow");
  assert.equal(trendOf([], null, "2026-10-04"), null);
});

test("each point holds the counts behind every figure, by family", () => {
  const rows = rowsAt("2026-10-04T12:00:00Z", true);
  const p = pointOf("2026-10-04T12:00:00Z", placeMeasures(rows), measuresByFamily(rows, ["GEO"]));
  assert.equal(p.day, "2026-10-04");
  assert.ok(p.completeness.of > 0 && p.completeness.n === 1);
  assert.ok(p.families.some(f => f.group === "GEO" && f.n === 1));
  assert.equal(isPlaceHistory([p]), true);
  assert.equal(isPlaceHistory([{ day: "x" }]), false);
});

test("only places with a saved scope are scored, at most once a day, and an unreadable place keeps its points", async () => {
  const reads: string[] = [];
  const geography = { type: "county", geoid: "04003", stateAbbr: "AZ", version: "county:2020", label: "Cochise" } as const;
  const other = { ...geography, geoid: "04019", label: "Pima" };
  const now = "2026-10-04T12:00:00Z";
  const previous = { "geo:az.county.04019": [point("2026-10-04", 4, 10)], "geo:az.county.99999": [point("2026-10-01", 1, 2)] };
  const out = await collectPlaceHistory({ scopes: [{ geography }, { geography: other }], previous, now, limit: 6,
    read: async key => { reads.push(key); return { state: "READ", placeKey: key, label: key, covers: "", divisions, rows: rowsAt(now, true), observedAt: now, readMs: { geography: 0, held: 0 } }; } });
  assert.deepEqual(reads, ["geo:az.county.04003"], "Pima already holds today's point");
  assert.deepEqual(Object.keys(out).sort(), ["geo:az.county.04003", "geo:az.county.04019"], "a place with no saved scope is dropped");
  assert.equal(out["geo:az.county.04003"].at(-1)?.day, "2026-10-04");
  const failed = await collectPlaceHistory({ scopes: [{ geography }], previous: { "geo:az.county.04003": [point("2026-10-01", 1, 2)] }, now, read: async () => { throw new Error("census down"); } });
  assert.equal(failed["geo:az.county.04003"].length, 1);
  const refused = await collectPlaceHistory({ scopes: [{ geography }], previous: undefined, now, read: async () => ({ state: "REFUSED", code: "HELD_UNREAD", says: "x" }) });
  assert.deepEqual(refused["geo:az.county.04003"], []);
  assert.match(PLACE_HISTORY_SQL, /placeHistory/);
});

test("a sent place's card carries the arrow and the previous value", () => {
  const now = "2026-10-04T12:00:00Z";
  const rows = rowsAt(now, true);
  const current = placeMeasures(rows).completeness.percent!;
  const view = v6PlaceSection({ state: "READ", placeKey: "geo:az.county.04003", label: "Cochise County", covers: "x", divisions, rows, observedAt: now, readMs: { geography: 0, held: 0 } },
    { group: null, states: null, q: null, offset: 0, limit: 10 }, null, [point("2026-10-03", 0, 100)]);
  assert.equal(view.data.score.trend?.direction, current > 0 ? "up" : "same");
  assert.equal(view.data.score.trend?.previousPercent, 0);
});
