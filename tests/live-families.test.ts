import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import type { HeldPlaceCapture } from "../lib/civic-data/held-place-capture.ts";
import { liveFamiliesByGovernment } from "../lib/control-plane/expansion/live-families.ts";
import { jurisdictionRequirements } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { UNREAD_MEETING_PARTITIONS } from "../lib/control-plane/scheduler/provider-inputs.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";

const NOW = "2026-10-04T12:00:00.000Z";
const D = "ocd-division/country:us/state:xx/county:example";
const subjects: HeldPlaceCapture["subjects"][number][] = [
  { id: `${D}#governing`, kind: "body", divisionIds: [D], captureKind: "registry-body", label: "Example County board" },
  { id: `${D}#seat-1`, kind: "seat", divisionIds: [D], captureKind: "local-officeholder", label: "Example County commissioner" },
];
const government = { id: "xx:county:example", ocdId: D };

/** Every owed officeholder/government row for the two subjects, held as `state` and fresh until `freshUntil`. */
function heldAll(state: HeldPlaceCapture["held"][number]["state"], freshUntil: string): HeldPlaceCapture["held"][number][] {
  return buildPlaceOwedList({ divisions: [{ id: D, label: D }], subjects, held: [], now: NOW })
    .filter(item => !item.subject.id.includes("#inventory:") && item.subject.kind !== "calendar" && /^(GOV|OFF|EXE)-/.test(item.checklistId))
    .map(item => ({ subjectId: item.subject.id, checklistId: item.checklistId, state, sourceUrl: "https://example.gov/people",
      checkedAt: "2026-10-03T00:00:00.000Z", freshUntil, value: null }));
}

test("a government whose officeholder rows are all published and fresh is live for that family", () => {
  const held = heldAll("published", "2026-10-30T00:00:00.000Z");
  assert.ok(held.length > 0, "the fixture owes rows");
  assert.deepEqual([...liveFamiliesByGovernment({ governments: [government], capture: { subjects, held }, now: NOW }).get(government.id) ?? []], ["OFFICEHOLDERS"]);
});

test("rows the government does not publish count as settled", () => {
  const held = heldAll("unpublished", "2026-10-30T00:00:00.000Z");
  assert.ok(liveFamiliesByGovernment({ governments: [government], capture: { subjects, held }, now: NOW }).get(government.id)?.has("OFFICEHOLDERS"));
});

test("a stale row, an unheld row, or no held row at all keeps the discovery Scout", () => {
  const fresh = heldAll("published", "2026-10-30T00:00:00.000Z");
  const stale = fresh.map((f, i) => (i === 0 ? { ...f, freshUntil: "2026-10-01T00:00:00.000Z" } : f));
  assert.equal(liveFamiliesByGovernment({ governments: [government], capture: { subjects, held: stale }, now: NOW }).has(government.id), false);
  assert.equal(liveFamiliesByGovernment({ governments: [government], capture: { subjects, held: fresh.slice(1) }, now: NOW }).has(government.id), false);
  assert.equal(liveFamiliesByGovernment({ governments: [government], capture: { subjects, held: [] }, now: NOW }).has(government.id), false);
  assert.equal(liveFamiliesByGovernment({ governments: [{ id: "xx:other", ocdId: "ocd-division/country:us/state:xx/county:other" }], capture: { subjects, held: fresh }, now: NOW }).size, 0, "another government's rows do not count");
});

test("a live family drops only its discovery Scout; the other families and the directory stay", () => {
  const reg: JurisdictionRegistry = JSON.parse(readFileSync(join(import.meta.dirname, "../data/states/az/jurisdictions/az.json"), "utf8"));
  const school = { ...reg.jurisdictions.find(j => j.govClass === "SCHOOL_DISTRICT")!, sourceIds: [] };
  const routes = (live?: ReadonlySet<string>) => jurisdictionRequirements(reg, school, UNREAD_MEETING_PARTITIONS, true, live).map(r => r.route.routeId);
  const before = routes();
  assert.ok(before.includes("coverage-discovery:officeholders"));
  const after = routes(new Set(["OFFICEHOLDERS"]));
  assert.deepEqual(before.filter(r => !after.includes(r)), ["coverage-discovery:officeholders"]);
});
