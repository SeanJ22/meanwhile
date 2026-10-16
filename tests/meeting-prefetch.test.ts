import assert from "node:assert/strict";
import test from "node:test";
import { meetingPrefetchSeeds } from "../lib/civic-data/meeting-prefetch.ts";
import { buildMeetingPartitions, MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import type { RoutineDataStore } from "../lib/civic-data/store.ts";
import type { PromotedProjection, RoutineRecordClass } from "../lib/civic-data/types.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import type { SourceAcquisitionEvidence } from "../lib/sources/acquisition-trace.ts";
import { civicPlusCalendarRequests, makeCivicPlusSource } from "../lib/sources/civicplus/index.ts";
import { SOURCE_PREFETCH_MAX_BYTES, prefetchSourceRequests, runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import { memoryWebsitePacing } from "../lib/control-plane/website-pacing.ts";
import type { SavedSourceResponse, SourceFetchStore } from "../lib/sources/fetch-source-state.ts";
import { fetchEvents } from "../lib/sources/legistar/client.ts";
import { legistarReadWindow } from "../lib/sources/legistar/index.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import { makeCivicClerkSource } from "../lib/sources/civicclerk/index.ts";
import { makeDiligentSource } from "../lib/sources/diligent/index.ts";
import { makeIqm2Source } from "../lib/sources/iqm2/index.ts";
import { makeApptegySource } from "../lib/sources/apptegy/index.ts";
import { makeNovusAgendaSource } from "../lib/sources/novusagenda/index.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../lib/meetings/constants.ts";

const wiring: BodySourceWiring = { bodyId: "ocd-division/country:us/state:il/place:fixture#governing",
  ocdId: "ocd-division/country:us/state:il/place:fixture", agendaSourceType: "CIVICPLUS", jurisdiction: "Fixture",
  publishingOrg: "Fixture Clerk", timeZone: "America/Chicago", verifiedAt: "2026-10-15T12:00:00.000Z",
  config: { slug: "fixture", icalUrl: "https://fixture.gov/calendar.ics?CID=7" } };
const partition = buildMeetingPartitions([wiring])[0]!;
const evidence = (url: string, byteCount = 220_402): SourceAcquisitionEvidence => ({ source: "civicplus", requestedUrl: url,
  finalUrl: url, httpStatus: 200, rawHash: "a".repeat(64), byteCount });

function held(acquisitions: readonly SourceAcquisitionEvidence[], reads: string[] = [], source = "civicplus", generatedAt = "2026-10-14T12:00:00.000Z"): Pick<RoutineDataStore, "readPromotion"> {
  return { async readPromotion<T>(recordClass: string, scope: string) {
    assert.equal(recordClass, "MEETING"); reads.push(scope);
    return { sourceId: partition.sourceId, scope, payload: { generatedAt, sources: [{ source, acquisitions }] } } as PromotedProjection<T>;
  } };
}

test("rollout prefetch uses current calendar requests and only that body's matching held byte count", async () => {
  const priorRegistry = MEETING_PARTITION_CONTRACTS.map(row => row.id), reads: string[] = [];
  const root = civicPlusCalendarRequests(wiring)[0]!;
  const [seed] = await meetingPrefetchSeeds(held([evidence("https://fixture.gov/old-calendar.ics"), evidence(root.url)], reads), partition);
  assert.deepEqual(seed, { ...root, byteCount: 220_402 });
  assert.deepEqual(reads, [partition.scope]);
  assert.deepEqual(MEETING_PARTITION_CONTRACTS.map(row => row.id), priorRegistry);
  assert.deepEqual(await meetingPrefetchSeeds(held([evidence("https://fixture.gov/old-calendar.ics")]), partition), []);
  assert.deepEqual(await meetingPrefetchSeeds(held([evidence(root.url, SOURCE_PREFETCH_MAX_BYTES + 1)]), partition), []);
  assert.deepEqual(await meetingPrefetchSeeds(held([evidence(root.url), evidence(root.url, SOURCE_PREFETCH_MAX_BYTES + 1)]), partition), []);
  assert.deepEqual(await meetingPrefetchSeeds(held([evidence(root.url, -1)]), partition), []);
  assert.deepEqual(await meetingPrefetchSeeds(held([{ ...evidence(root.url), httpStatus: 403 }]), partition), []);
  const skipped: string[] = [];
  assert.deepEqual(await meetingPrefetchSeeds(held([], skipped), { ...partition, suspended: true }), []);
  assert.deepEqual(await meetingPrefetchSeeds(held([], skipped), { ...partition, meetingSource: "legistar" }), []);
  assert.deepEqual(skipped, []);
});

test("prefetch bounds held body reads independently of queued transport work and releases failed reads", async () => {
  let active = 0, peak = 0, started = 0;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const source = held([evidence(wiring.config.icalUrl)]);
  const store: Pick<RoutineDataStore, "readPromotion"> = { async readPromotion<T>(recordClass: RoutineRecordClass, scope: string) {
    const index = started++; active++; peak = Math.max(peak, active);
    try {
      await waiting;
      if (index === 5) throw new Error("held body unavailable");
      return await source.readPromotion<T>(recordClass, scope);
    } finally { active--; }
  } };
  const pending = Promise.allSettled(Array.from({ length: 64 }, () => meetingPrefetchSeeds(store, partition)));
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(started, 4);
    assert.equal(active, 4);
  } finally { release(); }
  const results = await pending;
  assert.equal(started, 64);
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.equal(results.filter(result => result.status === "fulfilled" && result.value[0]?.byteCount === 220_402).length, 63);
});

test("Legistar prefetch rebuilds current dates through the actual request builder instead of replaying an old query", async () => {
  const selected = buildMeetingPartitions([{ ...wiring, agendaSourceType: "LEGISTAR", config: {
    slug: "fixture", sourceRoutes: "legistar", eventBodyId: "42",
  } }])[0]!;
  const oldAt = new Date("2026-10-14T12:00:00.000Z"), now = new Date("2026-10-15T12:00:00.000Z");
  const requests: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => { requests.push(new Request(input, init)); return new Response("[]"); };
  for (const at of [oldAt, now]) await fetchEvents("fixture", { ...legistarReadWindow(at), bodyId: 42 }, { fetchImpl });
  const [seed] = await meetingPrefetchSeeds(held([{ ...evidence(requests[0]!.url), source: "legistar" }], [], "legistar", oldAt.toISOString()), selected, now);
  assert.ok(seed);
  assert.equal(seed.url, requests[1]!.url);
  assert.notEqual(seed.url, requests[0]!.url);
  assert.deepEqual(seed.headers, [...requests[1]!.headers].filter(([name]) => name !== "user-agent"));
  assert.equal(seed.byteCount, 220_402);
  const otherBody = requests[0]!.url.replace("BodyId%20eq%2042", "BodyId%20eq%2043");
  assert.notEqual(otherBody, requests[0]!.url);
  assert.deepEqual(await meetingPrefetchSeeds(held([{ ...evidence(otherBody), source: "legistar" }], [], "legistar", oldAt.toISOString()), selected, now), []);
});

test("CivicPlus descriptors match every RSS, calendar and AgendaCenter root the adapter reads", async () => {
  for (const row of [wiring, { ...wiring, config: { ...wiring.config, agendaCenterUrl: "https://fixture.gov/AgendaCenter", agendaCenterCategoryId: "7" } }]) {
    const expected = civicPlusCalendarRequests(row);
    const requests: Request[] = [];
    const source = makeCivicPlusSource([row], async (input, init) => {
      const request = new Request(input, init); requests.push(request);
      const accept = request.headers.get("accept")!;
      return new Response(accept === "text/calendar" ? "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR"
        : accept === "application/rss+xml" ? "<rss><channel></channel></rss>" : '<html><div id="cat7"></div></html>',
      { headers: { "content-type": accept } });
    }, { store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks });
    await source.fetch({ lat: 0, lng: 0, radiusKm: 1 });
    assert.equal(requests.length, expected.length);
    for (const [index, request] of requests.entries()) {
      assert.equal(request.method, "GET"); assert.equal(request.url, expected[index]!.url); assert.equal(request.redirect, expected[index]!.redirect);
      assert.deepEqual([...request.headers].filter(([name]) => name !== "user-agent"), expected[index]!.headers);
    }
    const selected = buildMeetingPartitions([row])[0]!;
    const seeds = await meetingPrefetchSeeds(held(requests.map(request => evidence(request.url))), selected);
    assert.deepEqual(seeds, expected.map(request => ({ ...request, byteCount: 220_402 })));
    assert.equal(seeds.length, row.config.agendaCenterUrl ? 3 : 1);
  }
});

test("a CivicPlus adapter consumes prefetched 200 and 304 responses without a second physical request", async () => {
  const saved = new Map<string, SavedSourceResponse>(), vault = new MemoryEvidenceStore();
  const store: SourceFetchStore = { pacing: memoryWebsitePacing(), withLease: async (_key, work) => work(),
    read: async key => saved.get(key) ?? null, readRequestPlan: async () => ({ calendar: [], documents: {} }), saveRequestGroup: async () => {},
    record: async (key, value) => { if (value) saved.set(key, value); } };
  const locks = createMemoryRepositories().locks, calls: Headers[] = [];
  let now = Date.parse("2026-10-15T12:00:00.000Z");
  const runtime = { store, now: () => now, transport: (async (_input, init) => {
    calls.push(new Headers(init?.headers));
    if (calls.length > 1) { assert.equal(calls.at(-1)!.get("if-none-match"), '"calendar-one"'); return new Response(null, { status: 304 }); }
    return new Response("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR", { headers: { etag: '"calendar-one"', "content-type": "text/calendar" } });
  }) as typeof fetch };
  for (let pass = 0; pass < 2; pass++) {
    const dueAt = new Date(now).toISOString();
    const [seed] = await meetingPrefetchSeeds(held([evidence(wiring.config.icalUrl)]), partition);
    await runWithSourceFetch({ sourceId: partition.id, state: "US-IL", dueAt, vault, runtime }, async () => {
      await prefetchSourceRequests({ sourceId: partition.id, state: "US-IL", dueAt, seeds: seed ? [seed] : [] });
      const source = makeCivicPlusSource([wiring], undefined, { store: vault, locks, now: () => dueAt });
      const raw = await source.fetch({ lat: 0, lng: 0, radiusKm: 1 });
      assert.equal(raw[0]!.collectedAt, dueAt);
      assert.match(raw[0]!.ical, /BEGIN:VCALENDAR/);
    });
    assert.equal(calls.length, pass + 1, "normal adapter parsing shares the exact prefetched response identity");
    now += 3_600_000;
  }
  assert.equal(saved.size, 1, "seed and adapter headers, URL and redirect identify the same saved response");
});

test("query-root seeds use each adapter's current GET with its exact headers and redirect", async () => {
  const cases = [
    { source: "ical", type: "ICAL", config: { feedUrl: "https://fixture.gov/feed?ical=1" }, make: makeIcalSource },
    { source: "civicclerk", type: "CIVICCLERK", config: { apiBase: "https://fixture.api.civicclerk.com" }, make: makeCivicClerkSource },
    { source: "diligent", type: "DILIGENT", config: { serviceBase: "https://fixture.civicweb.net" }, make: makeDiligentSource },
    { source: "iqm2", type: "IQM2", config: { base: "https://fixture.iqm2.com" }, make: makeIqm2Source },
    { source: "apptegy", type: "APPTEGY", config: { apiBase: "https://fixture.api.thrillshare.com" }, make: makeApptegySource },
    { source: "novusagenda", type: "NOVUSAGENDA", config: { portalUrl: "https://fixture.novusagenda.com/AgendaPublic", bodyMatch: "Council" }, make: makeNovusAgendaSource },
  ] as const;
  const originalNow = Date.now;
  try {
    for (const row of cases) {
      const current: BodySourceWiring = { ...wiring, agendaSourceType: row.type, config: { ...row.config, slug: "fixture" } };
      const selected = buildMeetingPartitions([current])[0]!;
      const requests: Request[] = [];
      for (const at of ["2026-10-14T12:00:00.000Z", "2026-10-15T12:00:00.000Z"]) {
        const now = Date.parse(at), stop = new AbortController(); Date.now = () => now;
        const source = row.make([current], async (input, init) => {
          requests.push(new Request(input, init)); stop.abort(new Error("captured first GET")); throw stop.signal.reason;
        });
        await source.fetch({ lat: 0, lng: 0, radiusKm: 1, signal: stop.signal,
          startsAfter: new Date(now - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString(),
          startsBefore: new Date(now + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString(),
        }).catch(() => []);
      }
      assert.equal(requests.length, 2, row.source);
      const [seed] = await meetingPrefetchSeeds(held([{ ...evidence(requests[0]!.url), source: row.source }], [], row.source), selected, new Date("2026-10-15T12:00:00.000Z"));
      assert.ok(seed, row.source);
      assert.equal(requests[1]!.method, "GET", row.source);
      assert.equal(seed.url, requests[1]!.url, row.source);
      assert.equal(seed.redirect, requests[1]!.redirect, row.source);
      assert.deepEqual(seed.headers, [...requests[1]!.headers].filter(([name]) => name !== "user-agent"), row.source);
    }
  } finally { Date.now = originalNow; }
});
