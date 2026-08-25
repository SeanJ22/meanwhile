/**
 * **RULING 143 made checkable, and the ways an absence is allowed to fail.**
 *
 * The whole risk in this module is one direction: it decides when a field stops
 * being owed, and every mistake it can make is a mistake that rounds a gap up
 * into a finish. So the guards below are all about REFUSING — the passing case
 * gets one test and the refusals get five.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDIDATE_FIELD_EXPIRY_DAYS,
  KELLY_FIELDS,
  STUCK_MOVES,
  absenceStands,
  addDays,
  type ArguedAbsence,
  type StuckStep,
} from "../lib/hunt/kelly-depth.ts";

const step = (move: (typeof STUCK_MOVES)[number], over: Partial<StuckStep> = {}): StuckStep => ({
  move,
  query: `a literal query for ${move}`,
  result: "nothing found",
  reached: true,
  ...over,
});

const complete = (over: Partial<ArguedAbsence> = {}): ArguedAbsence => ({
  candidacyId: "ballot-nj-morris:us-senate:murphy",
  field: "campaignSite",
  protocol: STUCK_MOVES.map((m) => step(m)),
  at: "2026-08-24",
  expiresOn: addDays("2026-08-24", CANDIDATE_FIELD_EXPIRY_DAYS),
  argument: "five moves, none of them found a site",
  ...over,
});

test("the five Kelly fields are exactly the five Sean named", () => {
  assert.deepEqual(
    [...KELLY_FIELDS],
    ["photo", "phone", "contact", "verifiedPage", "campaignSite"],
    "RULING 143 names a photo, a phone, a working contact, a specific verified page and a campaign site",
  );
});

test("a complete, reached, unexpired protocol STANDS", () => {
  const v = absenceStands(complete(), "2026-08-25");
  assert.equal(v.stands, true);
  assert.match(v.why, /2026-08-24/);
});

test("fewer than five moves is VOID — RULING 94", () => {
  const v = absenceStands(complete({ protocol: STUCK_MOVES.slice(0, 4).map((m) => step(m)) }), "2026-08-25");
  assert.equal(v.stands, false);
  assert.match(v.why, /VOID/);
  assert.match(v.why, /4 of 5/);
});

test("five rows of the SAME move is one question asked five times, and is VOID", () => {
  const v = absenceStands(
    complete({ protocol: [step("lateral"), step("lateral"), step("lateral"), step("lateral"), step("lateral")] }),
    "2026-08-25",
  );
  assert.equal(v.stands, false);
  assert.match(v.why, /repeats a move/);
});

test("a move with no literal query, or no result, is VOID — a description is not the text that was typed", () => {
  const noQuery = complete({
    protocol: STUCK_MOVES.map((m) => (m === "tier-above" ? step(m, { query: "  " }) : step(m))),
  });
  assert.equal(absenceStands(noQuery, "2026-08-25").stands, false);

  const noResult = complete({
    protocol: STUCK_MOVES.map((m) => (m === "same-shape" ? step(m, { result: "" }) : step(m))),
  });
  assert.equal(absenceStands(noResult, "2026-08-25").stands, false);
});

test("five WALLS are five attempts and establish nothing — the field stays owed", () => {
  /*
   * The case this project is most likely to get wrong on this ballot, because it
   * is what actually happened: every general web index whose robots.txt permits
   * walking answers our requests with a bot challenge. A protocol made entirely
   * of refusals looks complete and has walked nothing.
   */
  const allWalled = complete({
    protocol: STUCK_MOVES.map((m) => step(m, { reached: false, result: "HTTP 202, a bot challenge page" })),
  });
  const v = absenceStands(allWalled, "2026-08-25");
  assert.equal(v.stands, false);
  assert.match(v.why, /REFUSED/);

  /* One reached move is enough — the bar has to be clearable by a school-board
   * candidate with no web presence, or an argued absence can never be earned. */
  const oneReached = complete({
    protocol: STUCK_MOVES.map((m, i) =>
      step(m, i === 0 ? { reached: true } : { reached: false, result: "HTTP 202, a bot challenge page" }),
    ),
  });
  assert.equal(absenceStands(oneReached, "2026-08-25").stands, true);
});

test("an absence EXPIRES on the RULING 53 clock, and stale is not wrong", () => {
  const a = complete({ at: "2026-08-01", expiresOn: addDays("2026-08-01", CANDIDATE_FIELD_EXPIRY_DAYS) });
  const v = absenceStands(a, "2026-08-24");
  assert.equal(v.stands, false);
  assert.match(v.why, /STALE/);
  assert.match(v.why, /2026-08-08/, "the expiry is seven days after the walk, per RULING 53");
});

test("addDays reads the calendar date from the string and never round-trips a local Date", () => {
  /*
   * RULING 140's trap, one field over. `new Date("2026-08-24")` is midnight UTC
   * and formatting it in America/Phoenix returns the 23rd, so an expiry computed
   * that way is a day early — which would silently return fields to owed.
   */
  assert.equal(addDays("2026-08-24", 7), "2026-08-31");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04", "it crosses a year boundary");
  assert.equal(addDays("2026-02-26", 7), "2026-03-05", "it crosses a month boundary");
});
