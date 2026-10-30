import "./helpers/linking-copies.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceTextWithoutNuls } from "../lib/doors/source-text.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/changes.ts";
import { recordSourceObservation } from "../lib/doors/source-capture.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { currentVotingSourceDoors, votingAcquisitionDeadline, votingReadHasFacts } from "../scripts/fetch-voting-sites.mts";
import { combineVotingSourceReads, mergeVotingSourceRead, saveVotingSourceDoor, votingSourceReadOrder, recordVotingSourceRead } from "../lib/ballot/voting-source-publication.ts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { votingFetchSession } from "../lib/ballot/voting-source-fetch.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const now = "2026-10-23T08:00:00.000Z";
const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
const door = doors.find(row => row.url === "https://vip.sos.nd.gov/Precincts.aspx?eid=348")!;
const bytes = readFileSync("tests/fixtures/voting-sources/nd-2026-native.html");

test("decoded NULs never enter source notes or doors while original bytes remain exact", async () => {
  const repos = createMemoryRepositories();
  const native = new TextEncoder().encode("Polling\0places");
  let saved: Uint8Array | null = null;
  await recordSourceObservation(repos, { url: door.url, ocdId: door.scope.ocdId, state: "ND", names: ["North\0 Dakota"],
    disposition: { kind: "EVIDENCE", family: "voting", recordClass: "VOTING_SITE", belongs: true, quote: "Polling\0 places", reason: "Official\0 list" },
    capture: { contentType: "text/plain", bytes: native } }, now, { putBytes: async (_artifact, body) => { saved = body; return { stored: true, where: "test", why: "saved" }; } });
  assert.strictEqual(saved, native);
  assert.ok(!(JSON.stringify(await repos.fieldManual.list())).includes("\\u0000"));
  await saveVotingSourceDoor(repos.doors, { ...door, title: "Polling\0 list", office: { name: "Election\0 office" } }, now);
  assert.ok(!(JSON.stringify(await repos.doors.list())).includes("\\u0000"));
  assert.strictEqual(sourceTextWithoutNuls({ bytes: native }).bytes, native);
});

test("decoded NULs are cleaned after extraction before projection hashes", async () => {
  const read = await readVotingSource(door, { now: () => now, fetch: (async () => new Response(bytes, { headers: { "content-type": "text/html" } })) as typeof fetch });
  const tainted = { ...read, sites: read.sites.map(site => ({ ...site, name: site.name + "\0" })), fileTitle: "Official\0 list" };
  assert.equal(await votingReadHasFacts({ ...door, url: "https://unlinked.example.org/voting", linkingPage: undefined }, read), false, "a previously published sibling cannot establish an unlinked vendor source's authority");
  const combined = combineVotingSourceReads([tainted]);
  assert.equal(combined.sites[0]!.name, read.sites[0]!.name);
  assert.ok(!JSON.stringify(mergeVotingSourceRead(undefined, door, tainted, now)).includes("\\u0000"));
  assert.strictEqual(combined.rawBodies[0]!.bytes, read.rawBodies[0]!.bytes);
});

test("next scheduled pass starts with the untried list and keeps a newer verified route", async () => {
  const repos = createMemoryRepositories();
  const sources = [door, { ...door, id: "next-official-list", url: "https://vip.sos.nd.gov/other-list" }];
  for (const source of sources) await saveVotingSourceDoor(repos.doors, source, now);
  const read = await readVotingSource(door, { now: () => now, fetch: (async () => new Response(bytes, { headers: { "content-type": "text/html" } })) as typeof fetch });
  await recordVotingSourceRead(repos.doors, door, read, now);
  assert.equal((await votingSourceReadOrder(repos.doors, "ND", sources))[0]!.id, sources[1]!.id);
  const older = { ...door, access: { status: "open" as const, checkedAt: "2026-10-13", detail: "Earlier parser" } };
  const newer = { ...door, access: { status: "open" as const, checkedAt: "2026-10-23", detail: "Current parser" } };
  assert.equal(currentVotingSourceDoors([newer], [older])[0], newer);
  assert.equal(currentVotingSourceDoors([older], [newer])[0], newer);
});

test("source transports abort inside their slot even if a caller supplies an unbounded signal", async () => {
  let requests = 0;
  const session = votingFetchSession({ deadlineMs: Date.now() + 35, fetch: (async (_url, init) => {
    requests++;
    return await new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
  }) as typeof fetch });
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const started = Date.now();
    await assert.rejects(session.get(door.url, { signal: new AbortController().signal }));
    assert.ok(Date.now() - started < 1000);
    assert.equal(requests, 1, "a timed-out robots read cannot launch a late source request");
  } finally { clearInterval(keepAlive); }
  const start = Date.parse(now);
  assert.equal(votingAcquisitionDeadline(start), start + 20 * 60_000);
  assert.ok(votingAcquisitionDeadline(start, start + 60_000) < start + 60_000);
});

test("the scheduled job reads a known HTML list before discovery and keeps it on tomorrow's pass", async (t) => {
  const { refreshVotingSources } = await import("../scripts/fetch-voting-sites.mts");
  const { MemoryRoutineDataStore } = await import("../lib/civic-data/store.ts");
  const { cycleVault } = await import("../lib/control-plane/scheduler/vault.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readVotingSitesProjection } = await import("../lib/ballot/voting-sites-server.ts");
  const store = new MemoryRoutineDataStore(), repos = createMemoryRepositories();
  const root = await mkdtemp(join(tmpdir(), "vs07-job-"));
  const requests: string[] = [];
  const fetchSource = (async input => {
    const url = String(input); requests.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    return url === door.url ? new Response(bytes, { headers: { "content-type": "text/html" } }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    let yesterday: string[] = [], clock = Date.parse(now);
    t.mock.method(Date, "now", () => clock);
    for (const at of [now, "2026-10-24T08:00:00.000Z"]) {
      clock = Date.parse(at);
      const report = await refreshVotingSources({ state: "ND", store, context: { repos }, now: () => at,
        deadlineMs: Date.now() + 10_000, fetch: fetchSource, geocode: async () => null,
        registry: { divisions: [], bodies: [] }, vault: cycleVault(root), seeds: [door] });
      assert.ok(report.terminal?.acquisitionSucceeded);
      assert.equal(report.attemptedSourceIds[0], door.id);
      const reader = await readVotingSitesProjection("ND", { store, now: at });
      assert.equal(reader.kind, "PROMOTED");
      if (reader.kind !== "PROMOTED") continue;
      const sites = reader.value.jurisdictions.flatMap(row => row.sites);
      assert.equal(sites.length, 26);
      assert.equal(canonicalCivicDataHash(reader.value), { [now]: "0195c81fa5f1bed62e2a905049114e01cb82fb5b9891d413294308fdb09c015b" }[at] ?? "09c62a4bd9a509d634f8da924b2a119b7beff422f841f142672fbfd39b4f54ee", "readers get exactly the package published before the fingerprint change");
      const ids = sites.map(site => site.id);
      if (yesterday.length) assert.deepEqual(ids, yesterday);
      yesterday = ids;
    }
    assert.equal(requests[1], door.url);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cleaned source metadata passes the actual PostgreSQL JSONB NUL constraint", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    const source = { quote: "Polling\0 places", nested: [{ hours: "7\0am" }] };
    await assert.rejects(db.query("SELECT $1::jsonb AS source", [JSON.stringify(source)]), /unsupported Unicode escape sequence/);
    const saved = await db.query<{ source: typeof source }>("SELECT $1::jsonb AS source", [JSON.stringify(sourceTextWithoutNuls(source))]);
    assert.equal(saved.rows[0]!.source.quote, "Polling places");
    assert.equal(saved.rows[0]!.source.nested[0]!.hours, "7am");
  } finally { await db.close(); }
});

test("a cutoff records only its completed unchanged sources, resumes the other source first, and never refreshes the whole state early; fetch noise is no change, a moved site is", async (t) => {
  const { refreshVotingSources } = await import("../scripts/fetch-voting-sites.mts");
  const { MemoryRoutineDataStore } = await import("../lib/civic-data/store.ts");
  const { votingSitesContract } = await import("../lib/ballot/voting-sites-data-plane.ts");
  const { cycleVault } = await import("../lib/control-plane/scheduler/vault.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const store = new MemoryRoutineDataStore(), repos = createMemoryRepositories();
  const source: VotingSourceDoor = { id: "nd-full-list", url: "https://elections.example.gov/locations.csv", publisher: "County clerk",
    scope: { state: "ND", ocdId: "ocd-division/country:us/state:nd/county:adams", name: "Adams County", countyFips: "38001" },
    shape: "file", covers: ["ELECTION_DAY"], electionDate: "2026-11-03", electionPageUrl: "https://elections.example.gov/locations.csv",
    electionAssociationVerified: true, model: "ASSIGNED", extraction: { format: "csv", columns: { name: "Location", address: "Address", kind: "Kind", date: "Date" } } };
  // Every response differs (an export stamp no reader is shown), as a firewall's per-response script makes HTML differ.
  let fetches = 0, address = "1 Main St";
  const sourceBytes = () => `Location,Address,Kind,Date,Exported\nPublic Library,${address},ELECTION_DAY,2026-11-03,${++fetches}\n`;
  const second = { ...source, id: `${source.id}-second`, url: "https://elections.example.gov/second.csv" };
  const root = await mkdtemp(join(tmpdir(), "voting-hash-resume-"));
  const contract = votingSitesContract("ND");
  let clock = Date.parse(now), cut = false;
  const deadline = Date.parse("2026-10-24T08:00:00.000Z") + 10_000;
  t.mock.method(Date, "now", () => clock);
  const fetchSource = (async input => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    return [source.url, second.url].includes(url) ? new Response(sourceBytes(), { headers: { "content-type": "text/csv" } }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  const run = (at: string) => refreshVotingSources({ state: "ND", store, context: { repos }, now: () => at,
    deadlineMs: at === "2026-10-24T08:00:00.000Z" ? deadline : clock + 10_000,
    fetch: fetchSource, geocode: async () => null, registry: { divisions: [], bodies: [] }, vault: cycleVault(root), seeds: [source, second] });
  let bytesRead = 0;
  for (const name of Object.getOwnPropertyNames(MemoryRoutineDataStore.prototype).filter(name => /^read|^eventObservedAt$/.test(name))) {
    const original = (store as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[name]!.bind(store);
    t.mock.method(store as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, name, async (...args: unknown[]) => {
      const out = await original(...args); bytesRead += Buffer.byteLength(JSON.stringify(out) ?? ""); return out;
    });
  }
  try {
    const initial = await run(now);
    const firstConfirmation = (await store.readPromotionIdentity(contract.recordClass, contract.scope))!.latestConfirmation!.observedAt;
    let forbidHeld = true;
    const originalRead = store.readPromotion.bind(store);
    t.mock.method(store, "readPromotion", async (recordClass: Parameters<typeof originalRead>[0], scope: string) => {
      if (forbidHeld) assert.ok(!["VOTING_SITE", "REGISTRATION"].includes(recordClass), "matching sources never load the held state or registration, including after a cutoff");
      return originalRead(recordClass, scope);
    });
    const originalCandidate = store.readCandidate.bind(store);
    t.mock.method(store, "readCandidate", async (id: string) => {
      assert.equal(forbidHeld, false, "matching sources never read a held candidate body");
      return originalCandidate(id);
    });
    const compareAndSet = repos.doors.compareAndSet.bind(repos.doors);
    t.mock.method(repos.doors, "compareAndSet", async (...[id, revision, value, at]: Parameters<typeof compareAndSet>) => {
      const saved = await compareAndSet(id, revision, value, at);
      if (cut && value.validators?.checkedAt === "2026-10-24T08:00:00.000Z") { cut = false; clock = deadline; }
      return saved;
    });
    clock = Date.parse("2026-10-24T08:00:00.000Z"); cut = true;
    const partial = await run("2026-10-24T08:00:00.000Z");
    assert.equal(partial.attemptedSourceIds.length, 1);
    assert.equal(partial.publications, 0);
    assert.equal(partial.confirmedSources, 1);
    assert.equal(partial.terminal?.confirmedAt, undefined);
    assert.equal((await store.readPromotionIdentity(contract.recordClass, contract.scope))!.latestConfirmation!.observedAt, firstConfirmation);
    forbidHeld = false;
    const { readVotingSitesProjection } = await import("../lib/ballot/voting-sites-server.ts");
    const reader = await readVotingSitesProjection("ND", { store, now: "2026-10-24T08:00:00.000Z" });
    assert.equal(reader.kind, "PROMOTED");
    if (reader.kind !== "PROMOTED") return;
    const checkedUrl = partial.attemptedSourceIds[0] === source.id ? source.url : second.url;
    const sourceRows = reader.value.jurisdictions.flatMap(row => [...row.sources ?? [], ...row.sites.flatMap(site => site.sources ?? [])]);
    assert.ok(sourceRows.some(row => row.url === checkedUrl && row.checkedAt === "2026-10-24T08:00:00.000Z"), "the completed source's actual check reaches Sources");
    assert.ok(sourceRows.filter(row => row.url !== checkedUrl).every(row => row.checkedAt === now), "the unread sibling keeps its earlier check");
    assert.equal(reader.metadata.retrievedAt, now, "a partial source check does not freshen the whole state");
    forbidHeld = true; bytesRead = 0;
    clock = Date.parse("2026-10-25T08:00:00.000Z");
    const resumed = await run("2026-10-25T08:00:00.000Z");
    console.info(`unchanged pass of two sources: ${resumed.publications} publications, ${bytesRead} bytes of stored reads`);
    assert.ok(bytesRead < 10_000, `an unchanged pass reads only pointers and fingerprints (${bytesRead} bytes)`);
    assert.notEqual(resumed.attemptedSourceIds[0], partial.attemptedSourceIds[0], "the unread source keeps its earlier persisted attempt time");
    assert.equal(resumed.confirmedSources, 2);
    assert.equal(resumed.terminal?.confirmedAt, "2026-10-25T08:00:00.000Z");
    assert.equal(resumed.terminal?.candidateId, initial.terminal?.candidateId, "both source confirmations retain the same published facts");
    forbidHeld = false; address = "2 Main St"; clock = Date.parse("2026-10-26T08:00:00.000Z");
    assert.equal((await run("2026-10-26T08:00:00.000Z")).publications, 2, "a moved site publishes from each source as before");
    const moved = await readVotingSitesProjection("ND", { store, now: "2026-10-26T08:00:00.000Z" });
    assert.ok(moved.kind === "PROMOTED" && moved.value.jurisdictions.some(row => row.sites.some(site => site.address === "2 Main St")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
