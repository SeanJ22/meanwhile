import { azBallot } from "./helpers/ballot-district-fixtures.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sharedNotesFor } from "../lib/ballot/shared-notes.ts";

const note = (id: string, scopeNote: string | null) => ({ id, scopeNote });

test("F01 11.1: a note carried by many contests moves to the foot, once", () => {
  const text = "The Secretary of State has not yet published the final ballot wording.";
  const { notes, markerFor, isShared } = sharedNotesFor([
    note("a", text),
    note("b", text),
    note("c", text),
  ]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].count, 3);
  // Verbatim. Nothing is shortened or paraphrased on the way down.
  assert.equal(notes[0].text, text);
  for (const id of ["a", "b", "c"]) {
    assert.equal(isShared(id), true);
    assert.equal(markerFor(id), "*");
  }
});

test("F01 11.1: a note only ONE contest carries stays exactly where it is", () => {
  const { notes, markerFor, isShared } = sharedNotesFor([
    note("a", "Only this contest says this."),
    note("b", "And only this one says this."),
  ]);
  assert.deepEqual(notes, []);
  assert.equal(isShared("a"), false);
  assert.equal(markerFor("a"), "");
});

test("F01 11.1: two different repeated notes get two different markers", () => {
  const { notes, markerFor } = sharedNotesFor([
    note("a", "First note."),
    note("b", "Second note."),
    note("c", "First note."),
    note("d", "Second note."),
  ]);
  assert.deepEqual(notes.map((n) => n.marker), ["*", "†"]);
  assert.equal(markerFor("a"), "*");
  assert.equal(markerFor("b"), "†");
});

test("F01 11.1: markers continue from the page's source footnotes, never collide", () => {
  // The ballot page already numbers shared SOURCE lines. A `*` must mean one
  // thing on one page.
  const { notes } = sharedNotesFor([note("a", "X"), note("b", "X")], 2);
  assert.equal(notes[0].marker, "‡");
});

test("F01 11.1: contests with no note contribute nothing and break nothing", () => {
  const { notes, markerFor } = sharedNotesFor([
    note("a", null),
    note("b", null),
    note("c", "Shared."),
    note("d", "Shared."),
  ]);
  assert.equal(notes.length, 1);
  assert.equal(markerFor("a"), "");
  assert.equal(sharedNotesFor([]).notes.length, 0);
});

test("Arizona measures with held wording have no wording gap, and absent proposals stay held", () => {
  const { notes, isShared, markerFor } = sharedNotesFor(azBallot.contests);
  const measures = azBallot.contests.filter(contest => contest.type === "MEASURE");
  assert.equal(measures.length, 8);
  for (const contest of measures) {
    const measure = azBallot.measures.find(row => row.contestId === contest.id)!;
    assert.ok(measure.questionText.trim().length > 120);
    assert.ok(measure.officialText?.vault.key);
    assert.equal(contest.scopeNote ?? null, null);
    assert.equal(isShared(contest.id), false);
    assert.equal(markerFor(contest.id), "");
  }
  assert.deepEqual(azBallot.heldContests?.map(contest => contest.id).sort(),
    [143, 145, 212].map(number => `ballot-az-pima:prop-${number}`));
  for (const held of azBallot.heldContests ?? []) {
    assert.equal(held.ocdId, "ocd-division/country:us/state:az");
    assert.match(held.reason, /absent from both final lists/);
    assert.match(held.reason, /https:\/\/azsos\.gov\/sites\/default\/files\/docs\/2026-Ballot-Language-English-2026-0819\.pdf/);
    assert.equal(azBallot.contests.some(contest => contest.id === held.id), false);
    assert.equal(isShared(held.id), false);
    assert.equal(markerFor(held.id), "");
  }
  for (const shared of notes) {
    const carriers = azBallot.contests.filter(contest => contest.scopeNote === shared.text);
    assert.equal(shared.count, carriers.length);
    assert.ok(carriers.length > 1);
    for (const contest of carriers) assert.equal(markerFor(contest.id), shared.marker);
  }
  assert.doesNotMatch(
    azBallot.contests.map((contest) => contest.scopeNote ?? "").join("\n"),
    /has not yet published the final ballot wording|exact ballot question has not been recorded here/,
    "held official wording must not carry an obsolete publication or acquisition gap",
  );
});

test("F01 11.2 / 11.3: the ballot page drops the contradiction and the false claim", () => {
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  // The self-contradicting privacy paragraph is gone. The link stays.
  assert.ok(
    !/we\s*\n?\s*never see them/.test(page),
    "the self-contradicting picks paragraph is back",
  );
  assert.match(page, /How we handle data/);
  // The page no longer claims an order it does not use.
  assert.ok(
    !/listed alphabetically by surname —/.test(page),
    "the page claims plain alphabetical order again",
  );
  // The privacy link and truthful absence of an alphabetical-order claim remain.
  assert.doesNotMatch(page, /const NEUTRAL_NOTE|\{NEUTRAL_NOTE\}/);
});
