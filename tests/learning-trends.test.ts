/**
 * MW-025 — a walk records which handed field-manual doors it actually used.
 * MW-027 — what the Scout results measure is drawn week by week, and a week
 * with no record is a gap, never a zero.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildLearningTrends, mondayOf, pointWords, weekRange, type WeekLearningRow } from "../lib/control-plane/admin-view/learning-trends.ts";
import type { FieldManualEntry, FieldManualStore } from "../lib/control-plane/field-manual.ts";
import { usedFieldManualEntryIds } from "../lib/control-plane/scheduler/field-manual-scout.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";

function entry(id: string, url: string | null, routeId: string | null): FieldManualEntry {
  return {
    id, role: "SCOUT", kind: "ROUTE", title: id, summary: id, states: ["az"], recordClasses: [], platforms: [], outcome: "YIELDED",
    url, source: "fixture", observedAt: null, tier: null, payload: routeId === null ? null : { routeId },
  } as FieldManualEntry;
}

const STORE: FieldManualStore = {
  formatVersion: 1,
  updatedOn: null,
  entries: [
    entry("fm:by-url", "https://Pima.Legistar.com/Calendar.aspx/", null),
    entry("fm:by-route", null, "pima-legistar-api"),
    entry("fm:unwalked", "https://example.gov/never", "never-route"),
  ],
};

function walk(over: Partial<ScoutResult>): ScoutResult {
  return {
    rungs: [{ index: 1, rung: "primary-site-navigation", tool: "fetch_public", target: "https://pima.legistar.com/Calendar.aspx", observed: "HTTP 200", artifactIds: [], note: null, at: "2026-09-25T10:00:00.000Z", ok: true }],
    candidates: [{ routeId: "pima-legistar-api" }],
    ...over,
  } as unknown as ScoutResult;
}

test("MW-025: a handed door counts as used when its url matches a walked rung or its routeId a proposed candidate", () => {
  const handed = ["fm:by-url", "fm:by-route", "fm:unwalked", "fm:gone-from-store"];
  assert.deepEqual(usedFieldManualEntryIds(walk({}), handed, STORE), ["fm:by-url", "fm:by-route"]);
  assert.deepEqual(usedFieldManualEntryIds(walk({ rungs: [], candidates: [] }), handed, STORE), [], "given is not used");
  assert.deepEqual(usedFieldManualEntryIds(walk({}), [], STORE), [], "nothing handed, nothing used");
  assert.deepEqual(usedFieldManualEntryIds(walk({}), ["fm:unwalked"], STORE), [], "a door handed and not walked is not used");
});

function row(week: string, over: Partial<WeekLearningRow> = {}): WeekLearningRow {
  return {
    week, walks: 10, pairRecorded: 10, handed: 4, usedRecorded: 4, usedWalks: 1, reusedDoors: 2, rebuiltRecorded: 10, rebuiltRoutes: 1,
    resumed: 5, resumedFound: 2, fresh: 5, freshFound: 1, found: 3, usd: 6, unpriced: 0, ...over,
  };
}

test("MW-027: the weeks run from the first record through now, and a week with no record is a gap in every series", () => {
  assert.equal(mondayOf("2026-09-25T12:00:00.000Z"), "2026-09-21");
  assert.equal(mondayOf("2026-09-21T00:00:00.000Z"), "2026-09-21");
  assert.deepEqual(weekRange("2026-09-07", "2026-09-25T12:00:00.000Z"), ["2026-09-07", "2026-09-14", "2026-09-21"]);

  const t = buildLearningTrends([row("2026-09-07"), row("2026-09-21", { usedRecorded: 0, usedWalks: 0, reusedDoors: 0, unpriced: 2 })], "2026-09-25T12:00:00.000Z");
  assert.deepEqual(t.weeks, ["2026-09-07", "2026-09-14", "2026-09-21"]);
  for (const s of Object.values(t.series)) assert.equal(s.points[1]!.value, null, `${s.key}: a week with no walk is a gap, never 0`);
  assert.equal(t.series.handed.points[0]!.value, 0.4);
  assert.equal(t.series.handed.points[0]!.of, 10);
  assert.equal(t.series.used.points[2]!.value, null, "a week whose walks do not record use is a gap");
  assert.equal(t.series.reused.points[2]!.value, null);
  assert.equal(t.series.perFind.points[0]!.value, 2);
  assert.equal(t.series.perFind.points[2]!.floor, true, "an unpriced walk makes the week's dollars a floor");
  assert.equal(pointWords("usd", t.series.perFind.points[2]!), "at least $2.00 over 3");
  assert.equal(pointWords("share", t.series.handed.points[0]!), "40% of 10");
  assert.equal(pointWords("share", t.series.handed.points[1]!), null);
  assert.equal(t.series.used.says, "Measured in 1 of 3 weeks; the other 2 hold no record of it — gaps, not zeros.");
  assert.match(t.escalations.says, /^0 escalations recorded in each of the 2 weeks with paid work — because nothing writes an escalation record yet/);
});

test("MW-027: no rows means no weeks and no measured series, never a row of zeros", () => {
  const t = buildLearningTrends([], "2026-09-25T12:00:00.000Z");
  assert.deepEqual(t.weeks, []);
  assert.equal(t.series.handed.measuredWeeks, 0);
  assert.equal(t.series.handed.says, "Not recorded in any of the 0 weeks on record.");
  assert.equal(t.escalations.says, "No paid walk is on record, and nothing records an escalation.");
});
