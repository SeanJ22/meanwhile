import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
import {
  deriveActiveDistrictTypes,
  interactionTurnsOverlayOn,
} from "../lib/state/district-intent.ts";

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

/**
 * The claims-reachable guard (session item 2, 2026-08-14 second session) —
 * the stated-N family extended to the map. The tester asked for Kearsarge
 * Regional School District by name at 03255; the who-governs card counted
 * it, but its layer (school) was not in the default draw set, so a body
 * the card claims was unreachable on the map. The rule: every body the
 * who-governs card counts must render when the overlay is on with the
 * DEFAULT type set — which now means every type defaults on, and every
 * counted body's division must exist as a feature in its layer's
 * committed geometry.
 */
test("every body the who-governs card counts is reachable on the map with default layers", async () => {
  const { DEFAULT_DISTRICT_TYPES, ALL_DISTRICT_TYPES } = await import(
    "../lib/state/defaults.ts"
  );
  // The author's order: all district types default on. If a type is ever
  // removed from the default set again, the per-body check below is what
  // says which claimed body just became unreachable.
  assert.deepEqual(
    [...DEFAULT_DISTRICT_TYPES].sort(),
    [...ALL_DISTRICT_TYPES].sort(),
    "all district-type layers default on",
  );

  const LAYER_FOR_DIVISION: Record<string, string> = {
    county: "county",
    place: "municipal",
    school_district: "school",
  };

  const featureIds = new Map<string, Set<string>>();
  const idsForLayer = (type: string): Set<string> => {
    let ids = featureIds.get(type);
    if (!ids) {
      ids = new Set();
      for (const file of DISTRICT_LAYERS[type as (typeof DISTRICT_TYPES)[number]]
        .files) {
        const parsed = JSON.parse(
          readFileSync(join(ROOT, "public", "geo", file), "utf8"),
        ) as { features: Array<{ properties: { ocdId?: string } }> };
        for (const feature of parsed.features) {
          if (feature.properties.ocdId) ids.add(feature.properties.ocdId);
        }
      }
      featureIds.set(type, ids);
    }
    return ids;
  };

  for (const [zip, [lat, lng]] of Object.entries(ZIPS)) {
    const coverage = await coverageAt(lat, lng, 1);
    for (const body of coverage.bodies) {
      if (!body.ocdId) continue; // division-less curated bodies have no layer
      const layer = LAYER_FOR_DIVISION[body.divisionType];
      assert.ok(
        layer,
        `${zip}: body ${body.ocdId} has divisionType ${body.divisionType} with no mapped layer`,
      );
      assert.ok(
        (DEFAULT_DISTRICT_TYPES as readonly string[]).includes(layer),
        `${zip}: layer ${layer} for counted body ${body.ocdId} is not in the default draw set`,
      );
      assert.ok(
        idsForLayer(layer).has(body.ocdId),
        `${zip}: counted body ${body.ocdId} has no feature in the ${layer} layer — the card claims what the map cannot show`,
      );
    }
  }
});

/**
 * The state-change half of the same guard (seventh sighting, 2026-08-14).
 * The initial-render checks above never exercised an *interaction*: with
 * "Show districts" off, the district-type checkboxes stayed live and every
 * click changed state with zero visible effect — reported in production as
 * "the checkboxes do nothing". The rule and the derivation now live in
 * lib/state/district-intent.ts where they can be held without a component
 * harness (that gap is M13).
 */
test("a populated selection with the overlay on may never derive to nothing", () => {
  for (const selected of [
    ["congressional"],
    ["congressional", "state-house", "county"],
    [...DISTRICT_TYPES],
  ] as const) {
    const drawn = deriveActiveDistrictTypes(true, false, [...selected]);
    assert.deepEqual(
      drawn,
      [...selected],
      "overlay on + selection present must draw exactly the selection",
    );
  }

  // The gates that legitimately empty the derivation, stated as such.
  assert.deepEqual(deriveActiveDistrictTypes(false, false, ["county"]), []);
  assert.deepEqual(deriveActiveDistrictTypes(true, true, ["county"]), []);
});

test("touching the district-type group turns the overlay on — except clear", () => {
  // Checking a type or selecting all expresses "show me districts"; a click
  // that changes state with no visible effect is the defect this pins.
  assert.equal(interactionTurnsOverlayOn("toggle-type"), true);
  assert.equal(interactionTurnsOverlayOn("select-all"), true);
  // Clearing every type draws nothing, so it must not enable the overlay.
  assert.equal(interactionTurnsOverlayOn("clear"), false);
});

/**
 * The failed-fetch rule (2a, ninth sighting of the shape): **a failed
 * operation may not render as an empty success.** The regression this pins:
 * a settle-path fetch failed in production and the sidebar stood behind
 * "0 meetings / 0 bodies / 0 officials" while the failure card rendered
 * beside it — three confident false claims. "Couldn't check" and "none" are
 * different facts; the stat cards must never claim the second on the
 * strength of the first.
 */
test("a failed fetch renders couldn't-check, never confident zeros", async () => {
  const { deriveStatsView } = await import("../lib/state/derive.ts");

  const stats = {
    meetings: 0,
    bodies: 0,
    districts: 10,
    officials: 0,
    coverageAnswered: true,
  };
  const failed = deriveStatsView(stats, true, true);

  for (const key of ["meetings", "bodies", "officials"] as const) {
    assert.notEqual(
      failed[key],
      0,
      `stats.${key} rendered 0 beside a failed fetch — that is a false claim`,
    );
    assert.equal(failed[key], "—");
  }
  // Districts draw from committed files on the client and are genuinely
  // intact when the meetings service is not — the honest number stays.
  assert.equal(failed.districts, 10);
  assert.ok(failed.failedNote, "the failed state must say couldn't-check");

  // And the healthy path passes numbers through untouched, zeros included —
  // a real zero is the truth when the fetch answered.
  const ok = deriveStatsView(stats, true, false);
  assert.equal(ok.meetings, 0);
  assert.equal(ok.failedNote, null);
});

test("3g: the districts door renders exactly the list the card counts", async () => {
  const { districtDoorRows, deriveStatsView, computeStats } = await import(
    "../lib/state/derive.ts"
  );
  // A drawn set spanning types: two with matching seats, two without
  // (county/school districts have no legislative seat), plus a seat that is
  // NOT drawn (must not create a row).
  const drawn = [
    { type: "congressional", tier: "national", typeLabel: "Congressional", ocdId: "ocd-division/country:us/state:az/cd:7", label: "AZ-7" },
    { type: "state-senate", tier: "state", typeLabel: "State senate", ocdId: "ocd-division/country:us/state:az/sldu:21", label: "State Senate District 21" },
    { type: "county", tier: "local", typeLabel: "County", ocdId: "ocd-division/country:us/state:az/county:pima", label: "Pima County" },
    { type: "school", tier: "local", typeLabel: "School district", ocdId: "ocd-division/country:us/state:az/school_district:tucson", label: "Tucson Unified" },
  ] as const;
  const holder = {
    id: "congress:G000606", name: "Adelita S. Grijalva", officeTitle: "U.S. Representative",
    partyLabel: "Democrat", websiteUrl: null, sourceUrl: null, email: null,
    phone: null, contactFormUrl: null, photoUrl: null, campaignUrl: null,
  };
  const seats = [
    { ocdId: "ocd-division/country:us/state:az/cd:7", label: "AZ-7", divisionType: "cd", tier: "national", representatives: [holder] },
    { ocdId: "ocd-division/country:us/state:az/cd:6", label: "AZ-6", divisionType: "cd", tier: "national", representatives: [holder] },
  ];
  const rows = districtDoorRows(drawn as never, seats as never);

  // The invariant the author caught production violating: stated N ===
  // rendered rows, from the SAME list.
  assert.equal(rows.length, drawn.length, "one row per drawn district, no more, no fewer");
  const cardN = deriveStatsView(
    computeStats({ meetings: [], coverage: null, drawnDistricts: drawn as never }),
    true,
    false,
  ).districts;
  assert.equal(cardN, rows.length, "the card's stated N must equal the door's rendered rows");

  // Holders attach only where the seat matches by ocdId; a missing seat
  // renders an empty holder list, never drops the row.
  assert.equal(rows[0].holders.length, 1);
  assert.equal(rows[2].holders.length, 0);
  // The undrawn seat created no row.
  assert.ok(!rows.some((r) => r.ocdId.endsWith("cd:6")));
});

test("3h: free scrolling never re-expands the who-governs card; a typed zip does", async () => {
  const { noticeShouldExpand } = await import("../lib/state/derive.ts");
  // Launch: typed zip, nothing shown yet.
  assert.equal(noticeShouldExpand("zip", "85701", null), true);
  // Sidebar zip change: typed zip, new area.
  assert.equal(noticeShouldExpand("zip", "07866", "85701"), true);
  // Same zip re-entered: the handler resets collapse itself; the rule
  // alone does not re-fire.
  assert.equal(noticeShouldExpand("zip", "85701", "85701"), false);
  // The author's complaint: a settled pan crossing into a new ZCTA must
  // NOT pop the card - data refreshes silently under the bubble.
  assert.equal(noticeShouldExpand("settled", "85641", "85701"), false);
  assert.equal(noticeShouldExpand("settled", "85641", null), false);
});

/**
 * Item 4 of the tester's mobile pass (2026-08-14). She reported roughly
 * four of the six district types checked and enabled the rest by hand. The
 * brief's stated hypothesis was stale device-local layer preferences from
 * before the all-on default, to be cleared by a one-time versioned
 * migration.
 *
 * Diagnosed before building it, and the hypothesis is wrong in a way worth
 * pinning: **the district-type selection is not persisted anywhere.** It
 * lives in the in-memory UI store and is rebuilt from DEFAULT_DISTRICT_TYPES
 * on every load, so no device can be carrying a stale one and a migration
 * would have migrated nothing. The actual cause was timing — her pass began
 * 2026-08-14 18:32 UTC and the all-on default merged to main at 22:59 UTC
 * the same day, so she was reading the previous deploy, whose default was
 * exactly three types plus the "Show districts" master toggle.
 *
 * This test is what keeps that answer true. The moment a district-type
 * selection starts being written to device storage, the defaults stop being
 * authoritative on a returning reader's device and the tester's report
 * becomes reproducible for real — at which point a migration IS owed.
 */
test("district-type selection is never persisted — the defaults stay authoritative on every device", () => {
  const sources = [
    "lib/state/defaults.ts",
    "lib/state/reducer.ts",
    "lib/state/provider.tsx",
    "hooks/use-district-layer.ts",
    "components/shell/filters-area.tsx",
  ];
  let readFiles = 0;
  for (const relative of sources) {
    const path = join(ROOT, relative);
    if (!existsSync(path)) continue; // a rename is not a failure; the sweep below is
    readFiles++;
    const src = readFileSync(path, "utf8");
    const storageLines = src
      .split("\n")
      .filter((line) => /localStorage|sessionStorage/.test(line));
    for (const line of storageLines) {
      assert.ok(
        !/districtTypes|district_types|district-types/i.test(line),
        `${relative}: district-type selection must not touch device storage — "${line.trim()}"`,
      );
    }
  }
  assert.ok(readFiles >= 3, `only ${readFiles} state sources were read — the sweep did not run`);

  // The one district key that IS persisted is the master toggle, and it
  // stores a single flag, not a type list. An explicit "0" is the reader's
  // own choice and stays honored — that is not staleness to migrate away.
  const layer = readFileSync(join(ROOT, "hooks/use-district-layer.ts"), "utf8");
  assert.ok(
    /wtp\.show_districts/.test(layer),
    "the master toggle is the only persisted district preference",
  );
  assert.ok(
    /raw === "0" \? OFF : ON/.test(layer),
    "never-stored defaults ON; only an explicit off is honored",
  );
});

/**
 * M57 (2026-08-15) — the sidebar counters, the denominator disease's third
 * sighting. The author's production pass: the sidebar read "6 OFFICIALS"
 * while the officials door listed a mayor, six council members, a five-seat
 * governing board, five county supervisors, the state delegation, the
 * governor and both senators — twenty-four people. Bodies was wrong the same
 * way and nobody had noticed: 13 against a door listing 60.
 *
 * Both counters had their OWN derivation, correct when written and never
 * updated as their doors grew. So the guard is not "the numbers agree today"
 * — it is that each counter is computed from the SAME collection its surface
 * renders, checked against real committed registry data at all four demo
 * zips. A counter that re-derives can drift; a counter handed the rendered
 * list cannot.
 */
for (const [zip, [lat, lng]] of Object.entries(ZIPS)) {
  test(`M57: every sidebar counter equals its door's rendered rows at ${zip}`, async () => {
    const { computeStats, deriveStatsView, districtDoorRows } = await import(
      "../lib/state/derive.ts"
    );
    const { groupOfficials, allOfficialRows } = await import(
      "../lib/officials/tier-grouping.ts"
    );

    const coverage = await coverageAt(lat, lng, 1);

    // The drawn set the map reports; stood in for here by the districts the
    // registry resolves, because the value under test is the coupling, not
    // MapLibre's viewport query.
    const drawn = coverage.seats.map((s) => ({
      type: "congressional" as const,
      tier: s.tier,
      typeLabel: "District",
      ocdId: s.ocdId,
      label: s.label,
    }));
    const meetings = [] as never[];

    const stats = computeStats({ meetings, coverage, drawnDistricts: drawn });
    const view = deriveStatsView(stats, true, false);

    // OFFICIALS — the door renders groupOfficials()'s three tiers.
    const groups = groupOfficials(coverage);
    const officialRows =
      groups.local.length + groups.state.length + groups.federal.length;
    assert.ok(
      officialRows > 0,
      `${zip}: no officials rows at all — the denominator is empty, weaken this test deliberately or fix the join`,
    );
    assert.equal(
      view.officials,
      officialRows,
      `${zip}: OFFICIALS card says ${view.officials}, the door renders ${officialRows}`,
    );
    // And the door's own flat list is the same set — no fourth derivation.
    assert.equal(allOfficialRows(coverage).length, officialRows);

    // The regression in its exact production shape: the old derivation
    // (seats + senators) must NOT be what the card says wherever curated
    // locals or statewide executives exist.
    const seatsAndSenatorsOnly = new Set<string>();
    for (const seat of coverage.seats)
      for (const h of seat.representatives) seatsAndSenatorsOnly.add(h.id);
    for (const s of coverage.senators) seatsAndSenatorsOnly.add(s.id);
    if (groups.local.length > 0 || coverage.statewideExecutives.length > 0) {
      assert.notEqual(
        view.officials,
        seatsAndSenatorsOnly.size,
        `${zip}: the card is back on the seats-and-senators derivation — the M57 regression`,
      );
    }

    // BODIES — the door renders coverage.bodies, one row each.
    assert.equal(
      view.bodies,
      coverage.bodies.length,
      `${zip}: BODIES card says ${view.bodies}, the door renders ${coverage.bodies.length}`,
    );

    // DISTRICTS — the door renders exactly one row per drawn district.
    assert.equal(view.districts, districtDoorRows(drawn, coverage.seats).length);

    // MEETINGS — the list overlay renders the same filtered array the card
    // measures, so the coupling is length-for-length.
    assert.equal(view.meetings, meetings.length);
  });
}

/**
 * The overlay-off state (M57, the author's second report: "the DISTRICTS
 * counter renders blank"). A dash is this product's word for "we could not
 * check". Spending it on a switch the reader flipped made the one number
 * that was never broken read as the broken one.
 */
test("M57: districts off says Off, not the couldn't-check dash", async () => {
  const { computeStats, deriveStatsView } = await import("../lib/state/derive.ts");

  const off = computeStats({ meetings: [], coverage: null, drawnDistricts: null });
  assert.equal(off.districts, null, "nothing drawn is null, not a count of zero");
  assert.equal(deriveStatsView(off, false, false).districts, "Off");
  // Even with a drawn list in hand, the master switch decides.
  const drawn = [
    {
      type: "county" as const,
      tier: "local" as const,
      typeLabel: "County",
      ocdId: "ocd-division/country:us/state:az/county:pima",
      label: "Pima County",
    },
  ];
  const on = computeStats({ meetings: [], coverage: null, drawnDistricts: drawn });
  assert.equal(deriveStatsView(on, false, false).districts, "Off");
  assert.equal(deriveStatsView(on, true, false).districts, 1);

  // And the coverage-less state does not claim zeros for the two counters
  // whose door says it could not resolve who governs.
  const view = deriveStatsView(on, true, false);
  assert.equal(view.bodies, "—");
  assert.equal(view.officials, "—");
});
