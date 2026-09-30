import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import test from "node:test";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate } from "../lib/registry/runtime-data-plane.ts";
import { CENSUS_PLACEHOLDER_LABELS } from "../lib/registry/census-placeholders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { nationalDelivery, publishNationalPlaceSources, type NationalDivisionInput } from "../lib/civic-data/worker-national-publication.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

const NOW = "2026-09-29T20:00:00.000Z";
const OH = "ocd-division/country:us/state:oh";

function capture(text: string, url: string, observedAt = "2026-09-29T19:00:00.000Z"): WorkerPublicationCapture {
  const contentHash = `sha256-${createHash("sha256").update(text).digest("hex")}`;
  return { evidence: { artifactId: `ar-${contentHash.slice(7, 31)}`, contentHash, text, acquiredByAttemptId: "at-place", canonicalUrl: url,
    retrievedAt: observedAt, sourceId: new URL(url).hostname, methodRouteId: "place:census" }, observedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
}

/** The recorded registry, with the deployed Census placeholder correction replayed (as the roster tests do). */
async function store() {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const s = new MemoryRoutineDataStore();
  Object.assign(s, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  const imported = (await readRegistryRuntimePrior(s, NOW))!;
  const divisions = imported.payload.registry.divisions.filter(row => CENSUS_PLACEHOLDER_LABELS[row.label]).map(row => ({ ...row, label: CENSUS_PLACEHOLDER_LABELS[row.label] }));
  const corrected = registryRuntimeCandidate({ contractId: "registry-runtime-bindings", version: "fixture-census-correction", sourceThrough: NOW,
    sourceReceipt: { contractVersion: 1, reviewedAt: NOW, reviewedBy: "recorded-fixture-control", sources: [...new Set(divisions.map(row => row.provenance!.sourceUrl!))].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "U.S. Census Bureau", sourceClass: "OFFICIAL_PUBLISHER" as const, retrievedAt: NOW, httpStatus: 200, rawHash: createHash("sha256").update(JSON.stringify(divisions)).digest("hex"), reviewedEvidence: "Offline fixture: Census LEA 99997 means no school district." })) },
    payload: { ...imported.payload, registry: { ...imported.payload.registry, divisions, bodies: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { ...imported.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior: imported });
  assert.ok((await processRegisteredManualCandidate(s, "registry-runtime-bindings", corrected, NOW, imported.versionId)).promoted);
  return s;
}

const placeUrl = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query?geometry=43215";
const houseUrl = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2/query?geometry=43215";
const geography = [
  capture(`{"features":[{"attributes":{"NAME":"Columbus city","GEOID":"3918000","LSAD":"25","FUNCSTAT":"A"}}]}`, placeUrl),
  capture(`{"features":[{"attributes":{"NAME":"State House District 7","GEOID":"39007"}}]}`, houseUrl),
];
const divisions: NationalDivisionInput[] = [
  { id: `${OH}/place:columbus`, label: "Columbus city", divisionType: "place", geoid: "3918000", sourceUrl: placeUrl, sourceDataset: "TIGER_CB2023", lsad: "25", funcstat: "A" },
  { id: `${OH}/sldl:7`, label: "State House District 7", divisionType: "sldl", geoid: "39007", sourceUrl: houseUrl, sourceDataset: "TIGER_CB2023" },
  { id: OH, label: "Ohio", divisionType: "state", geoid: "39", sourceUrl: placeUrl, sourceDataset: "TIGER_CB2023" },
];
const profileUrl = "https://ohiohouse.gov/members/allison-russo";
const governorUrl = "https://governor.ohio.gov/about/governor-mike-dewine";
const governor = capture("<html><head><title>Governor Mike DeWine | Governor of Ohio</title></head><body><h1>Governor Mike DeWine</h1><p>The 70th Governor of the State of Ohio.</p></body></html>", governorUrl);
const profile = capture(`<html><head><title>Representative Allison Russo | Ohio House</title></head><body><h1>Representative Allison Russo</h1><p>District 7</p></body></html>`, profileUrl);

test("a place with no prepared registry gets its Census divisions, their bodies and its verified officials through the registry door (§3)", async () => {
  const s = await store();
  const result = await publishNationalPlaceSources({ store: s, now: NOW, divisions, geographyCaptures: geography, sources: { officials: [
    { discoveryId: "russo", divisionId: `${OH}/sldl:7`, name: "Allison Russo", officeTitle: "Representative", officialUrl: profileUrl, document: { url: profileUrl, capture: profile } },
    { discoveryId: "dewine", divisionId: OH, name: "Mike DeWine", officeTitle: "Governor", officialUrl: governorUrl, document: { url: governorUrl, capture: governor } },
    { discoveryId: "unsaved", divisionId: `${OH}/sldl:7`, name: "Someone Else", officeTitle: "Representative", officialUrl: profileUrl, document: { url: profileUrl } },
  ] } });
  assert.deepEqual(result.divisions, [`${OH}/place:columbus`, `${OH}/sldl:7`]);
  assert.deepEqual(result.bodies, [`${OH}/place:columbus#governing`, `${OH}/sldl:7#seat`]);
  assert.deepEqual(result.members.map(m => [m.bodyId, m.discoveryIds]), [[OH, ["dewine"]], [`${OH}/sldl:7#seat`, ["russo"]]]);
  assert.deepEqual(result.gaps.map(g => g.key).sort(), ["division:" + OH, "official:unsaved"]);
  assert.ok(result.promotedVersionId);
  // A door package speaks only for its own members: the thousands it omits are retained, not listed as excluded (the 313 MB candidate).
  const written = (await s.readCandidate(result.candidateId!))!;
  assert.equal((written.candidate.excludedFacts ?? []).filter(f => f.code === "MANUAL_MEMBER_REMOVAL_EVIDENCE_MISSING").length, 0);
  const after = (await readRegistryRuntimePrior(s, NOW))!;
  const roster = after.payload.bodyRosters.find(r => r.bodyId === `${OH}/sldl:7#seat`);
  assert.deepEqual(roster?.members.map(m => [m.name, m.officeTitle]), [["Allison Russo", "Representative"]]);
  assert.equal(roster?.sourceUrl, profileUrl);
  const executive = after.payload.statewideExecutives.find(row => row.stateOcdId === OH);
  assert.deepEqual([executive?.holder.id, executive?.holder.name, executive?.holder.officeTitle, executive?.sourceUrl], ["statewide:oh/governor", "Mike DeWine", "Governor", governorUrl]);
  assert.equal(after.payload.registry.bodies.find(b => b.id === `${OH}/place:columbus#governing`)?.name, null, "a council's name is a sourced fact, never minted");

  const again = await publishNationalPlaceSources({ store: s, now: NOW, divisions, geographyCaptures: geography, sources: { officials: [] } });
  assert.deepEqual([again.divisions, again.bodies, again.candidateId], [[], [], null], "a second call with the same evidence adds nothing");
});

test("an official whose page does not name the district, and a division its saved Census response does not show, stay gaps", async () => {
  const s = await store();
  const elsewhere = capture(profile.evidence.text.replace("District 7", "District 8"), profileUrl);
  const result = await publishNationalPlaceSources({ store: s, now: NOW, geographyCaptures: geography,
    divisions: [...divisions.slice(0, 2), { ...divisions[0], id: `${OH}/place:bexley`, label: "Bexley city", geoid: "3905438" }],
    sources: { officials: [{ discoveryId: "russo", divisionId: `${OH}/sldl:7`, name: "Allison Russo", officeTitle: "Representative", officialUrl: profileUrl, document: { url: profileUrl, capture: elsewhere } }] } });
  assert.deepEqual(result.members, []);
  assert.match(result.gaps.find(g => g.key === "official:russo")!.detail, /ROSTER_PAGE_NOT_THIS_BODY/);
  assert.equal(result.gaps.find(g => g.key === `division:${OH}/place:bexley`)?.detail, "DIVISION_NOT_ON_SAVED_SOURCE");
});

test("an official page whose text is not the saved bytes is a named gap, and the pass reports what it delivered", async () => {
  const s = await store();
  const altered = { ...governor, evidence: { ...governor.evidence, text: governor.evidence.text.replace("DeWine</h1>", "DeWine </h1>") } };
  const result = await publishNationalPlaceSources({ store: s, now: NOW, divisions, geographyCaptures: geography, sources: { officials: [
    { discoveryId: "dewine", divisionId: OH, name: "Mike DeWine", officeTitle: "Governor", officialUrl: governorUrl, document: { url: governorUrl, capture: altered } }] } });
  assert.match(result.gaps.find(g => g.key === "official:dewine")!.detail, /^OFFICIAL_PAGE_UNUSABLE:CONTENT_HASH_MISMATCH/);
  const delivered = nationalDelivery([result]);
  assert.deepEqual([delivered.records, delivered.gaps.length, delivered.versionId === result.promotedVersionId], [0, 2, true]);
});
