import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { coverageAt } from "../lib/registry/server.ts";
import {
  hasRepresentation,
  namedHolderCount,
  noticeLabel,
  shouldRenderNotice,
} from "../lib/registry/representation.ts";
import { DISTRICT_LAYERS, DISTRICT_TYPES } from "../lib/map/districts.ts";

/**
 * The panel-denominator guard.
 *
 * The regression this pins: the coverage notice — the only surface that
 * renders who governs and represents a point — returned null whenever the
 * cascade landed on `exact`. While the demo zips sat on the widened rung the
 * coupling was invisible; the moment the composite served real meetings
 * everywhere, every zip went exact and 537 federal officials plus three
 * state rosters silently left the product with every test green. The sixth
 * sighting of the shape CLAUDE.md names: an operation (here, a UI panel)
 * that can render nothing must be asked what it rendered.
 *
 * So: against the *committed* rosters and geometry — the real stores, not
 * fixtures — the render gate must say "render" at every demo zip on every
 * tier, and the summary behind it must actually name people. If a roster
 * file is non-empty and this panel would render nothing, that is a failing
 * build, not a styling choice.
 */

const ROOT = join(import.meta.dirname, "..");

const ZIPS: Record<string, [number, number]> = {
  "85701": [32.21696, -110.971],
  "85641": [32.04903, -110.62291],
  "07866": [40.95499, -74.48801],
  "03255": [43.31403, -72.02455],
};

function rosterPeopleCount(name: string): number {
  const parsed = JSON.parse(
    readFileSync(join(ROOT, "lib", "registry", name), "utf8"),
  ) as { officeholders?: unknown[]; people?: unknown[] };
  const list = parsed.officeholders ?? parsed.people ?? [];
  return Array.isArray(list) ? list.length : 0;
}

test("the committed rosters are non-empty (the denominator)", () => {
  // If these ever legitimately empty out, the assertions below must weaken
  // with them — that is the point of stating the denominator first.
  assert.ok(rosterPeopleCount("officeholders-us.json") > 500);
  for (const state of ["04", "33", "34"]) {
    assert.ok(
      rosterPeopleCount(`officeholders-${state}.json`) > 0,
      `officeholders-${state}.json holds nobody`,
    );
  }
});

for (const [zip, [lat, lng]] of Object.entries(ZIPS)) {
  test(`officials surface renders at ${zip} on the exact tier`, async () => {
    // meetingCount > 0 puts the summary in the MEETINGS state — the exact
    // rung's normal case, and the one the old gate silently dropped.
    const coverage = await coverageAt(lat, lng, 1);

    assert.ok(hasRepresentation(coverage), `${zip}: summary holds nothing`);
    assert.ok(
      shouldRenderNotice("exact", coverage),
      `${zip}: populated store, panel gated off — the regression`,
    );

    // The store names people (rosters are committed and non-empty per the
    // test above), so the panel's holder count must not be zero.
    const named = namedHolderCount(coverage);
    assert.ok(named > 0, `${zip}: rosters non-empty but zero names surface`);

    // Every seat at the four demo zips currently has a sourced holder —
    // the "zero holes" audit. A broken join drops this, silently, which is
    // exactly what happened with cd:0 and the NH designations.
    assert.equal(
      coverage.seatCounts.named,
      coverage.seatCounts.total,
      `${zip}: ${coverage.seatCounts.total - coverage.seatCounts.named} seats lost their holders`,
    );

    assert.equal(noticeLabel("exact", coverage), "Who governs here");
  });
}

test("the notice always renders on failure rungs, with or without coverage", () => {
  for (const tier of ["widened", "concluded", "none"] as const) {
    assert.ok(shouldRenderNotice(tier, null));
  }
});

/**
 * Same shape for the district overlays: every committed boundary file that a
 * layer spec references must exist and hold features. A layer whose file
 * went missing or empty would draw nothing while the toggle renders and the
 * build stays green — the panel-denominator failure in map clothing.
 */
test("every district layer's committed files exist and hold features", () => {
  for (const type of DISTRICT_TYPES) {
    for (const file of DISTRICT_LAYERS[type].files) {
      const parsed = JSON.parse(
        readFileSync(join(ROOT, "public", "geo", file), "utf8"),
      ) as { features?: unknown[] };
      assert.ok(
        Array.isArray(parsed.features) && parsed.features.length > 0,
        `${type}: ${file} is empty — the layer would silently draw nothing`,
      );
    }
  }
});
