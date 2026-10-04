import assert from "node:assert/strict";
import test from "node:test";
import { tierForOffice } from "../lib/ocd/tiers.ts";

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
