import assert from "node:assert/strict";
import test from "node:test";
import { getCachedStateCoverageForDivision, getCachedStateDivision, isStateDivisionPending, loadReaderState, loadStateAndPlace, mergeReaderCoverage, stateCoverageForZip, type ReaderStateResponse } from "../lib/reader/client.ts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";
import type { MeetingSearchResult } from "../lib/meetings/query.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const coverage: CoverageSummary = {
  state: "UNMAPPED", bodies: [], seats: [], stateLegislatorAuthorities: [], divisions: [],
  unincorporated: false, senators: [], statewideExecutives: [],
  counts: { total: 0, withSource: 0, withoutSource: 0, lookedAt: 0, governing: { total: 0, withSource: 0 } },
  seatCounts: { total: 0, named: 0 },
};
const state: ReaderStateResponse = { state: "AZ", version: "held", coverage, zipPlaces: {}, directory: null, boundaryUrl: "/tiles.pmtiles" };
const place: MeetingSearchResult = { coverage, meetings: [], tier: "none", radiusKm: 20, center: { lat: 32, lng: -110 } };

test("a sourced vacancy survives the cached state, ZIP selection and merged place answer", async t => {
  const ocdId = "ocd-division/country:us/state:fl/cd:20";
  const vacancy = { ocdId, sourceUrl: "https://clerk.house.gov/xml/lists/MemberData.xml", sourceOrg: "House Clerk",
    collectedAt: "2026-10-18T03:15:00Z", reason: "Vacancy due to resignation" };
  const answer: ReaderStateResponse = { ...state, state: "FL", zip: "33311",
    coverage: { ...coverage, seats: [{ ocdId, label: "Florida Congressional District 20", divisionType: "cd", tier: "national", representatives: [], vacancy }] },
    zipPlaces: { "33311": { ids: [ocdId], partial: [], samples: 1 } } };
  t.mock.method(globalThis, "fetch", async () => Response.json(answer));
  const held = await loadReaderState("FL", "33311");
  assert.deepEqual(getCachedStateDivision(ocdId)?.vacancy, vacancy);
  const scoped = stateCoverageForZip(held, "33311");
  assert.deepEqual(mergeReaderCoverage(scoped, coverage, 0)?.seats[0].vacancy, vacancy);
  assert.equal(getCachedStateDivision(ocdId)?.holders.length, 0);
});

for (const first of ["state", "place"] as const) {
  test(`state and place start together and publish state first when ${first} arrives first`, async () => {
    const stateRead = deferred<ReaderStateResponse>(), placeRead = deferred<MeetingSearchResult>();
    const events: string[] = [];
    const done = loadStateAndPlace({
      state: () => { events.push("start-state"); return stateRead.promise; },
      place: () => { events.push("start-place"); return placeRead.promise; },
      signal: new AbortController().signal,
      onState: () => { events.push("state"); }, onPlace: () => { events.push("place"); },
    });
    assert.deepEqual(events, ["start-state", "start-place"]);
    if (first === "state") stateRead.resolve(state); else placeRead.resolve(place);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    assert.ok(!events.includes("place"));
    stateRead.resolve(state); placeRead.resolve(place); await done;
    assert.deepEqual(events, ["start-state", "start-place", "state", "place"]);
  });
}

test("a superseded view cannot publish a late state or local result", async () => {
  const stateRead = deferred<ReaderStateResponse>(), placeRead = deferred<MeetingSearchResult>();
  const controller = new AbortController(), events: string[] = [];
  const done = loadStateAndPlace({ state: () => stateRead.promise, place: () => placeRead.promise, signal: controller.signal,
    onState: () => { events.push("state"); }, onPlace: () => { events.push("place"); } });
  controller.abort(); stateRead.resolve(state); placeRead.resolve(place); await done;
  assert.deepEqual(events, []);
});

test("a failed state request still publishes the independent place result", async () => {
  let shown: MeetingSearchResult | null = null;
  await loadStateAndPlace({ state: () => Promise.reject(new Error("state unavailable")), place: () => Promise.resolve(place), signal: new AbortController().signal,
    onState: () => assert.fail("unavailable state"), onPlace: result => { shown = result; } });
  assert.equal(shown, place);
});

test("ZIP coverage filters other districts and final local coverage retains state seats", () => {
  const own = "ocd-division/country:us/state:az/cd:7", other = "ocd-division/country:us/state:az/cd:1";
  const seats: CoverageSummary["seats"] = [own, other].map(ocdId => ({ ocdId, label: ocdId, divisionType: "cd", tier: "national", representatives: [] }));
  const scoped = stateCoverageForZip({ ...state, coverage: { ...coverage, seats }, zipPlaces: { "85701": { ids: [own], partial: [own], samples: 4 } } }, "85701");
  assert.deepEqual(scoped?.seats.map(seat => seat.ocdId), [own]);
  assert.deepEqual(mergeReaderCoverage(scoped, coverage, 0)?.seats.map(seat => seat.ocdId), [own]);
  const updated = stateCoverageForZip({ ...state, coverage: { ...coverage, seats }, zipPlaces: { "85701": { ids: [own], partial: [], samples: 4 } } }, "85701", { ids: [other], partial: [], samples: 0 });
  assert.deepEqual(updated?.seats.map(seat => seat.ocdId), [other], "a newer Census resolution replaces provisional ZIP membership");
  assert.deepEqual(stateCoverageForZip({ ...state, coverage: { ...coverage, seats } }, "85701")?.seats, [], "an unindexed postal ZIP still receives statewide information without the whole state's district seats");
});

test("subsequent ZIPs share the state's request and recheck after thirty seconds", async () => {
  const original = globalThis.fetch, now = Date.now;
  const urls: string[] = [];
  globalThis.fetch = async input => { urls.push(String(input)); return Response.json(state); };
  try {
    const first = loadReaderState("AZ"), second = loadReaderState("US-az");
    assert.equal(first, second);
    await first;
    await loadReaderState("AZ");
    assert.deepEqual(urls, ["/api/reader/state?state=AZ"]);
    Date.now = () => now() + 31_000;
    await loadReaderState("AZ");
    assert.equal(urls.length, 2, "new information is rechecked without a page reload");
  } finally { globalThis.fetch = original; Date.now = now; }
});

test("compact ZIP responses neither fetch the state directory nor suppress unopened districts", async () => {
  const original = globalThis.fetch;
  const root = "ocd-division/country:us/state:vt", first = `${root}/sldu:1`, second = `${root}/sldu:2`;
  const urls: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input), zip = new URL(url, "http://localhost").searchParams.get("zip")!;
    urls.push(url);
    const ocdId = zip === "05001" ? first : second;
    return Response.json({ ...state, state: "VT", zip, coverage: { ...coverage,
      seats: [{ ocdId, label: ocdId, divisionType: "sldu", tier: "state", representatives: [] }],
    }, zipPlaces: { [zip]: { ids: [ocdId], partial: [], samples: 1 } } });
  };
  try {
    await loadReaderState("VT", "05001");
    assert.deepEqual(getCachedStateDivision(first)?.holders, [], "a held empty seat answers without another fetch");
    assert.equal(getCachedStateDivision(second), null, "a district outside the selected ZIP remains available on click");
    await loadReaderState("VT", "05001");
    await loadReaderState("VT", "05401");
    assert.deepEqual(getCachedStateDivision(second)?.holders, []);
    assert.deepEqual(urls, ["/api/reader/state?state=VT&zip=05001", "/api/reader/state?state=VT&zip=05401"]);
  } finally { globalThis.fetch = original; }
});

test("the complete state answers other state seats, including empty seats, while local divisions stay with place facts", async () => {
  const original = globalThis.fetch, now = Date.now;
  const pending = deferred<Response>();
  const root = "ocd-division/country:us/state:oh", district = `${root}/cd:3`, empty = `${root}/sldu:9`, local = `${root}/county:franklin`;
  globalThis.fetch = () => pending.promise;
  try {
    const loading = loadReaderState("OH");
    assert.equal(isStateDivisionPending(district), true);
    assert.equal(isStateDivisionPending(local), false);
    assert.equal(getCachedStateCoverageForDivision(district), null);
    const value = { ...state, state: "OH", coverage: { ...coverage,
      seats: [{ ocdId: district, label: "Third district", divisionType: "cd" as const, tier: "national" as const, representatives: [] }],
    } };
    pending.resolve(Response.json(value));
    await loading;
    assert.equal(isStateDivisionPending(district), false);
    assert.deepEqual(getCachedStateDivision(district)?.holders, []);
    assert.deepEqual(getCachedStateDivision(empty)?.holders, [], "the state knows even a missing seat's source has no holder to show");
    assert.equal(getCachedStateCoverageForDivision(local), null);
    assert.equal(getCachedStateCoverageForDivision("ocd-division/country:us/state:wv/cd:3"), null, "Ohio's cached package cannot answer another state");
    Date.now = () => now() + 31_000;
    assert.equal(getCachedStateCoverageForDivision(district), null, "expired state data cannot suppress a fresh lookup");
  } finally { globalThis.fetch = original; Date.now = now; }
});
