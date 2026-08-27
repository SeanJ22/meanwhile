import assert from "node:assert/strict";
import test from "node:test";

import { AZ_CAWCD_ROSTERS } from "../lib/registry/rosters-az-cawcd.ts";
import { BODY_ROSTERS, rosterHoldersForBody } from "../lib/registry/body-rosters.ts";

/**
 * **THE CAWCD BOARD REACHES A READER** (2026-08-27).
 *
 * This body taxes every parcel in Pima County and rendered NOBODY. First it
 * rendered the wrong people — the five Pima County Supervisors, taken by a
 * geographic fallback — and when that fallback was removed it rendered an
 * honest emptiness. The emptiness then persisted for a reason that was not
 * about membership at all: the board's PARTISANSHIP had not been sourced.
 *
 * These tests pin the separation. Membership is verified and rendered;
 * partisanship is unknown, renders nothing, and stays open.
 */

const CAWCD =
  "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district";

/** The five Pima County Supervisors this body used to render instead. */
const SUPERVISORS = [
  "Rex Scott",
  "Matt Heinz",
  "Jennifer Allen",
  "Steve Christy",
  "Adelita Grijalva",
];

test("the board renders its own fifteen directors", () => {
  const holders = rosterHoldersForBody(CAWCD);
  assert.equal(
    holders.length,
    15,
    `CAWCD rendered ${holders.length} people — the board has fifteen directly elected directors`,
  );
});

test("no Pima County Supervisor is rendered as a CAWCD director", () => {
  /*
   * The original defect, pinned by NAME. The fallback that produced it is gone,
   * but a roster keyed to `county:pima` is exactly where those five people
   * would reappear if anything ever resolved this body by its division again.
   */
  const names = rosterHoldersForBody(CAWCD).map((h) => h.name);
  for (const supervisor of SUPERVISORS) {
    assert.ok(
      !names.includes(supervisor),
      `${supervisor} is a Pima County Supervisor and is being rendered as a CAWCD director`,
    );
  }
});

test("every director carries the body's own page as its record", () => {
  const [roster] = AZ_CAWCD_ROSTERS;
  assert.match(roster.sourceUrl, /^https:\/\/www\.cap-az\.com\/board\/board-members\/$/);
  assert.equal(roster.sourceOrg, "Central Arizona Water Conservation District");

  for (const member of roster.members) {
    assert.ok(member.name.length > 2, "a director with no name");
    assert.ok(member.officeTitle.length > 2, `${member.name}: no published title`);
    assert.match(
      member.websiteUrl ?? "",
      /^https:\/\/www\.cap-az\.com\/board\/board-members\/[a-z0-9-]+\/$/,
      `${member.name}: the record must be this member's own page on the body's site`,
    );
  }
});

test("the county split matches the board's statutory composition", () => {
  /*
   * Maricopa 10, Pima 4, Pinal 1. Read off each member's own page heading, and
   * checked against the composition the board is required to have — an
   * independent check that fifteen pages were read correctly and none missed.
   * It also fixes an earlier note recording only THREE confirmed Pima members.
   */
  const [roster] = AZ_CAWCD_ROSTERS;
  const count = (county: string) =>
    roster.members.filter((m) => (m.termNote ?? "").includes(`${county} County`)).length;

  assert.equal(count("Maricopa"), 10, "Maricopa seats");
  assert.equal(count("Pima"), 4, "Pima seats");
  assert.equal(count("Pinal"), 1, "Pinal seats");
  assert.equal(count("Maricopa") + count("Pima") + count("Pinal"), 15);
});

test("the four Pima seats are identified, because their terms end together", () => {
  /*
   * NH244's input, and nothing more than that. Naming which seats fall vacant
   * on 2026-12-31 is a fact about the ROSTER; whether a contest for them
   * appears on the 2026 ballot is a fact about an ELECTION AUTHORITY and is
   * not asserted here. A sitting director is never treated as a candidate.
   */
  const [roster] = AZ_CAWCD_ROSTERS;
  const pima = roster.members.filter((m) => (m.termNote ?? "").includes("Pima County"));
  assert.deepEqual(
    pima.map((m) => m.name).sort(),
    ["Justin Manuel", "Karen Cesare", "Mark Taylor", "Pat Jacobs"],
  );
});

test("membership is wired while partisanship stays honestly unknown", () => {
  /*
   * The whole point of the change. Two independent facts, and the unknown one
   * may not strand the known one.
   */
  const roster = BODY_ROSTERS.find((r) => r.bodyId === CAWCD);
  assert.ok(roster, "the roster is not wired into BODY_ROSTERS at all");
  if (!roster) return;

  assert.equal(roster.partisanship, "UNDETERMINED");
  assert.equal(
    roster.partisanshipSourceUrl,
    undefined,
    "UNDETERMINED cites nothing by definition — a source here would be a claim we cannot make",
  );

  // And no party is invented for anybody, which is the failure mode that
  // would make wiring-before-sourcing wrong.
  for (const member of roster.members) {
    assert.ok(
      !member.partyLabel,
      `${member.name} carries a party on a board whose partisanship is unsourced`,
    );
  }
});
