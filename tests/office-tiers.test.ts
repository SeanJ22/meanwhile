import assert from "node:assert/strict";
import test from "node:test";
import { tierForOffice, tierForOcdId } from "../lib/ocd/tiers.ts";

test("office identity takes precedence over the electorate's division", () => {
  const state = "ocd-division/country:us/state:xx";
  for (const title of ["U.S. Senator", "United States Senator", "U.S. Representative"]) {
    assert.equal(tierForOffice(title, state), "national", title);
  }
  for (const title of ["Governor", "Secretary of State", "Attorney General", "State Senator"]) {
    assert.equal(tierForOffice(title, `${state}/place:example`), "state", title);
  }
  assert.equal(tierForOffice("Mayor", state), "local");
  assert.equal(tierForOffice("An unknown office", state), "state");
  assert.equal(tierForOffice(null, "ocd-division/country:us/unknown:example"), null);
});

test("statewide executives, judicial seats and state commissions retain the State label", () => {
  const state = "ocd-division/country:us/state:oh";
  for (const title of ["Governor and Lieutenant Governor", "Supreme Court Justice", "Court of Appeals Judge",
    "Agriculture Commissioner", "Labor Commissioner", "Public Service Commissioner", "Public Lands Commissioner", "Chief Election Officer"]) {
    assert.equal(tierForOffice(title, `${state}/place:cleveland`), "state", title);
  }
  for (const segment of ["supreme_court", "court_of_appeals", "public_service_commission", "sbe"]) {
    assert.equal(tierForOcdId(`${state}/${segment}:1`), "state", segment);
  }
  assert.equal(tierForOffice("Justice Supreme Court of Maryland — Appellate Circuit 4", "ocd-division/country:us/state:md/county:prince_george_s"), "state");
  assert.equal(tierForOffice("Mayor", state), "local");
});
