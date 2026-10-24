import { geometryFiles } from "../lib/holdings/discovery.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fixtureZipResolution } from "./helpers/zip-location.ts";
import { bodiesAt, type GeoFeature } from "../lib/registry/resolve.ts";
import type { Division, Registry } from "../lib/registry/types.ts";

/**
 * Hand-written ground truth per ZIP that the polygon-generated registry is measured against; the useful
 * output is what the derivation fails to produce.
 */

const here = dirname(fileURLToPath(import.meta.url));
const HOLDINGS_ROOT = join(here, "..");

/** What must resolve, per ZIP, as OCD-ID substrings, so the oracle is about which governments resolve, not key shape. */
const ORACLE: Record<string, { must: string[]; note: string }> = {
  "85701": {
    note: "Downtown Tucson. City, county, unified school district, and state and federal seats.",
    must: [
      "county:pima",
      "place:tucson",
      "school_district:tucson_unified",
      "sldu:",
      "sldl:",
      "cd:",
    ],
  },
  "85641": {
    note: "Vail. Unincorporated — a CDP with no municipal government, which is the whole point.",
    must: [
      "county:pima",
      "school_district:vail_unified",
      "sldu:",
      "sldl:",
      "cd:",
    ],
  },
  "07866": {
    note: "Rockaway Township NJ. A township, not the neighbouring borough, plus TWO school districts.",
    must: [
      "county:morris",
      "place:rockaway_township",
      "school_district:",
      "sldu:",
      "sldl:",
      "cd:",
    ],
  },
  "03255": {
    note: "Newbury NH. A town — a county subdivision, absent from the Census place file entirely.",
    must: [
      "county:merrimack",
      "place:newbury_town",
      "school_district:",
      "sldu:",
      "sldl:",
      "cd:",
    ],
  },
};

async function loadFeatures(): Promise<GeoFeature[]> {
  const names = geometryFiles(HOLDINGS_ROOT);
  const all: GeoFeature[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(HOLDINGS_ROOT, name), "utf8"));
    all.push(...(parsed.features as GeoFeature[]));
  }
  return all;
}

async function loadRegistry(): Promise<Registry> {
  return JSON.parse(
    await readFile(join(here, "..", "lib", "registry", "registry.json"), "utf8"),
  ) as Registry;
}

const features = await loadFeatures();
const registry = await loadRegistry();
const byId = new Map<string, Division>(registry.divisions.map((d) => [d.ocdId, d]));

function resolve(zip: string) {
  const r = fixtureZipResolution(zip);
  assert.ok(r.ok, `${zip} must resolve to a centroid`);
  const point: [number, number] = [r.centroid.lng, r.centroid.lat];
  return bodiesAt(point, features, byId, registry.bodies);
}

for (const [zip, spec] of Object.entries(ORACLE)) {
  test(`${zip} resolves every division on the oracle list — ${spec.note}`, () => {
    const { divisions } = resolve(zip);
    const ids = divisions.map((d) => d.ocdId);

    const missing = spec.must.filter((want) => !ids.some((id) => id.includes(want)));
    assert.deepEqual(
      missing,
      [],
      `${zip} is missing ${missing.join(", ")}.\nResolved:\n  ${ids.join("\n  ")}`,
    );
  });
}

test("85641 gets a school board and no municipal government", () => {
  // An unincorporated point whose only municipal-shaped division is a Census County Division (no government):
  // the derivation must produce no council for it and still find the school board.
  const { divisions, bodies } = resolve("85641");

  const municipalish = divisions.filter((d) => d.divisionType === "place");
  assert.ok(municipalish.length > 0, "expected a place-type division to cover Vail");
  assert.ok(
    municipalish.every((d) => d.lsad === "22" || d.lsad === "57"),
    `expected only statistical divisions, got ${municipalish
      .map((d) => `${d.label}(${d.lsad})`)
      .join(", ")}`,
  );

  const municipalIds = new Set(municipalish.map((d) => d.ocdId));
  assert.equal(
    bodies.filter((b) => b.ocdId && municipalIds.has(b.ocdId)).length,
    0,
    "a CDP or CCD must never generate a council",
  );

  assert.ok(
    bodies.some((b) => b.ocdId?.includes("school_district:vail_unified")),
    "Vail Unified must still have a governing board",
  );
});

test("07866 resolves the township, not the neighbouring borough", () => {
  // Two municipalities with the same name in one county must not collapse onto one identifier.
  const { divisions } = resolve("07866");
  const ids = divisions.map((d) => d.ocdId);

  assert.ok(ids.some((id) => id.endsWith("place:rockaway_township")));
  assert.ok(
    !ids.some((id) => id.endsWith("place:rockaway_borough")),
    "the borough is a different municipality and must not resolve here",
  );
});

test("07866 sits in two school districts at once", () => {
  // A K-8 district and a regional high school district cover the same ground.
  // Nothing downstream may assume one school district per point.
  const { divisions } = resolve("07866");
  const schools = divisions.filter((d) => d.divisionType === "school_district");

  assert.ok(
    schools.length >= 2,
    `expected two school districts, got ${schools.map((s) => s.label).join(", ")}`,
  );
});

test("every derived body is labelled structural, never sourced", () => {
  const derived = registry.bodies.filter(
    (b) => b.bodyOrigin === "DERIVED_FROM_DIVISION_TYPE",
  );
  assert.ok(derived.length >= 265, "the derived rows went missing");

  for (const body of derived) {
    // A body's existence is structural and its name stays null on every derived row; no body may claim an
    // exhausted search (tests/link-ladder.test.ts).
    assert.notEqual(
      body.coverageStatus,
      "NO_SOURCE_FOUND",
      `${body.id} claims a search came back empty; none has been exhausted yet`,
    );
    // The existence of the body is a structural claim. Its name is not, and
    // names vary by state — supervisors, commissioners, select boards.
    assert.equal(
      body.name,
      null,
      `${body.id} carries a name that nothing sourced`,
    );
    assert.equal(body.provenance.verifiedAt, null);
  }
});

test("every curated body carries a sourced name with its citation", () => {
  // A curated name may appear only with the page it was read from cited.
  const curated = registry.bodies.filter((b) => b.bodyOrigin === "CURATED");
  assert.ok(curated.length > 0, "the curated overlay went missing");

  for (const body of curated) {
    assert.ok(body.name, `${body.id} has no name — curation read it off a page`);
    assert.ok(
      body.provenance.sourceUrl,
      `${body.id} names a body with no citation`,
    );
    assert.notEqual(body.coverageStatus, "NO_SOURCE_FOUND");
  }

  // The division-less path exists and stays the exception.
  const divisionless = curated.filter((b) => b.ocdId === null);
  assert.ok(divisionless.length >= 1, "PCC's division-less row went missing");

  // One division, many bodies: the registry must never assume one
  // body per division.
  const tucson = registry.bodies.filter(
    (b) => b.ocdId === "ocd-division/country:us/state:az/place:tucson",
  );
  assert.ok(
    tucson.length > 50,
    `Tucson should carry its boards and commissions; got ${tucson.length}`,
  );

  // No two bodies share an id, curated included.
  const ids = new Set(registry.bodies.map((b) => b.id));
  assert.equal(ids.size, registry.bodies.length, "duplicate body ids");
});

test("no legislative district generates a meeting body", () => {
  // A legislative district elects a seat in a chamber that sits elsewhere. It
  // is not a body that meets, and Arizona's districts elect three people.
  const legislative = new Set(
    registry.divisions
      .filter((d) => ["sldu", "sldl", "cd"].includes(d.divisionType))
      .map((d) => d.ocdId),
  );

  for (const body of registry.bodies) {
    assert.ok(
      !body.ocdId || !legislative.has(body.ocdId),
      `${body.id} attaches a meeting body to a legislative district`,
    );
  }
});

test("every body points at a division that exists", () => {
  for (const body of registry.bodies) {
    if (!body.ocdId) continue;
    assert.ok(byId.has(body.ocdId), `${body.id} references an unknown division`);
  }
});
