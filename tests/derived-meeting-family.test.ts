/**
 * A reviewed calendar publishes through the runner's doors with no code release, and keeps its verified sittings
 * through temporary outages. Every step is the production door, on the in-memory store:
 *
 * 1. a reviewed crosswalk row is promoted through the manual door;
 * 2. the wiring store is derived from it, a validated walk and the vault, and
 *    promoted through the routine door, which checks every promoted input;
 * 3. the state's derived family reads the member on its attested host and
 *    promotes through the meeting-partition door, which checks every member
 *    read's host against the wiring version it names;
 * 4. the meetings Reader composes the family's sittings beside every partition.
 *
 * No code names the body, the calendar or the host: they are data from step 1.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { planDerivedVersion, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import {
  buildDerivedFamily,
  derivedFamilyCandidate,
  type FamilyMemberRead,
} from "../lib/civic-data/derived-meeting-family.ts";
import {
  bodySourceWiringFor,
  derivedWiringCandidate,
  derivedWiringEntries,
  derivedWiringKey,
  familyMembers,
  readDerivedMeetingWiring,
  type DerivedWiringProjection,
} from "../lib/civic-data/derived-meeting-wiring.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { manualProjectionCandidate, type CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { CROSSWALK_CITATION, subBodyId, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { derivedMeetingFamilyId, requiredMeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import {
  processRegisteredManualCandidate,
  processRegisteredMeetingPartitionCandidate,
  processRegisteredRoutineCandidate,
} from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { deriveWiringDecisions } from "../lib/control-plane/discovery/derived-wiring.ts";
import { walkMeetingsDiscoveryNeed, type DiscoveryOpen } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { readMeetingsProjection, reconcileCounts } from "../lib/meetings/snapshot.ts";
import { preparePublishedMeetingSnapshot } from "../lib/meetings/prepared-snapshot.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { reconcileSuccessfulMeetingPartition } from "../scripts/ingest.ts";
import { meetingReaderServingWindowAt } from "../lib/meetings/constants.ts";

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
    /* The door checks every promoted input against the store; the crosswalk's own version stands in for registration here. */
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

async function promoteFamily(store: MemoryRoutineDataStore, now: string, feed: string | null, host = HOST, options: { readonly confirmUnchanged?: boolean } = {}, alter?: (read: FamilyMemberRead) => FamilyMemberRead) {
  const wiring = await readDerivedMeetingWiring({ store, bypassCache: true, now });
  assert.equal(wiring.kind, "PROMOTED");
  if (wiring.kind !== "PROMOTED") throw new Error("no wiring");
  const partition = requiredMeetingPartitionContract(derivedMeetingFamilyId("US-AZ"));
  const members = familyMembers(wiring.value, "US-AZ");
  const previousRead = await store.readPromotion("MEETING", partition.scope);
  const previous = previousRead === null ? null : (await store.readCandidate(previousRead.versionId))!.candidate.readModel as never;
  const reads: FamilyMemberRead[] = members.filter((m) => m.status === "ACTIVE" && feed !== null).map((member) => {
    const url = ROUTE.replace(HOST, host);
    return {
      member,
      acquisitions: [{ requestedUrl: url, finalUrl: url, httpStatus: 200, rawHash: sha256(feed!), byteCount: feed!.length }],
      ok: true, error: null, freshMeetings: readFeed(feed!, now).filter((m) => m.bodyId === member.row.bodyId), freshAgendaDocuments: [], retrievedAt: now,
    };
  }).map(read => alter ? alter(read) : read);
  const build = buildDerivedFamily({
    wiringInput: {
      kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring",
      versionId: wiring.metadata.versionId!, readModelSha256: sha256(canonicalCivicDataJson(wiring.value as DerivedWiringProjection)), promotedAt: wiring.metadata.promotedAt!,
    },
    members, reads, previous, generatedAt: now,
    reconcile: (read, previousSlice, windowAnchor) => reconcileSuccessfulMeetingPartition({
      sourceName: "ical", generatedAt: windowAnchor, freshMeetings: read.freshMeetings,
      freshAgendaDocuments: read.freshAgendaDocuments, previous: previousSlice,
    }),
  });
  const candidate = derivedFamilyCandidate(partition, build);
  const validatedAt = reads.map(read => read.retrievedAt).concat(now).sort().at(-1)!;
  return { build, candidate, outcome: await processRegisteredMeetingPartitionCandidate(store, partition.id, candidate, validatedAt, undefined, options) };
}

test("two calendars combine distinct dates and repeated IDs; a failed sibling cannot replace a fresh sitting", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalk = await promoteCrosswalk(store);
  await deriveWiring(store, crosswalk, FEED, T_WIRING);
  const wiring = await readDerivedMeetingWiring({ store, bypassCache: true, now: T_FAMILY });
  assert.equal(wiring.kind, "PROMOTED");
  if (wiring.kind !== "PROMOTED") return;
  const [one] = familyMembers(wiring.value, "US-AZ");
  const route = `https://${HOST}/second.ics`;
  const two = { ...one, id: derivedWiringKey(one.row.kind, one.row.bodyId, route), row: { ...one.row, route } };
  const events = readFeed(ics([
    { uid: "oct2", summary: BODY_NAME, start: "20261002T160000" },
    { uid: "oct14", summary: BODY_NAME, start: "20261014T160000" },
  ]), T_FAMILY);
  const reading = (member: typeof one, freshMeetings: Meeting[]): FamilyMemberRead => ({ member, ok: true, error: null,
    freshMeetings, freshAgendaDocuments: [], retrievedAt: T_FAMILY,
    acquisitions: [{ requestedUrl: member.row.route, finalUrl: member.row.route, httpStatus: 200, rawHash: sha256(FEED), byteCount: FEED.length }],
  });
  const build = (reads: FamilyMemberRead[], previous: ReturnType<typeof buildDerivedFamily>["snapshot"] | null) => buildDerivedFamily({
    wiringInput: { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring",
      versionId: wiring.metadata.versionId!, readModelSha256: sha256(canonicalCivicDataJson(wiring.value)), promotedAt: wiring.metadata.promotedAt! },
    members: [one, two], reads, previous, generatedAt: T_FAMILY,
    reconcile: (read, prior, anchor) => reconcileSuccessfulMeetingPartition({ sourceName: "ical", generatedAt: anchor,
      freshMeetings: read.freshMeetings, freshAgendaDocuments: read.freshAgendaDocuments, previous: prior }),
  });
  const first = build([reading(one, [events[0]]), reading(two, events)], null);
  assert.deepEqual(first.snapshot.meetings.map(row => row.startsAt.slice(0, 10)).sort(), ["2026-10-02", "2026-10-14"]);
  assert.deepEqual(first.snapshot.counts, { fresh: 2, carried: 0, total: 2, duplicatesCollapsed: 1 });
  assert.doesNotThrow(() => reconcileCounts(first.snapshot));
  const next = build([reading(one, [events[0]])], first.snapshot);
  assert.equal(next.snapshot.meetings.length, 2);
  assert.equal(next.snapshot.meetings.find(row => row.id === events[0].id)?.carried, undefined);
  assert.ok(next.snapshot.meetings.find(row => row.id === events[1].id)?.carried);
  assert.doesNotThrow(() => reconcileCounts(next.snapshot));
  assert.equal(derivedFamilyCandidate(requiredMeetingPartitionContract(derivedMeetingFamilyId("US-AZ")), next).semantics.violations.length, 0);
});

test("a promoted family's internal fresh duplicates reconcile in composition and publish the prepared snapshot", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalk = await promoteCrosswalk(store);
  await deriveWiring(store, crosswalk, FEED, T_WIRING);
  const family = await promoteFamily(store, T_FAMILY, FEED, HOST, {}, read => ({
    ...read, freshMeetings: Array.from({ length: 4 }, () => read.freshMeetings[0]),
  }));
  assert.ok(family.outcome.promoted, family.outcome.candidate.failureDetail ?? "");
  assert.equal(family.build.snapshot.counts.duplicatesCollapsed, 3);
  const read = await readMeetingsProjection({ store, bypassCache: true, now: T_FAMILY });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(read.value.counts, { fresh: 1, carried: 0, total: 1, duplicatesCollapsed: 3 });
  assert.equal(read.value.sources.reduce((sum, source) => sum + source.normalized, 0), 4);
  assert.deepEqual(read.value.meetings, family.build.snapshot.meetings);
  assert.doesNotThrow(() => reconcileCounts(read.value));
  assert.equal((await preparePublishedMeetingSnapshot(store, T_FAMILY)).status, "PUBLISHED");
});

test("a serving-window boundary crossed during collection uses the actual final input anchor", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalk = await promoteCrosswalk(store);
  await deriveWiring(store, crosswalk, FEED, T_WIRING);
  const prior = await promoteFamily(store, T_FAMILY, FEED, HOST, {}, read => ({ ...read, freshMeetings: [
    ...read.freshMeetings, { ...read.freshMeetings[0], id: "ical:expires", startsAt: "2026-05-26T21:30:05.000Z", status: "CONCLUDED", agendaUrl: null },
  ] }));
  assert.ok(prior.outcome.promoted, prior.outcome.candidate.failureDetail ?? "");
  const readAt = "2026-09-24T21:30:10.574Z";
  const next = await promoteFamily(store, T_SECOND, FEED, HOST, {}, read => ({ ...read, retrievedAt: readAt }));
  assert.ok(next.outcome.promoted, next.outcome.candidate.failureDetail ?? "");
  assert.equal(next.candidate.retrieval.retrievedAt, readAt);
  assert.equal(next.build.inputs.find(row => row.kind === "MEMBER_ACQUISITION")?.retrievedAt, readAt);
  const evidence = next.build.removalEvidence.find(row => row.key === "meeting:ical:expires");
  assert.equal(evidence?.code, "OUTSIDE_REGISTERED_SERVING_WINDOW");
  if (evidence?.code !== "OUTSIDE_REGISTERED_SERVING_WINDOW") return;
  assert.equal(evidence.lowerBound, meetingReaderServingWindowAt(readAt)?.lowerBound);
  assert.ok(!next.build.snapshot.meetings.some(row => row.id === "ical:expires"));
});

test("an unverified row stays open while its verified sibling publishes and its prior good row survives", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalk = await promoteCrosswalk(store);
  await deriveWiring(store, crosswalk, FEED, T_WIRING);
  const first = await promoteFamily(store, T_FAMILY, FEED);
  const prior = first.build.snapshot.meetings[0];
  const next = await promoteFamily(store, T_SECOND, FEED, HOST, {}, read => ({ ...read, freshMeetings: [
    { ...prior, startsAt: "unconfirmed" },
    { ...read.freshMeetings[0], id: "ical:new", title: "New verified sitting", startsAt: "2026-11-05T23:00:00.000Z" },
    { ...read.freshMeetings[0], id: "ical:foreign", bodyId: "another-body" },
  ] }));
  assert.ok(next.outcome.promoted, next.outcome.candidate.failureDetail ?? "");
  assert.equal(next.build.heldFacts.filter(row => row.code === "MEETING_ROW_UNVERIFIED").length, 2);
  assert.equal(next.build.snapshot.meetings.find(row => row.id === prior.id)?.startsAt, prior.startsAt);
  assert.ok(next.build.snapshot.meetings.find(row => row.id === prior.id)?.carried);
  assert.ok(next.build.snapshot.meetings.some(row => row.id === "ical:new"));
  assert.ok(!next.build.snapshot.meetings.some(row => row.id === "ical:foreign"));
  const reader = await readMeetingsProjection({ store, now: T_SECOND, bypassCache: true });
  assert.equal(reader.kind, "PROMOTED");
  if (reader.kind === "PROMOTED") assert.ok(reader.value.meetings.some(row => row.id === "ical:new"));
});

test("C16 END TO END: a reviewed crosswalk row plus a validated route publishes through the doors with no code release", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalkInput = await promoteCrosswalk(store);

  const wiring = await deriveWiring(store, crosswalkInput, FEED, T_WIRING);
  assert.equal(wiring.decisions[0]?.disposition, "PROMOTE");
  assert.equal(wiring.outcome.candidate.state, "PROMOTED", wiring.outcome.candidate.failureDetail ?? "");
  assert.equal(wiring.outcome.readerReadback?.status, "PASS");

  const family = await promoteFamily(store, T_FAMILY, FEED);
  assert.equal(family.outcome.candidate.state, "PROMOTED", family.outcome.candidate.failureDetail ?? "");
  assert.deepEqual(family.build.snapshot.meetings.map((m) => m.title), ["Housing Commission"], "only the reviewed body's sittings; the Tourism Commission's never enter");
  assert.equal(family.build.snapshot.meetings[0]?.bodyId, BODY_ID);

  const reader = await readMeetingsProjection({ store, now: T_FAMILY, bypassCache: true });
  assert.equal(reader.kind, "PROMOTED");
  if (reader.kind !== "PROMOTED") return;
  assert.ok(reader.value.meetings.some((m) => m.bodyId === BODY_ID && m.title === "Housing Commission"), "the reader composes the family's sitting");
  assert.equal(reader.partitions.find((p) => p.contractId === derivedMeetingFamilyId("US-AZ"))?.kind, "PROMOTED");

  /* Maintained without another code release: the next pass reads the feed again and publishes what changed. */
  const next = ics([
    { uid: "h1", summary: "Housing Commission", start: "20261008T160000" },
    { uid: "h2", summary: "Housing Commission", start: "20261105T160000" },
  ]);
  const second = await promoteFamily(store, T_SECOND, next);
  assert.equal(second.outcome.candidate.state, "PROMOTED", second.outcome.candidate.failureDetail ?? "");
  assert.equal(second.build.snapshot.meetings.length, 2);
});

test("C16: a member read off its attested host is held on its verified sittings, and the door refuses a forged member read", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalkInput = await promoteCrosswalk(store);
  await deriveWiring(store, crosswalkInput, FEED, T_WIRING);
  await promoteFamily(store, T_FAMILY, FEED);

  /* Off host: the build holds the member and carries its last verified sitting, marked. */
  const offHost = await promoteFamily(store, T_SECOND, FEED, "attacker.example.org");
  const member = offHost.build.snapshot.derivedMembers?.[0];
  assert.equal(member?.outcome, "HELD");
  assert.match(member?.detail ?? "", /off its attested host/);
  assert.ok(offHost.build.snapshot.meetings.every((m) => m.carried !== undefined), "carried, never re-read as fresh");
  assert.equal(offHost.outcome.promoted, null, "no member was read cleanly, so nothing new is claimed");
  const pointer = await store.readPromotion("MEETING", requiredMeetingPartitionContract(derivedMeetingFamilyId("US-AZ")).scope);
  assert.ok(pointer !== null, "the family's last known good stays live");
});

test("C16: a suspended connection publishes nothing new and keeps its previously verified sittings", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalkInput = await promoteCrosswalk(store);
  await deriveWiring(store, crosswalkInput, FEED, T_WIRING);
  const first = await promoteFamily(store, T_FAMILY, FEED);
  assert.equal(first.outcome.candidate.state, "PROMOTED");

  /* The route now answers 404: the wiring row is suspended, not dropped. */
  const suspended = await deriveWiring(store, crosswalkInput, "Not Found", "2026-09-24T21:00:00.000Z", 404);
  assert.equal(suspended.decisions[0]?.disposition, "SUSPEND");
  assert.equal(suspended.outcome.candidate.state, "PROMOTED", suspended.outcome.candidate.failureDetail ?? "");
  const wiring = await readDerivedMeetingWiring({ store, bypassCache: true, now: T_SECOND });
  assert.equal(wiring.kind === "PROMOTED" ? wiring.value.records[0]?.status : null, "SUSPENDED");

  const held = await promoteFamily(store, T_SECOND, FEED);
  assert.equal(held.build.snapshot.derivedMembers?.[0]?.outcome, "HELD");
  assert.match(held.build.snapshot.derivedMembers?.[0]?.detail ?? "", /suspended for review \(ROUTE_GONE\)/);
  const reader = await readMeetingsProjection({ store, now: T_SECOND, bypassCache: true });
  assert.ok(reader.kind === "PROMOTED" && reader.value.meetings.some((m) => m.bodyId === BODY_ID), "the verified sitting is still what the reader sees");
});

test("C16: a wiring version that drops a row is refused by the door, and the last known good wiring stays", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalkInput = await promoteCrosswalk(store);
  const first = await deriveWiring(store, crosswalkInput, FEED, T_WIRING);
  assert.equal(first.outcome.candidate.state, "PROMOTED");
  /* A plan that silently omits the promoted row: no trigger, no withdrawal, just gone. */
  const dropped = derivedWiringCandidate({ ...first.plan, rows: [], promoted: [], carried: [] }, [crosswalkInput], "2026-09-24T21:10:00.000Z");
  const outcome = await processRegisteredRoutineCandidate(store, "meeting-source-wiring", dropped, "2026-09-24T21:10:00.000Z");
  assert.equal(outcome.promoted, null, "a connection never disappears without its own evidence");
  const live = await readDerivedMeetingWiring({ store, bypassCache: true, now: T_SECOND });
  assert.equal(live.kind === "PROMOTED" ? live.value.records.length : 0, 1);
});

test("R23: an unchanged derived pass is receipted on the pointed version, not re-promoted", async () => {
  const store = new MemoryRoutineDataStore();
  const crosswalkInput = await promoteCrosswalk(store);
  const first = await deriveWiring(store, crosswalkInput, FEED, T_WIRING);
  assert.equal(first.outcome.candidate.state, "PROMOTED", first.outcome.candidate.failureDetail ?? "");
  const family = await promoteFamily(store, T_FAMILY, FEED);
  assert.equal(family.outcome.candidate.state, "PROMOTED", family.outcome.candidate.failureDetail ?? "");
  const partition = requiredMeetingPartitionContract(derivedMeetingFamilyId("US-AZ"));
  const familyPointer = await store.readPromotionIdentity("MEETING", partition.scope);

  // The same crosswalk and the same feed a pass later: nothing a reader sees changed.
  const wiringAgain = await deriveWiring(store, crosswalkInput, FEED, T_SECOND, 200, { confirmUnchanged: true });
  assert.equal(wiringAgain.outcome.confirmed?.versionId, first.outcome.candidate.candidate.id, "the wiring re-check confirms the pointed version");
  assert.equal(await store.readCandidateSummary(wiringAgain.candidate.id), null, "no wiring candidate is written for an unchanged pass");
  assert.equal(wiringAgain.candidate.retrieval.httpStatus, null, "a derived version fetched nothing and names no status");

  const familyAgain = await promoteFamily(store, "2026-09-24T22:30:00.000Z", FEED, HOST, { confirmUnchanged: true });
  assert.equal(familyAgain.outcome.confirmed?.versionId, familyPointer?.versionId, "the family re-check confirms the pointed version");
  assert.equal((await store.readPromotionIdentity("MEETING", partition.scope))?.versionId, familyPointer?.versionId, "readers keep their version");
  assert.equal(await store.readCandidateSummary(familyAgain.candidate.id), null, "no family candidate is written for an unchanged pass");

  // A real change still promotes a new version.
  const next = ics([
    { uid: "h1", summary: "Housing Commission", start: "20261008T160000" },
    { uid: "h2", summary: "Housing Commission", start: "20261105T160000" },
  ]);
  const changed = await promoteFamily(store, "2026-09-24T23:30:00.000Z", next, HOST, { confirmUnchanged: true });
  assert.equal(changed.outcome.confirmed, undefined);
  assert.equal(changed.outcome.candidate.state, "PROMOTED", changed.outcome.candidate.failureDetail ?? "");
});
