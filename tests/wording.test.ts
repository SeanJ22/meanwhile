import assert from "node:assert/strict";
import { test } from "node:test";

import { agendaAbsenceNote, stateOf } from "../lib/registry/wording.ts";
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
  // 258 of 265 bodies are NOT_ATTEMPTED. Pairing the statutory sentence with a
  // search that never happened would let New Hampshire law explain away our own
  // backlog.
  assert.equal(agendaAbsenceNote(NH, "NOT_ATTEMPTED"), null);
  assert.equal(agendaAbsenceNote(NH, "KNOWN_UNCOVERED"), null);
  assert.equal(agendaAbsenceNote(NH, "LIVE"), null);
});

test("outside New Hampshire an exhausted search owns the gap", () => {
  const note = agendaAbsenceNote(AZ, "NO_SOURCE_FOUND")!;
  assert.match(note, /searched high and low/);
  // Arizona requires the agenda posted on the body's website, so silence there
  // is not lawful and must not be excused.
  assert.ok(!/does not require an agenda/.test(note));
});

test("no body in the registry can trigger this copy today", () => {
  // Nothing has been searched to exhaustion, so the sentence renders for
  // nobody. Recorded rather than hidden: the wording is decided and in place,
  // and the first exhausted hunt is what makes it appear.
  const exhausted = registry.bodies.filter(
    (b) => b.coverageStatus === "NO_SOURCE_FOUND",
  );
  assert.equal(exhausted.length, 0);
});
