import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveZip } from "../lib/geo/zcta.ts";
import { summarizeCoverage } from "../lib/registry/coverage.ts";
import { contains, type GeoFeature } from "../lib/registry/resolve.ts";
import type { Division, Registry } from "../lib/registry/types.ts";

/**
 * Coverage language, and the count that proves the derivation rule is right.
 *
 * Two jobs. The first is the four states of 4.6.6 — the reader must always be
 * able to tell "nothing is scheduled" from "we cannot see what is scheduled",
 * and must never be told they have no representation.
 *
 * The second is the federal check. Phase 4.7 says the derivation rule is
 * validated against the Census of Governments rather than invented, and this is
 * where that happens: the three clip counties hold exactly 74 general-purpose
 * governments, and a rule producing a different number is wrong.
 */

const here = dirname(fileURLToPath(import.meta.url));
const GEO_DIR = join(here, "..", "public", "geo");

async function loadFeatures(): Promise<GeoFeature[]> {
  const names = (await readdir(GEO_DIR)).filter((n) => n.endsWith(".geojson"));
  const all: GeoFeature[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(GEO_DIR, name), "utf8"));
    all.push(...(parsed.features as GeoFeature[]));
  }
  return all;
}

const features = await loadFeatures();
const registry = JSON.parse(
  await readFile(join(here, "..", "lib", "registry", "registry.json"), "utf8"),
) as Registry;
const byId = new Map<string, Division>(registry.divisions.map((d) => [d.ocdId, d]));

function coverageFor(zip: string, meetingCount: number) {
  const r = resolveZip(zip);
  assert.ok(r.ok, `${zip} must resolve to a centroid`);
  return summarizeCoverage(
    [r.centroid.lng, r.centroid.lat],
    features,
    byId,
    registry.bodies,
    meetingCount,
  );
}

/**
 * The 2022 Census of Governments count for the three clip counties.
 *
 * 39 municipalities in Morris NJ, 27 in Merrimack NH, 5 incorporated places in
 * Pima AZ, plus the 3 county governments. This is the number the derivation has
 * to reproduce, and reproducing it is what turns "the rule looks reasonable"
 * into "the rule agrees with the federal enumeration".
 */
const COG_GENERAL_PURPOSE = 74;

/** Per-county, from the same federal source. */
const COG_BY_COUNTY: Record<string, number> = {
  "Pima AZ": 5,
  "Merrimack NH": 27,
  "Morris NJ": 39,
};

const bodyOcdIds = new Set(registry.bodies.map((b) => b.ocdId));

/** Average of every exterior-ring vertex. Good enough to place a municipality in its county. */
function centroid(feature: GeoFeature): [number, number] {
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      sx += x;
      sy += y;
      n++;
    }
  }
  return [sx / n, sy / n];
}

test("the clip counties hold exactly the 74 governments Census enumerates", () => {
  // The federal check, and the reason the derivation rule is credible rather
  // than merely plausible. Done by geometric containment, not by reading county
  // out of the identifier: after the FUNCSTAT fix a New Jersey borough is a flat
  // `state:nj/place:*` row with no county segment at all, so an identifier-shaped
  // test would silently miss 29 governments.
  const counties = JSON.parse(
    readFileSync(join(GEO_DIR, "county-us.geojson"), "utf8"),
  ).features as GeoFeature[];

  const perCounty: Record<string, number> = {};
  for (const feature of features) {
    if (!bodyOcdIds.has(feature.properties.ocdId)) continue;
    const division = byId.get(feature.properties.ocdId);
    if (division?.divisionType !== "place") continue;

    const home = counties.find((c) => contains(centroid(feature), c));
    if (!home) continue;
    const key = `${home.properties.label} ${(home.properties as { state?: string }).state}`;
    perCounty[key] = (perCounty[key] ?? 0) + 1;
  }

  assert.deepEqual(
    perCounty,
    COG_BY_COUNTY,
    `municipal counts per county disagree with the Census of Governments: ${JSON.stringify(perCounty)}`,
  );

  const total =
    Object.values(perCounty).reduce((a, b) => a + b, 0) +
    registry.divisions.filter((d) => d.divisionType === "county").length;

  assert.equal(total, COG_GENERAL_PURPOSE, `expected ${COG_GENERAL_PURPOSE}, got ${total}`);
});

test("a government listed in both layers keeps the real row, not the fictitious one", () => {
  // Concord NH is in the place file and the county-subdivision file. One city.
  // Census marks the duplicate itself: the place row is FUNCSTAT=A and the
  // subdivision row is FUNCSTAT=F, a fictitious entity that exists only to fill
  // the geographic hierarchy.
  //
  // Which row survives matters as much as how many. An earlier read-layer
  // dedupe kept the county-subdivision row and dropped `place:concord` — the
  // count was right and the identity was wrong, which is worse, because every
  // officeholder and meeting downstream joins on that key.
  const concord = registry.divisions.filter(
    (d) => d.divisionType === "place" && /concord/.test(d.ocdId) && d.state === "NH",
  );
  assert.ok(
    concord.length >= 2,
    "expected Concord NH in both layers — if this fails the registry build changed",
  );

  const withBody = concord.filter((d) => bodyOcdIds.has(d.ocdId));
  assert.equal(withBody.length, 1, "one city is one governing body");
  assert.equal(withBody[0].funcstat, "A");
  assert.equal(
    withBody[0].ocdId,
    "ocd-division/country:us/state:nh/place:concord",
    "the active place row is the City of Concord",
  );

  const dropped = concord.filter((d) => !bodyOcdIds.has(d.ocdId));
  assert.ok(dropped.every((d) => d.funcstat === "F"));
});

test("every fictitious row is suppressed, and only fictitious rows are", () => {
  // 32 across the three clip counties. If this number moves, either Census
  // changed a vintage or the rule stopped reading FUNCSTAT.
  const municipal = registry.divisions.filter((d) => d.divisionType === "place");
  const fictitious = municipal.filter((d) => d.funcstat === "F");

  assert.equal(fictitious.length, 32, "expected 32 fictitious duplicate rows");
  assert.ok(
    fictitious.every((d) => !bodyOcdIds.has(d.ocdId)),
    "a fictitious row must never produce a governing body",
  );
  assert.ok(
    municipal
      .filter((d) => d.funcstat === "A")
      .every((d) => bodyOcdIds.has(d.ocdId)),
    "every active municipal government must produce a governing body",
  );
});

test("Rockaway borough and township both survive as separate governments", () => {
  // The case that makes the direction of the fix matter. Morris County holds
  // both, and they are two municipalities with two councils. The borough is a
  // flat place row; the township is a county subdivision; and there is a third,
  // fictitious row duplicating the borough.
  const rockaway = registry.divisions.filter((d) => /place:rockaway/.test(d.ocdId));
  const governing = rockaway.filter((d) => bodyOcdIds.has(d.ocdId)).map((d) => d.ocdId);

  assert.equal(governing.length, 2, `expected two governments, got ${governing.join(", ")}`);
  assert.ok(governing.some((id) => id.endsWith("/place:rockaway")), "the borough");
  assert.ok(
    governing.some((id) => id.endsWith("/place:rockaway_township")),
    "the township",
  );
});

test("85701 keeps the City of Tucson and is not called unincorporated", () => {
  // The regression the dedupe introduced and this test now pins. Downtown
  // Tucson is covered by both `place:tucson` (the city) and
  // `county:pima/place:tucson_ccd` (a statistical Census County Division).
  // Reading the CCD as a subdivision government dropped the city, leaving the
  // largest municipality in the test set unrepresented and reporting downtown
  // as having no city government.
  const coverage = coverageFor("85701", 0);

  assert.equal(
    coverage.unincorporated,
    false,
    "downtown Tucson has a city government",
  );

  // Exactly one municipal *government*. The division now also carries the
  // city's boards, commissions and the PHA as curated bodies (D29) — real
  // bodies, not extra city governments, and they must not read as one.
  const municipal = coverage.bodies.filter(
    (b) => b.divisionType === "place" && b.name === null,
  );
  assert.equal(municipal.length, 1, `expected the city, got ${municipal.length}`);
  assert.match(municipal[0].divisionLabel, /tucson/i);
  assert.ok(
    coverage.bodies.some((b) => b.name === "Planning Commission (PC)"),
    "the curated boards should surface alongside the city",
  );
});

test("85641 states the unincorporated fact and still names its government", () => {
  // The case the whole phase exists for. Vail is a CDP: no municipal
  // government at all. The old answer was an empty map reading as civic
  // silence; the correct one names the county and the school district and says
  // plainly that there is no city government.
  const coverage = coverageFor("85641", 0);

  // NONE_SCHEDULED, not NO_SOURCE, since 2026-08-13: both of Vail's governing
  // bodies (Pima County via Legistar, Vail Unified via its own site's events
  // API) are LIVE in the composite, so an empty calendar is now a statement
  // about the calendar rather than about our coverage.
  assert.equal(coverage.state, "NONE_SCHEDULED");
  assert.equal(coverage.unincorporated, true, "Vail is unincorporated and must say so");

  const labels = coverage.bodies.map((b) => b.divisionLabel);
  assert.ok(
    labels.some((l) => /pima/i.test(l)),
    `expected the county, got ${labels.join(", ")}`,
  );
  assert.ok(
    labels.some((l) => /vail/i.test(l)),
    `expected Vail Unified, got ${labels.join(", ")}`,
  );
  assert.equal(
    coverage.bodies.filter((b) => b.divisionType === "place").length,
    0,
    "a CDP must never produce a municipal body",
  );
});

test("nobody is ever told they have no representation", () => {
  // Every square foot of the country is governed by something. Whatever the
  // coverage state, a target zip always resolves at least a county board, a
  // school board, and state and federal seats.
  for (const zip of ["85701", "85641", "07866", "03255"]) {
    const coverage = coverageFor(zip, 0);
    assert.ok(
      coverage.bodies.length > 0,
      `${zip} resolved no governing body at all`,
    );
    assert.ok(
      coverage.seats.length > 0,
      `${zip} resolved no legislative representation`,
    );
    assert.notEqual(coverage.state, "UNMAPPED", `${zip} should be mapped`);
  }
});

test("finding meetings and finding nothing are different states", () => {
  assert.equal(coverageFor("85701", 4).state, "MEETINGS");
  // Every body governing 85701 is LIVE as of 2026-08-13, so zero meetings is
  // an empty calendar, not a coverage gap…
  assert.equal(coverageFor("85701", 0).state, "NONE_SCHEDULED");
  // …and 07866 joined it on 2026-08-15, when Morris Hills Regional — the last
  // GOVERNING body at the point without a source — was wired (M78). The two
  // bodies still unwired there are Rockaway's Environmental Commission and
  // Board of Assessment Commissioners, both COMMISSION class, and the state
  // deliberately does not turn on those: an unwired commission must not read
  // as a government whose calendar is missing. The sidebar still counts them.
  const rockaway = coverageFor("07866", 0);
  assert.equal(rockaway.state, "NONE_SCHEDULED");
  assert.ok(
    rockaway.counts.withoutSource >= 2,
    `${rockaway.counts.withoutSource} bodies without a source — the two ` +
      `unwired commissions must still be counted, not absorbed by the state`,
  );
  assert.deepEqual(
    rockaway.bodies
      .filter((b) => b.bodyClass === "GOVERNING" && b.coverageStatus !== "LIVE")
      .map((b) => b.bodyId),
    [],
    "a governing body at 07866 lost its source",
  );
});

test("a body's name is never invented for display", () => {
  // The copy prints the *division's* label, which Census sourced. A DERIVED
  // body's own name is null and must stay that way until something sources
  // it. A CURATED row may carry a name — that is what the origin means — and
  // then it must cite the page the name was read off. (Rockaway's Planning
  // Board and Board of Adjustment arrived curated on 2026-08-15, named from
  // the township's own AgendaCenter headings.)
  const coverage = coverageFor("07866", 0);
  assert.ok(coverage.bodies.length > 0);

  for (const body of coverage.bodies) {
    const source = registry.bodies.find((b) => b.id === body.bodyId);
    assert.ok(source, `${body.bodyId} is not in the registry`);
    if (source.bodyOrigin === "CURATED") {
      assert.ok(
        source.provenance?.sourceUrl,
        `${body.bodyId} is curated but cites no page for its name`,
      );
    } else {
      assert.equal(source.name, null, `${body.bodyId} gained a name from nowhere`);
    }
    // The coverageStatus assertion that used to sit here was incidental to this
    // test and is now false: Rockaway township has an audit row, so it reads
    // KNOWN_UNCOVERED. What this test is actually about — a name never being
    // invented — is unaffected, and holds even for the audited rows, since a
    // source hunt finds a website and never a body's name.
    assert.notEqual(body.divisionLabel, "", "a division label must be present to render");
  }
});

test("07866 counts its two school districts separately", () => {
  // A K-8 district and a regional high school district cover the same ground,
  // and they are two governments with two boards.
  const coverage = coverageFor("07866", 0);
  const schools = coverage.bodies.filter((b) => b.divisionType === "school_district");

  assert.ok(
    schools.length >= 2,
    `expected two school boards, got ${schools.map((s) => s.divisionLabel).join(", ")}`,
  );
});

test("03255 resolves the town, deduped to one municipal division", () => {
  // Newbury NH is a county subdivision and absent from the place file. Nothing
  // should double it, and the town government must survive the dedupe.
  //
  // **The claim is one DIVISION, not one body** (corrected 2026-08-15, the
  // truth session). This asserted one municipal body until the browser rung
  // reached the town's own site and found the Planning Board, the
  // Conservation Commission and the Zoning Board of Adjustment sitting beside
  // the Selectboard — one division, many bodies, which the registry has
  // always said is the normal case and which Tucson and Rockaway already
  // demonstrate. The dedupe this test guards is of the DIVISION; a body count
  // standing in for it would have made finding a town's other governments
  // look like a regression.
  const coverage = coverageFor("03255", 0);
  const municipal = coverage.bodies.filter((b) => b.divisionType === "place");
  const divisions = new Set(municipal.map((b) => b.divisionLabel));

  assert.equal(divisions.size, 1, `expected one town, got ${[...divisions].join(", ")}`);
  assert.match(municipal[0].divisionLabel, /newbury/i);
  assert.ok(municipal.length >= 4, `expected the town's four bodies, got ${municipal.length}`);
  assert.equal(coverage.unincorporated, false);
});
