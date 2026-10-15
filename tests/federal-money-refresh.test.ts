import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { federalMoneyCandidate, federalMoneyCounts } from "../lib/federal-money/candidate.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { joinFederalMoneyFacts, type FederalMoneyJoinInput } from "../lib/federal-money/join.ts";
import { FEDERAL_MONEY_PARTITION_BYTES, federalMoneyPartitionOf, federalMoneyPartitionScope, federalMoneyLookupKeys, type FederalMoneyProjection, type FederalMoneyCheckpoint, type FederalMoneyPage } from "../lib/federal-money/model.ts";
import { processRegisteredFanOutCandidate } from "../lib/civic-data/promotion.ts";
import { federalMoneyProjectionIssue, readFederalMoneyPartition, readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { readFederalMoneyCheckpoint } from "../lib/federal-money/progress.ts";
import { type FederalMoneyPartitionChange } from "../lib/federal-money/partitions.ts";
import { saveFederalMoneyCapture, withFederalMoneyVault } from "../lib/federal-money/vault.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishFederalMoneyPartition, publishFederalMoneyProgress } from "../lib/federal-money/edge-publication.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { FEDERAL_MONEY_STATES } from "../lib/federal-money/sources.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordFederalMoneyDoorRead } from "../lib/federal-money/doors.ts";
import { feedDoorId } from "../lib/doors/registry.ts";

const now = "2026-10-12T23:45:00.000Z";
beforeEach(context => { if ("mock" in context) context.mock.method(Date, "now", () => Date.parse("2026-10-13T03:00:00.000Z")); });
const evidenceStore = new MemoryEvidenceStore();
const sourceBody = readFileSync(new URL("./fixtures/federal-money/openfema-live.json", import.meta.url), "utf8");
const capture = await saveFederalMoneyCapture({ url: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=1",
  body: sourceBody, retrievedAt: now, publicationDate: null }, evidenceStore);
const native = parseFederalMoney("openfema", capture, "AR", sourceBody);
const county = "ocd-division/country:us/state:ar/county:ouachita";
const identities: FederalMoneyJoinInput = { divisions: [{ ocdId: county, geoid: "05103", divisionType: "county" }], bodies: [], governments: [] };
const fullPage: FederalMoneyPage = { facts: native, captures: [capture], complete: true, declaredTotal: 1 };
const leafScope = federalMoneyPartitionScope("openfema", "AR", federalMoneyPartitionOf(native[0]));
const acquireOptions = { evidenceStore };

test("an asynchronous initial USAspending page durably retains its cursor before any facts arrive", async () => {
  const store = new MemoryRoutineDataStore();
  let submissions = 0;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v2/bulk_download/awards/") {
      submissions++;
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { filters: {
        agencies: [{ type: "awarding", tier: "toptier", name: "all" }], prime_award_types: ["02", "03", "04", "05"],
        place_of_performance_locations: [{ country: "USA", state: "AZ" }], date_type: "action_date",
        date_range: { start_date: "2000-10-01", end_date: "2000-12-31" },
      }, file_format: "csv" });
      return Response.json({ status_url: "https://api.usaspending.gov/status?job=synthetic-job", file_url: "https://files.usaspending.gov/synthetic.zip" });
    }
    assert.equal(path, "/status");
    return Response.json({ status: "pending" });
  };
  const input = { source: "usaspending" as const, store, states: ["AZ"], identities: async () => ({ divisions: [], bodies: [], governments: [] }),
    acquireOptions: { fetch, evidenceStore }, now: () => now, maxRounds: 1 };
  const first = await refreshFederalMoney(input);
  assert.ok(first.outcome.promoted);
  assert.deepEqual(first.projection.counts, { loaded: 0, joined: 0, unjoined: 0 });
  const held = await store.readPromotion<FederalMoneyCheckpoint>("FEDERAL_MONEY", "usaspending:AZ");
  assert.equal(held?.payload.checkpoint?.cursor?.year, 2000);
  assert.equal(held?.payload.checkpoint?.cursor?.statusUrl, "https://api.usaspending.gov/status?job=synthetic-job");
  const repeated = await refreshFederalMoney({ ...input, now: () => "2026-10-12T23:46:00.000Z" });
  assert.ok(repeated.outcome.promoted);
  assert.equal(submissions, 1, "a resumed pending job must not submit another bulk extract");
  assert.equal(repeated.candidate?.absence.claimsAbsence, false);
});

test("an initial empty source check records progress without publishing an absence claim", async () => {
  const store = new MemoryRoutineDataStore();
  const result = await refreshFederalMoney({ source: "openfema", store, states: ["AS"], identities: async () => ({ divisions: [], bodies: [], governments: [] }),
    acquireOptions: { evidenceStore, fetch: async () => Response.json({ metadata: { count: 0 }, DisasterDeclarationsSummaries: [] }) }, now: () => now, maxRounds: 1 });
  assert.ok(result.outcome.promoted);
  assert.deepEqual(result.projection.counts, { loaded: 0, joined: 0, unjoined: 0 });
  assert.equal(result.projection.states[0].status, "COMPLETE");
  assert.equal(result.candidate?.absence.claimsAbsence, false);
  const read = await readFederalMoneyCheckpoint("openfema", "AS", { store, now, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.equal("records" in read.value, false);
});

test("real OpenFEMA sample publishes through registered fanout, native join and bounded typed partition", async () => {
  const store = new MemoryRoutineDataStore();
  const result = await refreshFederalMoney({ source: "openfema", store, acquireOptions, states: ["AR"], identities: async () => identities,
    acquire: async () => fullPage, now: () => now, maxRounds: 1 });
  assert.equal(result.outcome.candidate.state, "PROMOTED", result.outcome.candidate.failureDetail ?? "not published");
  assert.equal(result.outcome.readerReadback?.status, "PASS", result.outcome.readerReadback?.detail);
  assert.deepEqual(result.projection.counts, { loaded: 1, joined: 1, unjoined: 0 });
  const read = await readFederalMoneyPartition("openfema", leafScope, { store, now, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.deepEqual(read.value.records[0].divisionIds, [county]);
  const checkpoint = await readFederalMoneyCheckpoint("openfema", "AR", { store, now, bypassCache: true });
  assert.equal(checkpoint.kind, "PROMOTED");
  if (checkpoint.kind === "PROMOTED") assert.equal("records" in checkpoint.value, false);
});

test("same saved source is a successful unchanged check; outages preserve its state rows and save their actual door reason", async () => {
  const store = new MemoryRoutineDataStore(), repos = createMemoryRepositories();
  let checked = now;
  const statuses: string[] = [];
  const input = { source: "openfema" as const, store, acquireOptions, states: ["AR"], identities: async () => identities,
    acquire: async () => ({ ...fullPage, captures: [{ ...capture, retrievedAt: checked }], facts: parseFederalMoney("openfema", { ...capture, retrievedAt: checked }, "AR", sourceBody) }),
    now: () => checked, maxRounds: 1,
    onProgress: async (row: { status: string }) => { statuses.push(row.status); },
    doorRead: (row: { state: string; at: string; rows: number; reason: string | null }) => recordFederalMoneyDoorRead({ ...row, source: "openfema", doors: repos.doors }) };
  await refreshFederalMoney(input);
  const prior = await store.readPromotion("FEDERAL_MONEY", leafScope);
  checked = "2026-10-13T00:10:00.000Z";
  const reread = await refreshFederalMoney(input);
  assert.ok(reread.outcome.promoted);
  const same = await store.readPromotion("FEDERAL_MONEY", leafScope);
  assert.equal(same?.versionId, prior?.versionId, "same facts keep the pointer and record a fresh unchanged confirmation");
  assert.equal(reread.projection.states[0].lastCompleteAt, checked);
  checked = "2026-10-13T01:00:00.000Z";
  const failed = await refreshFederalMoney({ ...input, acquire: async () => { throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "OpenFEMA connection refused"); } });
  assert.equal(failed.outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion("FEDERAL_MONEY", leafScope))?.versionId, prior?.versionId);
  const door = await repos.doors.mustRead(feedDoorId("openfema:AR"));
  assert.match(door.value.lastFailureReason ?? "", /connection refused/);
  assert.equal(statuses.at(-1), "OUTAGE");
});

test("unfinished pages keep a durable continuation and source-native unmatched rows; native audit report links do not alter source bytes", async () => {
  const store = new MemoryRoutineDataStore();
  let received: unknown;
  const first = await refreshFederalMoney({ source: "openfema", store, acquireOptions, states: ["AR"], identities: async () => ({ divisions: [], bodies: [], governments: [] }),
    acquire: async () => ({ ...fullPage, complete: false, continuation: { source: "openfema", phase: "declarations", offset: 1000 } }), now: () => now, maxRounds: 1 });
  assert.deepEqual(first.projection.counts, { loaded: 1, joined: 0, unjoined: 1 });
  await refreshFederalMoney({ source: "openfema", store, acquireOptions, states: ["AR"], identities: async () => identities,
    acquire: async (_source, _state, options) => { received = options?.cursor; return fullPage; }, now: () => now, maxRounds: 1 });
  assert.deepEqual(received, { source: "openfema", phase: "declarations", offset: 1000 });
  assert.equal((await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", leafScope))?.payload.records.length, 1);
  assert.equal(FEDERAL_MONEY_STATES.length, new Set(FEDERAL_MONEY_STATES).size);
  assert.ok(["AK", "HI", "DC", "PR"].every(state => FEDERAL_MONEY_STATES.includes(state)));
});

test("source-native saved row tampering fails registered publication", async () => {
  const records = joinFederalMoneyFacts(native, identities).map(row => ({ ...row, title: "Invented declaration" }));
  const projection: FederalMoneyProjection = { formatVersion: 2, source: "openfema", state: "AR", partition: federalMoneyPartitionOf(records[0]), records, lookupKeys: federalMoneyLookupKeys(records), counts: federalMoneyCounts(records) };
  const candidate = federalMoneyCandidate({ projection, page: fullPage, now });
  const result = await withFederalMoneyVault(evidenceStore, () => processRegisteredFanOutCandidate(new MemoryRoutineDataStore(), "openfema", candidate, now));
  assert.equal(result.promoted, null);
  assert.match(result.candidate.failureDetail ?? "", /saved official source row/);
});

test("an empty incremental source page succeeds without erasing earlier proven records", async () => {
  const store = new MemoryRoutineDataStore();
  const input = { source: "openfema" as const, store, acquireOptions, states: ["AR"], identities: async () => identities, maxRounds: 1 };
  await refreshFederalMoney({ ...input, acquire: async () => fullPage, now: () => now });
  const emptyCapture = await saveFederalMoneyCapture({ ...capture, body: JSON.stringify({ DisasterDeclarationsSummaries: [] }) }, evidenceStore);
  const result = await refreshFederalMoney({ ...input, now: () => "2026-10-13T01:00:00.000Z",
    acquire: async () => ({ facts: [], captures: [emptyCapture], complete: true, declaredTotal: 0 }) });
  assert.ok(result.outcome.promoted);
  assert.deepEqual(result.projection.counts, { loaded: 1, joined: 1, unjoined: 0 });
  const read = await readFederalMoneyPartition("openfema", leafScope, { store, now: "2026-10-13T01:00:00.000Z", bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.equal(read.value.records[0].id, native[0].id);
});

test("the next incremental pass overlaps the previous pass start, including updates during pagination", async () => {
  const store = new MemoryRoutineDataStore();
  let clock = now;
  const input = { source: "openfema" as const, store, acquireOptions, states: ["AR"], identities: async () => identities,
    now: () => clock, maxRounds: 1 };
  await refreshFederalMoney({ ...input, acquire: async () => {
    clock = "2026-10-13T00:10:00.000Z";
    return { ...fullPage, complete: false, continuation: { source: "openfema", phase: "declarations", offset: 1000 } };
  } });
  await refreshFederalMoney({ ...input, acquire: async () => {
    clock = "2026-10-13T00:35:00.000Z";
    return fullPage;
  } });
  clock = "2026-10-13T01:00:00.000Z";
  let since: string | undefined;
  await refreshFederalMoney({ ...input, acquire: async (_source, _state, options) => { since = options?.since; return fullPage; } });
  assert.equal(since, now, "an update published after the initial page must remain eligible next pass");
});

test("a bounded national slice retains counts and continuation for a state it cannot visit", async () => {
  const store = new MemoryRoutineDataStore();
  await refreshFederalMoney({ source: "openfema", store, acquireOptions, states: ["AR"], identities: async () => identities,
    acquire: async () => ({ ...fullPage, complete: false, continuation: { source: "openfema", phase: "declarations", offset: 1000 } }),
    now: () => now, maxRounds: 1 });
  const result = await refreshFederalMoney({ source: "openfema", store, acquireOptions, states: ["AR", "OH"], identities: async () => identities,
    acquire: async () => { throw new Error("a zero-round slice must not call the publisher"); }, now: () => now, maxRounds: 0 });
  assert.deepEqual(result.projection.counts, { loaded: 1, joined: 1, unjoined: 0 });
  assert.equal(result.projection.states[0].cursor?.offset, 1000);
  assert.equal(result.projection.states[1].counts.loaded, 0);
});

test("audit children join a held government through their native report id and UEI, preserving a null child UEI and rejecting a foreign report", async () => {
  const generalBody = JSON.stringify([{ report_id: "2025-AR-001", audit_year: 2025, auditee_uei: "ABC123DEF456", auditee_name: "County Government", auditee_state: "AR" }]);
  const childBody = JSON.stringify([{ report_id: "2025-AR-001", reference_number: "2025-001" }, { report_id: "2025-AR-FOREIGN", reference_number: "2025-002" }]);
  const generalCapture = await saveFederalMoneyCapture({ ...capture, url: "https://api.fac.gov/general", body: generalBody }, evidenceStore);
  const childCapture = await saveFederalMoneyCapture({ ...capture, url: "https://api.fac.gov/findings", body: childBody }, evidenceStore);
  const general = parseFederalMoney("federal-audit-clearinghouse", generalCapture, "AR", generalBody);
  const children = parseFederalMoney("federal-audit-clearinghouse", childCapture, "AR", childBody);
  const government = { id: "government:US-AR:cog:001", aliases: [], jurisdictionId: null, state: "AR", name: "County Government", kind: "GOVERNMENT" as const,
    governmentClass: "COUNTY", nativeIds: { uei: "ABC123DEF456" }, status: null, sourceVintage: "2025", website: null, officePhone: null, officeAddress: null, countyFips: "05103",
    associations: [{ divisionId: county, layer: "county", geoid: "05103", basis: "SOURCE_CODE" as const }], bodyIds: [`${county}#governing`],
    provenance: { sourceUrl: "https://sam.gov/", sourceOrg: "SAM.gov", collectedAt: now, verifiedAt: null } };
  const joined = joinFederalMoneyFacts([...general, ...children], { ...identities, governments: [government] });
  assert.ok(joined[1].bodyIds.includes(government.id), "Ask's native government subject gets the same recipient facts");
  assert.equal(joined[1].uei, null, "the general record's UEI does not become invented child source text");
  assert.equal(joined[2].joinStatus, "UNJOINED");
  assert.equal(joined[2].bodyIds.length, 0);
  assert.equal(joined.length, 3);
});

test("a crash after database promotion replays saved bytes to the place edge without reacquiring or counting twice", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-money-replay-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  const store = new MemoryRoutineDataStore();
  let acquisitions = 0;
  const input = { source: "openfema" as const, store, acquireOptions, states: ["AR"], identities: async () => identities,
    acquire: async () => { acquisitions++; return fullPage; }, now: () => now, maxRounds: 1 };
  await assert.rejects(refreshFederalMoney({ ...input, onPartition: async () => { throw new Error("simulated process loss before reader publish"); } }), /simulated process loss/);
  const checkpoint = await store.readPromotion<FederalMoneyCheckpoint>("FEDERAL_MONEY", "openfema:AR");
  assert.ok(checkpoint?.payload.checkpoint.pending);
  assert.equal(checkpoint.payload.counts.loaded, 0);
  const leaf = await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", leafScope);
  assert.equal(leaf?.payload.records.length, 1);
  const result = await refreshFederalMoney({ ...input,
    onPartition: change => publishFederalMoneyPartition({ ...change, store: artifactStore }),
    onProgress: (row, checkedAt) => publishFederalMoneyProgress({ store: artifactStore, source: "openfema", state: row.state, checkedAt, complete: row.status === "COMPLETE", reason: row.reason }) });
  assert.equal(acquisitions, 1);
  assert.deepEqual(result.projection.counts, { loaded: 1, joined: 1, unjoined: 0 });
  assert.equal((await store.readPromotion("FEDERAL_MONEY", leafScope))?.versionId, leaf?.versionId);
  assert.equal((await store.readPromotion<FederalMoneyCheckpoint>("FEDERAL_MONEY", "openfema:AR"))?.payload.checkpoint.pending, undefined);
  const read = await readFederalMoneyForPlace({ divisionId: county }, { artifactStore });
  assert.equal(read.sources[3].records[0].id, native[0].id);
  assert.equal(read.sources[3].coverageComplete, true);
});

test("a growing county splits into bounded leaves and an unchanged replay writes no new leaf version", async () => {
  const store = new MemoryRoutineDataStore();
  const sourceRecord = JSON.parse(sourceBody).DisasterDeclarationsSummaries[0];
  const projections = new Map<string, { value: FederalMoneyProjection; versionId: string }>();
  const input = { source: "openfema" as const, store, acquireOptions, states: ["AR"], identities: async () => identities, maxRounds: 1,
    onPartition: async (change: FederalMoneyPartitionChange) => { projections.set(federalMoneyPartitionScope("openfema", "AR", change.projection.partition), { value: change.projection, versionId: change.versionId }); } };
  let page = 0;
  const acquire = async (): Promise<FederalMoneyPage> => {
    const start = page++ === 0 ? 0 : 500;
    const records = Array.from({ length: start === 0 ? 500 : 101 }, (_, i) => ({ ...sourceRecord, id: `synthetic-split-${start + i}` }));
    const body = JSON.stringify({ DisasterDeclarationsSummaries: records });
    const saved = await saveFederalMoneyCapture({ ...capture, body }, evidenceStore);
    return { facts: parseFederalMoney("openfema", saved, "AR", body), captures: [saved], complete: start !== 0, declaredTotal: 601,
      ...(start === 0 ? { continuation: { source: "openfema", phase: "declarations", offset: 500 } as const } : {}) };
  };
  await refreshFederalMoney({ ...input, acquire, now: () => now });
  const firstLeaf = await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", leafScope);
  assert.equal(firstLeaf?.payload.records.length, 500);
  const second = await refreshFederalMoney({ ...input, acquire, now: () => "2026-10-13T00:10:00.000Z" });
  assert.deepEqual(second.projection.counts, { loaded: 601, joined: 601, unjoined: 0 });
  const root = (await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", leafScope))!.payload;
  assert.equal(root.records.length, 0);
  assert.ok(root.children!.length > 1);
  assert.equal(root.subtreeCounts?.loaded, 601);
  const leaves = [...projections.values()].filter(row => !row.value.children?.length);
  assert.equal(leaves.reduce((sum, row) => sum + row.value.records.length, 0), 601);
  assert.ok(leaves.every(row => row.value.records.length <= 500));
  const before = new Map([...projections].map(([scope, held]) => [scope, held.versionId]));
  await refreshFederalMoney({ ...input, acquire, now: () => "2026-10-13T00:35:00.000Z" });
  assert.deepEqual(new Map([...projections].map(([scope, held]) => [scope, held.versionId])), before);
});

test("corrupt vault bytes fail the native fact check and no partition is promoted", async () => {
  const records = joinFederalMoneyFacts(native, identities);
  const projection: FederalMoneyProjection = { formatVersion: 2, source: "openfema", state: "AR", partition: federalMoneyPartitionOf(records[0]), records,
    counts: federalMoneyCounts(records), lookupKeys: federalMoneyLookupKeys(records) };
  const corrupted = new Proxy(evidenceStore, { get(target, property) {
    if (property === "get") return async (key: string) => {
      const held = await target.get(key);
      if (held) held.bytes[0] ^= 1;
      return held;
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const candidate = federalMoneyCandidate({ projection, page: fullPage, now });
  const result = await withFederalMoneyVault(corrupted, () => processRegisteredFanOutCandidate(new MemoryRoutineDataStore(), "openfema", candidate, now));
  assert.equal(result.promoted, null);
  assert.match(result.candidate.failureDetail ?? "", /content hash/);
  assert.ok((candidate.normalizedPayload as { captures: object[] }).captures.every(saved => !("body" in saved)));
  assert.equal(JSON.stringify(candidate.normalizedPayload).includes(capture.vaultKey), true);
});

test("a corrected source county moves the native row and clears the previous place without duplicating counts", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-money-move-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  const store = new MemoryRoutineDataStore();
  const otherCounty = "ocd-division/country:us/state:ar/county:pulaski";
  const input = { source: "openfema" as const, store, acquireOptions, states: ["AR"], maxRounds: 1,
    identities: async () => ({ ...identities, divisions: [...identities.divisions, { ocdId: otherCounty, geoid: "05119", divisionType: "county" }] }),
    locate: async () => (await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", leafScope))?.payload.records.map(row => ({ id: row.id, partition: federalMoneyPartitionOf(row) })) ?? [],
    onPartition: (change: FederalMoneyPartitionChange) => publishFederalMoneyPartition({ ...change, store: artifactStore }) };
  await refreshFederalMoney({ ...input, acquire: async () => fullPage, now: () => now });
  const correctedBody = JSON.stringify({ DisasterDeclarationsSummaries: [{ ...JSON.parse(sourceBody).DisasterDeclarationsSummaries[0], fipsCountyCode: "119", designatedArea: "Pulaski (County)" }] });
  const saved = await saveFederalMoneyCapture({ ...capture, body: correctedBody, retrievedAt: "2026-10-13T01:00:00.000Z" }, evidenceStore);
  const corrected: FederalMoneyPage = { facts: parseFederalMoney("openfema", saved, "AR", correctedBody), captures: [saved], complete: true, declaredTotal: 1 };
  const result = await refreshFederalMoney({ ...input, acquire: async () => corrected, now: () => "2026-10-13T01:00:00.000Z" });
  assert.deepEqual(result.projection.counts, { loaded: 1, joined: 1, unjoined: 0 });
  assert.equal((await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", leafScope))?.payload.records.length, 0);
  assert.equal((await readFederalMoneyForPlace({ divisionId: county }, { artifactStore })).sources[3].records.length, 0);
  assert.equal((await readFederalMoneyForPlace({ divisionId: otherCounty }, { artifactStore })).sources[3].records[0].id, native[0].id);
});

test("an empty replacement without a promoted relocation target cannot erase accepted native facts", async () => {
  const store = new MemoryRoutineDataStore();
  await refreshFederalMoney({ source: "openfema", store, acquireOptions, states: ["AR"], identities: async () => identities,
    acquire: async () => fullPage, now: () => now, maxRounds: 1 });
  const held = (await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", leafScope))!;
  const projection = { ...held.payload, records: [], lookupKeys: [], counts: { loaded: 0, joined: 0, unjoined: 0 } };
  const candidate = federalMoneyCandidate({ projection, page: { facts: [], captures: [], complete: true, declaredTotal: 0 }, now,
    predecessorVersionId: held.versionId });
  const result = await withFederalMoneyVault(evidenceStore, () => processRegisteredFanOutCandidate(store, "openfema", candidate, now, held.versionId));
  assert.equal(result.promoted, null);
  assert.equal((await store.readPromotion("FEDERAL_MONEY", leafScope))?.versionId, held.versionId);
});

test("a failed source-status edge write retries from its completed checkpoint without another provider call", async () => {
  const store = new MemoryRoutineDataStore();
  const input = { source: "openfema" as const, store, acquireOptions, states: ["AR"], maxRounds: 1, identities: async () => identities,
    acquire: async () => fullPage, now: () => now };
  await assert.rejects(refreshFederalMoney({ ...input, onProgress: async () => { throw new Error("status store unavailable"); } }), /status store unavailable/);
  let status: string | undefined;
  await refreshFederalMoney({ ...input, now: () => "2026-10-12T23:46:00.000Z",
    acquire: async () => { throw new Error("the source is within its own update clock"); },
    onProgress: async row => { status = row.status; } });
  assert.equal(status, "COMPLETE");
});

test("an identity database outage preserves accepted place facts and replays the pending source page after recovery", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-money-identity-retry-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  const store = new MemoryRoutineDataStore();
  let acquisitions = 0;
  let failedIdentity = false;
  let currentPage = fullPage;
  const input = { source: "openfema" as const, store, acquireOptions, states: ["AR"], maxRounds: 1,
    identities: async () => { if (failedIdentity) throw new Error("held identity database temporarily unavailable"); return identities; },
    acquire: async () => { acquisitions++; return currentPage; },
    onPartition: (change: FederalMoneyPartitionChange) => publishFederalMoneyPartition({ ...change, store: artifactStore }),
    onProgress: (row: { state: string; status: string; reason: string | null }, checkedAt: string) => publishFederalMoneyProgress({ store: artifactStore, source: "openfema", state: row.state, checkedAt, complete: row.status === "COMPLETE", reason: row.reason }) };
  await refreshFederalMoney({ ...input, now: () => now });
  const before = await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", leafScope);
  const sourceRecord = JSON.parse(sourceBody).DisasterDeclarationsSummaries[0];
  const body = JSON.stringify({ DisasterDeclarationsSummaries: [sourceRecord, { ...sourceRecord, id: "synthetic-identity-retry" }] });
  const saved = await saveFederalMoneyCapture({ ...capture, body, retrievedAt: "2026-10-13T01:00:00.000Z" }, evidenceStore);
  currentPage = { facts: parseFederalMoney("openfema", saved, "AR", body), captures: [saved], complete: true, declaredTotal: 2 };
  failedIdentity = true;
  const outage = await refreshFederalMoney({ ...input, now: () => "2026-10-13T01:00:00.000Z" });
  assert.equal(outage.projection.states[0].status, "OUTAGE");
  assert.match(outage.projection.states[0].reason ?? "", /identity database temporarily unavailable/);
  assert.deepEqual(outage.projection.counts, { loaded: 1, joined: 1, unjoined: 0 });
  assert.equal((await store.readPromotion("FEDERAL_MONEY", leafScope))?.versionId, before?.versionId);
  assert.ok((await store.readPromotion<FederalMoneyCheckpoint>("FEDERAL_MONEY", "openfema:AR"))?.payload.checkpoint.pending);
  const retained = await readFederalMoneyForPlace({ divisionId: county }, { artifactStore });
  assert.equal(retained.sources[3].records[0].id, native[0].id);
  failedIdentity = false;
  const recovered = await refreshFederalMoney({ ...input, now: () => "2026-10-13T01:01:00.000Z" });
  assert.equal(acquisitions, 2);
  assert.deepEqual(recovered.projection.counts, { loaded: 2, joined: 2, unjoined: 0 });
  const read = await readFederalMoneyForPlace({ divisionId: county }, { artifactStore });
  assert.equal(read.sources[3].records.length, 2);
  assert.equal(read.sources[3].coverageComplete, true);
});

test("opposite county corrections publish both destinations before removing originals and resume after a removal crash", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-money-cycle-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  const store = new MemoryRoutineDataStore();
  const otherCounty = "ocd-division/country:us/state:ar/county:pulaski";
  const template = JSON.parse(sourceBody).DisasterDeclarationsSummaries[0];
  const makePage = async (swapped: boolean): Promise<FederalMoneyPage> => {
    const body = JSON.stringify({ DisasterDeclarationsSummaries: [
      { ...template, id: "synthetic-cycle-a", fipsCountyCode: swapped ? "119" : "103" },
      { ...template, id: "synthetic-cycle-b", fipsCountyCode: swapped ? "103" : "119" },
    ] });
    const saved = await saveFederalMoneyCapture({ ...capture, body }, evidenceStore);
    return { facts: parseFederalMoney("openfema", saved, "AR", body), captures: [saved], complete: true, declaredTotal: 2 };
  };
  let page = await makePage(false);
  const roots = page.facts.map(row => federalMoneyPartitionScope("openfema", "AR", federalMoneyPartitionOf(row)));
  let acquisitions = 0;
  let crash = false;
  const corrections: FederalMoneyProjection[] = [];
  const input = { source: "openfema" as const, store, acquireOptions, states: ["AR"], maxRounds: 1,
    identities: async () => ({ ...identities, divisions: [...identities.divisions, { ocdId: otherCounty, geoid: "05119", divisionType: "county" }] }),
    locate: async () => {
      const locations = [];
      for (const scope of roots) for (const row of (await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", scope))?.payload.records ?? []) locations.push({ id: row.id, partition: federalMoneyPartitionOf(row) });
      return locations;
    },
    acquire: async () => { acquisitions++; return page; },
    onPartition: async (change: FederalMoneyPartitionChange) => {
      if (crash) {
        corrections.push(change.projection);
        if (change.previous && change.previous.records.length > change.projection.records.length) {
          crash = false;
          throw new Error("simulated crash after first correction removal");
        }
      }
      return publishFederalMoneyPartition({ ...change, store: artifactStore });
    } };
  await refreshFederalMoney({ ...input, now: () => now });
  page = await makePage(true);
  crash = true;
  await assert.rejects(refreshFederalMoney({ ...input, now: () => "2026-10-13T01:00:00.000Z" }), /simulated crash after first correction removal/);
  assert.deepEqual(corrections.slice(0, 2).map(row => row.records.length), [2, 2], "both destinations retain originals until all incoming facts publish");
  assert.equal(corrections[2].records.length, 1);
  const result = await refreshFederalMoney({ ...input, now: () => "2026-10-13T01:01:00.000Z" });
  assert.equal(acquisitions, 2);
  assert.deepEqual(result.projection.counts, { loaded: 2, joined: 2, unjoined: 0 });
  const left = await readFederalMoneyForPlace({ divisionId: county }, { artifactStore });
  const right = await readFederalMoneyForPlace({ divisionId: otherCounty }, { artifactStore });
  assert.deepEqual(left.sources[3].records.map(row => row.sourceId), ["synthetic-cycle-b"]);
  assert.deepEqual(right.sources[3].records.map(row => row.sourceId), ["synthetic-cycle-a"]);
  for (const scope of roots) assert.equal((await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", scope))?.payload.records.length, 1);
});

test("SAM storage groups stay bounded and address districts never publish recipient facts to unrelated cards", async t => {
  const template = JSON.parse(readFileSync(new URL("./fixtures/federal-money/sam-official-example.json", import.meta.url), "utf8"));
  const otherCounty = "ocd-division/country:us/state:ar/county:pulaski";
  const addressDistrict = "ocd-division/country:us/state:ar/cd:4";
  const uei = (index: number) => `TEST${String(index).padStart(8, "0")}`;
  const governmentIds = [county, otherCounty].map(division => `${division}#governing`);
  const nativeIdentities: FederalMoneyJoinInput = { divisions: [...identities.divisions,
    { ocdId: otherCounty, geoid: "05119", divisionType: "county" },
    { ocdId: addressDistrict, geoid: "0504", divisionType: "congressional_district" }],
    bodies: [], governments: [county, otherCounty].map((division, index) => ({ id: governmentIds[index], nativeIds: { uei: uei(index) },
      bodyIds: [], associations: [{ divisionId: division, layer: "county", geoid: index ? "05119" : "05103", basis: "SOURCE_CODE" as const }] })) };
  for (const district of ["04", null]) await t.test(district ? "native address district" : "unlocated registrations", async context => {
    const directory = mkdtempSync(join(tmpdir(), "federal-money-registrations-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const artifactStore = new LocalFileArtifactStore(directory), store = new MemoryRoutineDataStore();
    const projections = new Map<string, FederalMoneyProjection>();
    let pageIndex = 0;
    const input = { source: "sam-gov-entities" as const, store, acquireOptions, states: ["AR"], maxRounds: 1,
      identities: async () => nativeIdentities,
      acquire: async (): Promise<FederalMoneyPage> => {
        const start = pageIndex++ === 0 ? 0 : 500;
        const body = JSON.stringify({ entityData: Array.from({ length: start ? 1 : 500 }, (_, index) => ({ ...template,
          entityRegistration: { ...template.entityRegistration, ueiSAM: uei(start + index), legalBusinessName: `Synthetic registration ${start + index}` },
          coreData: { ...template.coreData, congressionalDistrict: district,
            physicalAddress: { ...template.coreData.physicalAddress, stateOrProvinceCode: "AR" } },
        })) });
        const saved = await saveFederalMoneyCapture({ url: "https://api.sam.gov/entity-information/v3/entities", body, retrievedAt: now, publicationDate: null }, evidenceStore);
        const facts = parseFederalMoney("sam-gov-entities", saved, "AR", body);
        assert.ok(facts.every(row => row.geography.length === 0));
        assert.ok(facts.every(row => federalMoneyPartitionOf(row).place === (district ? `registration-address-district:${district}` : "registration-unlocated")));
        return { facts, captures: [saved], complete: start !== 0, declaredTotal: 501,
          ...(start ? {} : { continuation: { source: "sam-gov-entities", phase: "extract", chunkIndex: 1 } as const }) };
      },
      onPartition: async (change: FederalMoneyPartitionChange) => {
        projections.set(federalMoneyPartitionScope("sam-gov-entities", "AR", change.projection.partition), change.projection);
        return publishFederalMoneyPartition({ ...change, store: artifactStore });
      },
      onProgress: (row: { state: string; status: string; reason: string | null }, checkedAt: string) => publishFederalMoneyProgress({
        store: artifactStore, source: "sam-gov-entities", state: row.state, checkedAt, complete: row.status === "COMPLETE", reason: row.reason }),
    };
    await refreshFederalMoney({ ...input, now: () => now });
    assert.equal(projections.size, 1, "500 registrations share one bounded root");
    assert.equal([...projections.values()][0].records.length, 500);
    const result = await refreshFederalMoney({ ...input, now: () => "2026-10-13T00:10:00.000Z" });
    assert.deepEqual(result.projection.counts, { loaded: 501, joined: 2, unjoined: 499 });
    const leaves = [...projections.values()].filter(projection => !projection.children?.length);
    assert.equal(leaves.reduce((sum, projection) => sum + projection.records.length, 0), 501);
    assert.ok(leaves.every(projection => projection.records.length <= 500));
    assert.ok([...projections.values()].some(projection => projection.records.length === 0 && projection.subtreeCounts?.loaded === 501));
    for (let index = 0; index < governmentIds.length; index++) {
      const read = await readFederalMoneyForPlace({ divisionId: index ? otherCounty : county, bodyId: governmentIds[index] }, { artifactStore });
      assert.deepEqual(read.sources[2].records.map(row => row.uei), [uei(index)]);
      assert.equal(read.sources[2].coverageComplete, true);
    }
    const addressRead = await readFederalMoneyForPlace({ divisionId: addressDistrict }, { artifactStore });
    assert.deepEqual(addressRead.sources[2].records, []);
  });
});

test("large FAC findings split on bytes before the row limit and preserve an oversized individual finding", async () => {
  const template = JSON.parse(readFileSync(new URL("./fixtures/federal-money/fac-findings-text-live-2026-10-15.json", import.meta.url), "utf8"))[0];
  const store = new MemoryRoutineDataStore(), projections = new Map<string, FederalMoneyProjection>();
  let pageIndex = 0;
  const input = { source: "federal-audit-clearinghouse" as const, store, acquireOptions, states: ["AR"], maxRounds: 1,
    identities: async () => ({ divisions: [], bodies: [], governments: [] }),
    acquire: async (): Promise<FederalMoneyPage> => {
      const last = pageIndex++ > 0;
      const body = JSON.stringify(Array.from({ length: last ? 1 : 8 }, (_, index) => ({ ...template,
        report_id: "synthetic-byte-split", finding_ref_number: `synthetic-${last ? 8 : index}`, fac_accepted_date: "2026-10-01",
        finding_text: `Generated large finding ${last ? 8 : index}. `.padEnd(last ? 5 * 1024 * 1024 : 600 * 1024, "x"),
      })));
      const saved = await saveFederalMoneyCapture({ url: "https://api.fac.gov/findings_text", body, retrievedAt: now, publicationDate: null }, evidenceStore);
      const facts = parseFederalMoney("federal-audit-clearinghouse", saved, "AR", body);
      const unsplit: FederalMoneyProjection = { formatVersion: 2, source: "federal-audit-clearinghouse", state: "AR", partition: federalMoneyPartitionOf(facts[0]),
        records: facts, counts: federalMoneyCounts(facts), lookupKeys: federalMoneyLookupKeys(facts) };
      assert.equal(facts.length, last ? 1 : 8);
      assert.ok(Buffer.byteLength(JSON.stringify(facts)) > FEDERAL_MONEY_PARTITION_BYTES);
      if (last) assert.equal(federalMoneyProjectionIssue(unsplit, "federal-audit-clearinghouse", "AR"), null);
      else assert.match(federalMoneyProjectionIssue(unsplit, "federal-audit-clearinghouse", "AR") ?? "", /bounded leaf/);
      return { facts, captures: [saved], complete: last, declaredTotal: 9,
        ...(last ? {} : { continuation: { source: "federal-audit-clearinghouse", phase: "findings_text", offset: 8 } as const }) };
    },
    onPartition: async (change: FederalMoneyPartitionChange) => { projections.set(federalMoneyPartitionScope("federal-audit-clearinghouse", "AR", change.projection.partition), change.projection); },
  };
  await refreshFederalMoney({ ...input, now: () => now });
  const result = await refreshFederalMoney({ ...input, now: () => "2026-10-13T00:10:00.000Z" });
  assert.deepEqual(result.projection.counts, { loaded: 9, joined: 0, unjoined: 9 });
  const leaves = [...projections.values()].filter(projection => !projection.children?.length);
  assert.equal(leaves.reduce((sum, projection) => sum + projection.records.length, 0), 9);
  assert.ok(leaves.length > 1);
  for (const projection of leaves) {
    assert.ok(projection.records.length <= 500);
    assert.ok(projection.records.length === 1 || Buffer.byteLength(JSON.stringify(projection.records)) <= FEDERAL_MONEY_PARTITION_BYTES);
    assert.equal(federalMoneyProjectionIssue(projection, "federal-audit-clearinghouse", "AR"), null);
  }
  assert.equal(leaves.flatMap(projection => projection.records).find(row => row.details.reference === "synthetic-8")?.details.findingText?.toString().length, 5 * 1024 * 1024);
});

test("500 FAC recipient partitions share one page capture read and the next refresh rechecks vault integrity", async () => {
  const vault = new MemoryEvidenceStore();
  const template = JSON.parse(readFileSync(new URL("./fixtures/federal-money/fac-general-live-2026-10-15.json", import.meta.url), "utf8"))[0];
  const body = JSON.stringify(Array.from({ length: 500 }, (_, index) => ({ ...template, report_id: `synthetic-cache-${index}`,
    auditee_uei: `TEST${String(index).padStart(8, "0")}`, auditee_name: `Synthetic audit recipient ${index}`, auditee_state: "AR" })));
  const saved = await saveFederalMoneyCapture({ url: "https://api.fac.gov/general", body, retrievedAt: now, publicationDate: null }, vault);
  const page: FederalMoneyPage = { facts: parseFederalMoney("federal-audit-clearinghouse", saved, "AR", body), captures: [saved], complete: true, declaredTotal: 500 };
  let reads = 0;
  let corrupt = false;
  const counted = new Proxy(vault, { get(target, property) {
    if (property === "get") return async (key: string) => {
      reads++;
      const stored = await target.get(key);
      if (stored && corrupt) stored.bytes[0] ^= 1;
      return stored;
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const scopes = new Set<string>();
  const input = { source: "federal-audit-clearinghouse" as const, acquireOptions: { evidenceStore: counted }, states: ["AR"], maxRounds: 1,
    acquire: async () => page, identities: async () => ({ divisions: [], bodies: [], governments: [] }), now: () => now,
    onPartition: async (change: FederalMoneyPartitionChange) => { scopes.add(federalMoneyPartitionScope("federal-audit-clearinghouse", "AR", change.projection.partition)); } };
  const result = await refreshFederalMoney({ ...input, store: new MemoryRoutineDataStore() });
  assert.deepEqual(result.projection.counts, { loaded: 500, joined: 0, unjoined: 500 });
  assert.equal(scopes.size, 500);
  assert.ok(reads > 0 && reads <= 2, `a page's shared capture was read ${reads} times`);
  const initialReads = reads;
  corrupt = true;
  const nextStore = new MemoryRoutineDataStore();
  await assert.rejects(refreshFederalMoney({ ...input, store: nextStore }), /content hash/);
  assert.ok(reads > initialReads, "the next refresh must read the vault instead of retaining the earlier page cache");
  assert.equal(await nextStore.readPromotion("FEDERAL_MONEY", [...scopes][0]), null);
});
