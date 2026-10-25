import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { MemoryRoutineDataStore, PORTRAIT_SCHEDULE_CODE, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { portraitHash, type PortraitSources } from "../lib/photos/evidence.ts";
import { storeVerifiedPortrait, type PortraitRuntime } from "../lib/photos/store.ts";
import type { KnownRelease, KnownReleaseOptions } from "../lib/sources/known-release.ts";
import { refreshPeoplePortraits } from "../scripts/people-portraits-refresh.mts";
import { portraitRunNeeded } from "../lib/photos/portrait-run.ts";
import { MemoryEvidenceStore, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

const vault = new MemoryEvidenceStore();
const SOURCE_DATE = "2026-10-08T12:00:00.000Z", START = "2026-10-09T21:00:00.000Z", VERIFIED = "2026-10-09T21:00:06.000Z";
const sha = "a".repeat(40);

async function publishPeople(store: RoutineDataStore, count: number, releaseId: string, now: string, evidence: EvidenceStore = vault) {
  const acquisitions = Array.from({ length: count }, (_, index) => {
    const url = `https://raw.githubusercontent.com/openstates/people/${releaseId}/data/az/legislature/${index}.yml`;
    return { requestedUrl: url, finalUrl: url, httpStatus: 200, retrievedAt: SOURCE_DATE,
      body: `id: ocd-person/member-${index}\nname: Jane Member ${index}\nroles:\n  - type: upper\n    district: '7'\n    start_date: '2025-01-01'\nlinks:\n  - url: https://legislature.example.gov/members/${index}\n` };
  });
  const people = acquisitions.flatMap(row => yamlToPeople(row.body, "az", row.requestedUrl, now));
  const roster = normalize(people, new Map([["az|upper|7", "ocd-division/country:us/state:az/sldu:7"]]), SOURCE_DATE, "US-AZ");
  const published = await publishStatePeople({ vault: evidence, store, state: "az", roster: { ...roster, currentMembershipComplete: true }, acquisitions, releaseId, now });
  assert.ok(published.outcome.promoted, JSON.stringify(published.outcome.candidate.receipt));
}

function profile(options: KnownReleaseOptions): KnownRelease {
  const index = new URL(options.url).pathname.split("/").at(-1);
  const bytes = new TextEncoder().encode(`<h1>Jane Member ${index}</h1><img alt="Portrait of Jane Member ${index}" src="/portraits/${index}.png">`);
  const sha256 = portraitHash(bytes).slice(7);
  return { sourceId: options.sourceId, releaseId: options.releaseId, requestedUrl: options.url, finalUrl: options.url, bytes, sha256,
    httpStatus: 200, retrievedAt: SOURCE_DATE, sourceObservedAt: SOURCE_DATE, checkedAt: VERIFIED, lastCheckStatus: 304, etag: null, lastModified: null,
    contentType: "text/html", reused: true, vaultKey: `project/freshness/source/${options.sourceId}/releases/fixture/${sha256}.bin` };
}

async function imageStore() {
  const bytes = await sharp({ create: { width: 160, height: 180, channels: 3, background: "navy" } }).png().toBuffer();
  const io: PortraitRuntime = { read: async (_url, signal) => { signal?.throwIfAborted(); return { bytes, retrievedAt: SOURCE_DATE, contentType: "image/png" }; }, put: async () => {} };
  return (id: string, sources: PortraitSources, at: string, signal: AbortSignal) => storeVerifiedPortrait(id, sources, at, io, "officials", signal);
}

test("a state with unchanged inputs and nothing due is skipped before anything large is read", async () => {
  const store = new MemoryRoutineDataStore();
  await publishPeople(store, 3, sha, START);
  assert.deepEqual(await portraitRunNeeded(store, "az", START), { needed: true, reason: "No portrait record is held for this state yet." });
  // Two of three verify; the third has no portrait on its page, so it is tried again in a week.
  const storePortrait = await imageStore();
  const run = await refreshPeoplePortraits({ store, vault, state: "az", options: { now: () => VERIFIED, storePortrait,
    acquire: async options => options.url.endsWith("/2") ? { ...profile(options), bytes: new TextEncoder().encode("<h1>Jane Member 2</h1>") } : profile(options) } });
  assert.ok(run.outcome.promoted);
  const schedule = run.candidate.excludedFacts?.find(fact => fact.code === PORTRAIT_SCHEDULE_CODE);
  assert.equal((schedule?.record as { nextDueAt: string }).nextDueAt, "2026-10-16T21:00:06.000Z");

  // The supervisor's whole decision: a few pointer ids and one small row, then no child.
  let candidateReads = 0, promotionReads = 0;
  const readCandidate = store.readCandidate.bind(store), readPromotion = store.readPromotion.bind(store);
  store.readCandidate = (async id => { candidateReads++; return readCandidate(id); }) as typeof store.readCandidate;
  store.readPromotion = (async (recordClass, scope) => { promotionReads++; return readPromotion(recordClass, scope); }) as typeof store.readPromotion;
  const rest = await portraitRunNeeded(store, "az", "2026-10-10T21:00:00.000Z");
  assert.equal(rest.needed, false, rest.reason);
  assert.match(rest.reason, /next photo is due 2026-10-16T21:00:06\.000Z/);
  assert.equal(candidateReads + promotionReads, 0, "no record payload is read to decide");

  // The week comes round: the failed portrait is due again.
  assert.deepEqual(await portraitRunNeeded(store, "az", "2026-10-16T21:00:06.000Z"),
    { needed: true, reason: "A portrait fell due at 2026-10-16T21:00:06.000Z." });
  // A new promotion of the state's people is a changed input, at once.
  store.readCandidate = readCandidate; store.readPromotion = readPromotion;
  await publishPeople(store, 4, "b".repeat(40), "2026-10-10T20:00:00.000Z");
  const changed = await portraitRunNeeded(store, "az", "2026-10-10T21:00:00.000Z");
  assert.equal(changed.needed, true);
  assert.match(changed.reason, /^US-AZ:.*changed since the last portrait run\.$/);
});

test("a run cut off by its deadline saves where it stopped and the next pass picks up there", async () => {
  const store = new MemoryRoutineDataStore();
  await publishPeople(store, 6, sha, START);
  const storePortrait = await imageStore();
  const controller = new AbortController(), first: string[] = [];
  const cut = await refreshPeoplePortraits({ store, vault, state: "az", options: { now: () => VERIFIED, storePortrait, signal: controller.signal,
    acquire: async options => {
      first.push(options.url);
      if (first.length === 2) controller.abort(new Error("PASS_TIME_BUDGET"));
      return profile(options);
    } } });
  assert.ok(cut.outcome.promoted);
  assert.ok(cut.candidate.excludedFacts?.some(fact => fact.code === "STATE_PORTRAIT_WORK_REMAINS"));
  assert.ok(!cut.candidate.excludedFacts?.some(fact => fact.code === "STATE_PORTRAIT_PROCESSING_FAILED"), "an interrupted person is not a failure");
  assert.equal((await portraitRunNeeded(store, "az", VERIFIED)).needed, true, "work remains, so the next pass runs");
  const second: string[] = [];
  await refreshPeoplePortraits({ store, vault, state: "az", options: { now: () => VERIFIED, storePortrait,
    acquire: async options => { second.push(options.url); return profile(options); } } });
  // The people the cut-off run never started come first, then the ones it interrupted; nobody is read again after verifying.
  assert.deepEqual(second.slice(0, 4), [2, 3, 4, 5].map(index => `https://legislature.example.gov/members/${index}`));
  assert.equal(new Set([...first, ...second]).size, 6);
  const after = await portraitRunNeeded(store, "az", VERIFIED);
  assert.equal(after.needed, false, after.reason);
});

test("on the production store the decision reads only pointer ids and one small row, and it matches the record", async () => {
  await withMigratedRoutineStore("openstates-people-az", async (store, pgVault) => {
    const as = (contract: string) => Object.assign(store as unknown as { writeAuthority: object }, {
      writeAuthority: { ...(store as unknown as { writeAuthority: object }).writeAuthority, contract } });
    await publishPeople(store, 2, sha, START, pgVault);
    as("people-portraits-az");
    const run = await refreshPeoplePortraits({ store, vault: pgVault, state: "az", options: { now: () => VERIFIED, storePortrait: await imageStore(),
      acquire: async options => profile(options) } });
    assert.ok(run.outcome.promoted, JSON.stringify(run.outcome.candidate.receipt));
    const state = await store.readPortraitRunState(run.candidate.scope);
    assert.deepEqual(state?.inputs.map(row => row.scope).sort(), ["US-AZ:openstates-people:v1"]);
    assert.equal(state?.nextDueAt, "2026-10-16T21:00:06.000Z");
    assert.equal(await store.readPortraitRunState("US-ZZ:people:portraits:v1"), null);
    let candidateReads = 0;
    const readCandidate = store.readCandidate.bind(store);
    store.readCandidate = (async id => { candidateReads++; return readCandidate(id); }) as typeof store.readCandidate;
    const rest = await portraitRunNeeded(store, "az", "2026-10-10T21:00:00.000Z");
    assert.equal(rest.needed, false, rest.reason);
    assert.equal(candidateReads, 0);
    store.readCandidate = readCandidate;
    as("openstates-people-az");
    await publishPeople(store, 3, "b".repeat(40), "2026-10-10T20:00:00.000Z", pgVault);
    assert.equal((await portraitRunNeeded(store, "az", "2026-10-10T21:00:00.000Z")).needed, true);
  });
});
