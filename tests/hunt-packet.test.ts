import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import type { HeldPlaceCapture } from "../lib/civic-data/held-place-capture.ts";
import { blankFingerprint, huntableItem, withAskedBlanks, packetCostEstimateUsd, packetFamilies, packetsFrom, reportableSubjects } from "../lib/hunt/packet.ts";

const NOW = "2026-10-14T12:00:00.000Z";
const COUNTY = "ocd-division/country:us/state:az/county:santa_cruz";
const CITY = "ocd-division/country:us/state:az/place:nogales";
const divisions = [{ id: COUNTY, label: "Santa Cruz County" }, { id: CITY, label: "Nogales" }];
const subjects: HeldPlaceCapture["subjects"][number][] = [
  { id: `${COUNTY}#board`, kind: "body", divisionIds: [COUNTY], captureKind: "registry-body", label: "Board of Supervisors" },
  { id: `${COUNTY}#seat-1`, kind: "seat", divisionIds: [COUNTY], captureKind: "local-officeholder", label: "Supervisor, District 1" },
  { id: `${CITY}#council`, kind: "body", divisionIds: [CITY, COUNTY], captureKind: "registry-body", label: "City Council" },
];
const seatName = { subjectId: `${COUNTY}#seat-1`, checklistId: "OFF-04", state: "published" as const,
  sourceUrl: "https://www.santacruzcountyaz.gov/169/Board-of-Supervisors", checkedAt: "2026-10-10T00:00:00.000Z",
  freshUntil: "2026-11-10T00:00:00.000Z", value: { name: "Manuel Ruiz", office: "Supervisor, District 1" } };

function owed(held: HeldPlaceCapture["held"][number][], ds = divisions) {
  return buildPlaceOwedList({ divisions: ds, subjects, held, now: NOW });
}

test("one packet per government, each subject under its own government", () => {
  const packets = packetsFrom({ divisions, items: owed([seatName]) });
  assert.deepEqual(packets.map(p => p.governmentId), [COUNTY, CITY]);
  const city = packets.find(p => p.governmentId === CITY)!;
  assert.ok(city.blanks.some(b => b.subjectId === `${CITY}#council`), "a body that also serves the county is the city's");
  assert.ok(!packets.find(p => p.governmentId === COUNTY)!.blanks.some(b => b.subjectId === `${CITY}#council`));
});

test("a held value is listed as held and never as a blank", () => {
  const county = packetsFrom({ divisions, items: owed([seatName]) }).find(p => p.governmentId === COUNTY)!;
  const held = county.held.find(f => f.subjectId === `${COUNTY}#seat-1` && f.checklistId === "OFF-04");
  assert.ok(held, "the published name is held");
  assert.match(held.value, /Manuel Ruiz/);
  assert.equal(held.sourceUrl, seatName.sourceUrl);
  assert.ok(!county.blanks.some(b => b.subjectId === `${COUNTY}#seat-1` && b.checklistId === "OFF-04"));
  assert.ok(county.blanks.some(b => b.subjectId === `${COUNTY}#seat-1` && b.checklistId !== "OFF-04"), "other facts about the seat stay open");
});

test("a stale value is held for its source's refresh, not hunted", () => {
  const stale = { ...seatName, freshUntil: "2026-10-12T00:00:00.000Z" };
  const county = packetsFrom({ divisions, items: owed([stale]) }).find(p => p.governmentId === COUNTY)!;
  assert.ok(county.held.some(f => f.checklistId === "OFF-04"));
  assert.ok(!county.blanks.some(b => b.subjectId === `${COUNTY}#seat-1` && b.checklistId === "OFF-04"));
});

test("blanks are only what an agent can find on a page", () => {
  const packets = packetsFrom({ divisions, items: owed([]) });
  for (const blank of packets.flatMap(p => p.blanks)) assert.ok(huntableItem(blank.checklistId), blank.checklistId);
  assert.equal(huntableItem("GATE-01"), false);
  assert.equal(huntableItem("ASK-01"), false);
});

test("a packet's subjects are its government and every subject it holds or owes", () => {
  const county = packetsFrom({ divisions, items: owed([seatName]) }).find(p => p.governmentId === COUNTY)!;
  const subjects = reportableSubjects(county);
  assert.ok(subjects.has(COUNTY));
  assert.ok(subjects.has(`${COUNTY}#seat-1`));
  assert.ok(!subjects.has(`${CITY}#council`));
});

test("the fingerprint moves only when the open blanks change", () => {
  const a = packetsFrom({ divisions, items: owed([]) }).find(p => p.governmentId === COUNTY)!;
  const b = packetsFrom({ divisions, items: owed([]) }).find(p => p.governmentId === COUNTY)!;
  const c = packetsFrom({ divisions, items: owed([seatName]) }).find(p => p.governmentId === COUNTY)!;
  assert.equal(blankFingerprint(a), blankFingerprint(b));
  assert.notEqual(blankFingerprint(a), blankFingerprint(c));
});

test("families and the estimate count only open blanks", () => {
  const packets = packetsFrom({ divisions, items: owed([seatName]) });
  const off = packetFamilies(packets).find(f => f.family === "OFF")!;
  assert.equal(off.name, "Officeholders");
  assert.ok(off.held >= 1 && off.blanks >= 1);
  const rates = { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5, searchUsd: 0.005 };
  assert.equal(packetCostEstimateUsd([{ blanks: [] }], rates), 0);
  assert.ok(packetCostEstimateUsd(packets, rates) > 0);
});

test("a question Ask could not answer about a body becomes a blank on its calendar, even where a value is held", () => {
  const county = packetsFrom({ divisions, items: owed([]) }).find(p => p.governmentId === COUNTY)!;
  const calendar = `${COUNTY}#board#calendar`;
  const heldCadence = { ...county, blanks: county.blanks.filter(b => !(b.subjectId === calendar && b.checklistId === "MTG-04")), held: [...county.held, { subjectId: calendar, subjectLabel: "Board of Supervisors: calendar", checklistId: "MTG-04",
    family: "MTG", requirement: "Cadence", value: "monthly", sourceUrl: "https://example.gov/board", checkedAt: "2026-01-01T00:00:00.000Z" }] };
  const asked = [{ bodyId: `${COUNTY}#board`, code: "CALENDAR_STALE" as const, recordClass: "MEETING" as const, asks: 3, days: 2, firstDay: "2026-10-12", lastDay: "2026-10-13" },
    { bodyId: `${CITY}#council`, code: "AGENDA_NOT_HELD" as const, recordClass: "MEETING" as const, asks: 1, days: 1, firstDay: "2026-10-13", lastDay: "2026-10-13" }];
  const withAsked = withAskedBlanks(heldCadence, asked);
  const blank = withAsked.blanks.find(b => b.subjectId === calendar && b.checklistId === "MTG-04");
  assert.ok(blank, "the stale calendar readers asked about is hunted");
  assert.match(blank.requirement, /Readers were told this 3 times/);
  assert.ok(!withAsked.held.some(f => f.subjectId === calendar && f.checklistId === "MTG-04"), "it is no longer listed as never-look-again");
  assert.ok(!withAsked.blanks.some(b => b.subjectId.startsWith(CITY)), "another government's question stays with that government");
  assert.notEqual(blankFingerprint(withAsked), blankFingerprint(heldCadence), "a new question makes the packet due again");
});
