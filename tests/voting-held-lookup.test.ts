import assert from "node:assert/strict";
import test from "node:test";
import { projectVotingJurisdiction, votingJurisdictionCovers } from "../lib/ballot/voting-answer.ts";
import { addCensusVotingGeographies, votingPlaceFromZip } from "../lib/ballot/voting-answer-geography.ts";
import { POST } from "../app/api/voting-sites/route.ts";
import { withReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import { holdVotingRawEvidence } from "../lib/ballot/voting-source-publication.ts";
import { votingFailureDetail } from "../lib/ballot/voting-errors.ts";
import { readVotingBoundaries, votingBoundaryBlanks } from "../lib/ballot/voting-source-boundaries.ts";
import { votingFetchSession } from "../lib/ballot/voting-source-fetch.ts";
import { mergeVotingSiteRows, type VotingSitesFile } from "../lib/ballot/voting-sites.ts";

const at = "2026-10-20T00:00:00.000Z";
const source = { publisher: "Protocol fixture", url: "https://protocol.example.gov/polling", checkedAt: at };
// Controlled protocol data exercises requests and persistence, and asserts no real precinct assignment.
const file: VotingSitesFile = { generatedAt: "2026-10-20", jurisdictions: [{
  ocdId: "ocd-division/country:us/state:tx/county:harris", state: "TX", countyFips: "48201", name: "Protocol county",
  model: "ASSIGNED", election: "2026 General Election", sourceOrg: source.publisher, sourceUrl: source.url, collectedAt: "2026-10-20", refusal: null,
  sites: ["ELECTION_DAY", "EARLY_VOTING", "DROP_BOX"].map((kind, index) => ({ id: `protocol-${index}`, name: `Protocol site ${index}`, address: `Protocol location ${index}`,
    room: null, lat: 29.76, lng: -95.37, kind: kind as "ELECTION_DAY" | "EARLY_VOTING" | "DROP_BOX", election: null, serves: null,
    precinct: kind === "ELECTION_DAY" ? "protocol-1" : undefined, countyFips: "48201", hours: "Protocol hours", sources: [source] })),
  boundaries: [{ precinct: "protocol-1", countyFips: "48201", kind: "OFFICIAL_PRECINCT", source,
    geometry: { type: "Polygon", coordinates: [[[-96, 29], [-95, 29], [-95, 30], [-96, 30], [-96, 29]]] } }],
}] };

async function holding(): Promise<ReaderAuthorityEdgeBundle> {
  const store = new MemoryRoutineDataStore();
  const candidate = votingSitesCandidate({ state: "TX", current: file, prior: null, failures: [],
    acquisition: await holdVotingRawEvidence({ rawBodies: [{ url: source.url, contentType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(file)) }] }),
    successfulAuthorityReads: 1, requestedUrl: source.url, finalUrl: source.url, retrievedAt: at });
  const outcome = await processRegisteredManualCandidate(store, "voting-sites:TX", candidate, at);
  assert.ok(outcome.promoted);
  const projection = outcome.promoted;
  return { edgeOnly: true, stateAuthorities: { families: new Set(["voting-sites"]), load: async (family, state) => {
    assert.equal(family, "voting-sites"); assert.equal(state, "TX");
    return { kind: "PROMOTED_POINTERS", entries: [{ kind: "PROMOTED", projection, attested: {
      recordClass: "VOTING_SITE", scope: candidate.scope, versionId: candidate.id, payloadSha256: candidate.normalization.normalizedHash!,
      retrievedAt: at, staleAtRetrieval: false, version: candidate.temporal.version, sourceThrough: candidate.temporal.sourceThrough,
    } }] };
  } } };
}

test("street requests use one Census geocode, held polygons and held sites; ZIP requests need no external lookup", async () => {
  const edge = await holding(), previous = globalThis.fetch, requests: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.origin !== "https://geocoding.geo.census.gov") {
      assert.ok(/neon|proxy|localhost/.test(url.hostname), "Only the anonymous count database may be called alongside Census");
      return Response.json({ fields: [], rows: [], rowCount: 0, command: "INSERT", rowAsArray: false });
    }
    requests.push(url.origin + url.pathname);
    assert.equal(url.origin, "https://geocoding.geo.census.gov");
    return Response.json({ result: { addressMatches: [{ coordinates: { x: -95.37, y: 29.76 }, geographies: {
      Counties: [{ STATE: "48", GEOID: "48201", NAME: "Harris County" }],
    } }] } });
  };
  try {
    const response = await withReaderAuthorityEdge(edge, () => POST(new Request("http://localhost/api/voting-sites", {
      method: "POST", body: JSON.stringify({ address: "Private request input" }),
    })));
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.jurisdictions[0].narrowing.kind, "EXACT");
    assert.equal(answer.jurisdictions[0].sites.length, 3);
    assert.equal(answer.jurisdictions[0].boundaries, undefined);
    assert.equal(JSON.stringify(answer).includes("Private request input"), false);
    const zip = await withReaderAuthorityEdge(edge, () => POST(new Request("http://localhost/api/voting-sites", { method: "POST", body: JSON.stringify({ address: "77002" }) })));
    assert.equal(zip.status, 200);
    assert.equal((await zip.json()).jurisdictions[0].sites.length, 3);
    const postal = await withReaderAuthorityEdge(edge, () => POST(new Request("http://localhost/api/voting-sites", { method: "POST", body: JSON.stringify({ address: "77201" }) })));
    assert.equal(postal.status, 200);
    assert.equal((await postal.json()).jurisdictions[0].sites.length, 3, "the held Houston postal alias must return the same held county sites");
    assert.equal(requests.length, 1);
  } finally { globalThis.fetch = previous; }
});

test("an unrecorded place is a coverage gap and does not become an infrastructure error", async () => {
  const edge: ReaderAuthorityEdgeBundle = { edgeOnly: true, stateAuthorities: { families: new Set(["voting-sites"]), load: async () => ({ kind: "PROMOTED_POINTERS",
    entries: [{ kind: "NOT_RECORDED", recordClass: "VOTING_SITE", scope: "US-TX:voting-sites" }] }) } };
  const response = await withReaderAuthorityEdge(edge, () => POST(new Request("http://localhost/api/voting-sites", { method: "POST", body: JSON.stringify({ address: "77002" }) })));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).outsideCoverage, true);
});

test("a street's incorporated municipality remains usable when its county subdivision has a different name", () => {
  // Protocol geography tests the Census response shape, without asserting a real precinct assignment.
  const place = addCensusVotingGeographies({ ...votingPlaceFromZip([]), precision: "ADDRESS" }, {
    result: { addressMatches: [{ geographies: {
      Counties: [{ STATE: "17", GEOID: "17031", NAME: "Protocol County" }],
      "County Subdivisions": [{ STATE: "17", GEOID: "1703100000", NAME: "Protocol Township" }],
      "Incorporated Places": [{ STATE: "17", GEOID: "1700000", NAME: "Protocol City city", BASENAME: "Protocol City" }],
    } }] },
  });
  assert.equal(votingJurisdictionCovers({ ...file.jurisdictions[0], state: "IL", countyFips: "17031",
    ocdId: "ocd-division/country:us/state:il/county:protocol/place:protocol_city" }, place), true);
});

test("error diagnostics preserve the cause while removing the typed address and URL credentials", () => {
  const detail = votingFailureDetail(new Error("Lookup failed for Private request input: https://user:secret@example.gov/lookup?address=Private%20request%20input", { cause: new Error("HTTP 502") }), "Private request input");
  assert.match(detail, /HTTP 502/);
  assert.doesNotMatch(detail, /Private|secret|user:|address=/);
});

test("held precinct acquisition checks source polygons and leaves missing polling assignments open", async () => {
  const door = { id: "protocol-boundaries", publisher: source.publisher, url: "https://protocol.example.gov/precincts.geojson", shape: "json" as const, covers: [],
    scope: { state: "TX", ocdId: file.jurisdictions[0].ocdId, name: "Protocol county", countyFips: "48201" }, electionDate: "2026-11-03", electionPageUrl: source.url, boundaryLayer: true };
  const session = votingFetchSession({ fetch: async input => new Response(String(input).endsWith("robots.txt") ? "" : JSON.stringify({ type: "FeatureCollection",
    features: [{ type: "Feature", properties: { precinct: "protocol-1" }, geometry: file.jurisdictions[0].boundaries![0].geometry }] })) });
  const boundaries = await readVotingBoundaries(door, session, source);
  assert.equal(boundaries[0].precinct, "protocol-1");
  assert.ok(session.rawBodies.length);
  assert.equal(votingBoundaryBlanks([door.scope], [{ ...file.jurisdictions[0], boundaries }], [door]).length, 0);
  assert.match(votingBoundaryBlanks([door.scope], [{ ...file.jurisdictions[0], sites: [], boundaries }], [door])[0].owed, /1 published precinct/);
});


test("ZIP town matching preserves the distinction between a borough and its same-named township", () => {
  const place = votingPlaceFromZip(["ocd-division/country:us/state:nj/county:morris", "ocd-division/country:us/state:nj/county:morris/place:mendham_township"]);
  const jurisdiction = { ...file.jurisdictions[0], state: "NJ", countyFips: undefined };
  assert.equal(votingJurisdictionCovers({ ...jurisdiction, ocdId: "ocd-division/country:us/state:nj/county:morris/place:mendham_township" }, place), true);
  assert.equal(votingJurisdictionCovers({ ...jurisdiction, ocdId: "ocd-division/country:us/state:nj/county:morris/place:mendham" }, place), false);
});

test("a shared early-voting location does not become another precinct's Election Day polling place", () => {
  const j = file.jurisdictions[0];
  const place = { ...votingPlaceFromZip(["ocd-division/country:us/state:tx/county:harris"]), precision: "ADDRESS" as const, point: { lat: 29.76, lng: -95.37 } };
  const other = { ...j.sites[0], id: "another-precinct", precinct: "protocol-2", precincts: ["protocol-2"],
    kinds: ["ELECTION_DAY" as const, "EARLY_VOTING" as const], schedules: [
      { kind: "ELECTION_DAY" as const, hours: "Election Day hours", source }, { kind: "EARLY_VOTING" as const, hours: "Early hours", source }] };
  const answer = projectVotingJurisdiction({ ...j, sites: [...j.sites, other] }, place);
  assert.equal(answer.narrowing.kind, "EXACT");
  const shared = answer.sites.find(site => site.id === other.id)!;
  assert.deepEqual(shared.kinds, ["EARLY_VOTING"]);
  assert.equal(shared.hours, "Early hours");
  assert.equal(shared.precinct, undefined);
});

test("a held ward and precinct select the source's entrance without another geography lookup", () => {
  const j = file.jurisdictions[0];
  const assigned = { ...j.sites[0], ward: "2", assignments: [{ precinct: "protocol-1", ward: "2", name: "Protocol east entrance", room: "Protocol room", source }] };
  const answer = projectVotingJurisdiction({ ...j, sites: [assigned], boundaries: j.boundaries!.map(boundary => ({ ...boundary, ward: "2" })) },
    { ...votingPlaceFromZip(["ocd-division/country:us/state:tx/county:harris"]), precision: "ADDRESS", point: { lat: 29.76, lng: -95.37 } });
  assert.equal(answer.narrowing.kind, "EXACT");
  assert.equal(answer.sites[0].name, "Protocol east entrance");
  assert.equal(answer.sites[0].room, "Protocol room");
});

test("official site facts outrank newer secondary facts and a failed geocode cannot erase a held publisher point", () => {
  const earlier = { ...file.jurisdictions[0].sites[0], geocodeSource: "PUBLISHER" as const, sources: [{ ...source, official: true }] };
  const secondary = { ...earlier, name: "Protocol secondary name", lat: null, lng: null,
    sources: [{ ...source, url: "https://protocol.example.org/locations", official: false, checkedAt: "2026-10-21" }] };
  assert.equal(mergeVotingSiteRows(earlier, secondary).name, earlier.name);
  const newest = { ...secondary, name: "Protocol updated official name", sources: [{ ...source, official: true, checkedAt: "2026-10-22" }] };
  const merged = mergeVotingSiteRows(earlier, newest);
  assert.equal(merged.name, newest.name);
  assert.equal(merged.lat, earlier.lat);
  assert.equal(merged.geocodeSource, "PUBLISHER");
});
