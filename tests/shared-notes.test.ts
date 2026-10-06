import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sharedNotesFor } from "../lib/ballot/shared-notes.ts";

/** F01 11.1 — a note that is the same on every contest is a page note. */

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

test("F01 11.1: the Arizona measures actually collapse — eleven into one", () => {
  // The author's instance, against the shipped data rather than a fixture.
  const ballot = JSON.parse(
    readFileSync(join(process.cwd(), "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8"),
  ) as { contests: { id: string; scopeNote: string | null }[] };

  const { notes, isShared } = sharedNotesFor(ballot.contests);
  const wording = notes.find((n) =>
    /has not yet published the final ballot wording/.test(n.text),
  );
  assert.ok(wording, "the repeated ballot-wording note did not collapse");
  assert.ok(
    wording.count >= 10,
    `expected the wording note on ten-plus contests, found ${wording.count}`,
  );
  // And every contest carrying it now points at the one note.
  const carriers = ballot.contests.filter((c) =>
    /has not yet published the final ballot wording/.test(c.scopeNote ?? ""),
  );
  assert.equal(carriers.length, wording.count);
  for (const c of carriers) assert.equal(isShared(c.id), true);
});

test("F01 11.2 / 11.3: the ballot page drops the contradiction and the false claim", () => {
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  // 11.2 — the self-contradicting privacy paragraph is gone. The link stays.
  assert.ok(
    !/we\s*\n?\s*never see them/.test(page),
    "the self-contradicting picks paragraph is back",
  );
  assert.match(page, /How we handle data/);
  // 11.3 — the page no longer claims an order it does not use.
  assert.ok(
    !/listed alphabetically by surname —/.test(page),
    "the page claims plain alphabetical order again",
  );
  // FE-30 retires the old neutral-copy paragraph under the current plan.
  // The privacy link and truthful absence of an alphabetical-order claim remain.
  assert.doesNotMatch(page, /const NEUTRAL_NOTE|\{NEUTRAL_NOTE\}/);
});
