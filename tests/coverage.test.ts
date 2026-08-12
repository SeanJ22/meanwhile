import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveZip } from "../lib/geo/zcta.ts";
import { dedupeMunicipal, summarizeCoverage } from "../lib/registry/coverage.ts";
import type { GeoFeature } from "../lib/registry/resolve.ts";
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

const GOVERNING_LSAD = new Set(["00", "21", "25", "43", "44", "47"]);

test("the clip counties hold exactly the 74 governments Census enumerates", () => {
  const municipal = registry.divisions.filter(
    (d) => d.divisionType === "place" && GOVERNING_LSAD.has(d.lsad ?? ""),
  );

  // The clip is an overlap test, so it pulls in municipalities of neighbouring
  // counties that share a border. The federal count is per county, so the
  // comparison has to be too.
  const inClip = municipal.filter(
    (d) =>
      /county:(morris|merrimack)\//.test(d.ocdId) ||
      (d.state === "AZ" && !d.ocdId.includes("/county:")),
  );

  const counties = registry.divisions.filter((d) => d.divisionType === "county");

  assert.equal(
    inClip.length + counties.length,
    COG_GENERAL_PURPOSE,
    `expected ${COG_GENERAL_PURPOSE} general-purpose governments, got ${
      inClip.length + counties.length
    } (${inClip.length} municipal + ${counties.length} county)`,
  );
});

test("a government ingested from both layers is counted once", () => {
  // Concord NH is in the place file and the county-subdivision file. Two
  // divisions, one city. Left alone it produces two governing bodies and the
  // reader is told their city government exists twice.
  const concord = registry.divisions.filter(
    (d) => d.divisionType === "place" && /concord/.test(d.ocdId) && d.state === "NH",
  );
  assert.ok(
    concord.length >= 2,
    "expected Concord NH in both layers — if this fails the registry build changed",
  );

  const bodies = registry.bodies.filter(
    (b) => b.ocdId && concord.some((d) => d.ocdId === b.ocdId),
  );
  const deduped = dedupeMunicipal(concord, bodies);

  assert.equal(deduped.divisions.length, 1, "one city is one division");
  assert.equal(deduped.bodies.length, 1, "one city is one governing body");
  assert.ok(
    deduped.divisions[0].ocdId.includes("/county:"),
    "the county-subdivision row is the government; the flat place row is the duplicate",
  );
});

test("dedupe leaves a state whose municipalities are places alone", () => {
  // Arizona's county subdivisions are all statistical CCDs, so nothing there is
  // duplicated and nothing may be dropped. Passing the *resolved* set rather
  // than a pre-filtered one on purpose: the CCDs have to be present, because a
  // dedupe that reads them as evidence of a subdivision government deletes the
  // City of Tucson.
  const az = registry.divisions.filter(
    (d) => d.divisionType === "place" && d.state === "AZ",
  );
  const bodies = registry.bodies.filter(
    (b) => b.ocdId && az.some((d) => d.ocdId === b.ocdId),
  );
  const { divisions, dropped } = dedupeMunicipal(az, bodies);

  assert.equal(dropped.length, 0, `dropped ${dropped.map((d) => d.label).join(", ")}`);
  assert.equal(divisions.length, az.length);
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

  const municipal = coverage.bodies.filter((b) => b.divisionType === "place");
  assert.equal(municipal.length, 1, `expected the city, got ${municipal.length}`);
  assert.match(municipal[0].divisionLabel, /tucson/i);
});

test("85641 states the unincorporated fact and still names its government", () => {
  // The case the whole phase exists for. Vail is a CDP: no municipal
  // government at all. The old answer was an empty map reading as civic
  // silence; the correct one names the county and the school district and says
  // plainly that there is no city government.
  const coverage = coverageFor("85641", 0);

  assert.equal(coverage.state, "NO_SOURCE");
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
  assert.equal(coverageFor("85701", 0).state, "NO_SOURCE");
});

test("a body's name is never invented for display", () => {
  // The copy prints the *division's* label, which Census sourced. Every body's
  // own name is null and must stay that way until something sources it.
  const coverage = coverageFor("07866", 0);
  assert.ok(coverage.bodies.length > 0);

  for (const body of coverage.bodies) {
    const source = registry.bodies.find((b) => b.id === body.bodyId);
    assert.ok(source, `${body.bodyId} is not in the registry`);
    assert.equal(source.name, null, `${body.bodyId} gained a name from nowhere`);
    assert.equal(source.coverageStatus, "NO_SOURCE_FOUND");
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

test("03255 resolves the town, deduped to one municipal body", () => {
  // Newbury NH is a county subdivision and absent from the place file. Nothing
  // should double it, and the town government must survive the dedupe.
  const coverage = coverageFor("03255", 0);
  const municipal = coverage.bodies.filter((b) => b.divisionType === "place");

  assert.equal(municipal.length, 1, `expected one town, got ${municipal.length}`);
  assert.match(municipal[0].divisionLabel, /newbury/i);
  assert.equal(coverage.unincorporated, false);
});
