import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { civicElectionRows, civicLookupFromRaw } from "../lib/sources/google-civic/model.ts";
import { civicCandidate } from "../lib/sources/google-civic/publication.ts";
import { lookupCivicAddress, readCivicApi } from "../lib/sources/google-civic/acquisition.ts";
import { GOOGLE_CIVIC_CONTRACT_ID, GOOGLE_CIVIC_SCOPE, civicStateScope, GOOGLE_CIVIC_STATES } from "../lib/sources/google-civic/targets.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
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

test("voting answers cannot enter the database or evidence vault", async () => {
  const vault = new MemoryEvidenceStore();
  const lookup = civicLookupFromRaw(rawMi, "12000", AT, districtIds);
  await assert.rejects(civicCandidate(vault, "reader", lookup, rawMi, "voterinfo"), /transient/);
  await assert.rejects(civicCandidate(vault, "reader", lookup, rawMi, "elections"), /transient/);
  assert.deepEqual(await vault.list(""), []);
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

test("a request-local public catalog prefetch is consumed once before sending the address to voterinfo", async () => {
  const requests: URL[] = [];
  const lookup = await lookupCivicAddress("private reader street", new Set(), {
    apiKey: "private-test-key", now: () => AT,
    electionCatalog: Promise.resolve({ raw: fixture("elections"), checkedAt: AT, status: 200 }),
    fetchImpl: (async (url: URL) => { requests.push(url); return new Response(rawMi); }) as unknown as typeof fetch,
  });
  assert.equal(lookup.status, "AVAILABLE");
  assert.equal(requests.length, 1);
  assert.ok(requests[0].pathname.endsWith("voterinfo"));
  assert.equal(requests[0].searchParams.get("address"), "private reader street");
  assert.equal(requests[0].searchParams.get("electionId"), "12000");
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

test("every HTTP failure logs its status and at most 300 body characters only on the server", async t => {
  const logs: string[] = [];
  t.mock.method(console, "error", (line: string) => logs.push(line));
  let attempt = 0;
  const statuses = [429, 503, 403];
  await assert.rejects(readCivicApi("voterinfo", { address: "private reader street" }, {
    apiKey: "private-test-key", sleep: async () => {},
    fetchImpl: async () => new Response(`provider failure private-test-key private reader street ${"x".repeat(500)}`, { status: statuses[attempt++] }),
  }), /HTTP 403/);
  const calls = logs.map(line => JSON.parse(line));
  assert.deepEqual(calls.map(row => row.httpStatus), statuses);
  assert.ok(calls.every(row => row.event === "google_civic_call_failed" && row.route === "voterinfo" && row.stage === "http" && row.body.length === 300));
  assert.doesNotMatch(logs.join(""), /private-test-key|private reader street/);
});

test("unreadable JSON logs its successful HTTP status and body prefix without leaking them into the answer", async t => {
  const logs: string[] = [];
  t.mock.method(console, "error", (line: string) => logs.push(line));
  const answer = await lookupCivicAddress("private reader street", new Set(), { apiKey: "private-test-key", electionId: "12000",
    fetchImpl: async () => new Response(`not JSON private-test-key private reader street ${"y".repeat(500)}`),
  });
  const call = JSON.parse(logs[0]);
  assert.equal(call.httpStatus, 200);
  assert.equal(call.stage, "parse");
  assert.equal(call.body.length, 300);
  assert.doesNotMatch(logs.join(""), /private-test-key|private reader street/);
  assert.doesNotMatch(JSON.stringify(answer), /not JSON|yyyy|private-test-key|private reader street/);
});

test("body and transport failures log the known HTTP status and available body, using null only without a response", async t => {
  const logs: string[] = [];
  t.mock.method(console, "error", (line: string) => logs.push(line));
  let sent = false;
  const stream = new ReadableStream({ pull(controller) {
    if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode("partial provider response")); }
    else controller.error(new Error("connection interrupted"));
  } });
  await assert.rejects(readCivicApi("voterinfo", {}, { apiKey: "private-test-key", fetchImpl: async () => new Response(stream) }), /body could not be read/);
  await assert.rejects(readCivicApi("voterinfo", {}, { apiKey: "private-test-key", fetchImpl: async () => { throw new Error("connection refused"); } }), /could not be reached/);
  const calls = logs.map(line => JSON.parse(line));
  assert.deepEqual(calls.map(row => [row.stage, row.httpStatus, row.body]), [
    ["body", 200, "partial provider response"], ["transport", null, ""],
  ]);
});

test("national refresh visits every state, records missing inventories and publishes a catalog without dropping covered rows", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), visited: string[] = [];
  const registration = (async (state: string) => { visited.push(state); return { kind: "NOT_RECORDED" }; }) as unknown as typeof readRegistrationProjection;
  const result = await refreshGoogleCivic({ store, vault, registration, readOptions: { apiKey: "private-test-key", now: () => AT,
    fetchImpl: (async () => new Response(fixture("elections"))) as typeof fetch } });
  assert.deepEqual(visited, GOOGLE_CIVIC_STATES);
  assert.equal(result.coverage.length, GOOGLE_CIVIC_STATES.length);
  assert.ok(result.coverage.every(row => row.reason?.includes("inventory")));
  assert.ok(result.outcome.promoted, JSON.stringify(result.outcome.candidate.receipt));
  const { rawCapture } = result.candidate.normalizedPayload as { rawCapture: RawCaptureRef };
  assert.deepEqual(await vault.list(""), [rawCapture.vaultKey], "one catalog response is stored once for every state marker");
  assert.equal(await readRawCaptureText(vault, rawCapture), fixture("elections"));
  const next = await processRegisteredRoutineCandidate(store, GOOGLE_CIVIC_CONTRACT_ID, await civicCandidate(vault, GOOGLE_CIVIC_SCOPE,
    { formatVersion: 1, kind: "CATALOG", checkedAt: AT, rows: civicElectionRows(fixture("elections"), AT, new Set(["ocd-division/country:us"])), coverage: result.coverage }, fixture("elections"), "elections"), AT);
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
  assert.ok(result.coverage.every(row => row.checked === 0 && row.loaded === 0 && row.reason?.includes("live for a reader")));
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
