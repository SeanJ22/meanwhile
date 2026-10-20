import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { civicElectionRows, civicLookupFromRaw, type CivicProjection } from "../lib/sources/google-civic/model.ts";
import { civicCandidate, failureCandidate, parseFailureCandidate } from "../lib/sources/google-civic/publication.ts";
import { lookupCivicAddress, readCivicApi } from "../lib/sources/google-civic/acquisition.ts";
import { GOOGLE_CIVIC_CONTRACT_ID, GOOGLE_CIVIC_SCOPE, GOOGLE_CIVIC_RECORD_CLASS, civicGovernmentScope, civicStateScope, GOOGLE_CIVIC_STATES } from "../lib/sources/google-civic/targets.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { readCivicProjection } from "../lib/sources/google-civic/reader.ts";
import { refreshGoogleCivic } from "../lib/sources/google-civic/refresh.ts";
import type { readRegistrationProjection } from "../lib/registration/reader.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { readRawCaptureText, type RawCaptureRef } from "../lib/civic-data/raw-capture-vault.ts";

const AT = "2026-10-12T23:13:00.000Z";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/google-civic/${name}.json`, import.meta.url), "utf8");
const rawMi = fixture("mi-voterinfo");
const districtIds = new Set((JSON.parse(rawMi).contests as { district?: { id?: string } }[]).flatMap(row => row.district?.id ?? []));

test("real November 3 samples preserve every row, upstream official flags and unknown publication dates", () => {
  for (const state of ["az", "mi", "va", "ca", "tx"]) {
    const raw = fixture(`${state}-voterinfo`), original = JSON.parse(raw);
    const lookup = civicLookupFromRaw(raw, "12000", AT, districtIds);
    const count = ["contests", "pollingLocations", "earlyVoteSites", "dropOffLocations"].reduce((sum, key) => sum + (original[key]?.length ?? 0), 0);
    assert.equal(lookup.rows.length, count);
    assert.equal(lookup.counts.joined + lookup.counts.unjoined, count);
    assert.equal(lookup.status, count ? "AVAILABLE" : "NO_DATA");
    for (const row of lookup.rows) {
      assert.ok(row.sources.every(source => source.official && source.publishedAt === null && source.collectedAt === AT));
      assert.ok(row.joinedDivisionId === null || districtIds.has(row.joinedDivisionId));
    }
    assert.ok(!JSON.stringify(lookup).includes(original.normalizedInput.line1), "the normalized reader address is never returned or saved by a reader lookup");
  }
  const lookup = civicLookupFromRaw(rawMi, "12000", AT, districtIds);
  assert.equal(lookup.counts.joined, 0, "this real sample supplies district names without native OCD ids, so names must not turn into joins");
  assert.ok(lookup.rows.some(row => row.joinedDivisionId === null), "sites with no native OCD id remain held");
  assert.throws(() => civicLookupFromRaw(rawMi, "2000", AT), /different election/);
});

test("only a provider district OCD id joins; a missing or unknown id retains its row", () => {
  const supplied = JSON.parse(rawMi);
  const id = "ocd-division/country:us/state:mi";
  supplied.contests[0].district.id = id;
  supplied.contests[1].district.id = "ocd-division/country:us/state:mi/place:not-held";
  const lookup = civicLookupFromRaw(JSON.stringify(supplied), "12000", AT, new Set([id]));
  assert.equal(lookup.counts.joined, 1);
  assert.equal(lookup.rows.length, civicLookupFromRaw(rawMi, "12000", AT).rows.length);
});

test("one national contract schedules every state and keeps its source distinct from certified lists", () => {
  const contracts = ROUTINE_SOURCE_CONTRACTS.filter(row => row.sourceId === GOOGLE_CIVIC_CONTRACT_ID);
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].fanOut, true);
  assert.deepEqual(contracts[0].readerProjection?.consumers, ["ballot", "voting-sites", "Admin"]);
  for (const state of ["AZ", "MI", "VA", "CA", "TX", "NY", "NJ", "NH", "DC"]) assert.ok(GOOGLE_CIVIC_STATES.includes(state));
  assert.equal(contracts[0].cadence.phases?.[0].everyMs, 24 * 60 * 60_000);
});

test("real source facts publish through the standing data plane, read back, confirm unchanged, and survive an outage", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), scope = civicGovernmentScope("government:US-MI:cog:public-capitol-sample");
  const first = civicLookupFromRaw(rawMi, "12000", AT, districtIds);
  const candidate = await civicCandidate(vault, scope, first, rawMi, "voterinfo");
  await assert.rejects(civicCandidate(vault, scope, { ...first, rows: first.rows.map((row, index) => index === 0 ? { ...row, value: { ...row.value, office: "Not on this saved source" } } : row) }, rawMi, "voterinfo"), /differ from/);
  const payload = candidate.normalizedPayload as { projection: unknown; rawCapture: RawCaptureRef };
  assert.deepEqual(Object.keys(payload).sort(), ["projection", "rawCapture"]);
  assert.equal(payload.rawCapture.byteLength, Buffer.byteLength(rawMi));
  assert.ok(!JSON.stringify(candidate).includes(JSON.parse(rawMi).normalizedInput.line1), "the candidate holds a reference, never the response bytes");
  assert.equal(await readRawCaptureText(vault, payload.rawCapture), rawMi);
  const published = await processRegisteredFanOutCandidate(store, GOOGLE_CIVIC_CONTRACT_ID, candidate, AT);
  assert.ok(published.promoted, JSON.stringify(published.candidate.receipt));
  assert.equal(published.readerReadback?.status, "PASS");
  const read = await readCivicProjection(scope, { store, now: AT, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  const later = "2026-10-12T23:14:00.000Z";
  const unchanged = await processRegisteredFanOutCandidate(store, GOOGLE_CIVIC_CONTRACT_ID,
    await civicCandidate(vault, scope, civicLookupFromRaw(rawMi, "12000", later, districtIds), rawMi, "voterinfo"), later);
  assert.ok(unchanged.confirmed, "same rows on a later source check are successful unchanged work");
  assert.equal(unchanged.promoted?.versionId, published.promoted.versionId);
  const failed = await processRegisteredFanOutCandidate(store, GOOGLE_CIVIC_CONTRACT_ID, failureCandidate(scope, "Google Civic request failed (HTTP 503).", later), later);
  assert.equal(failed.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotionIdentity(GOOGLE_CIVIC_RECORD_CLASS, scope))?.versionId, published.promoted.versionId);
});

test("live lookup selects the November 3 election explicitly and never leaks input addresses or keys", async () => {
  const requests: URL[] = [];
  const options = { apiKey: "private-test-key", now: () => AT, fetchImpl: (async (url: URL) => {
    requests.push(url);
    return new Response(url.pathname.endsWith("elections") ? fixture("elections") : rawMi);
  }) as unknown as typeof fetch };
  const lookup = await lookupCivicAddress("a private reader address", districtIds, options);
  assert.equal(lookup.status, "AVAILABLE");
  assert.equal(requests[1].searchParams.get("electionId"), "12000");
  assert.equal(requests[1].searchParams.get("address"), "a private reader address");
  assert.ok(!JSON.stringify(lookup).includes("private-test-key"));
  assert.ok(!JSON.stringify(lookup).includes("private reader"));
  const failed = await lookupCivicAddress("a private reader address", new Set(), { ...options,
    fetchImpl: (async () => new Response(fixture("nh-voterinfo"), { status: 404 })) as typeof fetch });
  assert.equal(failed.status, "OUTAGE");
  assert.match(failed.reason!, /HTTP 404/);
  assert.equal(failed.rows.length, 0);
});

test("provider Retry-After is honored on 429 and 5xx without small-government pacing", async () => {
  let requests = 0;
  const pauses: number[] = [];
  const result = await readCivicApi("elections", {}, { apiKey: "private-test-key", now: () => AT,
    sleep: async ms => { pauses.push(ms); },
    fetchImpl: (async () => ++requests === 1 ? new Response("", { status: 429, headers: { "retry-after": "7" } })
      : requests === 2 ? new Response("", { status: 503, headers: { "retry-after": "2" } }) : new Response(fixture("elections"))) as typeof fetch });
  assert.deepEqual(pauses, [7000, 2000]);
  assert.equal(result.checkedAt, AT);
});

test("national refresh retains the catalog source clock as state processing advances", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), visited: string[] = [];
  let tick = 0;
  const now = () => new Date(Date.parse(AT) + tick++ * 1000).toISOString();
  const registration = (async (state: string) => { visited.push(state); return { kind: "NOT_RECORDED" }; }) as unknown as typeof readRegistrationProjection;
  const result = await refreshGoogleCivic({ store, vault, registration, readOptions: { apiKey: "private-test-key", now,
    fetchImpl: (async () => new Response(fixture("elections"))) as typeof fetch } });
  assert.deepEqual(visited, GOOGLE_CIVIC_STATES);
  assert.equal(result.coverage.length, GOOGLE_CIVIC_STATES.length);
  assert.ok(result.coverage.every(row => row.reason?.includes("inventory")));
  assert.ok(result.outcome.promoted, JSON.stringify(result.outcome.candidate.receipt));
  assert.equal(result.candidate.retrieval.retrievedAt, AT);
  const expectedRows = civicElectionRows(fixture("elections"), AT, new Set(["ocd-division/country:us"]));
  for (const scope of [GOOGLE_CIVIC_SCOPE, ...GOOGLE_CIVIC_STATES.map(civicStateScope)]) {
    const held = await store.readPromotion<CivicProjection>(GOOGLE_CIVIC_RECORD_CLASS, scope);
    assert.ok(held, scope);
    assert.equal(held.payload.checkedAt, AT);
    assert.deepEqual(held.payload.rows, expectedRows);
  }
  assert.ok(tick > GOOGLE_CIVIC_STATES.length, "publication processing advances after the one source capture");
  const { rawCapture } = result.candidate.normalizedPayload as { rawCapture: RawCaptureRef };
  assert.deepEqual(await vault.list(""), [rawCapture.vaultKey], "one catalog response is stored once for every state marker");
  assert.equal(await readRawCaptureText(vault, rawCapture), fixture("elections"));
  const later = now();
  const next = await processRegisteredRoutineCandidate(store, GOOGLE_CIVIC_CONTRACT_ID, await civicCandidate(vault, GOOGLE_CIVIC_SCOPE,
    { formatVersion: 1, kind: "CATALOG", checkedAt: later, rows: civicElectionRows(fixture("elections"), later, new Set(["ocd-division/country:us"])), coverage: result.coverage }, fixture("elections"), "elections"), later);
  assert.ok(next.confirmed);
});

test("VS-01 background refresh sends no public or private addresses to Google", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), requests: URL[] = [];
  const registration = (async (state: string) => ({ kind: "PROMOTED", value: { divisions: [], governments: [
    { id: `government:US-${state}:cog:public-office-fixture`, officeAddress: `${state} public office fixture`, associations: [], bodyIds: [] },
  ] } })) as unknown as typeof readRegistrationProjection;
  const result = await refreshGoogleCivic({ store, vault, registration, readOptions: { apiKey: "private-test-key", now: () => AT,
    fetchImpl: (async (url: URL) => { requests.push(url); return new Response(fixture("elections")); }) as unknown as typeof fetch } });
  assert.ok(result.outcome.promoted);
  assert.equal(requests.length, 1);
  assert.ok(requests.every(url => url.pathname.endsWith("elections") && !url.searchParams.has("address")));
  assert.ok(result.coverage.every(row => row.checked === 0 && row.loaded === 0 && row.reason?.includes("explicit reader fallback")));
});

test("a changed query response advances its snapshot without turning omitted observations into an absence", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), scope = civicGovernmentScope("government:US-MI:cog:changed-response-fixture");
  const first = await processRegisteredFanOutCandidate(store, GOOGLE_CIVIC_CONTRACT_ID,
    await civicCandidate(vault, scope, civicLookupFromRaw(rawMi, "12000", AT), rawMi, "voterinfo"), AT);
  const changed = JSON.parse(rawMi);
  changed.pollingLocations[0].pollingHours = "Updated provider test hours";
  changed.contests = changed.contests.slice(1);
  const raw = JSON.stringify(changed), later = "2026-10-12T23:15:00.000Z";
  const next = await processRegisteredFanOutCandidate(store, GOOGLE_CIVIC_CONTRACT_ID,
    await civicCandidate(vault, scope, civicLookupFromRaw(raw, "12000", later), raw, "voterinfo"), later);
  assert.ok(next.promoted, JSON.stringify(next.candidate.receipt));
  assert.notEqual(next.promoted.versionId, first.promoted?.versionId);
  assert.equal(next.candidate.candidate.absence.claimsAbsence, false);
  assert.equal(next.candidate.candidate.changeSet?.removed.length, 0);
  assert.ok(await store.readCandidate(first.candidate.candidate.id), "the earlier complete source snapshot remains in the existing history");
});

test("a reached but unreadable source retains its public-office bytes and prior good facts", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), scope = civicGovernmentScope("government:US-MI:cog:parse-failure-fixture");
  const first = await processRegisteredFanOutCandidate(store, GOOGLE_CIVIC_CONTRACT_ID,
    await civicCandidate(vault, scope, civicLookupFromRaw(rawMi, "12000", AT), rawMi, "voterinfo"), AT);
  const raw = "Unreadable public-office source response";
  const failed = await processRegisteredFanOutCandidate(store, GOOGLE_CIVIC_CONTRACT_ID,
    await parseFailureCandidate(vault, scope, raw, "Google Civic response could not be parsed.", AT), AT);
  assert.equal(failed.candidate.state, "PARSE_INVALID");
  assert.equal(failed.candidate.acquisitionSucceeded, true);
  const { rawCapture } = failed.candidate.candidate.normalizedPayload as { rawCapture: RawCaptureRef };
  assert.deepEqual(Object.keys(failed.candidate.candidate.normalizedPayload as object), ["rawCapture"]);
  assert.equal(failed.candidate.candidate.retrieval.rawHash, rawCapture.rawHash);
  assert.equal(await readRawCaptureText(vault, rawCapture), raw);
  assert.equal((await store.readPromotionIdentity(GOOGLE_CIVIC_RECORD_CLASS, scope))?.versionId, first.promoted?.versionId);
});

test("a resumed national pass starts with states that have no completed source check", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), visited: string[] = [];
  const rows = civicElectionRows(fixture("elections"), AT, new Set(["ocd-division/country:us"]));
  await processRegisteredFanOutCandidate(store, GOOGLE_CIVIC_CONTRACT_ID,
    await civicCandidate(vault, civicStateScope("AL"), { formatVersion: 1, kind: "STATE", checkedAt: AT, rows, coverage: [] }, fixture("elections"), "elections"), AT);
  const registration = (async (state: string) => { visited.push(state); return { kind: "NOT_RECORDED" }; }) as unknown as typeof readRegistrationProjection;
  await refreshGoogleCivic({ store, vault, registration, readOptions: { apiKey: "private-test-key", now: () => AT,
    fetchImpl: (async () => new Response(fixture("elections"))) as typeof fetch } });
  assert.equal(visited.at(-1), "AL");
  assert.deepEqual(visited.slice(0, -1), GOOGLE_CIVIC_STATES.filter(state => state !== "AL"));
});
