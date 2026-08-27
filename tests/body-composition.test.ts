import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  BODY_COMPOSITIONS,
  compositionFor,
  membersOfBody,
} from "../lib/registry/body-composition.ts";
import { governingRosterHoldersForDivision, rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import type { Registry } from "../lib/registry/types.ts";

/**
 * **A BODY DOES NOT INHERIT MEMBERS FROM ITS GEOGRAPHY.**
 * (2026-08-27, the coverage-truth session. Red Controls 2 and 3.)
 *
 * The author's visual review on 2026-08-27 caught the Central Arizona Water
 * Conservation District card showing the five Pima County Supervisors under
 * *Who sits on it*, with "Jennifer Allen — Presides". CAWCD's own board page
 * says the board is *popularly elected, 15 members* — ten Maricopa, four Pima,
 * one Pinal — presided over by Terry Goddard.
 *
 * The cause was one line: a body with no roster of its own took
 * `governingRosterHoldersForDivision(body.ocdId)`. **74 of 1,998 registry
 * bodies rendered named members that way and through nothing else**, including
 * 58 appointed City of Tucson boards and commissions that each showed the Mayor
 * and Council.
 *
 * These guards hold the repaired shape:
 *
 * 1. The fallback is gone from every path that can make a MEMBERSHIP claim.
 * 2. An inherited roster requires a recorded, cited authority.
 * 3. An unsourced body renders nobody rather than plausible people.
 *
 * They live outside `lib/registry/body-composition.ts` so a defect in the
 * resolver cannot also disable the check on it.
 */

const ROOT = process.cwd();
const PIMA_SUPERVISORS = "ocd-division/country:us/state:az/county:pima#governing";
const TUCSON_COUNCIL = "ocd-division/country:us/state:az/place:tucson#governing";
const CAWCD = "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district";
const TUCSON_PHA = "ocd-division/country:us/state:az/place:tucson#public-housing-authority";
const TUCSON_PLANNING = "ocd-division/country:us/state:az/place:tucson#planning-commission";
const FLOOD_CONTROL = "ocd-division/country:us/state:az/county:pima#regional-flood-control-district";

function registry(): Registry {
  return JSON.parse(readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8")) as Registry;
}

/* -------------------------------------------------- the three red controls */

test("RED CONTROL: CAWCD cannot inherit the Pima County supervisors", () => {
  /*
   * The literal case the author caught. It is kept as a named control rather
   * than folded into the sweep below because a regression here has a specific,
   * checkable shape: five county supervisors standing in for a fifteen-member
   * elected water board.
   */
  const supervisors = rosterHoldersForBody(PIMA_SUPERVISORS);
  assert.ok(
    supervisors.length > 0,
    "the Pima County board roster is the thing CAWCD used to inherit — if it is empty this control proves nothing",
  );

  const resolved = membersOfBody(CAWCD);
  assert.equal(
    resolved.kind,
    "UNKNOWN_COMPOSITION",
    "CAWCD's membership is not sourced into a roster yet, so it must resolve as unknown",
  );
  /* Read the names BEFORE asserting the list is empty: `deepEqual(x, [])`
   * narrows `x` to `never[]`, and the loop below would then be checking a
   * type-level fact rather than a runtime one. */
  const names = new Set(resolved.members.map((m) => m.name));
  assert.deepEqual(resolved.members, [], "CAWCD must render no members rather than the wrong ones");

  for (const s of supervisors) {
    assert.ok(
      !names.has(s.name),
      `${s.name} is a Pima County Supervisor and must not appear on the CAWCD board. The board's ` +
        `own page (https://www.cap-az.com/board/board-members/, read 2026-08-27) names 15 popularly ` +
        `elected members; the four from Pima County are Karen Cesare, Pat Jacobs, Justin Manuel and ` +
        `Mark Taylor.`,
    );
  }
});

test("RED CONTROL: a Tucson advisory board cannot inherit the Mayor and Council", () => {
  const council = rosterHoldersForBody(TUCSON_COUNCIL);
  assert.ok(council.length > 0, "the Tucson council roster must exist for this control to mean anything");

  const resolved = membersOfBody(TUCSON_PLANNING);
  assert.equal(resolved.kind, "UNKNOWN_COMPOSITION");
  assert.deepEqual(
    resolved.members,
    [],
    "the Planning Commission is an appointed citizen body. It rendered the Mayor and the six Council " +
      "Members, and so did 57 other Tucson boards.",
  );
});

test("RED CONTROL: the Tucson PHA reuses Mayor and Council ONLY through its sourced alias, and keeps the resident seat", () => {
  /*
   * The nuance that makes this a good control rather than a simple deletion:
   * the Mayor and Council really ARE this board, and the app still could not
   * prove it. The City's own agenda of 2026-02-18 says so — and says one more
   * thing the seven-person roster dropped.
   */
  const resolved = membersOfBody(TUCSON_PHA);
  assert.equal(resolved.kind, "ALIAS_PLUS_ADDITIONAL_SEATS");
  assert.ok(resolved.authority, "an alias without a recorded authority is the fallback wearing a new name");
  assert.match(
    resolved.authority.quote,
    /Mayor and Council and a Resident Appointee/,
    "the authority must be the source's own words",
  );

  const council = rosterHoldersForBody(TUCSON_COUNCIL);
  assert.equal(
    resolved.members.length,
    council.length + 1,
    `the board is the Mayor and Council PLUS a Resident Appointee. Rendering only the ${council.length} ` +
      "council seats is what the division fallback did, and it is an incomplete board presented as a complete one.",
  );
  assert.ok(
    resolved.members.some((m) => m.officeTitle === "Resident Appointee"),
    "the Resident Appointee seat must be present",
  );
});

test("RED CONTROL: a statutory alias carries the statute that makes it lawful", () => {
  const resolved = membersOfBody(FLOOD_CONTROL);
  assert.equal(resolved.kind, "EXPLICIT_LEGAL_ALIAS");
  assert.equal(
    resolved.members.length,
    rosterHoldersForBody(PIMA_SUPERVISORS).length,
    "A.R.S. 48-3602(B) makes the supervisors this district's board of directors, so the roster IS theirs",
  );
  assert.match(resolved.authority?.sourceUrl ?? "", /azleg\.gov/);
  assert.match(resolved.authority?.quote ?? "", /board of supervisors shall be the board of directors/i);

  /*
   * **AND THE PAIR IS THE POINT.** The flood control district and CAWCD hang
   * off the SAME county division. One legitimately is the supervisors and one
   * emphatically is not, and no fallback keyed on geography can tell them
   * apart. Asserting both in one file is what stops a later "simplification"
   * restoring the fallback on the grounds that it was right for these three.
   */
  assert.notEqual(
    membersOfBody(CAWCD).members.length,
    resolved.members.length,
    "two bodies on one division, two different answers — that is the whole reason for this module",
  );
});

/* ------------------------------------------------------------- the sweep */

test("no registry body acquires members from a division it merely shares", () => {
  const reg = registry();
  const offenders: string[] = [];
  for (const b of reg.bodies) {
    const resolved = membersOfBody(b.id);
    if (resolved.members.length === 0) continue;
    if (resolved.kind === "DIRECT_BODY_ROSTER") continue;
    /* Anything else showing people must be a recorded alias. */
    const composition = compositionFor(b.id);
    if (!composition?.authority) {
      offenders.push(`${b.id} shows ${resolved.members.length} member(s) with no recorded authority`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("every recorded composition names a body the registry actually holds", () => {
  const ids = new Set(registry().bodies.map((b) => b.id));
  const problems: string[] = [];
  for (const c of BODY_COMPOSITIONS) {
    if (!ids.has(c.bodyId)) problems.push(`${c.bodyId} is not a registry body`);
    if (c.kind === "EXPLICIT_LEGAL_ALIAS" || c.kind === "ALIAS_PLUS_ADDITIONAL_SEATS") {
      if (!c.aliasOfBodyId) problems.push(`${c.bodyId} is an alias with no aliasOfBodyId`);
      else if (!ids.has(c.aliasOfBodyId)) problems.push(`${c.bodyId} aliases unknown body ${c.aliasOfBodyId}`);
      if (!c.authority?.quote?.trim()) problems.push(`${c.bodyId} is an alias with no quoted authority`);
      if (!c.authority?.sourceUrl?.trim()) problems.push(`${c.bodyId}'s authority cites no source URL`);
    } else if (c.aliasOfBodyId) {
      problems.push(`${c.bodyId} is not an alias but names aliasOfBodyId`);
    }
    for (const s of c.additionalSeats ?? []) {
      if (!s.sourceUrl?.trim()) problems.push(`${c.bodyId}'s "${s.officeTitle}" seat cites no source`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n  "));
});

/* ------------------------------------------------------------ the guard */

test("no reader surface reaches a body's members through a division roster", () => {
  /*
   * **THE ARCHITECTURAL HALF, and it is the one that lasts.**
   *
   * The rosters can be corrected today and re-inherited tomorrow by the next
   * surface that reaches for the convenient helper. So the helper itself is
   * banned from any module that renders a BODY.
   *
   * `governingRosterHoldersForDivision` is NOT banned outright — it answers a
   * legitimate and different question, *who represents this division*, which
   * is what `lib/registry/representation.ts` and the representation API route
   * ask on a DIVISION card. Those two are the allowed callers, by name, and
   * adding a third is a decision somebody has to make on purpose.
   */
  const ALLOWED = new Set([
    /* Where it is defined. */
    "lib/registry/body-rosters.ts",
    /* The DIVISION question — "who represents this district" — and its route. */
    "lib/registry/representation.ts",
    "app/api/representation/[...division]/route.ts",
    /* Tests OF those two, and of this rule. A test that may not name the thing
     * it is testing is a rule with no way to prove it holds. */
    "tests/body-composition.test.ts",
    "tests/body-rosters.test.ts",
    "tests/card-sources.test.ts",
    "tests/division-representation.test.ts",
    "tests/representation.test.ts",
  ]);

  const offenders: string[] = [];
  for (const file of filesThatWouldBeCommitted({ cwd: ROOT })) {
    if (ALLOWED.has(file)) continue;
    if (!/\.(ts|tsx|mts)$/.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    /* Comments stripped: this repo's guards read raw text, and the modules
     * that DOCUMENT the removal quote the call they deleted. */
    const code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (code.includes("governingRosterHoldersForDivision")) offenders.push(file);
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} module(s) outside the allowed set reach a division roster:\n  ` +
      offenders.join("\n  ") +
      "\n\nA body's members come from lib/registry/body-composition.ts. A division's " +
      "representatives are a different question and have a different resolver.",
  );
});

test("CONTROL: the removed fallback really would have inherited, on the bodies it was removed from", () => {
  /*
   * A guard that only ever passes proves nothing. This replays the deleted
   * behaviour and requires it to still produce the wrong answer, so the two
   * assertions above are demonstrably testing something live rather than
   * agreeing with a world where no body shares a division with a government.
   */
  const wouldHaveInherited = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/county:pima",
  );
  assert.ok(
    wouldHaveInherited.length > 0,
    "the old fallback must still return the supervisors — otherwise this control is vacuous",
  );
  assert.equal(
    membersOfBody(CAWCD).members.length,
    0,
    "and the new resolver must not",
  );
});
