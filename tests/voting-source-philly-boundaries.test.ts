import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { containsPoint } from "../lib/geo/polygon.ts";
import { answerVotingSites } from "../lib/ballot/voting-answer.ts";
import { mergeVotingSourceRead } from "../lib/ballot/voting-source-publication.ts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const root = "tests/fixtures/voting-sources/vs-07-philly-boundaries/";
const boundaryDoor = JSON.parse(readFileSync(root + "config-fragment.json", "utf8"))[0] as VotingSourceDoor;
const pollingDoor = (JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[])
  .find(door => door.id === "vs07-pa-philadelphia-polling-map")!;
interface Capture { url: string; finalUrl?: string; file: string; status: number; contentType: string; sha256?: string; savedHash?: string; root: string }
const captures: Capture[] = [
  ...JSON.parse(readFileSync(root + "captures.json", "utf8")).map((row: Capture) => ({ ...row, root })),
  ...JSON.parse(readFileSync("tests/fixtures/voting-sources/vs-07/manifest.json", "utf8")).map((row: Capture) => ({ ...row, root: "tests/fixtures/voting-sources/vs-07/" })),
];
const byUrl = new Map(captures.flatMap(row => [[row.url, row], ...row.finalUrl ? [[row.finalUrl, row] as const] : []] as const));
const fetcher: typeof fetch = async input => {
  const url = String(input);
  if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
  const capture = byUrl.get(url);
  assert.ok(capture, url);
  const bytes = readFileSync(capture.root + capture.file);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), capture.sha256 ?? capture.savedHash, capture.file);
  return new Response(bytes, { status: capture.status, headers: { "content-type": capture.contentType } });
};
const now = "2026-10-23T12:00:00.000Z";

test("Philadelphia's current Atlas polygons cover all 1,703 published ward/division assignments and reach exact reader narrowing", async () => {
  for (const capture of captures.filter(capture => capture.root === root)) {
    assert.equal(createHash("sha256").update(readFileSync(root + capture.file)).digest("hex"), capture.sha256, capture.file);
  }
  assert.equal(boundaryDoor.url, "https://atlas.phila.gov/");
  assert.match(readFileSync(root + "atlas-root-native.html", "utf8"), /assets\/index-BE7Gx29W\.js/);
  const metadata = JSON.parse(readFileSync(root + "political-divisions-metadata.json", "utf8"));
  const count = JSON.parse(readFileSync(root + "political-divisions-count.json", "utf8")).count;
  const polygons = JSON.parse(readFileSync(root + "political-divisions-normalized-all.geojson", "utf8"));
  const raw = JSON.parse(readFileSync(root + "political-divisions-all.geojson", "utf8"));
  assert.equal(count, 1703);
  assert.ok(count < metadata.maxRecordCount);
  assert.equal(polygons.features.length, count);
  assert.equal(raw.features.length, count);
  assert.equal(metadata.advancedQueryCapabilities.supportsOutFieldSQLExpression, true);
  for (const feature of polygons.features) {
    assert.equal(String(feature.properties.ward), String(Number(feature.properties.division_num.slice(0, 2))));
    assert.equal(String(feature.properties.division), String(Number(feature.properties.division_num.slice(2))));
    const original = raw.features.find((row: { properties: { division_num: string } }) => row.properties.division_num === feature.properties.division_num);
    assert.ok(original);
    assert.deepEqual(feature.geometry, original.geometry, "server-native ward normalization preserves every published polygon");
  }
  const runtime = { fetch: fetcher, now: () => now, captureCache: new Map() };
  const boundaries = await readVotingSource(boundaryDoor, runtime);
  const polling = await readVotingSource(pollingDoor, runtime);
  assert.deepEqual(boundaries.blanks, []);
  assert.deepEqual(polling.blanks, []);
  assert.equal(boundaries.boundaries?.length, 1703);
  assert.equal(polling.sites.length, 683);
  const assignments = new Map(polling.sites.flatMap(site => (site.assignments ?? []).map(assignment => [
    `${assignment.ward}:${Number(assignment.precinct)}`, site.id,
  ] as const)));
  assert.equal(assignments.size, 1703);
  for (const boundary of boundaries.boundaries!) {
    assert.ok(assignments.has(`${boundary.ward}:${Number(boundary.precinct)}`), `${boundary.ward}:${boundary.precinct}`);
  }
  const heldPolling = mergeVotingSourceRead(undefined, pollingDoor, polling, now);
  const jurisdiction = mergeVotingSourceRead(heldPolling, boundaryDoor, boundaries, now);
  assert.equal(jurisdiction.sites.length, 683);
  assert.equal(jurisdiction.boundaries?.length, 1703);
  assert.notEqual(boundaryDoor.url, pollingDoor.url, "independent source groups preserve polling-list replacement semantics");
  const tomorrow = "2026-10-24T12:00:00.000Z";
  const refreshed = mergeVotingSourceRead(mergeVotingSourceRead(jurisdiction, pollingDoor, polling, tomorrow), boundaryDoor, boundaries, tomorrow);
  assert.equal(refreshed.sites.length, 683);
  assert.equal(refreshed.boundaries?.length, 1703);
  const officialPoint = JSON.parse(readFileSync(root + "polling-place-native-point.geojson", "utf8")).features[0];
  const [lng, lat] = officialPoint.geometry.coordinates;
  const contains = jurisdiction.boundaries!.filter(boundary => containsPoint([lng, lat], boundary.geometry));
  assert.equal(contains.length, 1, "the native official polling-facility point lies in one current division");
  const answer = await answerVotingSites({ jurisdictions: [jurisdiction] } as Parameters<typeof answerVotingSites>[0], {
    precision: "ADDRESS", point: { lat, lng }, divisionIds: [jurisdiction.ocdId], states: ["PA"], countyFips: ["42101"],
    countySubdivisionGeoids: [], towns: ["Philadelphia"], wards: [], aiannhGeoids: [], precincts: [],
  });
  assert.equal(answer.jurisdictions.length, 1);
  assert.equal(answer.jurisdictions[0]!.narrowing.kind, "EXACT");
  assert.equal(answer.jurisdictions[0]!.sites.length, 1);
  assert.equal(answer.jurisdictions[0]!.sites[0]!.hours, "7 A.M. to 8 P.M");
  console.info("Native point reader result:", contains[0]!.ward, contains[0]!.precinct, answer.jurisdictions[0]!.sites[0]!.name, answer.jurisdictions[0]!.sites[0]!.address);
});
