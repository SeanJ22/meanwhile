import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceOwedList, type HeldPlaceField, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { openBlanksOf } from "../lib/coverage/open-blanks.ts";
import { collectNationalPlaceSources, openNationalFamilies } from "../lib/sources/plural/place.ts";
import { runPlaceSource } from "../lib/hunt/place-source.ts";
import { skippedFamilies } from "../lib/hunt/place-source-task.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const now = "2026-10-04T12:00:00Z";
const divisions = [{ id: county, label: "Cochise County" }];
const meeting: PlaceSubject = { id: "meeting:1", kind: "calendar", captureKind: "meeting", divisionIds: [county], label: "Board", startsAt: "2026-10-20T12:00:00Z" };
const fresh = (subjectId: string, checklistId: string): HeldPlaceField => ({ subjectId, checklistId, state: "published", sourceUrl: "https://x.gov", checkedAt: now, freshUntil: "2026-10-05T12:00:00Z" });

test("open blanks are the rows that are due, unsatisfied and not in progress, grouped by squad then subject", () => {
  const rows = buildPlaceOwedList({ divisions, subjects: [meeting], held: [fresh("meeting:1", "MTG-06")], now,
    hunt: (id, checklistId) => (id === "meeting:1" && checklistId === "MTG-08" ? { inProgress: true, attempts: 0 } : null) });
  const open = openBlanksOf(rows);
  const ids = open.all.filter(r => r.subject.id === "meeting:1").map(r => r.checklistId);
  assert.ok(!ids.includes("MTG-06"), "captured is satisfied");
  assert.ok(!ids.includes("MTG-08"), "being worked is not open");
  assert.ok(!ids.includes("DOC-01"), "an agenda for a meeting two weeks away is not yet due");
  assert.ok(ids.includes("MTG-07"));
  assert.ok(open.bySquad.get("governments-meetings")?.get("meeting:1")?.some(r => r.checklistId === "MTG-07"));
  assert.ok(open.bySquad.get("governments-meetings")?.get(county)?.some(r => r.checklistId.startsWith("GEO-")));
});

test("the national families with nothing open are skipped", () => {
  assert.deepEqual(openNationalFamilies([]), { officials: false, elections: false });
  assert.deepEqual(openNationalFamilies([{ checklistId: "OFF-04" }]), { officials: true, elections: false });
  assert.deepEqual(openNationalFamilies([{ checklistId: "ELE-11" }, { checklistId: "GOV-01" }]), { officials: false, elections: true });
  assert.deepEqual(skippedFamilies({ officials: true, elections: false }), ["elections"]);
});

test("a pass with no open families reads no sources", async () => {
  const read: string[] = [];
  const result = await collectNationalPlaceSources({sourceHints:async()=>[], divisions: [{ id: "ocd-division/country:us/state:mo", label: "Missouri", divisionType: "state", geoid: "29", sourceUrl: "https://census.gov" }],
    now, families: { officials: false, elections: false }, read: async url => { read.push(url); throw new Error("must not read"); } });
  assert.deepEqual(read, []);
  assert.deepEqual(result.families, { officials: false, elections: false });
});

test("a pass for elections only never reads the officials roster", async () => {
  const read: string[] = [];
  await collectNationalPlaceSources({sourceHints:async()=>[], divisions: [{ id: "ocd-division/country:us/state:mo", label: "Missouri", divisionType: "state", geoid: "29", sourceUrl: "https://census.gov" }],
    now, families: { officials: false, elections: true }, read: async url => { read.push(url); throw new Error("unavailable"); } });
  assert.ok(read.every(url => !/legislators|plural|\.csv/i.test(url)), read.join(", "));
  assert.deepEqual(read, ["https://www.sos.mo.gov/elections/"]);
});

test("a second pass on a place with every blank filled reads nothing and says which families it skipped", async () => {
  const division = { id: "ocd-division/country:us/state:mo", label: "Missouri", divisionType: "state", geoid: "29", sourceUrl: "https://census.gov" };
  const all = buildPlaceOwedList({ divisions: [division], subjects: [], held: [], now });

  const held = all.map(row => fresh(row.subject.id, row.checklistId));
  const read: string[] = [];
  const result = await runPlaceSource({ repos: createMemoryRepositories(), store: new MemoryRoutineDataStore(), zip: "65101", now,
    divisions: [division], geographyCaptures: [], readHeld: async () => ({ subjects: [], held }),
    readSource: async url => { read.push(url); throw new Error("must not read"); }, publish: async () => ({}) });
  assert.deepEqual(read, []);
  assert.deepEqual(skippedFamilies(result.families), ["officials", "elections"]);
});
