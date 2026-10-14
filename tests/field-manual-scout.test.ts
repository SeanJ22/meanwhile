import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { projectFieldManual } from "../lib/control-plane/field-manual.ts";
import { scoutFieldManualProjection, scoutStateHint } from "../lib/control-plane/scheduler/field-manual-scout.ts";

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

test("OFFICIAL_ROSTER inherits historic contact and roster methods before unrelated doors", () => {
  const make = (id: string, field: string) => ({
    id, role: "SCOUT" as const, kind: "ROUTE", title: id, summary: id, states: ["az"], recordClasses: [field], platforms: [],
    outcome: "YIELDED" as const, url: `https://example.gov/${id}`, source: "method", observedAt: null, tier: null, payload: {},
  });
  const store = { entries: [make("meeting", "meeting"), make("contact", "contact"), make("roster", "roster")] };
  const projection = scoutFieldManualProjection({ store }, { subjectId: "az:city:sierra-vista", recordClass: "OFFICIAL_ROSTER", limit: 2 });
  assert.deepEqual(projection.entryIds, ["contact", "roster"]);
});
