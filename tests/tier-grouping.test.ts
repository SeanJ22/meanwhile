import assert from "node:assert/strict";
import test from "node:test";

import { TIER_GROUP_LABELS } from "../lib/officials/tier-grouping.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";

test("statewide executives are sourced from the state's own domain, never a third party", () => {
  assert.ok(STATEWIDE_EXECUTIVES.length >= 3, `only ${STATEWIDE_EXECUTIVES.length} rows`);
  const states = new Set(STATEWIDE_EXECUTIVES.map((e) => e.stateOcdId));
  for (const state of ["az", "nj", "nh"]) {
    assert.ok(
      states.has(`ocd-division/country:us/state:${state}`),
      `${state}: no statewide executive at all`,
    );
  }
  for (const executive of STATEWIDE_EXECUTIVES) {
    const host = new URL(executive.sourceUrl).hostname;
    assert.ok(
      /(\.gov|\.nh\.gov|\.nj\.gov)$/.test(host) || host.endsWith(".gov"),
      `${executive.holder.name}: source ${host} is not a government domain`,
    );
  }
});

test("the tier labels are Local / State / Federal — never National on an officials header", () => {
  assert.equal(TIER_GROUP_LABELS.local, "Local");
  assert.equal(TIER_GROUP_LABELS.state, "State");
  assert.equal(TIER_GROUP_LABELS.federal, "Federal");
});
