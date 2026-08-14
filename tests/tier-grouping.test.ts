import assert from "node:assert/strict";
import test from "node:test";

import { coverageAt } from "../lib/registry/server.ts";
import {
  allOfficialRows,
  groupOfficials,
  TIER_GROUP_LABELS,
} from "../lib/officials/tier-grouping.ts";
import { namedHolderCount } from "../lib/registry/representation.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";

/**
 * Items 2b and 2c (wall clock 2026-08-14 second session).
 *
 * 2b — the governor was missing from who-governs at every zip: the card
 * is built from division rows, legislators attach via districts, and a
 * statewide executive is elected by no district on the map, so no row
 * ever claimed them. The guard asserts the CLASS (statewide-executive
 * attachment), never the individual names.
 *
 * 2c — officials group under three tiers everywhere they render, always
 * closest-first: Local, State, Federal. Membership is asserted by office
 * type.
 */

const ZIPS: Record<string, [number, number]> = {
  "85701": [32.21696, -110.971],
  "85641": [32.04903, -110.62291],
  "07866": [40.95499, -74.48801],
  "03255": [43.31403, -72.02455],
};

test("every zip's who-governs coverage includes its state's governor", async () => {
  for (const [zip, [lat, lng]] of Object.entries(ZIPS)) {
    const coverage = await coverageAt(lat, lng, 1);
    const governors = coverage.statewideExecutives.filter(
      (h) => h.officeTitle === "Governor",
    );
    assert.equal(
      governors.length,
      1,
      `${zip}: expected exactly one governor in statewideExecutives`,
    );
    // The class, not the name: a statewide-executive row with a source
    // read off the state's own site.
    const executive = STATEWIDE_EXECUTIVES.find(
      (e) => e.holder.id === governors[0].id,
    );
    assert.ok(executive, `${zip}: governor row traces to the curated module`);
    assert.ok(executive.sourceUrl.length > 0);
    assert.ok(executive.collectedAt.length > 0);
    assert.ok(
      governors[0].phone || governors[0].contactFormUrl || governors[0].websiteUrl,
      `${zip}: the governor carries a working contact`,
    );
  }
});

test("statewide executives are sourced from the state's own domain, never a third party", () => {
  assert.equal(STATEWIDE_EXECUTIVES.length, 3, "AZ, NJ, NH");
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

test("tier membership is correct by office type at every zip, closest-first", async () => {
  const FEDERAL_TITLES = new Set(["U.S. Senator", "U.S. Representative"]);
  const STATE_TITLES = new Set([
    "State Senator",
    "State Representative",
    "Assemblymember",
    "Governor",
  ]);
  for (const [zip, [lat, lng]] of Object.entries(ZIPS)) {
    const coverage = await coverageAt(lat, lng, 1);
    const groups = groupOfficials(coverage);

    for (const row of groups.federal) {
      assert.ok(
        FEDERAL_TITLES.has(row.holder.officeTitle),
        `${zip}: "${row.holder.officeTitle}" grouped FEDERAL`,
      );
    }
    for (const row of groups.state) {
      assert.ok(
        STATE_TITLES.has(row.holder.officeTitle),
        `${zip}: "${row.holder.officeTitle}" grouped STATE`,
      );
    }
    for (const row of groups.local) {
      assert.ok(
        !FEDERAL_TITLES.has(row.holder.officeTitle) &&
          !STATE_TITLES.has(row.holder.officeTitle),
        `${zip}: "${row.holder.officeTitle}" grouped LOCAL`,
      );
    }

    // The governor renders under STATE (2b ships inside 2c's structure).
    assert.ok(
      groups.state.some((r) => r.holder.officeTitle === "Governor"),
      `${zip}: governor missing from the STATE group`,
    );

    // Closest-first: the flat list is local rows, then state, then federal.
    const flat = allOfficialRows(coverage);
    assert.deepEqual(
      flat.map((r) => r.holder.id),
      [...groups.local, ...groups.state, ...groups.federal].map(
        (r) => r.holder.id,
      ),
      `${zip}: flat list must be Local → State → Federal`,
    );

    // The stat card's N is this same derivation — stated N equals
    // rendered rows, by construction and now by assertion.
    assert.equal(namedHolderCount(coverage), flat.length);

    // Local must actually hold people at every covered zip — a flat list
    // that silently lost the rosters is the door's old defect.
    assert.ok(groups.local.length > 0, `${zip}: LOCAL group is empty`);
  }
});
