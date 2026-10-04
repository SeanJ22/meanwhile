import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceOwedList, type HeldPlaceField, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { measuresByFamily, placeMeasures, placePercent } from "../lib/coverage/place-measures.ts";
import { scorePlace } from "../lib/control-plane/admin-view/place-scorecard.ts";
import { GROUP_NAMES } from "../lib/coverage/group-names.ts";
import { v6PlaceSection } from "../lib/control-plane/admin-view/v6-place-section.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const now = "2026-10-04T12:00:00Z";
const divisions = [{ id: county, label: "Cochise County" }];
const held = (subjectId: string, checklistId: string, state: HeldPlaceField["state"] = "published", freshUntil = "2026-10-05T12:00:00Z"): HeldPlaceField =>
  ({ subjectId, checklistId, state, sourceUrl: "https://x.gov", checkedAt: "2026-10-04T10:00:00Z", freshUntil });
const meeting = (id: string, startsAt: string): PlaceSubject => ({ id, kind: "calendar", captureKind: "meeting", divisionIds: [county], label: "Board", startsAt });

test("three measures with the counts behind them, never blended", () => {
  const rows = buildPlaceOwedList({ divisions, now, subjects: [meeting("m:1", "2026-10-05T12:00:00Z")], held: [
    held("m:1", "MTG-06"), held("m:1", "MTG-07"), held("m:1", "MTG-08", "published", "2026-10-04T11:00:00Z"), held("m:1", "DOC-01", "unpublished", "2026-10-04T15:00:00Z"),
    held(county, "GEO-03", "held")] });
  const m = placeMeasures(rows);
  assert.ok(m.completeness.percent !== null && m.completeness.n > 0);
  assert.equal(m.completeness.beside.awaitingPublication, 1, "the agenda is due and not yet posted: still owed, shown beside");
  assert.ok(m.completeness.beside.unresolved > 0, "rows with no date source are held out and shown, never dropped");
  assert.equal(m.completeness.beside.blocked, null, "a count we do not have is null, not zero");
  assert.ok(m.completeness.beside.noProducer >= 0);
  assert.equal(m.freshness.of, 4, "MTG-06, MTG-07, MTG-08 and the held geography item need freshness");
  assert.equal(m.freshness.n, 3);
  assert.equal(m.freshness.beside.refreshDue, 1);
  assert.equal(m.delivery.of, 2, "two published items are expected on a page; the stale one is not published now");
  assert.equal(m.delivery.n, 0);
  assert.equal(m.delivery.beside.notChecked, 2, "no page witness is recorded yet");
  assert.deepEqual(Object.keys(m).sort(), ["completeness", "delivery", "freshness"]);
});

test("a requirement that is already due is not removed by awaiting publication, and not-yet-due items are not owed yet", () => {
  const soon = buildPlaceOwedList({ divisions, now, subjects: [meeting("m:1", "2026-10-05T12:00:00Z")], held: [held("m:1", "DOC-01", "unpublished")] });
  const agenda = soon.find(r => r.subject.id === "m:1" && r.checklistId === "DOC-01")!;
  assert.equal(agenda.statuses.due, "due");
  const m = placeMeasures(soon);
  assert.equal(m.completeness.beside.awaitingPublication, 1);
  const far = placeMeasures(buildPlaceOwedList({ divisions, now, subjects: [meeting("m:2", "2026-10-30T12:00:00Z")], held: [] }));
  assert.ok(far.completeness.beside.notYetDue >= 1, "an agenda for a meeting weeks away is not yet owed");
});

test("government-unpublished is not counted as held", () => {
  const rows = [{ checklistId: "GOV-01", state: "published" as const }, { checklistId: "GOV-02", state: "unpublished" as const }, { checklistId: "GOV-03", state: "missing" as const }];
  const m = placeMeasures(rows);
  assert.equal(m.completeness.n, 1);
  assert.equal(m.completeness.of, 2, "the item the government does not publish leaves the denominator");
  assert.equal(m.completeness.beside.notPublishedByGovernment, 1);
  assert.equal(placePercent(rows), 50);
});

test("every figure is reported by family and by place, and the family counts add up to the place's", () => {
  const rows = [{ checklistId: "GOV-01", state: "published" as const }, { checklistId: "GEO-03", state: "missing" as const }, { checklistId: "OFF-04", state: "held" as const }];
  const byFamily = measuresByFamily(rows, ["GEO", "GOV", "OFF"]);
  assert.deepEqual(byFamily.map(f => f.group), ["GEO", "GOV", "OFF"]);
  assert.equal(byFamily.reduce((n, f) => n + f.measures.completeness.of, 0), placeMeasures(rows).completeness.of);
  assert.equal(byFamily.reduce((n, f) => n + f.measures.completeness.n, 0), placeMeasures(rows).completeness.n);
  assert.deepEqual(scorePlace(rows.map(r => ({ ...r, id: r.checklistId, requirement: "", subject: { id: "s", kind: "division", label: "S" }, held: [] })), GROUP_NAMES, []).measures, placeMeasures(rows));
});

test("a sent place's card carries three labeled figures and one-line notes", () => {
  const rows = buildPlaceOwedList({ divisions, now, subjects: [], held: [held(county, "GEO-03")] });
  const view = v6PlaceSection({ state: "READ", placeKey: "geo:az.county.04003", label: "Cochise County", covers: "x", divisions, rows, observedAt: now, readMs: { geography: 0, held: 0 } },
    { group: null, states: null, q: null, offset: 0, limit: 10 });
  assert.deepEqual(Object.keys(view.data.score.measures).sort(), ["completeness", "delivery", "freshness"]);
  assert.ok(view.missingParts.every(line => line.length < 100 && !/\n/.test(line)), "one-line labels, not paragraphs");
});
