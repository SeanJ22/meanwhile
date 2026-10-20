
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sharedNotesFor } from "../lib/ballot/shared-notes.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

const azBallot = Object.values(JSON.parse(readFileSync(join(import.meta.dirname, "../data/ballot/2026-general/az.json"), "utf8")).ballots)[0] as BallotSet;


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

test("F01 11.1: the eleven Arizona measure gaps collapse into one truthful note", () => {
  const text = "The exact ballot question has not been recorded here. The Legislative Council's official analysis is available below.";
  const { notes, isShared, markerFor } = sharedNotesFor(azBallot.contests);
  const wording = notes.find((n) => n.text === text);
  assert.ok(wording, "the repeated ballot-wording gap did not collapse verbatim");
  assert.equal(wording.count, 11);
  const carriers = azBallot.contests.filter((contest) => contest.scopeNote === text);
  assert.equal(carriers.length, 11);
  for (const contest of carriers) {
    assert.equal(isShared(contest.id), true);
    assert.equal(markerFor(contest.id), wording.marker);
  }
  assert.doesNotMatch(
    azBallot.contests.map((contest) => contest.scopeNote ?? "").join("\n"),
    /has not yet published the final ballot wording/,
    "missing reader wording does not establish that the election authority has not published it",
  );
});

test("F01 11.2 / 11.3: the ballot page drops the contradiction and the false claim", () => {
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  // The self-contradicting privacy paragraph is gone. The link stays.
  assert.ok(
    !/we\s*\n?\s*never see them/.test(page),
    "the self-contradicting picks paragraph is back",
  );
  assert.match(page, /href="\/transparency"[^>]*>\s*What this site collects\s*<\/Link>/,
    "the ballot must link to the collection details with its plain page title");
  // The page no longer claims an order it does not use.
  assert.ok(
    !/listed alphabetically by surname —/.test(page),
    "the page claims plain alphabetical order again",
  );
  // The privacy link and truthful absence of an alphabetical-order claim remain.
  assert.doesNotMatch(page, /const NEUTRAL_NOTE|\{NEUTRAL_NOTE\}/);
});
