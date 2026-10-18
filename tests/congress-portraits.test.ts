import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { congressPortraits, congressDirectoryPortraitLeads } from "../lib/officials/congress-portraits.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { federalDirectoryCandidate } from "../lib/officials/federal-directory-data-plane.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { portraitHash, verifyPortraitSources, type PortraitSources } from "../lib/photos/evidence.ts";
import { portraitBindingMatches } from "../lib/photos/binding.ts";
import { storeVerifiedPortrait, type PortraitRuntime } from "../lib/photos/store.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import type { KnownRelease, KnownReleaseOptions } from "../lib/sources/known-release.ts";

const START = "2026-10-09T21:00:00.000Z", CHECK = "2026-10-09T21:00:05.000Z", VERIFIED = "2026-10-09T21:00:06.000Z";
const ORIGINAL = "2026-10-08T12:00:00.000Z", PAST = "2026-09-01T12:00:00.000Z", SHA = "a".repeat(40);
const imageUrl = "https://www.congress.gov/img/member/fixture.jpg";
const bioguide = (index: number) => `A${String(index + 1).padStart(6, "0")}`;
const raw = (count = 1) => ({ "legislators-current": Array.from({ length: count }, (_, index) => ({
  id: { bioguide: bioguide(index) }, name: { first: "Jane", last: bioguide(index) },
  terms: [{ type: "rep", state: "AZ", district: index + 1, start: "2025-01-03", end: "2027-01-03", phone: "202-225-1000", url: `https://${bioguide(index).toLowerCase()}.house.gov/` }],
})) });
const directory = (count = 1) => normalizeCongressDirectory(raw(count), SHA, ORIGINAL, null, {}, START);
const apiText = (id: string) => JSON.stringify({ member: { bioguideId: id, depiction: { imageUrl } } });
function release(options: KnownReleaseOptions, body = apiText(options.releaseId), vintage = ORIGINAL, checkedAt = CHECK): KnownRelease {
  const bytes = new TextEncoder().encode(body), sha256 = portraitHash(bytes).slice(7);
  return { sourceId: options.sourceId, releaseId: options.releaseId, requestedUrl: options.url, finalUrl: options.url,
    bytes, sha256, httpStatus: 200, retrievedAt: vintage, sourceObservedAt: vintage, checkedAt, lastCheckStatus: 304,
    etag: null, lastModified: null, contentType: options.sourceId === "congress-member" ? "application/json" : "text/html", reused: true,
    vaultKey: `project/freshness/source/${options.sourceId}/releases/fixture/${sha256}.bin` };
}
async function imageStore() {
  const bytes = await sharp({ create: { width: 160, height: 180, channels: 3, background: "navy" } }).png().toBuffer();
  const writes: string[] = [];
  const io: PortraitRuntime = { read: async (_url, signal) => { signal?.throwIfAborted(); return { bytes, retrievedAt: ORIGINAL, contentType: "image/png" }; },
    put: async key => { writes.push(key); } };
  return { writes, store: (id: string, sources: PortraitSources, at: string, signal: AbortSignal) => storeVerifiedPortrait(id, sources, at, io, "officials", signal) };
}

test("same-day API captures verify after acquisition while source and image vintage remain unchanged", async () => {
  const images = await imageStore(), model = directory();
  let clock = START;
  const result = await congressPortraits(model, "2026-10-09", undefined, { apiKeyConfigured: true, now: () => clock,
    acquire: async options => {
      const page = release(options); await options.validate?.(page.bytes, page); clock = VERIFIED; return page;
    }, storePortrait: async (id, sources, at, signal) => {
      assert.throws(() => verifyPortraitSources(id, sources, "2026-10-09"), /PORTRAIT_SECOND_SOURCE_MISSING/, "the former date-only clock rejected today's actual capture");
      assert.equal(at, VERIFIED); return images.store(id, sources, at, signal);
    } });
  assert.equal(result.attempted, 1); assert.deepEqual(result.excludedFacts, []);
  const photo = result.projection.roster.officeholders[0].photo!;
  assert.ok(portraitBindingMatches("congress:A000001", photo));
  assert.equal(photo.verification!.checkedAt, VERIFIED);
  assert.equal(photo.verification!.sources[0].retrievedAt, ORIGINAL);
  assert.equal(photo.collectedAt, ORIGINAL);
  assert.equal(model.roster.officeholders[0].photo, null, "accepted input is not mutated");
  assert.equal(images.writes.length, 1);
});

test("a failed member retains its old verified portrait and cannot block another member or durable gap publication", async () => {
  const images = await imageStore(), model = directory(2), signal = new AbortController().signal;
  const oldPage = release({ sourceId: "congress-member", releaseId: "A000001", url: "https://api.congress.gov/v3/member/A000001?format=json" } as KnownReleaseOptions, apiText("A000001"), PAST, PAST);
  const oldPhoto = await images.store("congress:A000001", { subject: { personId: "congress:A000001", name: "Jane A000001", nativeIds: { congress: ["A000001"] }, profileUrls: [oldPage.finalUrl] }, imageUrl,
    captures: [{ transport: "REACHABLE", partial: false, httpStatus: 200, observedAt: PAST,
      evidence: { canonicalUrl: oldPage.finalUrl, sourceId: "Congress.gov", contentHash: portraitHash(oldPage.bytes), text: apiText("A000001"), retrievedAt: PAST, vaultKey: oldPage.vaultKey } }] }, PAST, signal);
  model.roster.officeholders[0].photo = oldPhoto;
  const result = await congressPortraits(model, START, signal, { apiKeyConfigured: true, now: () => VERIFIED, storePortrait: images.store,
    acquire: async options => {
      if (options.releaseId === "A000001") throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Fixture member route unavailable");
      const page = release(options); await options.validate?.(page.bytes, page); return page;
    } });
  assert.deepEqual(result.projection.roster.officeholders[0].photo, oldPhoto);
  assert.ok(result.projection.roster.officeholders[1].photo?.verification);
  assert.equal(result.projection.roster.officeholders[0].phone, "202-225-1000");
  assert.ok(result.excludedFacts.some(row => row.key === "congress:A000001:portrait" && row.code === "CONGRESS_PORTRAIT_SOURCE_FAILED"));
  const sourceUrl = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/legislators-current.yaml`;
  const candidate = await federalDirectoryCandidate({ state: "AZ", vault: new MemoryEvidenceStore(), projection: result.projection, excludedFacts: result.excludedFacts, retrievedAt: ORIGINAL,
    acquisitions: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, httpStatus: 200, body: JSON.stringify(raw(2)["legislators-current"]), retrievedAt: ORIGINAL }] });
  const store = new MemoryRoutineDataStore(), outcome = await processRegisteredManualCandidate(store, "congress-bulk-roster:AZ", candidate, VERIFIED);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? "");
  const saved = await store.readCandidate(candidate.id);
  assert.deepEqual(saved?.candidate.excludedFacts, result.excludedFacts);
  const read = await readFederalDirectoryProjection(["AZ"], { store, now: VERIFIED, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.equal(read.value.roster.officeholders.length, 2);
  assert.deepEqual(read.value.roster.officeholders[0].photo, oldPhoto);
  assert.ok(read.value.roster.officeholders[1].photo?.verification);
  assert.equal(read.value.roster.officeholders[1].provenance.collectedAt, ORIGINAL);
});

test("missing API configuration reuses held captures or records the gap and tries only the held official member URL", async () => {
  const images = await imageStore(), model = directory(), requested: string[] = [];
  const held = await congressPortraits(model, START, undefined, { apiKeyConfigured: false, now: () => VERIFIED, storePortrait: images.store,
    acquire: async options => { const page = release(options); await options.validate?.(page.bytes, page); return page; } });
  assert.ok(held.projection.roster.officeholders[0].photo?.verification, "an already-held API capture needs no key");
  const result = await congressPortraits(model, START, undefined, { apiKeyConfigured: false, now: () => VERIFIED, storePortrait: images.store,
    readApi: async () => { throw Error("No credentialed request should be attempted"); },
    acquire: async options => {
      requested.push(options.url);
      if (options.sourceId === "congress-member") await options.fetchImpl!(options.url, { signal: options.signal });
      return release(options, `<h1>Jane A000001</h1><img src="/jane.jpg" alt="Portrait of Jane A000001">`);
    } });
  assert.deepEqual(requested, ["https://api.congress.gov/v3/member/A000001?format=json", model.roster.officeholders[0].websiteUrl]);
  assert.ok(result.excludedFacts.some(row => row.code === "CONGRESS_PORTRAIT_API_UNCONFIGURED"));
  assert.equal((result.excludedFacts[0].record as { portraitStatus: string }).portraitStatus, "VERIFIED_FROM_ALTERNATIVE_SOURCE");
  assert.ok(result.excludedFacts.every(row => !row.detail.includes("portrait remains owed")));
  const photo = result.projection.roster.officeholders[0].photo!;
  assert.equal(photo.verification!.basis, "OWN_PAGE");
  assert.equal(photo.verification!.ownPageUrl, model.roster.officeholders[0].websiteUrl);
});

test("a pass with no new portrait still persists its exact field failures without changing accepted people", async () => {
  const store = new MemoryRoutineDataStore(), model = directory();
  const sourceUrl = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/legislators-current.yaml`;
  let priorId: string | null = null;
  for (const at of [VERIFIED, "2026-10-09T21:00:07.000Z"]) {
    const result = await congressPortraits(model, at, undefined, { apiKeyConfigured: false, now: () => at,
      acquire: async options => {
        if (options.sourceId === "congress-member") await options.fetchImpl!(options.url, { signal: options.signal });
        throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Fixture official page unavailable");
      } });
    assert.deepEqual(result.projection, model);
    assert.equal(result.excludedFacts.length, 3);
    const candidate = await federalDirectoryCandidate({ state: "AZ", vault: new MemoryEvidenceStore(), projection: model, excludedFacts: result.excludedFacts, retrievedAt: ORIGINAL,
      acquisitions: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, httpStatus: 200, body: JSON.stringify(raw()["legislators-current"]), retrievedAt: ORIGINAL }] });
    assert.notEqual(candidate.id, priorId, "a later failed field attempt needs its own durable candidate identity"); priorId = candidate.id;
    const outcome = await processRegisteredManualCandidate(store, "congress-bulk-roster:AZ", candidate, at, undefined, { confirmUnchanged: false });
    assert.ok(outcome.promoted || outcome.confirmed, outcome.candidate.failureDetail ?? "");
    const recorded = await store.readCandidate(candidate.id);
    assert.deepEqual(recorded?.candidate.excludedFacts, result.excludedFacts);
    assert.deepEqual((await store.readPromotion("FEDERAL_DIRECTORY", "US-AZ:current-congress-directory"))?.payload, model);
  }
});

test("known members are not limited to a calendar slice and an abort leaves explicit continuation work", async () => {
  const images = await imageStore();
  const complete = await congressPortraits(directory(25), START, undefined, { apiKeyConfigured: true, now: () => VERIFIED,
    storePortrait: images.store, acquire: async options => release(options) });
  assert.equal(complete.attempted, 25);
  assert.equal(complete.projection.roster.officeholders.filter(row => row.photo?.verification).length, 25);
  const controller = new AbortController(); let started = 0;
  const partial = await congressPortraits(directory(25), START, controller.signal, { apiKeyConfigured: true, now: () => VERIFIED,
    acquire: async options => {
      assert.equal(options.signal, controller.signal);
      if (++started === 3) controller.abort(new Error("Fixture deadline"));
      await new Promise<void>((_resolve, reject) => {
        if (options.signal.aborted) reject(options.signal.reason);
        else options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
      throw Error("unreachable");
    } });
  assert.equal(partial.attempted, 3);
  assert.ok(partial.excludedFacts.some(row => row.code === "CONGRESS_PORTRAIT_WORK_REMAINS" && row.detail.startsWith("25 ") && row.detail.includes("22 not started, 3 attempted")));
  assert.equal(partial.projection.roster.officeholders.length, 25);
  const nextController = new AbortController(), nextIds: string[] = [];
  const next = await congressPortraits(partial.projection, START, nextController.signal, { apiKeyConfigured: true, now: () => VERIFIED,
    previousExcludedFacts: partial.excludedFacts, acquire: async options => {
      nextIds.push(options.releaseId);
      if (nextIds.length === 3) nextController.abort(new Error("Next fixture deadline"));
      await new Promise<void>((_resolve, reject) => {
        if (options.signal.aborted) reject(options.signal.reason);
        else options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
      throw Error("unreachable");
    } });
  assert.deepEqual(nextIds, ["A000004", "A000005", "A000006"], "unchanged early failures cannot starve untouched native IDs");
  assert.ok(next.excludedFacts.some(row => row.key === "congress:A000001:portrait"), "the original failed attempt survives while other members are worked");
});

test("portrait image transport receives the existing caller cancellation signal", async () => {
  const model = directory(), controller = new AbortController();
  let observed = false, wrote = false;
  const result = await congressPortraits(model, START, controller.signal, { apiKeyConfigured: true, now: () => VERIFIED,
    acquire: async options => release(options), storePortrait: (id, sources, at, signal) => storeVerifiedPortrait(id, sources, at, {
      read: async (_url, passed) => {
        assert.equal(passed, controller.signal); observed = true;
        controller.abort(new Error("Fixture image deadline")); passed!.throwIfAborted(); return new Uint8Array();
      }, put: async () => { wrote = true; },
    }, "officials", signal) });
  assert.equal(observed, true); assert.equal(wrote, false);
  assert.equal(result.projection.roster.officeholders[0].photo, null);
  assert.ok(result.excludedFacts.some(row => row.code === "CONGRESS_PORTRAIT_PROCESSING_FAILED"));
});

test("directory image leads publish only when the exact person's own official page labels that image",async()=>{
  const images=await imageStore(),model=directory(),id="A000001",lead=congressDirectoryPortraitLeads(id)[1];
  const requested:string[]=[];
  const result=await congressPortraits(model,START,undefined,{apiKeyConfigured:false,now:()=>VERIFIED,storePortrait:images.store,
    acquire:async options=>{
      requested.push(options.url);
      if(options.sourceId === "congress-member")return release(options,JSON.stringify({member:{bioguideId:id}}));
      if(options.url.includes("house.gov"))return release(options,"<h1>Jane A000001</h1>");
      return release(options,`<h1>Jane A000001</h1><img src="${lead}" alt="Jane A000001">`);
    }});
  const photo=result.projection.roster.officeholders[0].photo!;
  assert.ok(portraitBindingMatches("congress:A000001",photo));
  assert.equal(photo.sourceUrl,lead);
  assert.equal(photo.verification!.ownPageUrl,"https://bioguide.congress.gov/search/bio/A000001");
  assert.equal(requested.some(url=>congressDirectoryPortraitLeads(id).includes(url)),false,"lead image bytes are requested only after the own-page check");
  assert.equal(images.writes.length,1);
});

test("a directory candidate belonging to a different person is never published",async()=>{
  const images=await imageStore(),model=directory(),id="A000001",lead=congressDirectoryPortraitLeads(id)[0];
  const result=await congressPortraits(model,START,undefined,{apiKeyConfigured:false,now:()=>VERIFIED,storePortrait:images.store,
    acquire:async options=>options.sourceId === "congress-member"
      ? release(options,JSON.stringify({member:{bioguideId:id}}))
      : release(options,`<h1>Jane A000001</h1><img src="${lead}" alt="Portrait of Other Person">`)});
  assert.equal(result.projection.roster.officeholders[0].photo,null);
  assert.equal(images.writes.length,0);
  assert.ok(result.excludedFacts.some(fact=>fact.code === "CONGRESS_PORTRAIT_IMAGE_NOT_FOUND"));
});
