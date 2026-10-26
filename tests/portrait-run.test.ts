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
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { portraitRunNeeded } from "../lib/photos/portrait-run.ts";
import { portraitDueAt, portraitProfileLinks, PORTRAIT_RETRY_MS } from "../lib/photos/portrait-work.ts";
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
  const url = new URL(options.url);
  const index = url.pathname.split("/").at(-1);
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

test("a changed portrait entry is due even when the image URL stays the same", async () => {
  const store = new MemoryRoutineDataStore();
  await publishPeople(store, 1, sha, START);
  const list = await import("../lib/photos/portrait-run.ts").then(({ portraitList }) => portraitList(store, "az", START, [], null));
  const person = { ...list.everyone[0], profileUrls:["https://legislature.example.gov/old-entry","https://legislature.example.gov/new-entry"],
    portraitCandidate: { imageUrl: "https://legislature.example.gov/jane.png", sourceUrl: "https://legislature.example.gov/old-entry", collectedAt: SOURCE_DATE } };
  const attemptedAt = START;
  const attempt = { key: "attempt", code: "STATE_PORTRAIT_NOT_FOUND", detail: "No portrait", record: { attemptedAt, profiles: portraitProfileLinks(person),portraitEntry:person.portraitCandidate } };
  assert.equal(portraitDueAt(person, attempt, () => false), Date.parse(attemptedAt) + PORTRAIT_RETRY_MS);
  assert.equal(portraitDueAt(person, { ...attempt, record: { attemptedAt } }, () => false), 0, "an old attempt without an entry binding cannot defer the current entry");
  assert.equal(portraitDueAt({ ...person, portraitCandidate: { ...person.portraitCandidate, sourceUrl: "https://legislature.example.gov/new-entry" } }, attempt, () => false), 0);
});

test("a batched portrait save and its final schedule keep the actual image acquisition proof", async () => {
  const store = new MemoryRoutineDataStore();
  await publishPeople(store, 51, sha, START);
  const bytes = await sharp({ create: { width: 160, height: 180, channels: 3, background: "navy" } }).png().toBuffer();
  const imageVaultKey = `project/freshness/source/person-portrait/raw/${portraitHash(bytes).slice(7)}`;
  let imagesRead=0;
  const result = await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => VERIFIED,
    acquire: async options => profile(options),
    storePortrait: (id, sources, at, signal) => storeVerifiedPortrait(id, sources, at, {
      read: async () => ({ bytes, retrievedAt: ++imagesRead===51 ? SOURCE_DATE : VERIFIED, contentType: "image/png", vaultKey: imageVaultKey }), put: async () => {},
    }, "officials", signal) } });
  assert.ok(result.outcome.promoted, result.outcome.candidate.failureDetail ?? undefined);
  assert.equal(result.candidate.retrieval.retrievedAt, VERIFIED);
  assert.ok(result.candidate.retrieval.derived?.inputs.some(ref => ref.kind === "VAULTED_EVIDENCE" && ref.artifactId === imageVaultKey && ref.contentHash === portraitHash(bytes)));
  assert.equal((result.candidate.readModel as { roster: { officeholders: unknown[] } }).roster.officeholders.length, 51);
});

/** Counts the large reads a decision or a run makes: whole candidates and whole promotions. */
function countLargeReads(held: RoutineDataStore) {
  const store = held as { -readonly [K in keyof RoutineDataStore]: RoutineDataStore[K] };
  const counts = { candidates: 0, promotions: 0, slim: 0 };
  const readCandidate = store.readCandidate.bind(store), readPromotion = store.readPromotion.bind(store), readSlimRosters = store.readSlimRosters.bind(store);
  store.readCandidate = (async id => { counts.candidates++; return readCandidate(id); }) as typeof store.readCandidate;
  store.readPromotion = (async (recordClass, scope) => { counts.promotions++; return readPromotion(recordClass, scope); }) as typeof store.readPromotion;
  store.readSlimRosters = (async (recordClass, scopes) => { counts.slim++; return readSlimRosters(recordClass, scopes); }) as typeof store.readSlimRosters;
  return { counts, restore: () => { store.readCandidate = readCandidate; store.readPromotion = readPromotion; store.readSlimRosters = readSlimRosters; } };
}

test("once everyone has a portrait the state is skipped, and only a new person without one is read", async () => {
  const store = new MemoryRoutineDataStore();
  await publishPeople(store, 3, sha, START);
  assert.deepEqual(await portraitRunNeeded(store, "az", START, null), { needed: true, reason: "No portrait record is held for this state yet." });
  const storePortrait = await imageStore();
  const first = await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => VERIFIED, storePortrait, acquire: async options => profile(options) } });
  assert.ok(first.outcome.promoted);
  const schedule = first.candidate.excludedFacts?.find(fact => fact.code === PORTRAIT_SCHEDULE_CODE);
  assert.equal((schedule?.record as { nextDueAt: string | null }).nextDueAt, null, "everyone has a portrait, so no one is due again");

  // A month on, the runner's decision reads no roster, record or saved page: shown portraits are never read again.
  const reads = countLargeReads(store);
  const rest = await portraitRunNeeded(store, "az", "2026-11-09T21:00:00.000Z", null);
  assert.equal(rest.needed, false, rest.reason);
  assert.deepEqual(reads.counts, { candidates: 0, promotions: 0, slim: 0 });
  // Open States promoting the same people again changes nothing.
  reads.restore();
  await publishPeople(store, 3, "b".repeat(40), "2026-10-10T20:00:00.000Z");
  const again = countLargeReads(store);
  assert.equal((await portraitRunNeeded(store, "az", "2026-10-10T21:00:00.000Z", null)).needed, false);
  assert.deepEqual(again.counts, { candidates: 0, promotions: 0, slim: 0 });
  again.restore();

  // Someone new takes office: the state runs, and only the new person's sources are read.
  await publishPeople(store, 4, "c".repeat(40), "2026-10-11T20:00:00.000Z");
  assert.deepEqual(await portraitRunNeeded(store, "az", "2026-10-11T21:00:00.000Z", null), { needed: true, reason: "1 people without a portrait are due." });
  const read: string[] = [];
  const next = await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => "2026-10-11T21:00:06.000Z", storePortrait,
    acquire: async options => { read.push(options.url); return profile(options); } } });
  assert.ok(next.outcome.promoted);
  assert.deepEqual(read, ["https://legislature.example.gov/members/3"]);
  assert.equal((await portraitRunNeeded(store, "az", "2026-10-11T21:00:07.000Z", null)).needed, false);
  // Readers keep every portrait they had and gain the new one.
  const people = await readStatePeopleProjection("US-AZ", { store, now: "2026-10-11T21:00:07.000Z", bypassCache: true });
  assert.ok(people.kind === "PROMOTED");
  assert.equal(people.value.roster.officeholders.filter(person => person.photo?.verification).length, 4);
});

test("a person whose portrait was not found is tried again a week later, and no one else is read", async () => {
  const store = new MemoryRoutineDataStore();
  await publishPeople(store, 3, sha, START);
  const storePortrait = await imageStore();
  // Member 2's page has no portrait.
  const acquire = (read: string[]) => async (options: KnownReleaseOptions) => {
    read.push(options.url);
    return options.url.endsWith("/2") ? { ...profile(options), bytes: new TextEncoder().encode("<h1>Jane Member 2</h1>") } : profile(options);
  };
  const first: string[] = [];
  await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => VERIFIED, storePortrait, acquire: acquire(first) } });
  assert.equal(first.length, 3);
  const rest = await portraitRunNeeded(store, "az", "2026-10-10T21:00:00.000Z", null);
  assert.equal(rest.needed, false, rest.reason);
  assert.match(rest.reason, /due 2026-10-16T21:00:06\.000Z/);
  assert.deepEqual(await portraitRunNeeded(store, "az", "2026-10-16T21:00:06.000Z", null),
    { needed: true, reason: "A person without a portrait fell due at 2026-10-16T21:00:06.000Z." });
  const retry: string[] = [];
  await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => "2026-10-16T21:00:06.000Z", storePortrait, acquire: acquire(retry) } });
  assert.deepEqual(retry, ["https://legislature.example.gov/members/2"]);
});

test("a run cut off by its deadline saves where it stopped and the next pass picks up there", async () => {
  const store = new MemoryRoutineDataStore();
  await publishPeople(store, 6, sha, START);
  const storePortrait = await imageStore();
  const controller = new AbortController(), first: string[] = [];
  const cut = await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => VERIFIED, storePortrait, signal: controller.signal,
    acquire: async options => {
      first.push(options.url);
      if (first.length === 2) controller.abort(new Error("PASS_TIME_BUDGET"));
      return profile(options);
    } } });
  assert.ok(cut.outcome.promoted);
  assert.ok(cut.candidate.excludedFacts?.some(fact => fact.code === "STATE_PORTRAIT_WORK_REMAINS"));
  assert.ok(!cut.candidate.excludedFacts?.some(fact => fact.code === "STATE_PORTRAIT_PROCESSING_FAILED"), "an interrupted person is not a failure");
  assert.equal((await portraitRunNeeded(store, "az", VERIFIED, null)).needed, true, "work remains, so the next pass runs");
  const second: string[] = [];
  await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => VERIFIED, storePortrait,
    acquire: async options => { second.push(options.url); return profile(options); } } });
  // The people the cut-off run never started come first, then the ones it interrupted; nobody is read again after verifying.
  assert.deepEqual(second.slice(0, 4), [2, 3, 4, 5].map(index => `https://legislature.example.gov/members/${index}`));
  assert.equal(new Set([...first, ...second]).size, 6);
  const after = await portraitRunNeeded(store, "az", VERIFIED, null);
  assert.equal(after.needed, false, after.reason);
});

test("on the production store the list is read slim, a person's saved pages alone, and the decision from digests", async () => {
  await withMigratedRoutineStore("openstates-people-az", async (store, pgVault) => {
    const as = (contract: string) => Object.assign(store as unknown as { writeAuthority: object }, {
      writeAuthority: { ...(store as unknown as { writeAuthority: object }).writeAuthority, contract } });
    await publishPeople(store, 2, sha, START, pgVault);
    const [slim] = await store.readSlimRosters("STATE_LEGISLATOR", ["US-AZ:openstates-people:v1"]);
    assert.equal(slim?.roster.officeholders.length, 2);
    assert.ok(slim!.roster.officeholders.every(person => person.offices === undefined), "offices stay in the database");
    const versionHash = (await store.readCandidate(slim!.versionId))?.candidate.normalization.normalizedHash;
    assert.equal(slim!.readModelSha256, versionHash);
    const one = await store.readCandidateCaptures(slim!.versionId, [`https://raw.githubusercontent.com/openstates/people/${sha}/data/az/legislature/1.yml`], ["data/az/legislature/9.yml"]);
    assert.equal(one.length, 1, "only the person's own file");
    assert.equal((await store.readCandidateCaptures(slim!.versionId, ["https://example.org/elsewhere"], [])).length, 0);
    const digest = await store.readRosterIdDigests("STATE_LEGISLATOR", ["US-AZ:openstates-people:v1"]);
    as("people-portraits-az");
    const run = await refreshPeoplePortraits({ store, vault: pgVault, state: "az", query: null, options: { now: () => VERIFIED, storePortrait: await imageStore(),
      acquire: async options => profile(options) } });
    assert.ok(run.outcome.promoted, JSON.stringify(run.outcome.candidate.receipt));
    const state = await store.readPortraitRunState(run.candidate.scope);
    assert.equal(state?.nextDueAt, null);
    assert.equal(state?.seen?.versions["STATE_LEGISLATOR\tUS-AZ:openstates-people:v1"], digest[0]?.digest);
    assert.equal(await store.readPortraitRunState("US-ZZ:people:portraits:v1"), null);
    const reads = countLargeReads(store);
    const rest = await portraitRunNeeded(store, "az", "2026-10-10T21:00:00.000Z", null);
    assert.equal(rest.needed, false, rest.reason);
    assert.deepEqual(reads.counts, { candidates: 0, promotions: 0, slim: 0 });
    reads.restore();
    as("openstates-people-az");
    await publishPeople(store, 3, "b".repeat(40), "2026-10-10T20:00:00.000Z", pgVault);
    assert.equal((await portraitRunNeeded(store, "az", "2026-10-10T21:00:00.000Z", null)).needed, true);
  });
});
