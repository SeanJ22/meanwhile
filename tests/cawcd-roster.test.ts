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

test("the seats are NONPARTISAN by statute, and no party is invented", () => {
  /*
   * **AMENDED THE SAME DAY IT WAS WRITTEN.** This asserted `UNDETERMINED` — the
   * honest state while only the district's own pages had been read, which say
   * role and county for every member and party for none. That is a finding
   * about the PAGES and settles nothing about the SEATS.
   *
   * The record that settles seats was then found where M62's own rule says to
   * look FIRST — *"partisan or nonpartisan by law or charter FIRST"* — and it is
   * **A.R.S. § 48-3709(B)**: candidates are on "the general election ballot of
   * the county in which the candidate resides, WITHOUT PARTY DESIGNATION".
   *
   * That is law rather than an inference from a silent page, so the open item
   * closed properly rather than by being downgraded. The separation still did
   * its job: fifteen verified people reached a reader while the orthogonal fact
   * was open, and closing it cost one line.
   */
  const roster = BODY_ROSTERS.find((r) => r.bodyId === CAWCD);
  assert.ok(roster, "the roster is not wired into BODY_ROSTERS at all");
  if (!roster) return;

  assert.equal(roster.partisanship, "NONPARTISAN");
  assert.match(
    roster.partisanshipSourceUrl ?? "",
    /azleg\.gov\/ars\/48\/03709/,
    "a settled partisanship must cite the record that settled it — here, the statute",
  );

  // And no party is invented for anybody. On a NONPARTISAN body there is none
  // to render, which is a different silence from an unsourced one.
  for (const member of roster.members) {
    assert.ok(
      !member.partyLabel,
      `${member.name} carries a party on a board the statute says has no party designation`,
    );
  }
});

test("the statute's own composition rule matches the roster we read", () => {
  /*
   * A.R.S. § 48-3708(A) sizes each county's delegation by population: fewer
   * than 600,000 elects one director, 600,000 to 2,100,000 elects four, more
   * than 2,100,000 elects ten. Pinal, Pima and Maricopa respectively — 1, 4 and
   * 10, which is exactly the split the fifteen member pages produced.
   *
   * Two independent sources, one answer: the statute says what the board must
   * be, the district's pages say who is on it, and they agree. Neither was
   * derived from the other.
   */
  const roster = BODY_ROSTERS.find((r) => r.bodyId === CAWCD);
  assert.ok(roster);
  if (!roster) return;
  const count = (county: string) =>
    roster.members.filter((m) => (m.termNote ?? "").includes(`${county} County`)).length;

  assert.equal(count("Maricopa"), 10, "A.R.S. 48-3708(A)(3): the largest county elects ten");
  assert.equal(count("Pima"), 4, "A.R.S. 48-3708(A)(2): a county in the middle band elects four");
  assert.equal(count("Pinal"), 1, "A.R.S. 48-3708(A)(1): the smallest county elects one");
});
