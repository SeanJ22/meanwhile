import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { projectFieldManual } from "../lib/control-plane/field-manual.ts";
import { blankRecordClass, scoutFieldManualProjection, scoutStateHint } from "../lib/control-plane/scheduler/field-manual-scout.ts";

test("scoutStateHint reads the state from an OCD subject and from an obligation id", () => {
  assert.deepEqual(scoutStateHint("ocd-division/country:us/state:nj/county:morris#governing", null), ["nj"]);
  assert.deepEqual(scoutStateHint(null, "freshness:jurisdiction:az:city:city-of-tucson#meetings-1"), ["az"]);
  assert.deepEqual(scoutStateHint("nothing here", "nothing here"), []);
});

test("a projection never exceeds its limit — a worker inherits a page, not the whole store", () => {
  const repos = createMemoryRepositories();
  void repos;
  const store = { entries: Array.from({ length: 200 }, (_, i) => ({
    id: `fm-${i}`, role: "SCOUT" as const, kind: "ROUTE", title: `t${i}`, summary: "s", states: ["nj"], recordClasses: ["meetings"], platforms: [], outcome: "YIELDED" as const, url: null, source: "x", observedAt: null, tier: null, payload: {},
  })) };
  const projection = projectFieldManual(store, { role: "SCOUT", state: "nj", recordClass: "meetings", limit: 30 });
  assert.equal(projection.lines.length, 30);
  assert.equal(projection.total, 200);
});

test("notes on the blanks' record classes rank ahead of generic notes, even ones about the place itself", () => {
  const make = (id: string, classes: string[], ocdIds?: string[]) => ({
    id, role: "SCOUT" as const, kind: "ROUTE", title: id, summary: id, states: ["az"], recordClasses: classes, platforms: [],
    outcome: "YIELDED" as const, url: `https://example.gov/${id}`, source: "method", observedAt: null, tier: null, payload: {}, ...(ocdIds ? { ocdIds } : {}),
  });
  const county = "ocd-division/country:us/state:az/county:cochise";
  const store = { entries: [make("robots", ["permission"], [county]), make("meeting", ["meeting"]), make("generic", []), make("campaign", ["campaignsite"]), make("contact", ["contact"])] };
  const blanks = ["CAN-05", "CAN-06", "CAN-17"].map(blankRecordClass).filter((value): value is string => value !== null);
  assert.deepEqual([...new Set(blanks)], ["candidate-enrichment"]);
  const projection = scoutFieldManualProjection({ store }, { subjectId: county, divisions: [county], recordClasses: blanks, limit: 4 });
  assert.deepEqual(projection.entryIds.slice(0, 2), ["campaign", "contact"]);
  assert.equal(blankRecordClass("meetingSchedule"), null);
});
