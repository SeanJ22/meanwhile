import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { candidatePortraitFromOwnSite, candidatePortraitFromCommons } from "../lib/ballot/candidate-portraits.ts";
import { readerCandidateProfiles } from "../lib/ballot/candidate-reader-privacy.ts";
import type { CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import { publishCandidatePortraits } from "../lib/ballot/portrait-refresh.ts";
import { derivedCampaignSitesCandidate } from "../lib/civic-data/derived-campaign-site-writer.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import type { DerivedCampaignSitesProjection } from "../lib/civic-data/derived-campaign-sites.ts";
import { stateBallotScope, stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { portraitBindingMatches } from "../lib/photos/binding.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";
import type { CampaignSiteIdentity } from "../lib/candidates/campaign-site-verifier.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

const NOW = "2026-10-01T00:00:00Z", NAME = "Jane Doe", SITE = "https://janedoeforcouncil.com/";
const IMAGE = "https://janedoeforcouncil.com/img/jane-doe.jpg";
const PNG = () => sharp({create:{width:200,height:240,channels:3,background:"#335577"}}).png().toBuffer();

function capture(url: string, text: string): WorkerPublicationCapture {
  const hash = `sha256-${createHash("sha256").update(text).digest("hex")}`;
  return { evidence: { artifactId: hash, contentHash: hash, text, canonicalUrl: url, retrievedAt: NOW, sourceId: new URL(url).hostname,
    acquiredByAttemptId: "fixture", methodRouteId: "portrait" }, observedAt: NOW, httpStatus: 200, transport: "REACHABLE", partial: false };
}
const page = (html: string) => ({ identity: { candidacyId: "candidate:jane-2026", givenName: "Jane", familyName: "Doe", officeTitle: "City Council", cycle: 2026, stateCode: "OH", ocdId: "ocd-division/country:us/state:oh/place:columbus" },
  capture: capture(SITE, `<h1>Jane Doe for City Council 2026</h1>${html}`) });
const runtime = () => { const stored = new Map<string, Uint8Array>();
  return { stored, io: { read: async () => PNG(), put: async (key: string, bytes: Uint8Array) => { stored.set(key, bytes); } } }; };

test("a named portrait on the campaign's own page is stored under candidates/ and bound by OWN_PAGE", async () => {
  const { stored, io } = runtime();
  const got = await candidatePortraitFromOwnSite(page(`<img alt="Jane Doe" src="${IMAGE}">`), NOW, io);
  assert.ok("patch" in got);
  const { patch } = got;
  assert.match(patch.photoUrl!, /^\/api\/portraits\/candidates\/[a-f0-9]{64}\.webp$/);
  assert.equal(patch.photoVerification?.basis, "OWN_PAGE");
  assert.match(patch.photoSource!, /janedoeforcouncil\.com/);
  assert.equal([...stored.keys()].length, 1);
  assert.ok([...stored.keys()][0].startsWith("candidates/"));
  const card = { ...patch, bio: null } as never;
  const projection = (c: unknown) => ({ cards: { cards: { "k": c }, note: "x", hunts: [] } }) as unknown as CandidateProfilesProjection;
  assert.equal(readerCandidateProfiles(projection(card)).cards.cards.k.photoUrl, patch.photoUrl);
  const unbound = readerCandidateProfiles(projection({ ...patch, photoVerification: undefined })).cards.cards.k;
  assert.equal(unbound.photoUrl, null); assert.equal(unbound.photoSource, null);
  const swapped = readerCandidateProfiles(projection({ ...patch, photoUrl: patch.photoUrl!.replace(/[a-f0-9]{8}\./, "00000000.") })).cards.cards.k;
  assert.equal(swapped.photoUrl, null);
});

test("an image that does not carry the candidate's name is never offered, and committed portraits stay visible", async () => {
  const { stored, io } = runtime();
  const got = await candidatePortraitFromOwnSite(page(`<img alt="Campaign logo" src="https://janedoeforcouncil.com/logo.png">`), NOW, io);
  assert.deepEqual(got, { gap: "PORTRAIT_NOT_ON_OWN_PAGE" });
  assert.equal(stored.size, 0);
  const legacy = { photoUrl: "/candidates/az-pima-x.jpg", photoSource: "official portrait" };
  const out = readerCandidateProfiles({ cards: { cards: { k: legacy }, note: "", hunts: [] } } as unknown as CandidateProfilesProjection);
  assert.equal(out.cards.cards.k.photoUrl, legacy.photoUrl);
});

const COMMONS_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Jane_Doe.jpg";
const commonsSubject: CampaignSiteIdentity = { candidacyId: "oh:2026:state-oh-cd-3:us-house:doe-jane",
  givenName: "Jane", familyName: "Doe", officeTitle: "U.S. Representative", ocdId: "ocd-division/country:us/state:oh/cd:3", stateCode: "OH", cycle: 2026 };
const wikidataRow = { person: { value: "http://www.wikidata.org/entity/Q1234" }, personLabel: { value: NAME },
  officeLabel: { value: "U.S. Representative" }, districtLabel: { value: "Ohio's 3rd congressional district" },
  stateCode: { value: "US-OH" }, image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Jane%20Doe.jpg" } };

function release(url: string, value: unknown): KnownRelease {
  const bytes = new TextEncoder().encode(JSON.stringify(value)), sha256 = createHash("sha256").update(bytes).digest("hex");
  return { sourceId: "candidate-wikimedia-portrait", releaseId: url, bytes, sha256, requestedUrl: url, finalUrl: url,
    httpStatus: 200, retrievedAt: NOW, sourceObservedAt: NOW, checkedAt: NOW, lastCheckStatus: 200, etag: null,
    lastModified: null, contentType: "application/json", reused: false, vaultKey: `project/freshness/source/commons/${sha256}.json` };
}
const commonsRuntime = (rows: unknown[] = [wikidataRow], license = "CC BY-SA 4.0", author = "<a>Photo Author</a>") => {
  const { io, stored } = runtime();
  const requests: string[] = [];
  return { stored, requests, portrait: io, capture: async (url: string) => {
    requests.push(url);
    return release(url, url.includes("query.wikidata.org") ? { results: { bindings: rows } } :
      { query: { pages: { 1: { title: "File:Jane Doe.jpg", imageinfo: [{ url: COMMONS_IMAGE,
        extmetadata: { LicenseShortName: { value: license }, Artist: { value: author } } }] } } } });
  } };
};

test("Commons publishes a candidacy-bound portrait with author and license from one publisher", async () => {
  const io = commonsRuntime();
  const result = await candidatePortraitFromCommons(commonsSubject, NOW, io);
  assert.ok("patch" in result);
  assert.equal(result.patch.photoVerification?.basis, "COMMONS");
  assert.equal(result.patch.photoSource, "Wikimedia Commons: Photo Author, CC BY-SA 4.0");
  assert.equal(result.patch.photoVerification?.commons?.wikidataId, "Q1234");
  assert.equal(io.requests.length, 2, "only Wikidata identity and the same Wikimedia publisher's file metadata are acquired");
  assert.equal(io.stored.size, 1);
  assert.equal(portraitBindingMatches(commonsSubject.candidacyId, { url: result.patch.photoUrl!,
    sourceUrl: COMMONS_IMAGE, verification: result.patch.photoVerification }, "candidates"), true);
});

test("a name match cannot substitute for the candidate's state and office or exact district", async () => {
  for (const row of [ { ...wikidataRow, stateCode: { value: "US-MI" } }, { ...wikidataRow, districtLabel: { value: "Ohio's 4th congressional district" } },
    { ...wikidataRow, officeLabel: { value: "Governor" } }, { ...wikidataRow, stateCode: undefined, officeLabel: undefined, districtLabel: undefined } ]) {
    const io = commonsRuntime([row]);
    assert.deepEqual(await candidatePortraitFromCommons(commonsSubject, NOW, io), { gap: "COMMONS_CANDIDACY_IDENTITY_UNRESOLVED" });
    assert.equal(io.requests.length, 1);
    assert.equal(io.stored.size, 0);
  }
  const ambiguous = commonsRuntime([wikidataRow, { ...wikidataRow, person: { value: "http://www.wikidata.org/entity/Q2345" } }]);
  assert.deepEqual(await candidatePortraitFromCommons(commonsSubject, NOW, ambiguous), { gap: "COMMONS_CANDIDACY_IDENTITY_UNRESOLVED" });
});

test("Commons publication refuses a restrictive license or missing author", async () => {
  for (const io of [commonsRuntime([wikidataRow], "CC BY-NC 4.0"), commonsRuntime([wikidataRow], "CC BY-SA 4.0", "")]) {
    await assert.rejects(candidatePortraitFromCommons(commonsSubject, NOW, io), /PORTRAIT_SECOND_SOURCE_MISSING/);
    assert.equal(io.stored.size, 0);
  }
});

test("a Commons portrait publishes through the existing derived door without a campaign site", async () => {
  const published: unknown[] = [];
  const plan = await publishCandidatePortraits({ plan: { records: [], inputs: [], held: [], published: [] },
    subjects: [{ ...commonsSubject, readerKeys: ["national-oh-house-3:jane-doe"], filingDomains: [] }],
    now: NOW, commonsRuntime: commonsRuntime(), onPublished: async plan => { published.push(plan); } });
  assert.equal(plan.records.length, 0);
  assert.equal(plan.portraits?.length, 1);
  assert.equal(published.length, 1);
  const candidate = derivedCampaignSitesCandidate("OH", plan, NOW);
  assert.deepEqual(candidate.semantics.violations, []);
  const store = new MemoryRoutineDataStore();
  const outcome = await processRegisteredRoutineCandidate(store, stateBallotContractId("candidate-campaign-sites-derived", "OH"), candidate, NOW);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? undefined);
  assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify(outcome.readerReadback));
  const read = await readPromotedCivicData<DerivedCampaignSitesProjection>("CURATED_READER_RECORD", stateBallotScope("candidate-campaign-sites-derived", "OH"), { store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.deepEqual(read.value.portraits, plan.portraits);
});

test("scheduled portrait refresh keeps the last photo when both source routes fail",async t=>{
  const subject={...commonsSubject,readerKeys:[commonsSubject.candidacyId],filingDomains:[]};
  const plan=await publishCandidatePortraits({plan:{records:[],inputs:[],held:[],published:[]},subjects:[subject],now:NOW,commonsRuntime:commonsRuntime()});
  assert.equal(plan.portraits?.length,1);
  let reads=0;
  const unavailable=async()=>{reads++;throw Error("Source temporarily unavailable");};
  const current=await publishCandidatePortraits({plan,subjects:[subject],now:"2026-10-01T01:00:00Z",capture:unavailable,commonsRuntime:{capture:unavailable}});
  assert.equal(reads,0,"the next hourly run retains a current portrait without another acquisition");
  t.mock.method(console,"error",()=>{});
  const refreshed=await publishCandidatePortraits({plan,subjects:[subject],now:"2026-10-09T00:00:00Z",capture:unavailable,commonsRuntime:{capture:unavailable}});
  assert.equal(reads,1);
  assert.deepEqual(refreshed.portraits,plan.portraits);
});
