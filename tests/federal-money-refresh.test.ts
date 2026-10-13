import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { federalMoneyCandidate, federalMoneyCounts } from "../lib/federal-money/candidate.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { joinFederalMoneyFacts, type FederalMoneyJoinInput } from "../lib/federal-money/join.ts";
import { federalMoneyScope, type FederalMoneyProjection, type FederalMoneyPage } from "../lib/federal-money/model.ts";
import { processRegisteredFanOutCandidate } from "../lib/civic-data/promotion.ts";
import { readFederalMoneyProjection } from "../lib/federal-money/reader.ts";
import { readFederalMoneyEdgePublication } from "../lib/federal-money/edge-publication.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { FEDERAL_MONEY_STATES } from "../lib/federal-money/sources.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordFederalMoneyDoorRead } from "../lib/federal-money/doors.ts";
import { feedDoorId } from "../lib/doors/registry.ts";

const now = "2026-10-12T23:45:00.000Z";
beforeEach(context => { if ("mock" in context) context.mock.method(Date, "now", () => Date.parse("2026-10-13T03:00:00.000Z")); });
const capture = { url: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=1",
  body: readFileSync(new URL("./fixtures/federal-money/openfema-live.json", import.meta.url), "utf8"), retrievedAt: now, publicationDate: null };
const native = parseFederalMoney("openfema", capture, "AR");
const county = "ocd-division/country:us/state:ar/county:ouachita";
const identities: FederalMoneyJoinInput = { divisions: [{ ocdId: county, geoid: "05103", divisionType: "county" }], bodies: [], governments: [] };
const fullPage: FederalMoneyPage = { facts: native, captures: [capture], complete: true, declaredTotal: 1 };

test("an asynchronous initial USAspending page durably retains its cursor before any facts arrive", async () => {
  const store = new MemoryRoutineDataStore();
  let submissions = 0;
  const fetch: typeof globalThis.fetch = async url => {
    const path = new URL(String(url)).pathname;
    if (path.includes("spending_by_transaction")) return Response.json({ results: [{ "Action Date": "2008-01-01" }] });
    if (path.includes("download/search")) { submissions++; return Response.json({ status_url: "https://api.usaspending.gov/status?job=synthetic-job", file_url: "https://files.usaspending.gov/synthetic.zip" }); }
    assert.equal(path, "/status");
    return Response.json({ status: "pending" });
  };
  const input = { source: "usaspending" as const, store, states: ["AZ"], identities: async () => ({ divisions: [], bodies: [], governments: [] }),
    acquireOptions: { fetch }, now: () => now, maxRounds: 1 };
  const first = await refreshFederalMoney(input);
  assert.ok(first.outcome.promoted);
  assert.deepEqual(first.projection.counts, { loaded: 0, joined: 0, unjoined: 0 });
  const held = await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", "usaspending:AZ");
  assert.equal(held?.payload.checkpoint?.cursor?.year, 2008);
  assert.equal(held?.payload.checkpoint?.cursor?.statusUrl, "https://api.usaspending.gov/status?job=synthetic-job");
  const repeated = await refreshFederalMoney({ ...input, now: () => "2026-10-12T23:46:00.000Z" });
  assert.ok(repeated.outcome.promoted);
  assert.equal(submissions, 1, "a resumed pending job must not submit another bulk extract");
  assert.equal(repeated.candidate?.absence.claimsAbsence, false);
});

test("an initial empty source check records progress without publishing an absence claim", async () => {
  const store = new MemoryRoutineDataStore();
  const result = await refreshFederalMoney({ source: "openfema", store, states: ["AS"], identities: async () => ({ divisions: [], bodies: [], governments: [] }),
    acquireOptions: { fetch: async () => Response.json({ metadata: { count: 0 }, DisasterDeclarationsSummaries: [] }) }, now: () => now, maxRounds: 1 });
  assert.ok(result.outcome.promoted);
  assert.deepEqual(result.projection.counts, { loaded: 0, joined: 0, unjoined: 0 });
  assert.equal(result.projection.states[0].status, "COMPLETE");
  assert.equal(result.candidate?.absence.claimsAbsence, false);
  const read = await readFederalMoneyProjection("openfema", "AS", { store, now, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.equal(read.value.records.length, 0);
});

test("real OpenFEMA sample publishes through registered fanout, native join, typed reader and state serving artifact", async () => {
  const store = new MemoryRoutineDataStore();
  const result = await refreshFederalMoney({ source: "openfema", store, states: ["AR"], identities: async () => identities,
    acquire: async () => fullPage, now: () => now, maxRounds: 1 });
  assert.equal(result.outcome.candidate.state, "PROMOTED", result.outcome.candidate.failureDetail ?? "not published");
  assert.equal(result.outcome.readerReadback?.status, "PASS", result.outcome.readerReadback?.detail);
  assert.deepEqual(result.projection.counts, { loaded: 1, joined: 1, unjoined: 0 });
  const read = await readFederalMoneyProjection("openfema", "AR", { store, now, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.deepEqual(read.value.records[0].divisionIds, [county]);
  const edge = await readFederalMoneyEdgePublication({ store, servedManifest: null, now, readServedState: async () => null });
  assert.ok(edge.states.ar); assert.deepEqual(edge.skipped, []);
});

test("same saved source is a successful unchanged check; outages preserve its state rows and save their actual door reason", async () => {
  const store = new MemoryRoutineDataStore(), repos = createMemoryRepositories();
  let checked = now;
  const input = { source: "openfema" as const, store, states: ["AR"], identities: async () => identities,
    acquire: async () => ({ ...fullPage, captures: [{ ...capture, retrievedAt: checked }], facts: parseFederalMoney("openfema", { ...capture, retrievedAt: checked }, "AR") }),
    now: () => checked, maxRounds: 1,
    doorRead: (row: { state: string; at: string; rows: number; reason: string | null }) => recordFederalMoneyDoorRead({ ...row, source: "openfema", doors: repos.doors }) };
  await refreshFederalMoney(input);
  const prior = await store.readPromotion("FEDERAL_MONEY", federalMoneyScope("openfema", "AR"));
  checked = "2026-10-13T00:10:00.000Z";
  const reread = await refreshFederalMoney(input);
  assert.ok(reread.outcome.promoted);
  const same = await store.readPromotion("FEDERAL_MONEY", federalMoneyScope("openfema", "AR"));
  assert.equal(same?.versionId, prior?.versionId, "same facts keep the pointer and record a fresh unchanged confirmation");
  assert.equal(same?.latestConfirmation?.retrieval.retrievedAt, checked);
  checked = "2026-10-13T01:00:00.000Z";
  const failed = await refreshFederalMoney({ ...input, acquire: async () => { throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "OpenFEMA connection refused"); } });
  assert.equal(failed.outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion("FEDERAL_MONEY", federalMoneyScope("openfema", "AR")))?.versionId, prior?.versionId);
  const door = await repos.doors.mustRead(feedDoorId("openfema:AR"));
  assert.match(door.value.lastFailureReason ?? "", /connection refused/);
});

test("unfinished pages keep a durable continuation and source-native unmatched rows; native audit report links do not alter source bytes", async () => {
  const store = new MemoryRoutineDataStore();
  let received: unknown;
  const first = await refreshFederalMoney({ source: "openfema", store, states: ["AR"], identities: async () => ({ divisions: [], bodies: [], governments: [] }),
    acquire: async () => ({ ...fullPage, complete: false, continuation: { source: "openfema", phase: "declarations", offset: 1000 } }), now: () => now, maxRounds: 1 });
  assert.deepEqual(first.projection.counts, { loaded: 1, joined: 0, unjoined: 1 });
  await refreshFederalMoney({ source: "openfema", store, states: ["AR"], identities: async () => identities,
    acquire: async (_source, _state, options) => { received = options?.cursor; return fullPage; }, now: () => now, maxRounds: 1 });
  assert.deepEqual(received, { source: "openfema", phase: "declarations", offset: 1000 });
  assert.equal((await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", "openfema:AR"))?.payload.records.length, 1);
  assert.equal(FEDERAL_MONEY_STATES.length, new Set(FEDERAL_MONEY_STATES).size);
  assert.ok(["AK", "HI", "DC", "PR"].every(state => FEDERAL_MONEY_STATES.includes(state)));
});

test("source-native saved row tampering fails registered publication", async () => {
  const records = joinFederalMoneyFacts(native, identities).map(row => ({ ...row, title: "Invented declaration" }));
  const projection: FederalMoneyProjection = { formatVersion: 1, source: "openfema", state: "AR", records, counts: federalMoneyCounts(records) };
  const candidate = federalMoneyCandidate({ projection, page: fullPage, now });
  const result = await processRegisteredFanOutCandidate(new MemoryRoutineDataStore(), "openfema", candidate, now);
  assert.equal(result.promoted, null);
  assert.match(result.candidate.failureDetail ?? "", /saved official source row/);
});

test("an empty incremental source page succeeds without erasing earlier proven records", async () => {
  const store = new MemoryRoutineDataStore();
  const input = { source: "openfema" as const, store, states: ["AR"], identities: async () => identities, maxRounds: 1 };
  await refreshFederalMoney({ ...input, acquire: async () => fullPage, now: () => now });
  // Synthetic empty transport represents an unchanged incremental window.
  const emptyCapture = { ...capture, body: JSON.stringify({ DisasterDeclarationsSummaries: [] }) };
  const result = await refreshFederalMoney({ ...input, now: () => "2026-10-13T01:00:00.000Z",
    acquire: async () => ({ facts: [], captures: [emptyCapture], complete: true, declaredTotal: 0 }) });
  assert.ok(result.outcome.promoted);
  assert.deepEqual(result.projection.counts, { loaded: 1, joined: 1, unjoined: 0 });
  const read = await readFederalMoneyProjection("openfema", "AR", { store, now: "2026-10-13T01:00:00.000Z", bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.equal(read.value.records[0].id, native[0].id);
});

test("the next incremental pass overlaps the previous pass start, including updates during pagination", async () => {
  const store = new MemoryRoutineDataStore();
  let clock = now;
  const input = { source: "openfema" as const, store, states: ["AR"], identities: async () => identities,
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
  await refreshFederalMoney({ source: "openfema", store, states: ["AR"], identities: async () => identities,
    acquire: async () => ({ ...fullPage, complete: false, continuation: { source: "openfema", phase: "declarations", offset: 1000 } }),
    now: () => now, maxRounds: 1 });
  const result = await refreshFederalMoney({ source: "openfema", store, states: ["AR", "OH"], identities: async () => identities,
    acquire: async () => { throw new Error("a zero-round slice must not call the publisher"); }, now: () => now, maxRounds: 0 });
  assert.deepEqual(result.projection.counts, { loaded: 1, joined: 1, unjoined: 0 });
  assert.equal(result.projection.states[0].cursor?.offset, 1000);
  assert.equal(result.projection.states[1].counts.loaded, 0);
});

test("audit children join a held government through their native report id and UEI, preserving a null child UEI and rejecting a foreign report", () => {
  // Explicitly synthetic FAC transport rows exercise its native relational join.
  const general = parseFederalMoney("federal-audit-clearinghouse", { ...capture, url: "https://api.fac.gov/general", body: JSON.stringify([{ report_id: "2025-AR-001", audit_year: 2025, auditee_uei: "ABC123DEF456", auditee_name: "County Government", auditee_state: "AR" }]) }, "AR");
  const children = parseFederalMoney("federal-audit-clearinghouse", { ...capture, url: "https://api.fac.gov/findings", body: JSON.stringify([{ report_id: "2025-AR-001", reference_number: "2025-001" }, { report_id: "2025-AR-FOREIGN", reference_number: "2025-002" }]) }, "AR");
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
