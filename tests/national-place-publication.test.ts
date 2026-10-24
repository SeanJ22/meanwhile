import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { factClocks } from "../lib/facts/clocks.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { factDb } from "./helpers/fact-db.ts";
import sharp from "sharp";

import { readRegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { nationalDelivery, publishNationalPlaceSources, type NationalDivisionInput } from "../lib/civic-data/worker-national-publication.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { stateRegistryRuntimeContractId } from "../lib/civic-data/state-scopes.ts";
import { rowKeyedCivicRecordsFor } from "../lib/civic-data/changes.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { trustedLkgImportUrl } from "../lib/civic-data/trusted-lkg-import.ts";
import { withStateRecordHashes } from "../lib/civic-data/state-publication.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { ROW_KEYED_CIVIC_CHANGE_CONTRACT } from "../lib/civic-data/changes.ts";
import { trustedLkgCandidateEnvelopeSha256 } from "../lib/civic-data/trusted-lkg-import.ts";
import { trustedLkgValidatorIds } from "../lib/civic-data/trusted-lkg-import.ts";
import { trustedLkgCandidateId } from "../lib/civic-data/trusted-lkg-import.ts";
import type { CandidateVersionRecord } from "../lib/civic-data/types.ts";
import type { PromotedProjection } from "../lib/civic-data/types.ts";
import { STATE_BINDING_REFRESH_TASKS } from "../lib/civic-data/state-binding-refresh-contracts.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { CENSUS_STATE_IDENTITIES_URL, refreshStateBinding } from "../lib/civic-data/state-binding-refresh.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

function stateRegistryRuntimeStore(state: string, store = new MemoryRoutineDataStore(), value?: RegistryRuntimeReadModel): MemoryRoutineDataStore {
  const original = registryTransferImport();
  const payload = registryFixtureForState(state, value), scope = stateRegistryRuntimeScope(state), contractId = stateRegistryRuntimeContractId(state);
  const civicRecords = rowKeyedCivicRecordsFor("REGISTRY_RUNTIME_BINDING", payload), digest = canonicalCivicDataHash(payload);
  const candidate = { ...original.record.candidate, scope,
    retrieval: { ...original.record.candidate.retrieval, requestedUrl: trustedLkgImportUrl(contractId) },
    normalization: { ...original.record.candidate.normalization, normalizedHash: digest, normalizedPayloadHash: digest,
      inputRecords: civicRecords.length, outputRecords: civicRecords.length, droppedRecords: 0 },
    normalizedPayload: payload, readModel: payload, civicRecords, identities: [],
    horizon: { ...original.record.candidate.horizon, returnedRecords: civicRecords.length },
    sourceProjectionEvidence: { kind: "SOURCE_PROJECTION_CONTRACT" as const, sourceId: original.record.candidate.sourceId, recordClass: original.record.candidate.recordClass, scope },
  };
  Object.assign(candidate, { normalization: withStateRecordHashes(candidate).normalization });
  candidate.changeSet = candidateChangeSet(candidate, null, ROW_KEYED_CIVIC_CHANGE_CONTRACT);
  candidate.bootstrapImport = { ...original.record.candidate.bootstrapImport!, contractId, scope,
    normalizedPayloadSha256: digest, readModelSha256: digest, candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(candidate), validatorIds: trustedLkgValidatorIds(candidate) };
  candidate.id = trustedLkgCandidateId(candidate.bootstrapImport);
  const receipt = { ...original.record.receipt!, candidateId: candidate.id, scope };
  const record = { ...original.record, candidate, receipt, promotedVersion: candidate.id, lastKnownGoodVersion: candidate.id };
  const projection = { ...original.projection, key: `REGISTRY_RUNTIME_BINDING:${scope}`, scope, versionId: candidate.id,
    lastKnownGoodVersionId: candidate.id, payload, receipt };
  const held = store as unknown as { candidates: Map<string, CandidateVersionRecord>; promotions: Map<string, PromotedProjection> };
  held.candidates.set(candidate.id, record);
  held.promotions.set(projection.key, projection);
  return store;
}

const NOW = "2026-09-29T20:00:00.000Z";
const OH = "ocd-division/country:us/state:oh";

function capture(text: string, url: string, observedAt = "2026-09-29T19:00:00.000Z"): WorkerPublicationCapture {
  const contentHash = `sha256-${createHash("sha256").update(text).digest("hex")}`;
  return { evidence: { artifactId: `ar-${contentHash.slice(7, 31)}`, contentHash, text, acquiredByAttemptId: "at-place", canonicalUrl: url,
    retrievedAt: observedAt, sourceId: new URL(url).hostname, methodRouteId: "place:census" }, observedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
}

const clocks = factClocks(null);
async function seeded() {
  const facts = await factDb();
  await ensureFactEntities(facts, join(import.meta.dirname, ".."), ["oh"]);
  return facts;
}

async function store() {
  return stateRegistryRuntimeStore("OH");
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

test("navigation text is rejected before a statewide record enters publication", async () => {
  const s = await store(), facts = await seeded();
  const result = await publishNationalPlaceSources({ state: "OH", store: s, facts, clocks, now: NOW, divisions, geographyCaptures: geography,
    sources: { officials: [{ discoveryId: "menu-label", divisionId: OH, name: "Actions", officeTitle: "Governor", officialUrl: governorUrl,
      document: { url: governorUrl, capture: capture("<h1>Ohio Governor</h1><nav>Actions</nav>", governorUrl) } }] } });
  assert.ok(result.gaps.some(row => row.detail === "STATEWIDE_OFFICIAL_NOT_A_PERSON"));
  assert.equal((await readRegistryRuntimePrior(s, NOW, "OH"))!.payload.statewideExecutives.some(row => row.holder.name === "Actions"), false);
});

test("an unrelated scheduled publication cleans malformed carried statewide rows and cannot restore them on the next run", async () => {
  const fixture = registryFixtureForState("OH");
  const holder = { id: "statewide:oh/menu", name: "Actions", officeTitle: "Governor", partyLabel: null, websiteUrl: governorUrl, sourceUrl: governorUrl,
    email: null, phone: null, contactFormUrl: null, photoUrl: null, campaignUrl: null, termEnd: null, birthDate: null };
  const bad = { stateOcdId: OH, holder, sourceUrl: governorUrl, sourceOrg: "Ohio Governor", collectedAt: "2026-09-28", verification: "PAGE_FETCHED" as const };
  const s = stateRegistryRuntimeStore("OH", new MemoryRoutineDataStore(), { ...fixture, statewideExecutives: [...fixture.statewideExecutives, bad] });
  const facts = await seeded();
  const result = await publishNationalPlaceSources({ state: "OH", store: s, facts, clocks, now: NOW, divisions, geographyCaptures: geography, sources: { officials: [] } });
  assert.deepEqual(result.gaps, []);
  assert.ok(result.promotedVersionId);
  assert.equal((await readRegistryRuntimePrior(s, NOW, "OH"))!.payload.statewideExecutives.some(row => row.holder.id === holder.id), false);
  const task = STATE_BINDING_REFRESH_TASKS.find(task => task.scope === stateRegistryRuntimeScope("OH"))!;
  const next = new Date(Date.parse(NOW) + task.cadenceMs).toISOString();
  const clock = await s.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(routineTaskDue(task, clock, Date.parse(next)), true, "the standing daily binding clock admits the next run");
  const bytes = new Uint8Array(readFileSync(new URL("fixtures/reference/census-state-identities.txt", import.meta.url)));
  const release: KnownRelease = { sourceId: "registry-reviewed-bindings", releaseId: "census-state-identities", bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"), requestedUrl: CENSUS_STATE_IDENTITIES_URL, finalUrl: CENSUS_STATE_IDENTITIES_URL,
    httpStatus: 200, retrievedAt: next, sourceObservedAt: next, checkedAt: next, lastCheckStatus: 200,
    etag: null, lastModified: null, contentType: "text/plain", reused: false };
  const scheduled = await refreshStateBinding({ state: "OH", store: s }, { now: () => next, acquire: async () => release, printReceipt: () => {} });
  assert.ok(scheduled.promoted || scheduled.confirmed, JSON.stringify(scheduled.candidate.receipt));
  assert.equal((await readRegistryRuntimePrior(s, next, "OH"))!.payload.statewideExecutives.some(row => row.holder.id === holder.id), false);
  const again = await publishNationalPlaceSources({ state: "OH", store: s, facts, clocks, now: NOW, divisions, geographyCaptures: geography,
    sources: { officials: [{ discoveryId: "menu-label", divisionId: OH, name: "Actions", officeTitle: "Governor", officialUrl: governorUrl,
      document: { url: governorUrl, capture: capture("<h1>Ohio Governor</h1><nav>Actions</nav>", governorUrl) } }] } });
  assert.ok(again.gaps.some(row => row.detail === "STATEWIDE_OFFICIAL_NOT_A_PERSON"));
  assert.equal((await readRegistryRuntimePrior(s, NOW, "OH"))!.payload.statewideExecutives.some(row => row.holder.id === holder.id), false);
});

test("normal publication removes duplicate carried offices and keeps contacts plus stable aliases on the selected person", async () => {
  const fixture = registryFixtureForState("OH");
  const holder = { id: "statewide:oh/one", name: "Mike DeWine", officeTitle: "Governor", partyLabel: null, websiteUrl: governorUrl, sourceUrl: governorUrl,
    email: "governor@ohio.gov", phone: null, contactFormUrl: null, photoUrl: null, campaignUrl: null, termEnd: null, birthDate: null };
  const first = { stateOcdId: OH, holder, sourceUrl: governorUrl, sourceOrg: "Ohio Governor", collectedAt: "2026-09-28", verification: "PAGE_FETCHED" as const };
  const second = { ...first, holder: { ...holder, id: "statewide:oh/two", email: null } };
  const checks = [first, second].map(row => ({ holder: { id: row.holder.id, name: row.holder.name, officeTitle: row.holder.officeTitle,
    divisions: [OH], authority: "REGISTRY_STATEWIDE_EXECUTIVE" as const, sourceUrl: row.sourceUrl }, status: "NOT_CHECKED" as const, candidacy: null,
    unresolvedCandidacyIds: [], reason: "Candidacy remains owed." }));
  const s = stateRegistryRuntimeStore("OH", new MemoryRoutineDataStore(), { ...fixture, statewideExecutives: [...fixture.statewideExecutives, first, second],
    officialCandidacies: { ...fixture.officialCandidacies, rows: [...fixture.officialCandidacies.rows, ...checks] },
    officialPhotos: { photos: [...fixture.officialPhotos.photos, { officeholderId: second.holder.id, name: second.holder.name,
      url: "https://governor.ohio.gov/portrait.jpg", sourceUrl: governorUrl, license: "CC0" }] },
    rosterPhotos: { ...fixture.rosterPhotos, [second.holder.id]: "https://governor.ohio.gov/portrait.jpg" } });
  const result = await publishNationalPlaceSources({ state: "OH", store: s, facts: await seeded(), clocks, now: NOW, divisions, geographyCaptures: geography, sources: { officials: [] } });
  assert.deepEqual(result.gaps, []);
  const payload = (await readRegistryRuntimePrior(s, NOW, "OH"))!.payload;
  const after = payload.statewideExecutives;
  assert.equal(after.length, 1);
  assert.equal(after[0].holder.email, holder.email);
  assert.ok(after[0].holder.nativeIds?.reader?.includes(second.holder.id));
  assert.ok(payload.officialCandidacies.rows.some(row => row.holder.id === second.holder.id));
  assert.ok(payload.officialPhotos.photos.some(row => row.officeholderId === second.holder.id));
  assert.equal(payload.rosterPhotos[second.holder.id], "https://governor.ohio.gov/portrait.jpg");
});

test("national place publication keeps legislative people on their single state authority",async()=>{
  const s=await store(),facts=await seeded();
  const result=await publishNationalPlaceSources({state:"OH",store:s,facts,clocks,now:NOW,divisions,geographyCaptures:geography,sources:{officials:[{discoveryId:"russo",divisionId:`${OH}/sldl:7`,name:"Allison Russo",officeTitle:"Representative",officialUrl:profileUrl,document:{url:profileUrl,capture:profile}}]}});
  assert.ok(result.divisions.includes(`${OH}/sldl:7`));
  assert.equal(result.bodies.some(id=>id.endsWith("#seat")),false);
  assert.ok(result.gaps.some(row=>row.detail==="STATE_PEOPLE_SOURCE_REFRESH_OWNS_LEGISLATIVE_MEMBERS"));
  assert.deepEqual((await readFactRosters(facts.query,[`${OH}/sldl:7#seat`])).rosters,[]);
});

test("statewide successor identities and candidacy checks cannot inherit the prior actor",async()=>{
  const s=await store(),facts=await seeded();
  const official=(name:string)=>({discoveryId:"governor",divisionId:OH,name,officeTitle:"Governor",officialUrl:governorUrl,document:{url:governorUrl,capture:capture(`<h1>Governor ${name}</h1><p>Governor of Ohio</p>`,governorUrl)}});
  const run=(name:string)=>publishNationalPlaceSources({state:"OH",store:s,facts,clocks,now:NOW,divisions,geographyCaptures:geography,sources:{officials:[official(name)]}});
  const first=await run("Mike DeWine");assert.deepEqual(first.gaps,[]);
  const old=(await readRegistryRuntimePrior(s,NOW,"OH"))!.payload.statewideExecutives.find(row=>row.stateOcdId===OH)!;
  const same=await run("Mike DeWine");assert.equal(same.candidateId,null);
  const changed=await run("Jordan Reyes");assert.deepEqual(changed.gaps,[]);
  const after=(await readRegistryRuntimePrior(s,NOW,"OH"))!.payload;
  const current=after.statewideExecutives.filter(row=>row.stateOcdId===OH);
  assert.equal(current.length,1);assert.notEqual(current[0].holder.id,old.holder.id);
  assert.equal(current[0].holder.name,"Jordan Reyes");
  assert.equal(after.officialCandidacies.rows.find(row=>row.holder.id===current[0].holder.id)?.status,"NOT_CHECKED");
  assert.equal(after.officialCandidacies.rows.some(row=>row.holder.id===old.holder.id),false);
});

test("saved own-page portraits publish by the exact accepted roster identity and actual normalized pixels",async()=>{
  const s=await store(),facts=await seeded(),name="Jane Doe",url="https://www.columbus.gov/council/jane-doe",imageUrl="https://www.columbus.gov/photos/jane-doe.jpg";
  const page=capture(`<title>Columbus City Council</title><h1>Columbus City Council</h1><h2>Councilmember Jane Doe</h2><img alt="Jane Doe" src="${imageUrl}">`,url);
  const original=await sharp({create:{width:200,height:240,channels:3,background:"#336699"}}).withMetadata({orientation:1}).jpeg().toBuffer();
  const stored=new Map<string,Uint8Array>();
  const result=await publishNationalPlaceSources({state:"OH",store:s,facts,clocks,now:NOW,divisions,geographyCaptures:geography,sources:{officials:[{discoveryId:"jane-native",divisionId:`${OH}/place:columbus`,name,officeTitle:"Councilmember",officialUrl:url,document:{url,capture:page},portrait:{imageUrl,captures:[page]}}]},portraitRuntime:{read:async()=>original,put:async(key,bytes)=>{stored.set(key,bytes);}}});
  assert.deepEqual(result.gaps,[]);
  const after=(await readRegistryRuntimePrior(s,NOW,"OH"))!.payload;
  const member=(await readFactRosters(facts.query,[`${OH}/place:columbus#governing`])).rosters[0]!.members[0]!;
  const photo=after.officialPhotos.photos.find(row=>row.officeholderId===member.id)!;
  assert.ok(photo);assert.equal(photo.verification?.personId,member.personId ?? member.id);assert.match(photo.url,/\.webp$/);
  assert.equal(stored.size,1);const bytes=[...stored.values()][0];
  const decoded=await sharp(bytes).raw().toBuffer({resolveWithObject:true});assert.equal(decoded.info.width,200);assert.equal(decoded.info.height,240);
  assert.equal((await sharp(bytes).metadata()).exif,undefined);
});

test("a corrupted saved source cannot replace the independently held official",async()=>{
  const s=await store(),facts=await seeded();
  const altered={...governor,evidence:{...governor.evidence,text:governor.evidence.text+" corruption"}};
  const result=await publishNationalPlaceSources({state:"OH",store:s,facts,clocks,now:NOW,divisions,geographyCaptures:geography,sources:{officials:[{discoveryId:"dewine",divisionId:OH,name:"Mike DeWine",officeTitle:"Governor",officialUrl:governorUrl,document:{url:governorUrl,capture:altered}}]}});
  assert.ok(result.gaps.some(row=>row.detail.includes("CONTENT_HASH_MISMATCH")));
  assert.equal(nationalDelivery([result]).records,0);
});
