import assert from "node:assert/strict";
import test from "node:test";
import { checklistItem } from "../lib/coverage/checklist-map.ts";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import type { HeldPlaceCapture } from "../lib/civic-data/held-place-capture.ts";
import { projectHeldPlaceFamilies } from "../lib/civic-data/held-place-families.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { blankFingerprint, withAskedBlanks, packetCostEstimateUsd, packetFamilies, packetsFrom, reportableSubjects } from "../lib/hunt/packet.ts";

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
  const ids = packets.flatMap(p => p.blanks.map(b => b.checklistId));
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const rule = checklistItem(id)!;
    assert.ok(rule.unit !== "system" && rule.unit !== "zip" && ["fact", "identity", "source", "freshness"].includes(rule.predicateKind), id);
  }
  assert.ok(!ids.some(id => id.startsWith("GATE-") || id.startsWith("ASK-")));
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

test("a candidacy owes the candidate blanks, its race owes the candidate list, and a measure owes its websites", () => {
  const CD1 = "ocd-division/country:us/state:az/cd:1";
  const provenance = { sourceUrl: "https://azsos.gov/2026/candidates", sourceOrg: "Arizona Secretary of State", collectedAt: "2026-10-01T00:00:00.000Z" };
  const contest = { electionId: "az-2026-general", ocdId: CD1, divisionVintage: "2024", voteFor: 1, termYears: 2, scopeNote: null, provenance };
  const ballot = {
    election: { id: "az-2026-general", date: "2026-11-03", name: "General", state: "AZ" },
    contests: [{ ...contest, id: "az-us-house-1", title: "U.S. House, District 1", type: "CANDIDACY", candidateListComplete: true },
      { ...contest, id: "az-prop-1", title: "Proposition 1", type: "MEASURE" }],
    candidacies: [
      { id: "cand-a", contestId: "az-us-house-1", familyName: "Alpha", givenName: "Ann", partyLabel: null, slogan: null, incumbent: null, websiteUrl: "https://annalpha.example", provenance },
      { id: "cand-b", contestId: "az-us-house-1", familyName: "Bravo", givenName: "Ben", partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance },
    ],
    measures: [{ id: "m-1", contestId: "az-prop-1", questionText: "Shall the district issue bonds?", officialStatement: null, provenance }],
    absences: [],
  } as unknown as BallotSet;
  const capture = projectHeldPlaceFamilies([CD1], null, { ballots: [ballot] });
  const items = buildPlaceOwedList({ divisions: [{ id: CD1, label: "Congressional District 1" }], subjects: capture.subjects, held: capture.held, now: NOW });
  const owed = (id: string, family: string) => items.filter(row => row.subject.id === id && row.checklistId.startsWith(family)).map(row => row.checklistId);
  const [packet] = packetsFrom({ divisions: [{ id: CD1, label: "Congressional District 1" }], items });
  const blanksOf = (id: string) => packet!.blanks.filter(b => b.subjectId === id).map(b => b.checklistId).sort();
  assert.deepEqual(blanksOf("cand-b"), ["CAN-04", "CAN-05", "CAN-06", "CAN-07", "CAN-16", "CAN-17"]);
  assert.deepEqual(blanksOf("cand-a"), ["CAN-06", "CAN-07", "CAN-16", "CAN-17"], "the filed website is held");
  assert.ok(packet!.held.some(f => f.subjectId === "cand-a" && f.checklistId === "CAN-05" && /annalpha/.test(f.value)));
  assert.deepEqual(owed("az-us-house-1", "CAN-"), [], "the race owes no candidate item");
  assert.ok(items.some(row => row.subject.id === "az-us-house-1" && row.checklistId === "ELE-07" && row.state !== "missing"), "the race holds its verified candidate list");
  assert.deepEqual(owed("az-prop-1", "CAN-"), [], "a measure owes no bio, photo or campaign contact");
  assert.ok(!owed("az-prop-1", "ELE-").includes("ELE-07"), "a measure owes no candidate list");
  assert.deepEqual(blanksOf("az-prop-1").filter(id => ["ELE-27", "ELE-28"].includes(id)), ["ELE-27", "ELE-28"], "its information page and committee sites are hunted");
  assert.ok(!owed("az-us-house-1", "ELE-").includes("ELE-27"), "a race owes no measure website");
});
