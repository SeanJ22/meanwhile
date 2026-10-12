import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
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

test("national place publication keeps legislative people on their single state authority",async()=>{
  const s=await store();
  const result=await publishNationalPlaceSources({store:s,now:NOW,divisions,geographyCaptures:geography,sources:{officials:[{discoveryId:"russo",divisionId:`${OH}/sldl:7`,name:"Allison Russo",officeTitle:"Representative",officialUrl:profileUrl,document:{url:profileUrl,capture:profile}}]}});
  assert.ok(result.divisions.includes(`${OH}/sldl:7`));
  assert.equal(result.bodies.some(id=>id.endsWith("#seat")),false);
  assert.ok(result.gaps.some(row=>row.detail==="STATE_PEOPLE_SOURCE_REFRESH_OWNS_LEGISLATIVE_MEMBERS"));
  assert.equal((await readRegistryRuntimePrior(s,NOW))!.payload.bodyRosters.some(row=>row.bodyId===`${OH}/sldl:7#seat`),false);
});

test("statewide successor identities and candidacy checks cannot inherit the prior actor",async()=>{
  const s=await store();
  const official=(name:string)=>({discoveryId:"governor",divisionId:OH,name,officeTitle:"Governor",officialUrl:governorUrl,document:{url:governorUrl,capture:capture(`<h1>Governor ${name}</h1><p>Governor of Ohio</p>`,governorUrl)}});
  const run=(name:string)=>publishNationalPlaceSources({store:s,now:NOW,divisions,geographyCaptures:geography,sources:{officials:[official(name)]}});
  const first=await run("Mike DeWine");assert.deepEqual(first.gaps,[]);
  const old=(await readRegistryRuntimePrior(s,NOW))!.payload.statewideExecutives.find(row=>row.stateOcdId===OH)!;
  const same=await run("Mike DeWine");assert.equal(same.candidateId,null);
  const changed=await run("Jordan Reyes");assert.deepEqual(changed.gaps,[]);
  const after=(await readRegistryRuntimePrior(s,NOW))!.payload;
  const current=after.statewideExecutives.filter(row=>row.stateOcdId===OH);
  assert.equal(current.length,1);assert.notEqual(current[0].holder.id,old.holder.id);
  assert.equal(current[0].holder.name,"Jordan Reyes");
  assert.equal(after.officialCandidacies.rows.find(row=>row.holder.id===current[0].holder.id)?.status,"NOT_CHECKED");
  assert.equal(after.officialCandidacies.rows.some(row=>row.holder.id===old.holder.id),false);
});

test("saved own-page portraits publish by the exact accepted roster identity and actual normalized pixels",async()=>{
  const s=await store(),name="Jane Doe",url="https://www.columbus.gov/council/jane-doe",imageUrl="https://www.columbus.gov/photos/jane-doe.jpg";
  const page=capture(`<title>Columbus City Council</title><h1>Columbus City Council</h1><h2>Councilmember Jane Doe</h2><img alt="Jane Doe" src="${imageUrl}">`,url);
  const original=await sharp({create:{width:200,height:240,channels:3,background:"#336699"}}).withMetadata({orientation:1}).jpeg().toBuffer();
  const stored=new Map<string,Uint8Array>();
  const result=await publishNationalPlaceSources({store:s,now:NOW,divisions,geographyCaptures:geography,sources:{officials:[{discoveryId:"jane-native",divisionId:`${OH}/place:columbus`,name,officeTitle:"Councilmember",officialUrl:url,document:{url,capture:page},portrait:{imageUrl,captures:[page]}}]},portraitRuntime:{read:async()=>original,put:async(key,bytes)=>{stored.set(key,bytes);}}});
  assert.deepEqual(result.gaps,[]);
  const after=(await readRegistryRuntimePrior(s,NOW))!.payload;
  const member=after.bodyRosters.find(row=>row.bodyId===`${OH}/place:columbus#governing`)!.members[0];
  const photo=after.officialPhotos.photos.find(row=>row.officeholderId===member.id)!;
  assert.ok(photo);assert.equal(photo.verification?.personId,member.personId ?? member.id);assert.match(photo.url,/\.webp$/);
  assert.equal(stored.size,1);const bytes=[...stored.values()][0];
  const decoded=await sharp(bytes).raw().toBuffer({resolveWithObject:true});assert.equal(decoded.info.width,200);assert.equal(decoded.info.height,240);
  assert.equal((await sharp(bytes).metadata()).exif,undefined);
});

test("a corrupted saved source cannot replace the independently held official",async()=>{
  const s=await store();
  const altered={...governor,evidence:{...governor.evidence,text:governor.evidence.text+" corruption"}};
  const result=await publishNationalPlaceSources({store:s,now:NOW,divisions,geographyCaptures:geography,sources:{officials:[{discoveryId:"dewine",divisionId:OH,name:"Mike DeWine",officeTitle:"Governor",officialUrl:governorUrl,document:{url:governorUrl,capture:altered}}]}});
  assert.ok(result.gaps.some(row=>row.detail.includes("CONTENT_HASH_MISMATCH")));
  assert.equal(nationalDelivery([result]).records,0);
});
