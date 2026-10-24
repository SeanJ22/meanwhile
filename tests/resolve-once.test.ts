import { geometryFiles } from "../lib/holdings/discovery.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fixtureZipResolution } from "./helpers/zip-location.ts";
import { summarizeCoverage, type CoverageSummary } from "../lib/registry/coverage.ts";
import { divisionsAt, sweepsRun, type GeoFeature } from "../lib/registry/resolve.ts";
import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import { GET as stateGET } from "../app/api/reader/state/route.ts";
import { GET as directoryGET } from "../app/api/directory/route.ts";
import { mergeReaderCoverage, stateCoverageForZip, type ReaderStateResponse } from "../lib/reader/client.ts";
import type { Division, Registry } from "../lib/registry/types.ts";
import { installRegistryAuthority, installFederalDirectory, syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";
import { recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { publishRecordedEdge } from "./helpers/reader-edge-meetings.ts";
import { azDistricts } from "./helpers/ballot-district-fixtures.ts";

await installRegistryAuthority();
{
  const recorded = recordedMeetingsSnapshot();
  await publishRecordedEdge(recorded.meetings, recorded.agendaDocuments, recorded.generatedAt, {
    "census-districts": { value: azDistricts, versionId: azDistricts.versionId },
  });
  const federal = syntheticFederalDirectory();
  for (const holder of federal.roster.officeholders.filter(holder => holder.state === "AZ")) {
    federal.directory.byMember[holder.id.slice("congress:".length)]!.districtOffices = [{ city: "Tucson", state: "AZ", address: "Fixture public office",
      zip: "85701", phone: "520-555-0100", lat: 32.22, lng: -110.97 }];
  }
  await installFederalDirectory(federal);
}

/**
 * `/api/meetings` reads ZIP divisions from the national index and composes coverage from its state and place packages.
 * The polygon resolver remains available for arbitrary map points.
 */

const here = dirname(fileURLToPath(import.meta.url));
const HOLDINGS_ROOT = join(here, "..");

async function loadFeatures(): Promise<GeoFeature[]> {
  const names = geometryFiles(HOLDINGS_ROOT);
  const all: GeoFeature[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(HOLDINGS_ROOT, name), "utf8"));
    all.push(...(parsed.features as GeoFeature[]));
  }
  return all;
}

const features = await loadFeatures();
const registry = JSON.parse(
  await readFile(join(here, "..", "lib", "registry", "registry.json"), "utf8"),
) as Registry;
const byId = new Map<string, Division>(registry.divisions.map((d) => [d.ocdId, d]));

/** Test ZIPs, plus a point outside coverage. */
const PROBES = ["85701", "85641", "07866", "03255", "06716"] as const;

test("pre-resolving the divisions produces the identical coverage answer", () => {
  // Passing the pre-resolved divisions yields the same coverage object.
  let checked = 0;
  for (const zip of PROBES) {
    const resolved = fixtureZipResolution(zip);
    if (!resolved.ok) continue;
    const point: [number, number] = [resolved.centroid.lng, resolved.centroid.lat];

    const without = summarizeCoverage(point, features, byId, registry.bodies, 3);
    const pre = divisionsAt(point, features, byId);
    const with_ = summarizeCoverage(point, features, byId, registry.bodies, 3, new Map(), pre);

    assert.deepEqual(
      with_,
      without,
      `${zip}: coverage differs when the divisions are handed in pre-resolved`,
    );
    checked += 1;
  }

  assert.equal(checked, PROBES.length, "every probe zip resolved to a centroid");
  console.log(`resolve-once: ${checked} probe point(s) identical either way`);
});

test("an EMPTY pre-resolved set is not silently treated as an answer", () => {
  // Passing `[]` would empty coverage and render a lookup failure as "no body governs here", so `undefined`
  // (resolve again) and `[]` must not be the same call.
  const resolved = fixtureZipResolution("85701");
  assert.ok(resolved.ok);
  const point: [number, number] = [resolved.centroid.lng, resolved.centroid.lat];

  const real = summarizeCoverage(point, features, byId, registry.bodies, 3);
  const empty = summarizeCoverage(
    point,
    features,
    byId,
    registry.bodies,
    3,
    new Map(),
    [],
  );

  assert.ok(real.bodies.length > 0, "85701 really is governed by somebody");
  assert.equal(empty.bodies.length, 0, "an empty set genuinely empties the answer");
  assert.notDeepEqual(
    empty,
    real,
    "empty and absent must not be the same input — one is an answer, one is a failure",
  );
});

test("ZIP-only state and meetings requests independently return the state's officials and Tucson's local holdings", async () => {
  const [stateResponse, placeResponse] = await Promise.all([
    stateGET(new Request("https://example.test/api/reader/state?zip=85701")),
    meetingsGET(new Request("https://example.test/api/meetings?zip=85701")),
  ]);
  assert.equal(stateResponse.status, 200);
  assert.equal(placeResponse.status, 200);
  const state = await stateResponse.json() as ReaderStateResponse;
  const place = await placeResponse.json() as { coverage: CoverageSummary; meetings: { bodyId?: string }[]; nearZip: string };
  assert.equal(state.directory, null, "compact ZIP state responses leave the directory for an office click");
  assert.equal(state.state, "AZ");
  assert.ok(state.coverage.statewideExecutives.some(holder => holder.name === "Katie Hobbs"), "the state request names Arizona's governor");
  assert.equal(state.coverage.senators.length, 2);
  assert.ok(state.zipPlaces["85701"]?.ids.includes("ocd-division/country:us/state:az/cd:7"));
  assert.ok(state.zipPlaces["85701"]?.ids.includes("ocd-division/country:us/state:az/place:tucson"));
  assert.ok(state.boundaryUrl.length > 0, "the state request gives the map its boundary source");
  assert.equal(place.nearZip, "85701");
  assert.ok(place.coverage.bodies.some(body => body.bodyId === "ocd-division/country:us/state:az/place:tucson#governing"), "the place request retains Tucson's council");
  assert.ok(place.meetings.length > 0, "the place request retains held meetings");
  const coverage = mergeReaderCoverage(stateCoverageForZip(state, "85701"), place.coverage, place.meetings.length);
  assert.ok(coverage, "the reader composes its parallel state and place answers");
  const house = coverage.seats.find(seat => seat.ocdId === "ocd-division/country:us/state:az/cd:7")?.representatives;
  assert.ok(house?.length, "the composed reader answer retains Tucson's House member");
  assert.equal(coverage.senators.length, 2);
  for (const holder of [...house, ...coverage.senators]) {
    assert.ok(holder.name.length > 0);
    const response = await directoryGET(new Request(`https://example.test/api/directory?member=${encodeURIComponent(holder.id)}&state=AZ`));
    assert.equal(response.status, 200, `${holder.name}'s office request succeeds`);
    const directory = await response.json() as { districtOffices: { address?: string; phone?: string }[] };
    assert.ok(directory.districtOffices.some(office => office.address && office.phone), `${holder.name}'s held office survives its reader request`);
  }
});

test("parallel indexed ZIP requests show held meetings and officials without a polygon sweep", async () => {
  const before = sweepsRun();
  const [stateResponse, response] = await Promise.all([
    stateGET(new Request("https://example.test/api/reader/state?zip=85701")),
    meetingsGET(new Request("https://example.test/api/meetings?zip=85701&lat=32.21696&lng=-110.971")),
  ]);
  const swept = sweepsRun() - before;

  assert.equal(stateResponse.status, 200, "the state request did not succeed");
  assert.equal(response.status, 200, "the probe request did not succeed");
  const state = await stateResponse.json() as ReaderStateResponse;
  const body = (await response.json()) as { meetings: unknown[]; coverage: CoverageSummary };
  assert.ok(Array.isArray(body.meetings), "no meetings array — the request did not do the work");
  assert.ok(body.coverage, "no coverage block — the place request did not compose its facts");
  const coverage = mergeReaderCoverage(stateCoverageForZip(state, "85701"), body.coverage, body.meetings.length);
  assert.ok(coverage, "the reader composes its parallel state and place answers");

  assert.ok(body.meetings.length > 0, "85701 retains its recorded meetings");
  assert.ok(body.coverage.bodies.some(body => body.bodyId === "ocd-division/country:us/state:az/county:pima#governing"), "85701 retains its county board");
  assert.ok(coverage.seats.some(seat => seat.ocdId === "ocd-division/country:us/state:az/cd:7" && seat.representatives.length > 0), `85701 retains its House member: ${JSON.stringify(coverage.seats.map(seat => ({ id: seat.ocdId, people: seat.representatives.map(holder => holder.name) })))}`);
  assert.equal(coverage.senators.length, 2, "85701 retains both senators");
  assert.equal(swept, 0, "the ZIP-to-places index supplies the held divisions without sweeping the state's polygons");
});

test("the counter can read two, so a one is a measurement and not a constant", () => {
  // Control: withholding the pre-resolved set makes summarizeCoverage resolve again, and the counter reads 2.
  const resolved = fixtureZipResolution("85701");
  assert.ok(resolved.ok);
  const point: [number, number] = [resolved.centroid.lng, resolved.centroid.lat];

  const before = sweepsRun();
  divisionsAt(point, features, byId);
  summarizeCoverage(point, features, byId, registry.bodies, 3);
  assert.equal(
    sweepsRun() - before,
    2,
    "the old call shape no longer costs two sweeps — the counter is not measuring",
  );

  const withPre = sweepsRun();
  const pre = divisionsAt(point, features, byId);
  summarizeCoverage(point, features, byId, registry.bodies, 3, new Map(), pre);
  assert.equal(
    sweepsRun() - withPre,
    1,
    "handing the divisions in still costs two sweeps — the reuse is not happening",
  );
});
