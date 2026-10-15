import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { planDerivedVersion, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import {
  bodySourceWiringFor,
  derivedWiringCandidate,
  derivedWiringEntries,
  derivedWiringKey,
  familyMembers,
  readDerivedMeetingWiring,
} from "../lib/civic-data/derived-meeting-wiring.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { manualProjectionCandidate, type CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { CROSSWALK_CITATION, subBodyId, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { installReviewedMeetingDoors, publishReviewedMeetingBody, reviewedMeetingPartition } from "./helpers/meeting-body-publication.ts";
import {
  processRegisteredManualCandidate,
  processRegisteredRoutineCandidate,
} from "../lib/civic-data/promotion.ts";
import { ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { deriveWiringDecisions } from "../lib/control-plane/discovery/derived-wiring.ts";
import { walkMeetingsDiscoveryNeed, type DiscoveryOpen } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { readMeetingsProjection, reconcileCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { preparePublishedMeetingSnapshot } from "../lib/meetings/prepared-snapshot.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { buildCompositeSource } from "../lib/sources/composite/wiring.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import type { DerivedWiringRecord } from "../lib/civic-data/derived-meeting-wiring.ts";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const OCD = "ocd-division/country:us/state:az/place:testville";
const HOST = "www.testville.example.gov";
const ROUTE = `https://${HOST}/common/modules/iCalendar/iCalendar.aspx?catID=49&feed=calendar`;
const BODY_PAGE = `https://${HOST}/Calendar.aspx?EID=2823`;
const BODY_NAME = "Housing Commission";
const BODY_ID = subBodyId(OCD, BODY_NAME);

function ics(events: readonly { uid: string; summary: string; start: string }[]): string {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    ...events.flatMap((e) => ["BEGIN:VEVENT", `UID:${e.uid}`, `SUMMARY:${e.summary}`, `DTSTART;TZID=America/Phoenix:${e.start}`, "END:VEVENT"]),
    "END:VCALENDAR", "",
  ].join("\r\n");
}
const FEED = ics([
  { uid: "h1", summary: "Housing Commission", start: "20261008T160000" },
  { uid: "t1", summary: "Tourism Commission Meeting", start: "20261009T160000" },
]);
const PAGE = `<html><body><h1>Housing Commission</h1><p>The Housing Commission serves as an advisory board to City Council.</p></body></html>`;

const T_WALK = "2026-09-24T19:00:00.000Z";
const T_CROSSWALK = "2026-09-24T19:30:00.000Z";
const T_WIRING = "2026-09-24T20:00:00.000Z";
const T_FAMILY = "2026-09-24T20:30:00.000Z";
const T_SECOND = "2026-09-24T21:30:00.000Z";

function crosswalkRow(): MeetingBodyCrosswalkRow {
  return {
    id: `${BODY_ID}|ICAL`,
    jurisdictionId: "az:city:city-of-testville",
    ocdId: OCD,
    bodyId: BODY_ID,
    bodyRole: "SUB_BODY",
    bodyName: BODY_NAME,
    kind: "ICAL",
    route: ROUTE,
    officialHost: HOST,
    filter: { titleMatch: BODY_NAME },
    publishingOrg: "City of Testville",
    timeZone: "America/Phoenix",
    evidence: {
      bodyPage: { url: BODY_PAGE, sha256: sha256(PAGE), quote: "The Housing Commission serves as an advisory board to City Council." },
      calendar: { url: ROUTE, sha256: sha256(FEED), selected: 1, total: 2 },
      readAt: "2026-09-24T19:10:00.000Z",
    },
    status: "ACTIVE",
    reviewedBy: "a reviewing agent session (test)",
    reviewedAt: "2026-09-24T19:20:00.000Z",
    authorization: CROSSWALK_CITATION,
  };
}

async function promoteCrosswalk(store: MemoryRoutineDataStore): Promise<DerivedInputRef> {
  const row = crosswalkRow();
  const source = (url: string, rawHash: string) => ({
    requestedUrl: url, finalUrl: url, publisher: "City of Testville", sourceClass: "OFFICIAL_PUBLISHER" as const,
    retrievedAt: row.evidence.readAt, httpStatus: 200, rawHash, reviewedEvidence: "The page names the commission; the feed's events carry its name.",
  });
  const outcome = await processRegisteredManualCandidate(store, "meeting-body-crosswalk", manualProjectionCandidate({
    contractId: "meeting-body-crosswalk",
    version: T_CROSSWALK,
    sourceThrough: T_CROSSWALK,
    sourceReceipt: { contractVersion: 1, reviewedAt: T_CROSSWALK, reviewedBy: row.reviewedBy, sources: [source(ROUTE, sha256(FEED)), source(BODY_PAGE, sha256(PAGE))] },
    payload: { kind: "meeting-body-crosswalk", records: [row] as unknown as CuratedReaderProjection["records"] },
  }), T_CROSSWALK);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureDetail ?? "");
  const read = await readCuratedReaderProjection("meeting-body-crosswalk", { store, bypassCache: true, now: T_CROSSWALK });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("crosswalk not promoted");
  const contract = requiredManualProductionContract("meeting-body-crosswalk");
  return {
    kind: "PROMOTED_VERSION", recordClass: contract.recordClass, scope: contract.scope, versionId: read.metadata.versionId!,
    readModelSha256: sha256(canonicalCivicDataJson(read.value)), promotedAt: read.metadata.promotedAt!,
  };
}

async function walk(feed: string, feedStatus = 200) {
  const map: Record<string, { status: number; body: string; contentType?: string; location?: string }> = {
    "https://testville.example.gov/robots.txt": { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" },
    "https://testville.example.gov/": { status: 301, body: "", location: `https://${HOST}/` },
    [`https://${HOST}/robots.txt`]: { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" },
    [`https://${HOST}/`]: { status: 200, body: `<a href="${ROUTE}">Boards and Commissions calendar</a>` },
    [ROUTE]: { status: feedStatus, body: feed, contentType: "text/calendar" },
  };
  const open: DiscoveryOpen = async ({ url }) => {
    const r = map[url] ?? { status: 404, body: "not found" };
    return { status: r.status, body: r.body, bytes: r.body.length, contentType: r.contentType ?? "text/html", location: r.location ?? null, transportError: null };
  };
  let tick = 0;
  return walkMeetingsDiscoveryNeed({
    jurisdictionId: "az:city:city-of-testville", stateCode: "AZ", name: "CITY OF TESTVILLE", govClass: "CITY_OR_TOWN",
    ownWebAddress: "testville.example.gov", basis: "SOURCE_DISCOVERY_OWED", sources: [],
    addressSource: { source: "GAP_LEDGER", versionId: "b".repeat(64) },
  }, {
    open, spaceOut: async () => {}, vault: async (a) => ({ stored: true, where: `vault/${a.id}`, why: "stored" }),
    now: () => new Date(Date.parse(T_WALK) + (tick++) * 1000).toISOString(), budget: { spent: () => false },
  });
}

async function deriveWiring(store: MemoryRoutineDataStore, crosswalkInput: DerivedInputRef, feed: string, now: string, feedStatus = 200, options: { readonly confirmUnchanged?: boolean } = {}) {
  const attempt = await walk(feed, feedStatus);
  const previousRead = await readDerivedMeetingWiring({ store, bypassCache: true, now });
  const previous = previousRead.kind === "PROMOTED" ? derivedWiringEntries(previousRead.value) : [];
  const vaulted = (artifactId: string) => ({ kind: "VAULTED_EVIDENCE" as const, artifactId, contentHash: `sha256-${sha256(feed)}`, tier: "RAW" as const, retrievedAt: T_WALK });
  const decisions = deriveWiringDecisions({
    crosswalk: { input: crosswalkInput, versionId: "xw", rows: [crosswalkRow()] },
    registration: () => ({ input: crosswalkInput }),
    attempts: [{ attempt, recordId: "1", recordedAt: attempt.finishedAt }],
    handWired: () => false,
    vaulted,
    vaultedBytes: (hex) => (hex === sha256(PAGE) ? { ...vaulted("ar-body-page"), contentHash: `sha256-${hex}` } : null),
    verify: (row, binding, evidence) => {
      const meetings = readFeed(feed, now);
      const own = meetings.filter((m) => m.bodyId === row.bodyId);
      return own.length === 0
        ? { changed: "the reviewed filter selects none of the feed's events" }
        : { verified: { adapter: binding.adapter, closureDigest: binding.closureDigest, verifiedAt: now, sittings: own.length, evidence }, selected: own.map((m) => `${m.startsAt}|${m.title}`) };
    },
    adapterDigest: () => "ical@test",
    previous,
    now,
  });
  const plan = planDerivedVersion(previous, decisions);
  assert.deepEqual(plan.refusals, []);
  const candidate = derivedWiringCandidate(plan, [crosswalkInput], now);
  return { decisions, plan, candidate, outcome: await processRegisteredRoutineCandidate(store, "meeting-source-wiring", candidate, now, undefined, options) };
}

function readFeed(feed: string, now: string): Meeting[] {
  const wiring = bodySourceWiringFor({
    bodyId: BODY_ID, ocdId: OCD, bodyName: BODY_NAME, kind: "ICAL", route: ROUTE, officialHost: HOST, jurisdictionId: "az:city:city-of-testville",
    state: "US-AZ", publishingOrg: "City of Testville", timeZone: "America/Phoenix",
    config: { slug: "derived-az-place-testville-body-housing-commission", bodyName: BODY_NAME, feedUrl: ROUTE, titleMatch: BODY_NAME },
    crosswalkRowId: `${BODY_ID}|ICAL`, reviewedAt: "2026-09-24T19:20:00.000Z", verifiedAt: "2026-09-24T19:10:00.000Z",
  });
  return makeIcalSource([wiring]).normalizeWithDrops([{ wiring, ics: feed, collectedAt: now, sourceUrl: ROUTE }], new Date(now)).meetings;
}

async function connect(store: MemoryRoutineDataStore): Promise<{ member: DerivedWiringRecord; crosswalk: DerivedInputRef }> {
  const crosswalk = await promoteCrosswalk(store);
  const result = await deriveWiring(store, crosswalk, FEED, T_WIRING);
  assert.equal(result.outcome.candidate.state, "PROMOTED", result.outcome.candidate.failureDetail ?? "");
  const wiring = await readDerivedMeetingWiring({ store, bypassCache: true, now: T_FAMILY });
  assert.equal(wiring.kind, "PROMOTED");
  if (wiring.kind !== "PROMOTED") throw new Error("no wiring");
  const [member] = familyMembers(wiring.value, "US-AZ");
  installReviewedMeetingDoors([member], T_FAMILY);
  return { member, crosswalk };
}

function publish(store: MemoryRoutineDataStore, member: DerivedWiringRecord, now: string, feed = FEED,
  options: { meetings?: readonly Meeting[]; host?: string; error?: string } = {}) {
  const url = ROUTE.replace(HOST, options.host ?? HOST);
  return publishReviewedMeetingBody({ store, member, now, meetings: options.meetings ?? readFeed(feed, now),
    acquisitions: options.error ? [] : [{ requestedUrl: url, finalUrl: url, httpStatus: 200, rawHash: sha256(feed), byteCount: feed.length }],
    error: options.error });
}

test("a reviewed calendar publishes its body immediately and keeps updating through the same door", async () => {
  const store = new MemoryRoutineDataStore();
  const { member } = await connect(store);
  const first = await publish(store, member, T_FAMILY);
  assert.equal(first.outcome.candidate.state, "PROMOTED", first.outcome.candidate.failureDetail ?? "");
  assert.deepEqual(first.snapshot.meetings.map(row => row.title), [BODY_NAME]);
  assert.equal(first.partition.bodyId, BODY_ID);
  const reader = await readMeetingsProjection({ store, now: T_FAMILY, bypassCache: true });
  assert.equal(reader.kind, "PROMOTED");
  if (reader.kind !== "PROMOTED") return;
  assert.deepEqual(reader.value.meetings.map(row => row.bodyId), [BODY_ID]);
  assert.equal(reader.partitions.find(row => row.contractId === first.partition.id)?.kind, "PROMOTED");
  const changed = await publish(store, member, T_SECOND, ics([
    { uid: "h1", summary: BODY_NAME, start: "20261008T160000" },
    { uid: "h2", summary: BODY_NAME, start: "20261105T160000" },
  ]));
  assert.equal(changed.outcome.candidate.state, "PROMOTED", changed.outcome.candidate.failureDetail ?? "");
  assert.equal(changed.snapshot.meetings.length, 2);
  assert.equal((await preparePublishedMeetingSnapshot(store, T_SECOND)).status, "PUBLISHED");
});

test("two calendars for one body combine distinct dates and repeated IDs within that body's partition", async () => {
  const store = new MemoryRoutineDataStore();
  const { member } = await connect(store);
  const route = `https://${HOST}/second.ics`;
  const second = { ...member, id: derivedWiringKey(member.row.kind, member.row.bodyId, route),
    row: { ...member.row, route, config: { ...member.row.config, feedUrl: route } } };
  installReviewedMeetingDoors([member, second], T_FAMILY);
  assert.equal(reviewedMeetingPartition(member).id, reviewedMeetingPartition(second).id);
  const calendars = [FEED, ics([
    { uid: "h1", summary: BODY_NAME, start: "20261008T160000" },
    { uid: "h2", summary: BODY_NAME, start: "20261105T160000" },
  ])];
  const reads: string[] = [];
  const source = buildCompositeSource({ sourceNames: ["ical"], meetingPartitions: [{ sourceName: "ical", bodyId: member.row.bodyId }], captureAcquisitionEvidence: true,
    fetchImpl: meetingFetchPass({ fetchImpl: async input => {
      const url = String(input); reads.push(url);
      return new Response(calendars[url === ROUTE ? 0 : 1], { headers: { "content-type": "text/calendar" } });
    } }) });
  const meetings = source.normalize(await source.fetch({ lat: 33, lng: -111, radiusKm: 20 }), new Date(T_FAMILY));
  assert.deepEqual(reads.sort(), [ROUTE, route].sort());
  assert.deepEqual(meetings.map(row => row.startsAt.slice(0, 10)).sort(), ["2026-10-08", "2026-11-05"]);
  const published = await publishReviewedMeetingBody({ store, member, now: T_FAMILY, meetings,
    acquisitions: source.lastReport!.children[0].acquisitions! });
  assert.equal(published.outcome.candidate.state, "PROMOTED", published.outcome.candidate.failureDetail ?? "");
  assert.doesNotThrow(() => reconcileCounts(published.snapshot));
});

test("an invalid row leaves its prior good fact live while a verified sibling publishes", async () => {
  const store = new MemoryRoutineDataStore();
  const { member } = await connect(store);
  const first = await publish(store, member, T_FAMILY);
  const prior = first.snapshot.meetings[0];
  const next = await publish(store, member, T_SECOND, FEED, { meetings: [
    { ...prior, startsAt: "unconfirmed" },
    { ...prior, id: "ical:new", title: "New verified sitting", startsAt: "2026-11-05T23:00:00.000Z" },
    { ...prior, id: "ical:foreign", bodyId: "another-body" },
  ] });
  assert.equal(next.outcome.candidate.state, "PROMOTED", next.outcome.candidate.failureDetail ?? "");
  assert.equal(next.snapshot.meetings.find(row => row.id === prior.id)?.startsAt, prior.startsAt);
  assert.ok(next.snapshot.meetings.find(row => row.id === prior.id)?.carried);
  assert.ok(next.snapshot.meetings.some(row => row.id === "ical:new"));
  assert.ok(!next.snapshot.meetings.some(row => row.id === "ical:foreign"));
  assert.ok(next.candidate.excludedFacts?.some(row => row.code === "MEETING_ROW_UNVERIFIED"));
});

test("an unreachable or off-host calendar leaves its last verified body partition live", async () => {
  const store = new MemoryRoutineDataStore();
  const { member } = await connect(store);
  const first = await publish(store, member, T_FAMILY);
  const pointer = await store.readPromotionIdentity("MEETING", first.partition.scope);
  await assert.rejects(publish(store, member, T_SECOND, FEED, { host: "attacker.example.org" }), /FINAL_ROUTE_NOT_REGISTERED/);
  const failed = await publish(store, member, "2026-09-24T22:30:00.000Z", FEED, { error: "HTTP 503" });
  assert.equal(failed.outcome.promoted, null);
  assert.equal((await store.readPromotionIdentity("MEETING", first.partition.scope))?.versionId, pointer?.versionId);
  const reader = await readMeetingsProjection({ store, now: "2026-10-01T12:00:00.000Z", bypassCache: true });
  assert.equal(reader.kind, "PROMOTED");
  if (reader.kind === "PROMOTED") {
    assert.equal(reader.value.meetings[0].bodyId, BODY_ID);
    assert.equal(reader.metadata.stale, "STALE");
    assert.equal(reader.metadata.retrievedAt, T_FAMILY);
  }
});

test("a suspended connection keeps its previously verified meetings visible without running its clock", async () => {
  const store = new MemoryRoutineDataStore();
  const { member } = await connect(store);
  const first = await publish(store, member, T_FAMILY);
  installReviewedMeetingDoors([{ ...member, status: "SUSPENDED" }], T_SECOND);
  assert.equal(reviewedMeetingPartition(member).suspended, true);
  assert.ok(!ROUTINE_SOURCE_TASKS.some(task => task.id === first.partition.id));
  const reader = await readMeetingsProjection({ store, now: T_SECOND, bypassCache: true });
  assert.equal(reader.kind, "PROMOTED");
  if (reader.kind === "PROMOTED") assert.equal(reader.value.meetings[0].bodyId, BODY_ID);
});

test("a wiring version that drops a row is refused and keeps the last known good connection", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalk = await promoteCrosswalk(store);
  const first = await deriveWiring(store, crosswalk, FEED, T_WIRING);
  const dropped = derivedWiringCandidate({ ...first.plan, rows: [], promoted: [], carried: [] }, [crosswalk], T_SECOND);
  const outcome = await processRegisteredRoutineCandidate(store, "meeting-source-wiring", dropped, T_SECOND);
  assert.equal(outcome.promoted, null);
  const live = await readDerivedMeetingWiring({ store, bypassCache: true, now: T_SECOND });
  assert.equal(live.kind === "PROMOTED" ? live.value.records.length : 0, 1);
});

test("unchanged body checks confirm the existing version and retain its original source evidence", async () => {
  const store = new MemoryRoutineDataStore();
  const { member } = await connect(store);
  const first = await publish(store, member, T_FAMILY);
  const next = await publish(store, member, T_SECOND);
  assert.equal(next.outcome.confirmed?.versionId, first.outcome.candidate.candidate.id, next.outcome.candidate.failureDetail ?? "");
  assert.equal(await store.readCandidateSummary(next.candidate.id), null);
  assert.equal((await store.readPromotionIdentity("MEETING", first.partition.scope))?.versionId, first.candidate.id);
  const held = (await store.readCandidate(first.candidate.id))!.candidate.readModel as MeetingsSnapshot;
  assert.equal(held.meetings[0].provenance.collectedAt, T_FAMILY);
});
