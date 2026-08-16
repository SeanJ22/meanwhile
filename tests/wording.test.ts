import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agendaAbsenceNote,
  collapseFootnotes,
  stateOf,
} from "../lib/registry/wording.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

/** D17 — the New Hampshire wording, and what gates it. */

const NH = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";
const AZ = "ocd-division/country:us/state:az/county:pima";

test("the state comes off the identifier, never off a label", () => {
  assert.equal(stateOf(NH), "nh");
  assert.equal(stateOf(AZ), "az");
  assert.equal(stateOf(null), null);
  // A place merely named after a state must not read as that state.
  assert.equal(stateOf("ocd-division/country:us/state:nj/place:new_hampshire"), "nj");
});

test("an exhausted New Hampshire search says the law does not require an agenda", () => {
  const note = agendaAbsenceNote(NH, "NO_SOURCE_FOUND")!;
  assert.match(note, /searched high and low/);
  assert.match(note, /New Hampshire does not require an agenda/);
  // The statute says notice is required and an agenda is not. Stating it the
  // other way round would be a false legal claim rendered to a reader, which is
  // precisely the error D17 exists to prevent.
  assert.ok(!/does require an agenda/.test(note.replace(/does not require/g, "")));
});

test("a body nobody searched never claims a search", () => {
  // D17 split (2026-08-13): the statutory sentence renders for every NH body
  // — it is a fact about the law, not about our work — while "searched high
  // and low" is a diligence claim that only an exhausted hunt may make.
  for (const status of ["NOT_ATTEMPTED", "KNOWN_UNCOVERED", "LIVE"] as const) {
    const note = agendaAbsenceNote(NH, status)!;
    assert.match(note, /New Hampshire does not require an agenda/, status);
    assert.ok(
      !/searched/i.test(note),
      `${status} must not claim a search happened`,
    );
  }
});

test("outside a no-agenda state, an unsearched body gets no note at all", () => {
  // Arizona requires the agenda posted; there is no statutory fact to state
  // and no diligence to claim, so the caller's own copy covers it.
  assert.equal(agendaAbsenceNote(AZ, "NOT_ATTEMPTED"), null);
  assert.equal(agendaAbsenceNote(AZ, "LIVE"), null);
});

test("outside New Hampshire an exhausted search owns the gap", () => {
  const note = agendaAbsenceNote(AZ, "NO_SOURCE_FOUND")!;
  assert.match(note, /searched high and low/);
  // Arizona requires the agenda posted on the body's website, so silence there
  // is not lawful and must not be excused.
  assert.ok(!/does not require an agenda/.test(note));
});

test("the statutory sentence now renders for real NH bodies", () => {
  // The split's whole point: before it, the exhausted count was zero and the
  // copy rendered for nobody — including the bodies it was written for. Now
  // every NH body carries the statutory fact, whatever its hunt state.
  const nhBodies = registry.bodies.filter(
    (b) => b.ocdId && stateOf(b.ocdId) === "nh",
  );
  assert.ok(nhBodies.length > 0, "the registry holds NH bodies");
  for (const body of nhBodies) {
    const note = agendaAbsenceNote(body.ocdId, body.coverageStatus as never);
    assert.ok(note, `${body.id} should carry the statutory sentence`);
    assert.match(note!, /New Hampshire does not require an agenda/);
  }
  // The diligence sentence still renders for nobody: no hunt is exhausted.
  const exhausted = registry.bodies.filter(
    (b) => b.coverageStatus === "NO_SOURCE_FOUND",
  );
  assert.equal(exhausted.length, 0);
});

/**
 * M94 — one footnote per distinct sentence, bodies named inline.
 *
 * The production shape: at 03255 the who-governs panel repeated "we couldn't
 * reach their calendar source" and "New Hampshire does not require an agenda"
 * up to four times each, and three of those repeats named ONE town three
 * times because Newbury's Planning Board, Conservation Commission and Zoning
 * Board all sit on the same division.
 */
test("identical footnotes collapse to one, naming every distinct body", () => {
  const bodies = [
    { divisionLabel: "Newbury town", ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town" },
    { divisionLabel: "Newbury town", ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town" },
    { divisionLabel: "Newbury town", ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town" },
    { divisionLabel: "Kearsarge Regional School District", ocdId: "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district" },
  ];

  const collapsed = collapseFootnotes(bodies, (b) =>
    agendaAbsenceNote(b.ocdId, "NOT_ATTEMPTED"),
  );

  assert.equal(collapsed.length, 1, "the statutory sentence rendered more than once");
  assert.equal(
    collapsed[0].subjects,
    "Newbury town, Kearsarge Regional School District",
    "a repeated town was named repeatedly, or a body was dropped from the line",
  );
  assert.match(collapsed[0].note, /New Hampshire does not require an agenda/);
});

test("footnotes that differ stay separate, in the panel's own order", () => {
  const bodies = [
    { divisionLabel: "Newbury town", ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town" },
    { divisionLabel: "Tucson city", ocdId: "ocd-division/country:us/state:az/place:tucson" },
  ];
  const collapsed = collapseFootnotes(bodies, (b) =>
    agendaAbsenceNote(b.ocdId, "NO_SOURCE_FOUND"),
  );
  assert.equal(collapsed.length, 2, "two different sentences were merged into one");
  assert.equal(collapsed[0].subjects, "Newbury town");
  assert.equal(collapsed[1].subjects, "Tucson city");
});

test("a body with nothing to say contributes no footnote at all", () => {
  const collapsed = collapseFootnotes(
    [{ divisionLabel: "Rockaway township", ocdId: "ocd-division/country:us/state:nj/place:rockaway" }],
    (b) => agendaAbsenceNote(b.ocdId, "LIVE"),
  );
  assert.deepEqual(collapsed, [], "an empty note became a rendered line");
});
