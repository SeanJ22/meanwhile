import { geometryFiles } from "../lib/holdings/discovery.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { installRegistryAuthority, installStateLegislators } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();
// Official state rosters are their own promoted families; a synthetic one per pilot state.
installStateLegislators("US-AZ");
installStateLegislators("US-NJ");

import { coverageAt } from "../lib/registry/server.ts";
import { governingRosterHoldersForDivision } from "../lib/registry/body-rosters.ts";
import {
  hasRepresentation,
  namedHolderCount,
  noticeLabel,
  representationForDivision,
  representationNoteFor,
  shouldRenderNotice,
} from "../lib/registry/representation.ts";
import { DISTRICT_LAYERS, DISTRICT_TYPES } from "../lib/map/districts.ts";
import { TIERS } from "../lib/ocd/tiers.ts";
import {
  deriveActiveDistrictTypes,
  interactionTurnsOverlayOn,
} from "../lib/state/district-intent.ts";

/**
 * The coverage notice is the only surface that renders who governs and represents a point. Against the
 * committed geometry, the render gate must say "render" at every test ZIP on every tier, and the summary
 * behind it must actually name people.
 */

const ROOT = join(import.meta.dirname, "..");

const ZIPS: Record<string, [number, number]> = {
  "85701": [32.21696, -110.971],
  "85641": [32.04903, -110.62291],
  "07866": [40.95499, -74.48801],
  "03255": [43.31403, -72.02455],
};


for (const [zip, [lat, lng]] of Object.entries(ZIPS)) {
  test(`officials surface renders at ${zip} on the exact tier`, async () => {
    // meetingCount > 0 puts the summary in the MEETINGS state, the exact rung's normal case.
    const coverage = await coverageAt(lat, lng, 1);

    assert.ok(hasRepresentation(coverage), `${zip}: summary holds nothing`);
    assert.ok(
      shouldRenderNotice("exact", coverage),
      `${zip}: populated store, panel gated off — the regression`,
    );

    const named = namedHolderCount(coverage);
    assert.ok(named > 0, `${zip}: rosters non-empty but zero names surface`);

    // Every seat at the test ZIPs has a sourced holder; a broken join drops this silently.
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

/** Every committed boundary file a layer spec references must exist and hold features. */
test("held Census boundary fixtures retain features for each kind", () => {
  for (const type of DISTRICT_TYPES) {
    for (const file of geometryFiles(ROOT).filter(file => DISTRICT_LAYERS[type].censusLayers.some(layer => file.split("/").at(-1)!.startsWith(layer)))) {
      const parsed = JSON.parse(
        readFileSync(join(ROOT, file), "utf8"),
      ) as { features?: unknown[] };
      assert.ok(
        Array.isArray(parsed.features) && parsed.features.length > 0,
        `${type}: ${file} is empty — the layer would silently draw nothing`,
      );
    }
  }
});

/**
 * Every body the who-governs card counts must render when the overlay is on with the default type set: every
 * type defaults on, and every counted body's division exists as a feature in its layer's committed geometry.
 */
test("every body the who-governs card counts is reachable on the map with default layers", async () => {
  const { DEFAULT_DISTRICT_TYPES, ALL_DISTRICT_TYPES } = await import(
    "../lib/state/defaults.ts"
  );
  assert.deepEqual(
    [...DEFAULT_DISTRICT_TYPES].sort(),
    [...ALL_DISTRICT_TYPES].sort(),
    "all district-type layers default on",
  );

  // A division type maps to the candidate layers that could hold it; reachable means the body's feature is
  // in at least one, and every candidate layer must be in the default draw set.
  const LAYERS_FOR_DIVISION: Record<string, string[]> = {
    county: ["county"],
    place: ["municipal"],
    school_district: ["school-unified", "school-elementary", "school-secondary"],
  };

  const featureIds = new Map<string, Set<string>>();
  const idsForLayer = (type: string): Set<string> => {
    let ids = featureIds.get(type);
    if (!ids) {
      ids = new Set();
      for (const file of geometryFiles(ROOT).filter(file => DISTRICT_LAYERS[type as (typeof DISTRICT_TYPES)[number]].censusLayers.some(layer => file.split("/").at(-1)!.startsWith(layer)))) {
        const parsed = JSON.parse(
          readFileSync(join(ROOT, file), "utf8"),
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
      // `divisionType` is null for a division-less body; the `ocdId` guard above already skips those.
      if (!body.divisionType) continue;
      // Hoisted: the narrowing above does not survive into the closure below,
      // because `body.ocdId` is a mutable property.
      const ocdId = body.ocdId;
      const divisionType = body.divisionType;
      const layers = LAYERS_FOR_DIVISION[divisionType];
      assert.ok(
        layers,
        `${zip}: body ${body.ocdId} has divisionType ${divisionType} with no mapped layer`,
      );
      for (const layer of layers) {
        assert.ok(
          (DEFAULT_DISTRICT_TYPES as readonly string[]).includes(layer),
          `${zip}: layer ${layer} for counted body ${body.ocdId} is not in the default draw set`,
        );
      }
      const found = layers.filter((layer) => idsForLayer(layer).has(ocdId));
      assert.ok(
        found.length > 0,
        `${zip}: counted body ${body.ocdId} has no feature in any of ${layers.join(", ")} — the card claims what the map cannot show`,
      );
      // One district is one KIND of district. A body appearing in two of the
      // three school layers would mean the source files overlap, and the
      // reader would see the same government drawn twice in two styles.
      assert.equal(
        found.length,
        1,
        `${zip}: counted body ${body.ocdId} appears in ${found.length} layers (${found.join(", ")}) — a district belongs to exactly one`,
      );
    }
  }
});

/** With "Show districts" off, a district-type checkbox click must not change state with no visible effect. */
test("a populated selection with the overlay on may never derive to nothing", () => {
  for (const selected of [
    ["congressional"],
    ["congressional", "state-house", "county"],
    [...DISTRICT_TYPES],
  ] as const) {
    const drawn = deriveActiveDistrictTypes(true, false, [...selected], TIERS);
    assert.deepEqual(
      drawn,
      [...selected],
      "overlay on + selection present must draw exactly the selection",
    );
  }

  // The gates that legitimately empty the derivation, stated as such.
  assert.deepEqual(deriveActiveDistrictTypes(false, false, ["county"], TIERS), []);
  assert.deepEqual(deriveActiveDistrictTypes(true, true, ["county"], TIERS), []);
});

test("touching the district-type group turns the overlay on — except clear", () => {
  // Checking a type or selecting all expresses "show me districts"; a click
  // that changes state with no visible effect is the defect this pins.
  assert.equal(interactionTurnsOverlayOn("toggle-type"), true);
  assert.equal(interactionTurnsOverlayOn("select-all"), true);
  // Clearing every type draws nothing, so it must not enable the overlay.
  assert.equal(interactionTurnsOverlayOn("clear"), false);
});

/** A failed operation may not render as an empty success: "couldn't check" and "none" are different facts. */
test("a failed fetch renders couldn't-check, never confident zeros", async () => {
  const { deriveStatsView } = await import("../lib/state/derive.ts");

  const stats = {
    meetings: 0,
    bodies: 0,
    // Zero bodies has no pair to state, so this is 0; null means coverage could not answer.
    governingBodies: 0,
    districts: 10,
    governingDistricts: null,
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

  // Stated N === rendered rows, from the same list.
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

  // The in-view mode says so on the tile.
  const inView = deriveStatsView(
    computeStats({ meetings: [], coverage: null, drawnDistricts: drawn as never }),
    true,
    false,
  );
  assert.equal(inView.districtsLabel, "In view");
  assert.equal(inView.districtsSecondary, null, "one number, one line");
});

test("the governing mode counts what contains the reader, and its door lists it", async () => {
  const { computeStats, deriveStatsView, governingDoorRows } = await import(
    "../lib/state/derive.ts"
  );

  // A ZIP centroid crosses lines, an address does not. Real coverage from the committed geometry.
  const coverage = await coverageAt(...ZIPS["03255"], 0);
  assert.ok(
    coverage.divisions.length > 0,
    "the governing set is the denominator — an empty one proves nothing",
  );

  // Without an address there is no governing claim to make: a ZCTA centroid
  // can sit in a different town than the reader, so the card stays in view
  // mode no matter how good the coverage is.
  const drawn = [
    {
      type: "county" as const,
      tier: "local" as const,
      typeLabel: "County",
      ocdId: "ocd-division/country:us/state:nh/county:merrimack",
      label: "Merrimack County",
    },
  ];
  const centroid = deriveStatsView(
    computeStats({ meetings: [], coverage, drawnDistricts: drawn, atAddress: false }),
    true,
    false,
  );
  assert.equal(centroid.districtsLabel, "In view");
  assert.equal(centroid.districts, 1);

  // With one, the card leads with the governing count and KEEPS the in-view
  // number rather than throwing it away.
  const atAddress = deriveStatsView(
    computeStats({ meetings: [], coverage, drawnDistricts: drawn, atAddress: true }),
    true,
    false,
  );
  assert.equal(atAddress.districtsLabel, "You're in");
  assert.equal(atAddress.districts, coverage.divisions.length);
  assert.equal(atAddress.districtsSecondary, "1 in view");

  // The stated-N rule, extended to the second mode: the door renders exactly
  // the rows the tile counted.
  const rows = governingDoorRows(coverage, (ocdId) =>
    representationForDivision(coverage, ocdId),
  );
  assert.equal(
    rows.length,
    atAddress.districts,
    "the governing card's N must equal the governing door's rows",
  );

  // Identifiers never render: every row carries a reader-facing type name.
  for (const row of rows) {
    assert.ok(row.label.length > 0);
    assert.ok(!/[_:]/.test(row.typeLabel), `${row.typeLabel} leaks an identifier`);
  }
  // And the mode names real people through the shared resolver — the county
  // board sits inside this set.
  assert.ok(
    rows.some((r) => r.holders.length > 0),
    "the governing door named nobody at a zip whose card names people",
  );

  // Turning the outlines off does not unmake geometry: the governing count
  // stands and the secondary line says the outlines are off.
  const outlinesOff = deriveStatsView(
    computeStats({ meetings: [], coverage, drawnDistricts: null, atAddress: true }),
    false,
    false,
  );
  assert.equal(outlinesOff.districts, coverage.divisions.length);
  assert.equal(outlinesOff.districtsSecondary, "District outlines are off");
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
  // The defect: a settled pan crossing into a new ZCTA must
  // NOT pop the card - data refreshes silently under the bubble.
  assert.equal(noticeShouldExpand("settled", "85641", "85701"), false);
  assert.equal(noticeShouldExpand("settled", "85641", null), false);
});

/**
 * The district-type selection is not persisted anywhere: it is rebuilt from DEFAULT_DISTRICT_TYPES on every
 * load. If it ever starts being written to device storage, a migration for stale selections is owed.
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
 * Each sidebar counter is computed from the same collection its surface renders, checked against committed
 * registry data at every test ZIP. A counter that re-derives can drift; one handed the rendered list cannot.
 */
for (const [zip, [lat, lng]] of Object.entries(ZIPS)) {
  test(`every sidebar counter equals its door's rendered rows at ${zip}`, async () => {
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

    // The old derivation (seats + senators) must not be what the card says where curated locals or statewide executives exist.
    const seatsAndSenatorsOnly = new Set<string>();
    for (const seat of coverage.seats)
      for (const h of seat.representatives) seatsAndSenatorsOnly.add(h.id);
    for (const s of coverage.senators) seatsAndSenatorsOnly.add(s.id);
    if (groups.local.length > 0 || coverage.statewideExecutives.length > 0) {
      assert.notEqual(
        view.officials,
        seatsAndSenatorsOnly.size,
        `${zip}: the card is back on the seats-and-senators derivation`,
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

/** A dash means "we could not check"; a switch the reader flipped is not that. */
test("districts off says Off, not the couldn't-check dash", async () => {
  const { computeStats, deriveStatsView } = await import("../lib/state/derive.ts");

  const off = computeStats({ meetings: [], coverage: null, drawnDistricts: null });
  assert.equal(off.districts, null, "nothing drawn is null, not a count of zero");
  assert.equal(deriveStatsView(off, false, false).districts, "Off");

  // A tile whose label claims something about the view answers from the live map (`stats.districts`), not
  // the persisted switch. "Off" is nothing drawn with the switch off.
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
  assert.equal(
    deriveStatsView(on, false, false).districts,
    1,
    "a district on screen may never render as Off, whatever the switch believes",
  );
  assert.equal(deriveStatsView(on, true, false).districts, 1);
  // Nothing drawn and the switch ON is a real zero, not "Off": the reader
  // asked for outlines and this view has none to give.
  const noneHere = computeStats({ meetings: [], coverage: null, drawnDistricts: [] });
  assert.equal(deriveStatsView(noneHere, true, false).districts, 0);
  assert.equal(deriveStatsView(noneHere, false, false).districts, "Off");

  // And the coverage-less state does not claim zeros for the two counters
  // whose door says it could not resolve who governs.
  const view = deriveStatsView(on, true, false);
  assert.equal(view.bodies, "—");
  assert.equal(view.officials, "—");
});

/**
 * Every division card renders the people some other surface already renders for that division, asserted per
 * division type so a fix to one type cannot hide a defect in another.
 */
test("no division card denies people another surface renders", async () => {
  const missing: string[] = [];
  const covered = new Map<string, number>();

  for (const [zip, [lat, lng]] of Object.entries(ZIPS)) {
    const coverage = await coverageAt(lat, lng, 0);

    // Every division ANY surface holds people for: legislative seats from the
    // officeholder index, local governments from the curated rosters.
    const divisions = new Map<string, { type: string; expected: number }>();
    for (const seat of coverage.seats) {
      if (seat.representatives.length > 0) {
        divisions.set(seat.ocdId, {
          type: seat.divisionType,
          expected: seat.representatives.length,
        });
      }
    }
    for (const body of coverage.bodies) {
      if (!body.ocdId || !body.divisionType) continue;
      const roster = governingRosterHoldersForDivision(body.ocdId);
      if (roster.length === 0) continue;
      const prior = divisions.get(body.ocdId);
      if (!prior || prior.expected < roster.length) {
        divisions.set(body.ocdId, {
          type: body.divisionType,
          expected: Math.max(prior?.expected ?? 0, roster.length),
        });
      }
    }

    for (const [ocdId, { type, expected }] of divisions) {
      const rendered = representationForDivision(coverage, ocdId);
      covered.set(type, (covered.get(type) ?? 0) + 1);
      if (rendered.length < expected) {
        missing.push(`${zip} ${type} ${ocdId}: card ${rendered.length} vs ${expected}`);
      }
    }
  }

  assert.deepEqual(missing, [], missing.join("\n"));

  // An empty pass would satisfy the loop above silently; all six division types with people are covered.
  for (const type of [
    "cd",
    "sldl",
    "sldu",
    "county",
    "place",
    "school_district",
  ]) {
    assert.ok(
      (covered.get(type) ?? 0) > 0,
      `no ${type} division with people was checked — the guard proved nothing`,
    );
  }
});

test("the honest empty line is the same sentence on both surfaces", () => {
  // A division with nobody says so once, in one place. Two surfaces writing
  // their own version of a gap is how one of them ends up softer than the
  // truth.
  assert.equal(representationForDivision(null, null).length, 0);
  assert.equal(
    representationForDivision(null, "ocd-division/country:us/state:az/cd:7").length,
    0,
    "no coverage means no seat — never a guess from the roster store",
  );
  assert.match(representationNoteFor("local"), /haven't sourced who sits on it/);
  assert.match(representationNoteFor("federal"), /No sourced officeholder/);
});
