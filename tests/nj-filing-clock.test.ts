import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ageInDays, compareFiling } from "../lib/hunt/nj-filing-clock.ts";

/**
 * **THE CLERK'S PUBLISHED COUNT AGAINST WHAT THIS PRODUCT RENDERS.**
 * (NJ Hunt 3 item 2, 2026-08-22.)
 *
 * `data/ballot/nj-morris-2026.json` is generated from the Morris County Clerk's
 * filed-candidate PDFs, and the clerk republishes at a new version path on their
 * own schedule — one revision landed WHILE NJ Hunt 2 was running, so the New
 * Jersey ballot was stale the day it shipped. A hand transcription's only
 * symptom is a contest that does not render, which is invisible to everyone
 * except the reader whose race is missing.
 *
 * These hold the decision without a network. The fetching half is not the rule.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const base = {
  rendered: 272,
  contestsRendered: 90,
  curatedAt: "2026-08-22",
  today: "2026-08-22",
  maxAgeDays: 1,
};

test("2.4: the pair reconciling inside its window is the only passing state", () => {
  const v = compareFiling({ ...base, published: 272 });
  assert.equal(v.state, "AGREES");
});

test("2.4: a clerk who has published MORE than we render is a divergence", () => {
  const v = compareFiling({ ...base, published: 328 });
  assert.equal(v.state, "DIVERGED");
  assert.match(v.state === "DIVERGED" ? v.why : "", /328 candidacies and this repo renders 272/);
});

test("2.4: a clerk who has published FEWER is equally a divergence", () => {
  // A withdrawal is as real as a filing, and rendering a withdrawn candidate is
  // a claim about who is running.
  assert.equal(compareFiling({ ...base, published: 260 }).state, "DIVERGED");
});

test("2.4: a zero parse is a FAILED extraction, never an empty filing", () => {
  const v = compareFiling({ ...base, published: 0 });
  assert.equal(v.state, "CANNOT_TELL");
  assert.match(v.state === "CANNOT_TELL" ? v.why : "", /failed parse/);
});

test("2.4: an unreadable clerk is CANNOT TELL, never agreement", () => {
  const v = compareFiling({ ...base, published: null });
  assert.equal(v.state, "CANNOT_TELL");
});

test("2.4: a ballot rendering no contests diverges even when the counts match", () => {
  // Both numbers can agree at 272 while the page shows nothing, because
  // candidacies and contests are two different measurements (the D68 pair rule).
  const v = compareFiling({ ...base, published: 272, contestsRendered: 0 });
  assert.equal(v.state, "DIVERGED");
});

test("2.3: past the one-day window the record is STALE even when it agrees", () => {
  const v = compareFiling({ ...base, published: 272, today: "2026-08-25" });
  assert.equal(v.state, "STALE");
  assert.equal(v.state === "STALE" ? v.ageDays : -1, 3);
});

test("2.3: the window is a DAY, not RULING 53's seven — this document is the ballot", () => {
  // The boundary is PAST the window, not at it: one day old against a one-day
  // window is still inside it.
  assert.equal(compareFiling({ ...base, published: 272, today: "2026-08-23" }).state, "AGREES");
  assert.equal(compareFiling({ ...base, published: 272, today: "2026-08-24" }).state, "STALE");
  assert.equal(
    compareFiling({ ...base, published: 272, today: "2026-08-24", maxAgeDays: 7 }).state,
    "AGREES",
    "the window is a parameter, and the default being 1 is the decision",
  );
});

test("2.3: a curatedAt that cannot be parsed reads as stale, never as fresh", () => {
  // Defaulting the other way is how a bad date buys permanent trust (RULING 53).
  assert.equal(ageInDays("not-a-date", "2026-08-22"), Number.POSITIVE_INFINITY);
  assert.equal(compareFiling({ ...base, published: 272, curatedAt: "not-a-date" }).state, "STALE");
});

test("2: the committed ballot still holds 90 contests and 272 candidacies", () => {
  /*
   * The regression guard for the carry-key defect. The contest id is minted
   * from jurisdiction + office + DIVISION, and the carry map was keyed on
   * division + office alone — so the three constituent municipalities of a
   * REGIONAL school district (Chester, Mendham and Washington Township all
   * elect members to the West Morris Regional board) minted three distinct ids
   * and read back one. Re-running the generator collapsed 90 contests to 87 and
   * orphaned four candidacy ids, and every Chester and Mendham reader would
   * have been shown Washington Township's candidates for a seat they do not
   * vote on.
   */
  const ballot = JSON.parse(
    readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8"),
  ) as { contests: { id: string }[]; candidacies: { id: string }[] };
  assert.equal(ballot.contests.length, 90);
  assert.equal(ballot.candidacies.length, 272);

  const ids = new Set(ballot.contests.map((c) => c.id));
  assert.equal(ids.size, ballot.contests.length, "no two contests may share an id");

  // The three regional-board contests specifically, by name.
  const westMorris = ballot.contests.filter((c) =>
    c.id.includes("west-morris-regional-school-district"),
  );
  assert.ok(
    westMorris.length >= 3,
    `a regional district's seats are allocated per constituent municipality — ` +
      `found ${westMorris.length} West Morris contests, expected at least 3`,
  );
});
