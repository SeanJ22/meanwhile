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
import { printWorkerPublicationReceipt } from "../lib/civic-data/worker-publication-tasks.ts";
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
  assert.deepEqual(result.gaps.map(g => g.key).sort(), ["official:unsaved"], "the state is the registry's scope, not a missing row");
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

test("a township that governs is published as a place with its governing body; a fictitious Census subdivision is neither a row nor a gap", async () => {
  const s = await store();
  const cousubUrl = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/1/query?geometry=43085";
  const saved = capture(`{"features":[{"attributes":{"NAME":"Sharon township","GEOID":"3904971248","LSAD":"44","FUNCSTAT":"A"}},{"attributes":{"NAME":"Columbus city","GEOID":"3904918000","LSAD":"25","FUNCSTAT":"F"}}]}`, cousubUrl);
  const township = `${OH}/county:franklin/place:sharon_township`;
  const result = await publishNationalPlaceSources({ store: s, now: NOW, geographyCaptures: [saved], sources: { officials: [] }, divisions: [
    { id: township, label: "Sharon township", divisionType: "cousub", geoid: "3904971248", sourceUrl: cousubUrl, sourceDataset: "TIGER_CB2023", lsad: "44", funcstat: "A" },
    { id: `${OH}/county:franklin/place:columbus_city`, label: "Columbus city", divisionType: "cousub", geoid: "3904918000", sourceUrl: cousubUrl, sourceDataset: "TIGER_CB2023", lsad: "25", funcstat: "F" },
  ] });
  assert.deepEqual(result.divisions, [township]);
  assert.deepEqual(result.bodies, [`${township}#governing`]);
  assert.deepEqual(result.gaps, []);
  const after = (await readRegistryRuntimePrior(s, NOW))!;
  const row = after.payload.registry.divisions.find(d => d.ocdId === township);
  assert.deepEqual([row?.divisionType, row?.funcstat, row?.parentOcdId], ["place", "A", `${OH}/county:franklin`]);
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
  assert.deepEqual([delivered.records, delivered.gaps.length, delivered.versionId === result.promotedVersionId], [0, 1, true]);
});

test("a missing seat body uses current Census bytes for a held division with an older source URL", async () => {
  const s = await store();
  // No official yet: the division publishes without its legislative seat body.
  await publishNationalPlaceSources({ store: s, now: NOW, divisions: [divisions[1]], geographyCaptures: geography, sources: { officials: [] } });
  const currentUrl = `${houseUrl}&vintage=current`;
  const current = capture(geography[1].evidence.text, currentUrl);
  const result = await publishNationalPlaceSources({ store: s, now: NOW,
    divisions: [{ ...divisions[1], sourceUrl: currentUrl }], geographyCaptures: [current], sources: { officials: [
      { discoveryId: "russo", divisionId: `${OH}/sldl:7`, name: "Allison Russo", officeTitle: "Representative", officialUrl: profileUrl, document: { url: profileUrl, capture: profile } },
    ] } });
  assert.deepEqual(result.divisions, [], "held division remains in place");
  assert.deepEqual(result.bodies, [`${OH}/sldl:7#seat`]);
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.members.flatMap(member => member.discoveryIds), ["russo"]);
  const after = (await readRegistryRuntimePrior(s, NOW))!;
  assert.equal(after.payload.registry.divisions.find(d => d.ocdId === divisions[1].id)?.provenance.sourceUrl, houseUrl);
  assert.equal(after.payload.registry.bodies.find(b => b.id === `${OH}/sldl:7#seat`)?.provenance.sourceUrl, currentUrl);
});

test("missing current geography leaves a body owed without blocking an independently sourced statewide official", async () => {
  const s = await store();
  await publishNationalPlaceSources({ store: s, now: NOW, divisions: [divisions[1]], geographyCaptures: geography, sources: { officials: [] } });
  const result = await publishNationalPlaceSources({ store: s, now: NOW, divisions, geographyCaptures: [], sources: { officials: [
    { discoveryId: "russo", divisionId: `${OH}/sldl:7`, name: "Allison Russo", officeTitle: "Representative", officialUrl: profileUrl, document: { url: profileUrl, capture: profile } },
    { discoveryId: "dewine", divisionId: OH, name: "Mike DeWine", officeTitle: "Governor", officialUrl: governorUrl, document: { url: governorUrl, capture: governor } },
  ] } });
  assert.deepEqual(result.bodies, []);
  assert.deepEqual(result.members.flatMap(member => member.discoveryIds), ["dewine"]);
  assert.ok(result.gaps.some(g => g.key === `division:${OH}/sldl:7` && g.detail.startsWith("DIVISION_SOURCE_NOT_SAVED:")));
});

test("a statewide office's holder: the same one is confirmed without losing their live facts; a new one owes the candidacy check again", async t => {
  const s = await store();
  const AZ = "ocd-division/country:us/state:az";
  const agUrl = "https://www.azag.gov/office/about-ag";
  const page = (name: string) => capture(`<html><head><title>About the Attorney General | Arizona Attorney General</title></head><body><h1>Attorney General ${name}</h1><p>Arizona's chief legal officer.</p></body></html>`, agUrl);
  const official = (name: string) => ({ discoveryId: `ag-${name}`, divisionId: AZ, name, officeTitle: "Attorney General", officialUrl: agUrl, document: { url: agUrl, capture: page(name) } });
  const azDivision = [{ id: AZ, label: "Arizona", divisionType: "state", geoid: "04", sourceUrl: agUrl, sourceDataset: "TIGER_CB2023" as const }];
  const before = (await readRegistryRuntimePrior(s, NOW))!;
  const live = before.payload.statewideExecutives.find(row => row.holder.id === "statewide:az/attorney-general")!;
  const same = await publishNationalPlaceSources({ store: s, now: NOW, divisions: azDivision, geographyCaptures: [], sources: { officials: [official("Kris Mayes")] } });
  assert.deepEqual([same.candidateId, same.gaps, same.members.map(m => m.discoveryIds)], [null, [], [["ag-Kris Mayes"]]], "confirmed, not replaced");
  assert.deepEqual((await readRegistryRuntimePrior(s, NOW))!.payload.statewideExecutives.find(row => row.holder.id === live.holder.id), live);
  const delivery = nationalDelivery([same]);
  assert.deepEqual([delivery.records, delivery.versionId, delivery.candidateId], [0, before.versionId, before.versionId]);
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => { lines.push(line); });
  assert.equal(await printWorkerPublicationReceipt(s, "registry-runtime-bindings", [], delivery, NOW), true,
    "an unchanged official-only pass emits its existing durable version instead of missing its receipt");
  const receipt = JSON.parse(lines[0].slice("RCD_RECEIPT=".length));
  assert.deepEqual([receipt.candidateId, receipt.delivered.records, receipt.delivered.gaps], [before.versionId, 0, 0]);

  const changed = await publishNationalPlaceSources({ store: s, now: NOW, divisions: azDivision, geographyCaptures: [], sources: { officials: [official("Jordan Reyes")] } });
  assert.deepEqual(changed.gaps, [], "a new holder of the office is not refused as a holder/candidacy mismatch");
  const after = (await readRegistryRuntimePrior(s, NOW))!;
  assert.equal(after.payload.statewideExecutives.find(row => row.holder.id === live.holder.id)?.holder.name, "Jordan Reyes");
  const bridge = after.payload.officialCandidacies.rows.find(row => row.holder.id === live.holder.id)!;
  assert.deepEqual([bridge.holder.name, bridge.status, bridge.candidacy], ["Jordan Reyes", "NOT_CHECKED", null], "the last holder's candidacy is never carried to the new one");
  assert.equal(nationalDelivery([same, changed]).records, 1, "reused holders do not inflate delivery in a mixed pass");
});

test("national delivery names the final roster candidate after earlier geography publications", () => {
  const delivered = nationalDelivery([{ candidateId: "cv-geography", promotedVersionId: "cv-roster",
    divisions: [], bodies: [], members: [{ bodyId: `${OH}/sldl:7#seat`, versionId: "cv-roster", discoveryIds: ["russo"] }], gaps: [] }]);
  assert.deepEqual([delivered.candidateId, delivered.versionId, delivered.records], ["cv-roster", "cv-roster", 1]);
});

test('state portrait publishes through the existing blob path and registry binding with its named official source and attribution', async () => {
  const s=await store();
  const imageUrl='https://images.example.org/allison-russo.jpg';
  const officialUrl='https://ohiohouse.gov/members/allison-russo';
  const page=capture(`<h1>Representative Allison Russo</h1><p>District 7</p><img alt="Allison Russo" src="${imageUrl}">`,officialUrl);
  const csv=capture(`name,image\nAllison Russo,${imageUrl}\n`,'https://data.openstates.org/people/current/oh.csv');
  // Existing decoder's structural JPEG fixture: 200x240, with a frame marker.
  const image=Buffer.from([0xff,0xd8,0xff,0xc0,0,17,8,0,240,0,200,3,1,0x11,0,2,0x11,0,3,0x11,0,0xff,0xd9]);
  const writes=new Map<string,Uint8Array>();let reads=0;
  const result=await publishNationalPlaceSources({store:s,now:NOW,divisions,geographyCaptures:geography,
    sources:{officials:[{discoveryId:'russo',divisionId:`${OH}/sldl:7`,name:'Allison Russo',officeTitle:'Representative',officialUrl,
      document:{url:officialUrl,capture:page},portrait:{imageUrl,captures:[csv,page]}}]},
    portraitRuntime:{read:async()=>{reads++;return image;},put:async(key,bytes)=>{writes.set(key,bytes);}}});
  assert.deepEqual(result.gaps,[]);
  const after=(await readRegistryRuntimePrior(s,NOW))!;
  const holder=after.payload.bodyRosters.find(r=>r.bodyId===`${OH}/sldl:7#seat`)!.members[0];
  const photo=after.payload.officialPhotos.photos.find(p=>p.officeholderId===holder.id)!;
  assert.ok(photo);assert.match(photo.url,/^\/api\/portraits\/officials\/[a-f0-9]{64}\.jpg$/);
  assert.equal(photo.verification?.basis,'OWN_PAGE');assert.equal(photo.license,null);assert.equal(photo.attribution,`Portrait: ${officialUrl}`);
  assert.equal(after.payload.rosterPhotos[holder.id],photo.url);assert.equal(reads,1);assert.equal(writes.size,1);
  assert.deepEqual(writes.values().next().value,image);
  const changed = registryRuntimeCandidate({contractId:'registry-runtime-bindings',scope:'MEMBERS',version:'unverified-photo-replacement',sourceThrough:NOW,
    sourceReceipt:{...after.sourceReceipt,sources:after.sourceReceipt.sources.map(source=>({...source,sourceClass:'OFFICIAL_PUBLISHER' as const}))},
    payload:{...after.payload,registry:{...after.payload.registry,divisions:[],bodies:[]},bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],
      officialCandidacies:{...after.payload.officialCandidacies,rows:[]},officialPhotos:{photos:[{...photo,url:'/api/portraits/officials/replaced.jpg',verification:undefined}]},
      rosterPhotos:{[holder.id]:'/api/portraits/officials/replaced.jpg'}}},{prior:after});
  assert.equal((changed.readModel as typeof after.payload).rosterPhotos[holder.id],photo.url,'an uncorroborated replacement retains the published portrait');
  assert.ok(changed.excludedFacts?.some(f=>f.key===`official-photo:${holder.id}` && /source binding/.test(f.detail ?? '')));
});

test('a non-official portrait without corroboration stays a gap while its official still publishes', async () => {
    const s=await store(),imageUrl='https://images.example.org/allison-russo.jpg',officialUrl='https://ohiohouse.gov/members/allison-russo';
    const page=capture(`<h1>Representative Allison Russo</h1><p>District 7</p><img alt="Allison Russo" src="${imageUrl}">`,officialUrl);
    const result=await publishNationalPlaceSources({store:s,now:NOW,divisions,geographyCaptures:geography,
      sources:{officials:[{discoveryId:'russo',divisionId:`${OH}/sldl:7`,name:'Allison Russo',officeTitle:'Representative',officialUrl,
        document:{url:officialUrl,capture:page},portrait:{imageUrl,captures:[capture(`<h1>Allison Russo</h1><img alt="Allison Russo" src="${imageUrl}">`,"https://portraits.example/people/russo")]}}]},
      portraitRuntime:{read:async()=>{throw Error('An unverified photo must not be downloaded');},put:async()=>{throw Error('must not store');}}});
    assert.ok(result.members.some(m=>m.discoveryIds.includes('russo')));
    assert.ok(result.gaps.some(g=>g.key==='portrait:russo' && g.detail==='PORTRAIT_SECOND_SOURCE_MISSING'),JSON.stringify(result.gaps));
});
