import assert from "node:assert/strict";
import test from "node:test";

import { AZ_CAWCD_ROSTERS } from "../lib/registry/cawcd-rosters.ts";
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";

const CAWCD =
  "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district";

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
  const [roster] = AZ_CAWCD_ROSTERS;
  const count = (county: string) =>
    roster.members.filter((m) => (m.termNote ?? "").includes(`${county} County`)).length;

  assert.equal(count("Maricopa"), 10, "Maricopa seats");
  assert.equal(count("Pima"), 4, "Pima seats");
  assert.equal(count("Pinal"), 1, "Pinal seats");
  assert.equal(count("Maricopa") + count("Pima") + count("Pinal"), 15);
});

test("the four Pima seats are identified, because their terms end together", () => {
  const [roster] = AZ_CAWCD_ROSTERS;
  const pima = roster.members.filter((m) => (m.termNote ?? "").includes("Pima County"));
  assert.deepEqual(
    pima.map((m) => m.name).sort(),
    ["Justin Manuel", "Karen Cesare", "Mark Taylor", "Pat Jacobs"],
  );
});

test("the seats are NONPARTISAN by statute, and no party is invented", () => {
  const roster = BODY_ROSTERS.find((r) => r.bodyId === CAWCD);
  assert.ok(roster, "the roster is not wired into BODY_ROSTERS at all");
  if (!roster) return;

  assert.equal(roster.partisanship, "NONPARTISAN");
  assert.match(
    roster.partisanshipSourceUrl ?? "",
    /azleg\.gov\/ars\/48\/03709/,
    "a settled partisanship must cite the record that settled it — here, the statute",
  );

  for (const member of roster.members) {
    assert.ok(
      !member.partyLabel,
      `${member.name} carries a party on a board the statute says has no party designation`,
    );
  }
});

test("the statute's own composition rule matches the roster we read", () => {
  const roster = BODY_ROSTERS.find((r) => r.bodyId === CAWCD);
  assert.ok(roster);
  if (!roster) return;
  const count = (county: string) =>
    roster.members.filter((m) => (m.termNote ?? "").includes(`${county} County`)).length;

  assert.equal(count("Maricopa"), 10, "A.R.S. 48-3708(A)(3): the largest county elects ten");
  assert.equal(count("Pima"), 4, "A.R.S. 48-3708(A)(2): a county in the middle band elects four");
  assert.equal(count("Pinal"), 1, "A.R.S. 48-3708(A)(1): the smallest county elects one");
});
