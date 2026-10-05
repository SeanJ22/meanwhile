import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceOwedList, type HeldPlaceField, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { rowStatuses } from "../lib/coverage/place-statuses.ts";
import { huntEvidenceFromWorkItems } from "../lib/control-plane/admin-view/place-hunt-evidence.ts";
import { owedListItem } from "../lib/control-plane/admin-view/place-scorecard.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const now = "2026-10-04T12:00:00Z";
const meeting = (startsAt: string): PlaceSubject => ({ id: "meeting:1", kind: "calendar", captureKind: "meeting", divisionIds: [county], label: "Board", startsAt });
const rowsFor = (subject: PlaceSubject, held: HeldPlaceField[], extra: Partial<Parameters<typeof buildPlaceOwedList>[0]> = {}) =>
  buildPlaceOwedList({ divisions: [{ id: county, label: "Cochise County" }], subjects: [subject], held, now, ...extra });
const absent = (id: string): HeldPlaceField => ({ subjectId: "meeting:1", checklistId: id, state: "unpublished", sourceUrl: "https://x.gov/agenda",
  checkedAt: "2026-10-04T09:00:00Z", freshUntil: "2026-10-04T15:00:00Z", value: { statement: "No agenda posted" } });

test("a meeting with no agenda posted yet reads 'Agenda not published yet' with its next check, never 'missing'", () => {
  const row = rowsFor(meeting("2026-10-05T12:00:00Z"), [absent("DOC-01")]).find(r => r.subject.id === "meeting:1" && r.checklistId === "DOC-01")!;
  assert.equal(row.statuses.published, "awaiting-publication");
  assert.equal(row.statuses.due, "due", "inside the agenda's notice window, so it is already due");
  assert.equal(row.statuses.found, "checked-not-posted");
  assert.equal(row.statuses.nextCheck, "2026-10-04T15:00:00Z");
  assert.equal(row.statuses.waitingWords, "Agenda not published yet");
  const listed = owedListItem(row);
  assert.equal(listed.statuses?.waitingWords, "Agenda not published yet");
});

test("an agenda for a meeting far ahead is not yet due; minutes fall due after the meeting", () => {
  const far = rowsFor(meeting("2026-10-20T12:00:00Z"), []).find(r => r.checklistId === "DOC-01")!;
  assert.equal(far.statuses.due, "not-yet-due");
  assert.equal(far.statuses.published, "not-known");
  const past = rowsFor(meeting("2026-08-01T12:00:00Z"), []).find(r => r.checklistId === "DOC-06")!;
  assert.equal(past.statuses.due, "due");
  const recent = rowsFor(meeting("2026-10-01T12:00:00Z"), []).find(r => r.checklistId === "DOC-06")!;
  assert.equal(recent.statuses.due, "not-yet-due");
});

test("a captured fact is found, published, fresh; its resident view stays not checked without a witness", () => {
  const held: HeldPlaceField = { subjectId: "meeting:1", checklistId: "MTG-06", state: "published", sourceUrl: "https://x.gov", checkedAt: "2026-10-04T10:00:00Z",
    freshUntil: "2026-10-04T13:00:00Z", workItemId: "w1" };
  const row = rowsFor(meeting("2026-10-05T12:00:00Z"), [held]).find(r => r.checklistId === "MTG-06")!;
  assert.deepEqual([row.statuses.found, row.statuses.published, row.statuses.fresh, row.statuses.seen], ["found", "published", "fresh", "not-checked"]);
  const seen = rowsFor(meeting("2026-10-05T12:00:00Z"), [held], { witness: id => (id === "w1" ? "CONFIRMED" : null) }).find(r => r.checklistId === "MTG-06")!;
  assert.equal(seen.statuses.seen, "seen");
  const stale = rowStatuses({ checklistId: "MTG-06", subject: { id: "meeting:1" }, held: [held] }, { now: "2026-10-04T20:00:00Z" });
  assert.equal(stale.fresh, "refresh-due");
  assert.equal(stale.nextCheck, "2026-10-04T13:00:00Z");
});

test("an item with no date source or unknown trigger is unresolved, never dropped", () => {
  const row = rowsFor(meeting("2026-10-05T12:00:00Z"), []).find(r => r.checklistId === "MTG-06")!;
  assert.equal(row.statuses.due, "due");
  const none = rowStatuses({ checklistId: "ELE-07", subject: { id: "contest:1" }, held: [] }, { now });
  assert.equal(none.due, "unresolved");
  assert.equal(none.applies, "depends");
  const unknown = rowStatuses({ checklistId: "NOT-LISTED-1", subject: { id: "x" }, held: [] }, { now });
  assert.equal(unknown.applies, "unresolved");
  assert.equal(unknown.due, "unresolved");
});

test("hunt activity comes from work items by subject and by the body they publish for", () => {
  const evidence = huntEvidenceFromWorkItems([
    { subject: "body-1", state: "OPEN", autonomousPlan: undefined },
    { subject: "other", state: "VERIFIED_COMPLETE", autonomousPlan: { publication: { contractId: "ballot-navigation", bodyId: "body-2" } } as never },
  ]);
  assert.deepEqual(evidence.get("body-1"), { inProgress: true, attempts: 0 });
  assert.deepEqual(evidence.get("body-2"), { inProgress: false, attempts: 1 });
  const inProgress = rowStatuses({ checklistId: "GOV-01", subject: { id: "body-1" }, held: [] }, { now, hunt: (id) => evidence.get(id) ?? null });
  assert.equal(inProgress.found, "in-progress");
  const searched = rowStatuses({ checklistId: "GOV-01", subject: { id: "body-2" }, held: [] }, { now, hunt: (id) => evidence.get(id) ?? null });
  assert.equal(searched.found, "attempted");
});

import { buildPlaceOwedList as buildOwed } from "../lib/coverage/place-owed.ts";

test("items are counted at the right unit: ZIP items per ZIP, gated division items by kind, laws and votes per legislature", () => {
  const state = "ocd-division/country:us/state:az";
  const school = `${state}/county:cochise/school_district:bisbee`;
  const place = `${state}/county:cochise/place:bisbee`;
  const rows = buildOwed({ divisions: [{ id: "ocd-division/country:us", label: "United States" }, { id: state, label: "Arizona" }, { id: school, label: "Bisbee Unified" }, { id: place, label: "Bisbee" }],
    subjects: [{ id: "seat:1", kind: "seat", captureKind: "state-legislator", divisionIds: [state], label: "Senator" },
      { id: "seat:2", kind: "seat", captureKind: "state-legislator", divisionIds: [state], label: "Representative" }],
    held: [], now, zips: ["85603", "85604"] });
  const idsOf = (subject: string) => rows.filter(r => r.subject.id === subject).map(r => r.checklistId);
  assert.deepEqual(idsOf("zip:85603"), ["GEO-01", "GEO-02", "GEO-04", "GEO-05", "GEO-06", "GEO-12"], "ZIP items go per ZIP");
  assert.equal(rows.filter(r => r.checklistId === "GEO-01").length, 2);
  assert.ok(idsOf(school).includes("GEO-09") && !idsOf(school).includes("GEO-10") && !idsOf(school).includes("GEO-11"), "only school districts owe school-district items");
  assert.ok(!idsOf(place).some(id => ["GEO-09", "GEO-10", "GEO-11"].includes(id)), "a town owes none of the gated items");
  assert.ok(idsOf(place).includes("GEO-03") && !idsOf(place).includes("GEO-01"));
  assert.deepEqual(idsOf(`${state}#legislature`).sort(), ["LEG-01", "LEG-10", "LEG-22"]);
  assert.deepEqual(idsOf("ocd-division/country:us#legislature").sort(), ["LEG-01", "LEG-10"]);
  assert.ok(idsOf("seat:1").includes("LEG-02") && !idsOf("seat:1").includes("LEG-03"), "a seat owes only the seat items");
  assert.ok(!rows.some(r => r.subject.kind === "rollcall"), "roll calls are owed only where they are held");
  const withoutZips = buildOwed({ divisions: [{ id: state, label: "Arizona" }], subjects: [], held: [], now });
  assert.ok(!withoutZips.some(r => r.checklistId === "GEO-01"), "a place whose ZIPs are not known owes no ZIP rows rather than invented ones");
  const tribal = buildOwed({ divisions: [{ id: place, label: "Bisbee" }], subjects: [], now,
    held: [{ subjectId: place, checklistId: "GEO-11", state: "published", sourceUrl: "https://x.gov", checkedAt: now, freshUntil: "2026-10-05T00:00:00Z" }] });
  assert.ok(tribal.some(r => r.subject.id === place && r.checklistId === "GEO-11"), "a tribal overlap is owed where one is held");
});
