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
