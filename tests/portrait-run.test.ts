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
import { portraitList, portraitRunNeeded, portraitStamp } from "../lib/photos/portrait-run.ts";
import { readHeldPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { PortraitAttempt } from "../lib/photos/portrait-work.ts";
import { neonConfig } from "@neondatabase/serverless";
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

/** Counts the large reads a decision or a run makes: whole candidates, whole promotions and roster slices. */
function countLargeReads(held: RoutineDataStore) {
  const store = held as { -readonly [K in keyof RoutineDataStore]: RoutineDataStore[K] };
  const counts = { candidates: 0, promotions: 0, slim: 0 };
  const readCandidate = store.readCandidate.bind(store), readPromotion = store.readPromotion.bind(store), readPortraitRosters = store.readPortraitRosters.bind(store);
  store.readCandidate = (async id => { counts.candidates++; return readCandidate(id); }) as typeof store.readCandidate;
  store.readPromotion = (async (recordClass, scope) => { counts.promotions++; return readPromotion(recordClass, scope); }) as typeof store.readPromotion;
  store.readPortraitRosters = (async request => { counts.slim++; return readPortraitRosters(request); }) as typeof store.readPortraitRosters;
  return { counts, restore: () => { store.readCandidate = readCandidate; store.readPromotion = readPromotion; store.readPortraitRosters = readPortraitRosters; } };
}

test("once everyone has a portrait the state is skipped, and only a new person without one is read", async () => {
  const store = new MemoryRoutineDataStore();
  await publishPeople(store, 3, sha, START);
  assert.deepEqual(await portraitRunNeeded(store, "az", START, null), { needed: true, reason: "No portrait record is held for this state yet." });
  const storePortrait = await imageStore();
  const first = await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => VERIFIED, storePortrait, acquire: async options => profile(options) } });
  assert.ok("outcome" in first);
  assert.ok(first.outcome.promoted);
  const schedule = first.candidate.excludedFacts?.find(fact => fact.code === PORTRAIT_SCHEDULE_CODE);
  assert.equal((schedule?.record as { nextDueAt: string | null }).nextDueAt, null, "everyone has a portrait, so no one is due again");

  // A month on, the runner's decision reads no roster, record or saved page: shown portraits are never read again.
  const reads = countLargeReads(store);
  const rest = await portraitRunNeeded(store, "az", "2026-11-09T21:00:00.000Z", null);
  assert.equal(rest.needed, false, rest.reason);
  assert.deepEqual(reads.counts, { candidates: 0, promotions: 0, slim: 0 });
  const confirmed = await refreshPeoplePortraits({ store, vault, state: "az", query: null,
    options: { now: () => "2026-10-09T22:00:00.000Z", acquire: async () => { throw Error("settled source must not acquire"); } } });
  assert.ok("confirmation" in confirmed);
  assert.deepEqual(reads.counts, { candidates: 0, promotions: 0, slim: 0 });
  // A different source version is reconsidered from its header even when it names the same people.
  reads.restore();
  await publishPeople(store, 3, "b".repeat(40), "2026-10-10T20:00:00.000Z");
  const again = countLargeReads(store);
  assert.equal((await portraitRunNeeded(store, "az", "2026-10-10T21:00:00.000Z", null)).needed, true);
  assert.deepEqual(again.counts, { candidates: 0, promotions: 0, slim: 0 });
  again.restore();

  // Someone new takes office: the state runs, and only the new person's sources are read.
  await publishPeople(store, 4, "c".repeat(40), "2026-10-11T20:00:00.000Z");
  const owed = await portraitRunNeeded(store, "az", "2026-10-11T21:00:00.000Z", null);
  assert.equal(owed.needed, true);
  assert.match(owed.reason, /source changed since the last list/);
  const read: string[] = [];
  const next = await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => "2026-10-11T21:00:06.000Z", storePortrait,
    acquire: async options => { read.push(options.url); return profile(options); } } });
  assert.ok("outcome" in next);
  assert.ok(next.outcome.promoted);
  assert.deepEqual(read, ["https://legislature.example.gov/members/3"]);
  assert.equal((await portraitRunNeeded(store, "az", "2026-10-11T21:00:07.000Z", null)).needed, false);
  // Readers keep every portrait they had and gain the new one.
  const people = await readStatePeopleProjection("US-AZ", { store, now: "2026-10-11T21:00:07.000Z" });
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
  assert.ok("outcome" in cut);
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
    const { rosters: [slim], everyone } = await store.readPortraitRosters({ rosters: [{ recordClass: "STATE_LEGISLATOR", scope: "US-AZ:openstates-people:v1" }],
      portrait: { recordClass: "STATE_LEGISLATOR", scope: "US-AZ:people:portraits:v1" }, read: null, due: [], subjects: [] });
    assert.equal(everyone, true, "a state's first list reads everyone");
    assert.equal(slim?.roster.officeholders.length, 2);
    assert.ok(slim!.roster.officeholders.every(person => person.offices === undefined && person.sourceHolders === undefined), "offices and merged copies stay in the database");
    const versionHash = (await store.readCandidate(slim!.versionId))?.candidate.normalization.normalizedHash;
    assert.equal(slim!.readModelSha256, versionHash);
    const one = await store.readCandidateCaptures(slim!.versionId, [`https://raw.githubusercontent.com/openstates/people/${sha}/data/az/legislature/1.yml`], ["data/az/legislature/9.yml"]);
    assert.equal(one.length, 1, "only the person's own file");
    assert.equal((await store.readCandidateCaptures(slim!.versionId, ["https://example.org/elsewhere"], [])).length, 0);
    const digest = await portraitStamp(store, "az", null);
    as("people-portraits-az");
    const run = await refreshPeoplePortraits({ store, vault: pgVault, state: "az", query: null, options: { now: () => VERIFIED, storePortrait: await imageStore(),
      acquire: async options => profile(options) } });
    assert.ok("outcome" in run);
    assert.ok(run.outcome.promoted, JSON.stringify(run.outcome.candidate.receipt));
    const state = await store.readPortraitRunState(run.candidate.scope);
    assert.equal(state?.nextDueAt, null);
    assert.equal(state?.seen?.versions["STATE_LEGISLATOR\tUS-AZ:openstates-people:v1"], digest.versions["STATE_LEGISLATOR\tUS-AZ:openstates-people:v1"]);
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

/** Every database response while `work` runs: its bytes, and which of the fixture's people it names. */
async function transferred<T>(work: () => Promise<T>): Promise<{ value: T; bytes: number; responses: number; named: Set<number> }> {
  const inner = neonConfig.fetchFunction!, seen = { bytes: 0, responses: 0, named: new Set<number>() };
  neonConfig.fetchFunction = (async (url: unknown, init: unknown) => {
    const response = await (inner as (url: unknown, init: unknown) => Promise<Response>)(url, init), body = await response.clone().text();
    seen.bytes += Buffer.byteLength(body); seen.responses++;
    for (const match of body.matchAll(/Jane Member (\d+)/g)) seen.named.add(Number(match[1]));
    return response;
  }) as typeof neonConfig.fetchFunction;
  try { return { value: await work(), ...seen }; } finally { neonConfig.fetchFunction = inner; }
}

/** A pass in a runner process whose disposable read copies are gone, as on a production host: every read asks the database. */
async function withoutCopies<T>(vault: EvidenceStore, work: (store: PostgresRoutineDataStore) => Promise<T>): Promise<T> {
  const names = ["WTP_CIVIC_READ_CACHE_URL", "WTP_CIVIC_READ_CACHE_TOKEN"], prior = names.map(name => process.env[name]);
  process.env.WTP_CIVIC_READ_CACHE_URL = "http://127.0.0.1:1"; process.env.WTP_CIVIC_READ_CACHE_TOKEN = "gone";
  try { return await work(new PostgresRoutineDataStore({vault})); }
  finally { names.forEach((name, index) => prior[index] === undefined ? delete process.env[name] : process.env[name] = prior[index]); }
}

/** Members 0 and 1 have portraits on their pages; member 2's page has none. */
async function portraitState(store: PostgresRoutineDataStore, vault: EvidenceStore, count: number) {
  const as = (contract: string) => Object.assign(store as unknown as { writeAuthority: object }, {
    writeAuthority: { ...(store as unknown as { writeAuthority: object }).writeAuthority, contract } });
  as("openstates-people-az");
  await publishPeople(store, count, sha, START, vault);
  as("people-portraits-az");
  const run = await refreshPeoplePortraits({ store, vault, state: "az", query: null, options: { now: () => VERIFIED, storePortrait: await imageStore(),
    acquire: async options => options.url.endsWith("/2") ? { ...profile(options), bytes: new TextEncoder().encode("<h1>Jane Member 2</h1>") } : profile(options) } });
  assert.ok("outcome" in run, "a first portrait run publishes; it cannot confirm an unchanged source");
  assert.ok(run.outcome.promoted, JSON.stringify(run.outcome.candidate.receipt));
  return { as, record: run.candidate.scope };
}
const heldAttempts = async (store: RoutineDataStore, now: string) =>
  ((await readHeldPeopleSource(store, "US-AZ", "people-portraits", now)).normalizedPayload as { excludedFacts: PortraitAttempt[] }).excludedFacts;

test("hour after hour, a record without a list stamp is decided from small rows, never by re-reading its rosters", async t => {
  await withMigratedRoutineStore("openstates-people-az", async (store, pgVault, pg) => {
    const { record, as } = await portraitState(store, pgVault, 3);
    // The records written before the schedule fact existed (55 of 57 states on Oct 27) hold attempts and no list stamp.
    await pg.exec("ALTER TABLE civic_data_candidates DISABLE TRIGGER USER");
    await pg.query(`UPDATE civic_data_candidates c SET candidate = jsonb_set(c.candidate - 'vault', '{excludedFacts}',
      (SELECT jsonb_agg(f) FROM jsonb_array_elements(c.candidate->'excludedFacts') f WHERE f->>'code' <> $1))
      FROM civic_data_promotions p WHERE p.scope = $2 AND c.id = p.current_version_id`, [PORTRAIT_SCHEDULE_CODE, record]);
    await pg.exec("ALTER TABLE civic_data_candidates ENABLE TRIGGER USER");
    assert.equal((await store.readPortraitRunState(record))?.seen, null);
    const passes = [];
    for (const hour of ["2026-10-10T16:00:00.000Z", "2026-10-10T17:00:00.000Z"]) {
      passes.push(await withoutCopies(pgVault, runner => transferred(() => portraitRunNeeded(runner, "az", hour, null))));
    }
    t.diagnostic(`decision without a stamp: ${passes.map(pass => `${pass.bytes} B in ${pass.responses} responses naming ${pass.named.size} people (${pass.value.reason})`).join("; ")}`);
    for (const pass of passes) {
      assert.equal(pass.value.needed, true, "the state runs once to record its list stamp");
      assert.deepEqual([...pass.named], [], "no roster's people cross the wire to decide");
      assert.ok(pass.bytes < 4_000, `${pass.bytes} bytes`);
    }
    // That one run records what its list was built from; from then on the state rests without anyone being read.
    as("people-portraits-az");
    const stamped: string[] = [];
    await refreshPeoplePortraits({ store, vault: pgVault, state: "az", query: null, options: { now: () => "2026-10-10T17:00:06.000Z",
      storePortrait: await imageStore(), acquire: async options => { stamped.push(options.url); return profile(options); } } });
    assert.deepEqual(stamped, [], "no one is due, so no page is read");
    const get=pgVault.get.bind(pgVault);let vaultReads=0;
    pgVault.get=async key=>{vaultReads++;return get(key);};
    const rest = await withoutCopies(pgVault, runner => transferred(() => portraitRunNeeded(runner, "az", "2026-10-10T18:00:00.000Z", null)));
    assert.equal(rest.value.needed, false, rest.value.reason);
    assert.deepEqual([...rest.named], []);
    assert.equal(vaultReads,0,"a repeat scheduling decision reads fingerprints and schedule metadata, not stored evidence");
  });
});

test("unchanged rosters cost only version rows, a due retry reads only that person, and a changed roster only its people without a portrait", async t => {
  await withMigratedRoutineStore("openstates-people-az", async (store, pgVault) => {
    const { as } = await portraitState(store, pgVault, 3);
    const DAY = "2026-10-10T21:00:00.000Z", WEEK = "2026-10-16T21:00:06.000Z";
    // Two passes in fresh processes with nothing due: only small version rows leave the database, and no person.
    const quiet = [];
    for (const now of [DAY, "2026-10-11T21:00:00.000Z"]) {
      const attempts = await heldAttempts(store, now);
      quiet.push(await withoutCopies(pgVault, runner => transferred(() => portraitList(runner, "az", now, attempts, null))));
    }
    for (const pass of quiet) {
      assert.deepEqual([...pass.named], [], "no one is read while their rosters are unchanged and no retry is due");
      assert.equal(pass.value.due.people.length, 0);
      assert.ok(pass.bytes < 4_000, `${pass.bytes} bytes`);
      assert.ok(pass.value.restingDueAt === Date.parse(WEEK), "member 2's retry is still counted on");
    }
    // A week on, member 2's retry is due: only member 2 is read. Members 0 and 1, whose portraits show, never are.
    const attempts = await heldAttempts(store, WEEK);
    const retry = await withoutCopies(pgVault, runner => transferred(() => portraitList(runner, "az", WEEK, attempts, null)));
    assert.deepEqual([...retry.named], [2]);
    assert.deepEqual(retry.value.due.people.map(person => person.name), ["Jane Member 2"]);
    // Open States names a fourth member: its roster changed, so its people without a shown portrait are read, and no one else.
    as("openstates-people-az");
    await publishPeople(store, 4, "b".repeat(40), "2026-10-11T20:00:00.000Z", pgVault);
    const changedAttempts = await heldAttempts(store, DAY);
    const changed = await withoutCopies(pgVault, runner => transferred(() => portraitList(runner, "az", "2026-10-11T21:00:00.000Z", changedAttempts, null)));
    assert.deepEqual([...changed.named].sort(), [2, 3]);
    assert.deepEqual(changed.value.due.people.map(person => person.name), ["Jane Member 3"]);
    assert.deepEqual(changed.value.unverified.people.map(person => person.name).sort(), ["Jane Member 2", "Jane Member 3"]);
    t.diagnostic(`quiet passes ${quiet.map(pass => `${pass.bytes} B`).join(", ")}; due retry ${retry.bytes} B; changed roster ${changed.bytes} B`);
  });
});
