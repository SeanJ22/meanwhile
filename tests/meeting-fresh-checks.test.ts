import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MEETING_PARTITION_CONTRACTS,
  meetingPartitionId,
  meetingPartitionOfId,
  refreshMeetingPartitions,
  type MeetingPartitionContract,
} from "../lib/civic-data/meeting-partitions.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { VALIDATION_CHECKS, type RoutineCandidate, type ValidationReceipt } from "../lib/civic-data/types.ts";
import { AUTHORITY_FAMILIES, type ReaderManifest } from "../lib/meetings/edge-artifacts.ts";
import {
  publishReaderEdgeArtifacts,
  publishReaderEdgeChecks,
  readReaderEdgeMeetings,
  type PublishAuthority,
  type PublishReaderExtras,
  type PublishRegistrations,
} from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore, scopedReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import {
  applyMeetingFreshChecks,
  confirmationCheckedAt,
  meetingFreshChecks,
  meetingRouteKey,
  meetingVersionRoutes,
} from "../lib/meetings/fresh-checks.ts";
import { freshnessDisclosure, lastReadByDivision, staleDivisionRead } from "../lib/meetings/freshness.ts";
import {
  clearPreparedMeetingsProjectionCache,
  MEETINGS_PREPARED_SCOPE,
  preparePublishedMeetingSnapshot,
  readComposedSourcePlaces,
  readPreparedMeetingsProjection,
} from "../lib/meetings/prepared-snapshot.ts";
import { RETIRED_MEETING_ROUTES } from "../lib/registry/source-wiring.ts";
import {
  readMeetingsProjection,
  snapshotClientMeta,
  type MeetingsProjectionReadResult,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";


const ACQUIRED_URL = "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/documents.html";
const HOUR = 3_600_000;
const T1 = "2026-09-20T12:00:00.000Z"; // both bodies read, new versions
const T2 = "2026-09-22T04:00:00.000Z"; // Pima re-checked: nothing new (a receipt), 40 h after T1
const T3 = "2026-09-22T04:30:00.000Z"; // Newbury's check fails
const T4 = "2026-09-22T05:00:00.000Z"; // Newbury changed: a new sitting
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

const PIMA = MEETING_PARTITION_CONTRACTS.find((p) => p.id === "meetings:legistar:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fcounty%3Apima%23governing")!;
const NEWBURY = MEETING_PARTITION_CONTRACTS.find((p) => p.id === "meetings:schedulepage:ocd-division%2Fcountry%3Aus%2Fstate%3Anh%2Fcounty%3Amerrimack%2Fplace%3Anewbury_town%23energy-committee")!;

function row(partition: MeetingPartitionContract, suffix: string, startsAt: string, collectedAt: string): Meeting {
  return {
    id: `${partition.meetingSource}:${partition.wiring!.jurisdiction.slice(0, 4).toLowerCase()}:${suffix}`,
    ocdId: partition.ocdId,
    bodyId: partition.bodyId,
    bodyName: partition.wiring!.publishingOrg,
    title: `Regular Meeting ${suffix}`,
    startsAt,
    timeZone: partition.wiring!.timeZone,
    location: null,
    online: { label: "Zoom Webinar", joinUrl: null },
    agendaUrl: null,
    jurisdiction: partition.wiring!.jurisdiction,
    status: "SCHEDULED",
    provenance: { sourceUrl: ACQUIRED_URL, sourceOrg: partition.wiring!.publishingOrg, collectedAt, verifiedAt: null },
  };
}

/** One routine read of a partition exactly as its child makes it: a new version, or a receipt when nothing changed. */
async function readPartition(store: MemoryRoutineDataStore, partition: MeetingPartitionContract, readAt: string, suffixes: readonly string[]) {
  const bytes = `${partition.id}:${suffixes.join(",")}:${readAt}`;
  const meetings = suffixes.map((suffix, index) => row(partition, suffix, `2026-10-${String(10 + index).padStart(2, "0")}T17:00:00.000Z`, readAt));
  const [result] = await promoteMeetingPartitions({
    store,
    partitions: [partition],
    meetings,
    agendaDocuments: [],
    reports: [{
      source: partition.meetingSource,
      ok: true,
      error: null,
      fetched: meetings.length,
      normalized: meetings.length,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      acquisitions: [{
        source: partition.meetingSource,
        requestedUrl: ACQUIRED_URL,
        finalUrl: ACQUIRED_URL,
        httpStatus: 200,
        rawHash: createHash("sha256").update(bytes).digest("hex"),
        byteCount: Buffer.byteLength(bytes),
      }],
    }],
    generatedAt: readAt,
  });
  assert.ok(result?.outcome.promoted, `${partition.id} read at ${readAt}: ${result?.outcome.candidate.failureDetail ?? ""}`);
  return result!.outcome;
}

/** A check that failed at the source: a refused candidate, the pointer and its receipts untouched. */
async function failedCheck(store: MemoryRoutineDataStore, partition: MeetingPartitionContract, readAt: string): Promise<void> {
  const pointer = (await store.readPromotion("MEETING", partition.scope))!;
  const pointed = (await store.readCandidate(pointer.versionId))!;
  const candidate: RoutineCandidate = { ...pointed.candidate, id: `cv-failed-${partition.bodyId.length}-${Date.parse(readAt)}`, retrieval: { ...pointed.candidate.retrieval, retrievedAt: readAt } };
  await store.create({
    candidate, state: "FETCHED", acquisitionSucceeded: true, receipt: null, promotedVersion: null,
    lastKnownGoodVersion: pointer.versionId, failureCode: null, failureDetail: null,
  }, { candidateId: candidate.id, sequence: 1, state: "FETCHED", at: readAt, detail: "persisted acquisition" });
  await store.transition(candidate.id, "NORMALIZED", readAt, "persisted normalization");
  const refused: ValidationReceipt = {
    contractVersion: 2, decision: "FAIL", candidateId: candidate.id, sourceId: candidate.sourceId, recordClass: candidate.recordClass,
    scope: candidate.scope, validatedAt: readAt, excludedFacts: [],
    checks: VALIDATION_CHECKS.map((check, index) => index === 0
      ? { check, verdict: "FAIL" as const, code: `${check}_FAIL`, detail: "the calendar page did not answer" }
      : { check, verdict: "PASS" as const, code: `${check}_PASS`, detail: "persisted proof" }),
  };
  const first = refused.checks[0]!;
  await store.transition(candidate.id, "SEMANTIC_INVALID", readAt, "refused", refused, { code: first.code, detail: first.detail });
}

async function composed(store: MemoryRoutineDataStore, now: string): Promise<Extract<MeetingsProjectionReadResult, { kind: "PROMOTED" }>> {
  clearPromotedReadModelCache();
  const read = await readMeetingsProjection({ store, now, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  return read as Extract<MeetingsProjectionReadResult, { kind: "PROMOTED" }>;
}

const collectedOf = (snapshot: MeetingsSnapshot, partition: MeetingPartitionContract) =>
  [...new Set(snapshot.meetings.filter((m) => m.bodyId === partition.bodyId).map((m) => m.provenance.collectedAt))];

/** The footer's inputs, exactly as the meetings route builds them. */
function footer(snapshot: MeetingsSnapshot) {
  const meta = snapshotClientMeta(snapshot);
  return {
    lastChecked: meta.generatedAt,
    failed: meta.sources.filter((s) => !s.ok || (s.unreachableOcdIds?.length ?? 0) > 0).map((s) => s.source).sort(),
    carried: freshnessDisclosure({ carried: meta.carried }).carried,
  };
}

test("the check rule: only a confirmation of the pointed version, of a version that read a source, and never a carried row", () => {
  const confirmation = { versionId: "cv-a", retrieval: { requestedUrl: ACQUIRED_URL, finalUrl: ACQUIRED_URL, httpStatus: 200, rawHash: "e".repeat(64), retrievedAt: T2 } };
  assert.equal(confirmationCheckedAt(confirmation, "cv-a", true), T2);
  assert.equal(confirmationCheckedAt(confirmation, "cv-b", true), null, "a confirmation of a replaced version says nothing about the current one");
  assert.equal(confirmationCheckedAt(confirmation, "cv-a", false), null, "a version that read no source was not checked by re-deriving it");
  assert.equal(confirmationCheckedAt(null, "cv-a", true), null, "no receipt, no check");

  const fresh = row(PIMA, "1", "2026-10-10T17:00:00.000Z", T1);
  const carried: Meeting = { ...row(PIMA, "2", "2026-10-11T17:00:00.000Z", T1), carried: { source: PIMA.meetingSource, lastFreshAt: T1, reason: "SOURCE_UNAVAILABLE" } };
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1, generatedAt: T1, counts: { fresh: 1, carried: 1, total: 2 },
    sources: [{ source: PIMA.meetingSource, ok: true, error: null, fetched: 1, normalized: 1, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }],
    meetings: [fresh, carried], agendaDocuments: [],
  };
  assert.deepEqual(meetingVersionRoutes(snapshot), [meetingRouteKey(fresh)], "only fresh rows name a route");
  assert.equal(meetingVersionRoutes({ ...snapshot, sources: [{ ...snapshot.sources[0]!, ok: false }] }), null);
  const route = meetingRouteKey(fresh)!;
  const applied = applyMeetingFreshChecks(snapshot, { checkedAt: T2, routes: { [route]: T2 } });
  assert.equal(applied.generatedAt, T2);
  assert.equal(applied.meetings[0]!.provenance.collectedAt, T2, "the re-read row is restamped");
  assert.equal(applied.meetings[1], carried, "a carried row keeps its own dates");
  assert.equal(snapshot.meetings[0]!.provenance.collectedAt, T1, "the served object is never mutated");
  assert.equal(applyMeetingFreshChecks(snapshot, { checkedAt: T1, routes: { [route]: T1 } }), snapshot, "nothing later: the same object");
  // A route two versions both hold cannot be told apart: it is left out, never stamped fresher than proven.
  const checks = meetingFreshChecks([
    { contractId: "a", versionId: "va", routes: ["legistar|x", "ical|y"], checkedAt: T2 },
    { contractId: "b", versionId: "vb", routes: ["ical|y"], checkedAt: T1 },
    { contractId: "c", versionId: "vc", checkedAt: T4 },
  ]);
  assert.deepEqual(checks, { checkedAt: T2, routes: { "legistar|x": T2 } }, "a version that read no source is no check, whatever it records");
});

test("controlled clock, the composing reader: a receipt-only period advances Last checked and the re-read listings; a failed check does not; changed information publishes as before", async () => {
  const store = new MemoryRoutineDataStore();
  const pimaV1 = await readPartition(store, PIMA, T1, ["a", "b"]);
  const newburyV1 = await readPartition(store, NEWBURY, T1, ["x"]);
  const before = await composed(store, at(T1, HOUR));
  assert.equal(before.value.generatedAt, T1);
  const footerBefore = footer(before.value);

  // Pima re-checked 40 hours later and found nothing new: a receipt, not a version.
  const recheck = await readPartition(store, PIMA, T2, ["a", "b"]);
  assert.ok(recheck.confirmed, "the re-check was confirmed on the pointed version");
  assert.equal(recheck.promoted!.versionId, pimaV1.promoted!.versionId, "readers stay on their version");
  const quiet = await composed(store, at(T2, 5 * 60_000));
  const checkedAt = at(T2, 0);
  assert.equal(quiet.value.generatedAt, checkedAt, "Last checked is the receipt's fresh check");
  assert.deepEqual(collectedOf(quiet.value, PIMA), [checkedAt], "Pima's re-read listings say they were read then");
  assert.deepEqual(collectedOf(quiet.value, NEWBURY), [T1], "Newbury was not re-checked: its listings keep their read");
  assert.deepEqual(quiet.partitions.find((p) => p.contractId === PIMA.id)?.freshCheck, { routes: [meetingRouteKey(quiet.value.meetings.find((m) => m.bodyId === PIMA.bodyId)!)!], checkedAt });
  // The footer: only the age moved. No source reads as failed and nothing reads as carried.
  const footerQuiet = footer(quiet.value);
  assert.deepEqual(footerQuiet.failed, footerBefore.failed, "a receipt fires no failed-refresh disclosure");
  assert.equal(footerQuiet.carried, null);
  // The division note: Pima, read 5 minutes ago, is not dated as stale; Newbury, 40 hours unread, is.
  const reads = lastReadByDivision(quiet.value.meetings, Date.parse(at(T2, 5 * 60_000)));
  assert.equal(staleDivisionRead(reads[PIMA.ocdId!], Date.parse(at(T2, 5 * 60_000))), null);
  assert.equal(staleDivisionRead(reads[NEWBURY.ocdId!], Date.parse(at(T2, 5 * 60_000)))?.at, T1);

  // Newbury's check fails: nothing it holds or Last checked moves.
  await failedCheck(store, NEWBURY, T3);
  const failed = await composed(store, at(T3, 60_000));
  assert.equal(failed.value.generatedAt, checkedAt, "a failed request is never a check");
  assert.deepEqual(collectedOf(failed.value, NEWBURY), [T1]);

  // Newbury changed: a new version publishes as before, with its new sitting.
  const newburyV2 = await readPartition(store, NEWBURY, T4, ["x", "y"]);
  assert.equal(newburyV2.confirmed, undefined);
  assert.notEqual(newburyV2.promoted!.versionId, newburyV1.promoted!.versionId);
  const changed = await composed(store, at(T4, 60_000));
  assert.equal(changed.value.generatedAt, T4);
  assert.equal(changed.value.meetings.filter((m) => m.bodyId === NEWBURY.bodyId).length, 2);
  assert.deepEqual(collectedOf(changed.value, NEWBURY), [T4]);
  assert.deepEqual(collectedOf(changed.value, PIMA), [checkedAt], "Pima keeps its receipt's check");
});

const EXTRAS: PublishReaderExtras = { commentAccess: [], everydayRouting: null };
const VALUES: PublishAuthority = Object.fromEntries(AUTHORITY_FAMILIES.map((family) => [family, { value: { family }, versionId: `${family}-v1` }]));
const CARRIED: PublishAuthority = Object.fromEntries(AUTHORITY_FAMILIES.map((family) => [family, { versionId: `${family}-v1`, carried: true as const }]));
const REGISTRATIONS: PublishRegistrations = { az: { value: { state: "az" }, versionId: "reg-az-v1" } };
const REGISTRATIONS_CARRIED: PublishRegistrations = { az: { versionId: "reg-az-v1", carried: true } };

test("controlled clock, the prepared serving copy and the edge: a receipt republishes the manifest alone, reads no row, and every reader path says when it was checked", async () => {
  clearPreparedMeetingsProjectionCache();
  const store = new MemoryRoutineDataStore();
  const edge = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "meeting-fresh-checks-")));
  const azEdge = scopedReaderArtifactStore(edge, "AZ");
  async function publishStates(snapshot: MeetingsSnapshot, metadata: Parameters<typeof publishReaderEdgeArtifacts>[1], options: Parameters<typeof publishReaderEdgeArtifacts>[2]) {
    for (const [state, partition] of [["AZ", PIMA], ["NH", NEWBURY]] as const) {
      const meetings = snapshot.meetings.filter(meeting => meeting.bodyId === partition.bodyId);
      const carried = meetings.filter(meeting => meeting.carried).length;
      const result = await publishReaderEdgeArtifacts({ ...snapshot, meetings,
        sources: snapshot.sources.filter(source => source.source === partition.meetingSource),
        counts: { total: meetings.length, fresh: meetings.length - carried, carried } }, metadata,
      { ...options, store: scopedReaderArtifactStore(edge, state) });
      assert.equal(result.status, "PUBLISHED");
    }
    return { status: "PUBLISHED" };
  }
  await readPartition(store, PIMA, T1, ["a", "b"]);
  await readPartition(store, NEWBURY, T1, ["x"]);

  // The pass after the reads: composed once, prepared, published in full.
  const first = await preparePublishedMeetingSnapshot(store, at(T1, 60_000));
  assert.equal(first.status, "PUBLISHED");
  if (first.status !== "PUBLISHED") return;
  assert.equal(first.servedGeneratedAt, T1);
  const served = await readPreparedMeetingsProjection({ store, now: at(T1, 60_000) });
  assert.equal(served.kind, "PROMOTED");
  if (served.kind !== "PROMOTED") return;
  const full = await publishStates(served.value, { sourceThrough: null, retrievedAt: served.metadata.retrievedAt, promotedThrough: null }, {
    store: edge, now: at(T1, 60_000), extras: EXTRAS, authority: VALUES, registrations: REGISTRATIONS,
    checks: { composition: first.composition, freshChecks: first.freshChecks },
  });
  assert.equal(full.status, "PUBLISHED");
  const manifestBefore = (await azEdge.readManifest())!.manifest;

  // Pima re-checked with nothing new.
  await readPartition(store, PIMA, T2, ["a", "b"]);
  const checkedAt = at(T2, 0);
  let compositions = 0;
  // Nothing whole is read: no partition payload, no candidate, not the prepared row.
  const wholeReads: string[] = [];
  const counted = <K extends "readPromotions" | "readPromotion" | "readCandidates" | "readCandidate" | "readPreparedReaderProjection">(name: K) => {
    const original = store[name].bind(store) as (...args: unknown[]) => Promise<unknown>;
    (store as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => { wholeReads.push(name); return original(...args); };
    return () => { (store as unknown as Record<string, unknown>)[name] = original; };
  };
  const restore = (["readPromotions", "readPromotion", "readCandidates", "readCandidate", "readPreparedReaderProjection"] as const).map(counted);
  const quiet = await preparePublishedMeetingSnapshot(store, at(T2, 60_000), {
    aggregate: async () => { compositions += 1; throw new Error("a receipt must not recompose the partitions"); },
  });
  for (const undo of restore) undo();
  assert.deepEqual(wholeReads, [], "the pass reads pointer identities and the serving copy's coupling alone");
  assert.equal(quiet.status, "CURRENT", "the same versions: nothing is recomposed or rewritten");
  if (quiet.status !== "CURRENT") return;
  assert.equal(compositions, 0);
  assert.equal(quiet.generatedAt, T1, "the serving copy itself is untouched");
  assert.equal(quiet.servedGeneratedAt, checkedAt, "what readers are told moves");
  assert.equal(quiet.composition, first.composition);
  assert.deepEqual(Object.values(quiet.freshChecks), [checkedAt]);

  // Everything carried but the checks, so the manifest alone republishes.
  const republished = await publishReaderEdgeChecks(
    { generatedAt: quiet.servedGeneratedAt!, retrievedAt: quiet.checkedAt, checks: { composition: quiet.composition, freshChecks: quiet.freshChecks } },
    { store: azEdge },
  );
  assert.equal(republished.status, "PUBLISHED");
  const manifestAfter = (await azEdge.readManifest())!.manifest;
  assert.equal(manifestAfter.generatedAt, checkedAt);
  assert.deepEqual(manifestAfter.scopes, manifestBefore.scopes, "the same immutable artifacts: none rewritten");
  assert.equal(manifestAfter.sequence, manifestBefore.sequence + 1);
  assert.deepEqual(manifestAfter.sources, manifestBefore.sources);

  // The reader, from the edge: Last checked, the re-read listings, and no false disclosure.
  const fromEdge = await readReaderEdgeMeetings({ store: edge, states: ["az", "nh"], fallback: async () => { throw new Error("the edge answers"); } });
  assert.equal(fromEdge.kind, "PROMOTED");
  if (fromEdge.kind !== "PROMOTED") return;
  assert.equal(fromEdge.value.generatedAt, checkedAt);
  assert.deepEqual(collectedOf(fromEdge.value, PIMA), [checkedAt]);
  assert.deepEqual(collectedOf(fromEdge.value, NEWBURY), [T1]);
  assert.deepEqual(footer(fromEdge.value).failed, footer(served.value).failed.filter(source => source === PIMA.meetingSource || source === NEWBURY.meetingSource), "a receipt fires no failed-refresh disclosure");
  // The reader, from the prepared fallback: the same answer from the pointer identities alone.
  // A serving process re-reads the checks at most once a minute; this read is a later one.
  const fallback = await readPreparedMeetingsProjection({ store, now: at(T2, 2 * 60_000) });
  assert.equal(fallback.kind, "PROMOTED");
  if (fallback.kind !== "PROMOTED") return;
  assert.equal(fallback.value.generatedAt, checkedAt);
  assert.deepEqual(collectedOf(fallback.value, PIMA), [checkedAt]);
  assert.equal(fallback.metadata.retrievedAt, checkedAt);

  // Newbury's check fails: prepare states the same checks, and the edge stays as it is.
  await failedCheck(store, NEWBURY, T3);
  const afterFailure = await preparePublishedMeetingSnapshot(store, at(T3, 60_000));
  assert.equal(afterFailure.status, "CURRENT");
  if (afterFailure.status !== "CURRENT") return;
  assert.equal(afterFailure.servedGeneratedAt, checkedAt, "a failed request is never a check");

  // Newbury changed: the composition is new, the prepared row is rewritten, and the edge publishes in full.
  await readPartition(store, NEWBURY, T4, ["x", "y"]);
  const changed = await preparePublishedMeetingSnapshot(store, at(T4, 60_000));
  assert.equal(changed.status, "PUBLISHED");
  if (changed.status !== "PUBLISHED") return;
  assert.notEqual(changed.composition, quiet.composition);
  assert.equal(changed.servedGeneratedAt, T4);
  assert.equal((await publishReaderEdgeChecks(
    { generatedAt: changed.servedGeneratedAt!, retrievedAt: null, checks: { composition: changed.composition, freshChecks: changed.freshChecks } },
    { store: azEdge },
  )).status, "NOT_COMPOSABLE", "the checks-only publish refuses another composition");
  const readBack = await readPreparedMeetingsProjection({ store, now: at(T4, 2 * 60_000) });
  assert.equal(readBack.kind, "PROMOTED");
  if (readBack.kind !== "PROMOTED") return;
  const published = await publishStates(readBack.value, { sourceThrough: null, retrievedAt: readBack.metadata.retrievedAt, promotedThrough: null }, {
    store: edge, now: at(T4, 60_000), extras: EXTRAS, authority: CARRIED, registrations: REGISTRATIONS_CARRIED,
    checks: { composition: changed.composition, freshChecks: changed.freshChecks },
  });
  assert.equal(published.status, "PUBLISHED");
  const manifestChanged: ReaderManifest = (await azEdge.readManifest())!.manifest;
  assert.equal(manifestChanged.composition, changed.composition);
  assert.equal(manifestChanged.generatedAt, T4);
  const reread = await readReaderEdgeMeetings({ store: edge, states: ["az", "nh"], fallback: async () => { throw new Error("the edge answers"); } });
  assert.equal(reread.kind, "PROMOTED");
  if (reread.kind !== "PROMOTED") return;
  assert.equal(reread.value.meetings.filter((m) => m.bodyId === NEWBURY.bodyId).length, 2, "the new sitting reaches readers");
  assert.deepEqual(collectedOf(reread.value, PIMA), [checkedAt]);
});

test("a published composition is read whatever doors the process holds: its partitions' scopes and places come from their ids", async () => {
  for (const partition of MEETING_PARTITION_CONTRACTS) {
    assert.deepEqual(meetingPartitionOfId(partition.id), { source: partition.meetingSource, bodyId: partition.bodyId, scope: partition.scope }, partition.id);
  }
  assert.equal(meetingPartitionOfId("meetings-history:ical:x"), null);
  assert.equal(meetingPartitionOfId("everyday-routing"), null);

  clearPreparedMeetingsProjectionCache();
  const store = new MemoryRoutineDataStore();
  await readPartition(store, PIMA, T1, ["a", "b"]);
  await readPartition(store, NEWBURY, T1, ["x"]);
  assert.equal((await preparePublishedMeetingSnapshot(store, at(T1, 60_000))).status, "PUBLISHED");
  await readPartition(store, PIMA, T2, ["a", "b"]);

  // A site that holds no door yet (its runner has published none) serves the same answer, Last checked included.
  const installed = MEETING_PARTITION_CONTRACTS.length;
  assert.equal(refreshMeetingPartitions([]).refreshed, true);
  try {
    assert.equal(MEETING_PARTITION_CONTRACTS.some((p) => p.id === PIMA.id || p.id === NEWBURY.id), false);
    const served = await readPreparedMeetingsProjection({ store, now: at(T2, 2 * 60_000) });
    assert.equal(served.kind, "PROMOTED");
    if (served.kind !== "PROMOTED") return;
    assert.equal(served.value.generatedAt, T2);
    assert.deepEqual(collectedOf(served.value, PIMA), [T2]);
    assert.deepEqual(collectedOf(served.value, NEWBURY), [T1]);
    const places = await readComposedSourcePlaces({ store });
    assert.deepEqual(places?.get(PIMA.meetingSource), [PIMA.ocdId]);
    assert.deepEqual(places?.get(NEWBURY.meetingSource), [NEWBURY.ocdId]);
  } finally {
    refreshMeetingPartitions();
  }
  assert.equal(MEETING_PARTITION_CONTRACTS.length, installed);
});

test("a failed source is attributed to the places its composed partitions serve: a retired route's held partition and a body with no division name none", async () => {
  const retired = RETIRED_MEETING_ROUTES.find((route) => route.bodyId.startsWith("ocd-division/"))!;
  const wilmot = "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town";
  const store = new MemoryRoutineDataStore();
  await store.writePreparedReaderProjection({
    recordClass: "MEETING", scope: MEETINGS_PREPARED_SCOPE, payload: {}, factSha256: "0".repeat(64),
    generatedAt: T1, composedAt: T1, sourceThrough: null, retrievedAt: null, promotedThrough: null,
    composedFrom: [
      { contractId: PIMA.id, versionId: "v-pima" },
      { contractId: meetingPartitionId(retired.meetingSource, retired.bodyId), versionId: "v-held" },
      { contractId: meetingPartitionId("pima-edu", "curated:az/pima-community-college#governing"), versionId: "v-curated" },
      { contractId: meetingPartitionId(NEWBURY.meetingSource, `${wilmot}#selectboard`), versionId: "v-wilmot" },
      { contractId: NEWBURY.id, versionId: "v-newbury" },
    ],
  }, null);
  const places = await readComposedSourcePlaces({ store });
  assert.ok(places !== null);
  assert.deepEqual(places.get(PIMA.meetingSource), [PIMA.ocdId]);
  assert.deepEqual(places.get(NEWBURY.meetingSource), [wilmot, NEWBURY.ocdId], "in the composition's order");
  assert.deepEqual(places.get("pima-edu"), [], "a body with no division names no place");
  assert.equal((places.get(retired.meetingSource) ?? []).includes(retired.bodyId.split("#")[0]!), false, "a retired route's held partition serves no place");
  assert.equal(await readComposedSourcePlaces({ store: new MemoryRoutineDataStore() }), null, "no composition, no attribution");
});


test("prepared meeting copies normalize state names and keep another state's bodies out", async () => {
  clearPreparedMeetingsProjectionCache();
  const store = new MemoryRoutineDataStore();
  await readPartition(store, PIMA, T1, ["az-only"]);
  await readPartition(store, NEWBURY, T1, ["nh-only"]);
  assert.equal((await preparePublishedMeetingSnapshot(store, T2, { state: "az" })).status, "PUBLISHED");
  const read = await readPreparedMeetingsProjection({ store, now: T2, state: "US-AZ" });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(read.value.meetings.map(meeting => meeting.bodyId), [PIMA.bodyId]);
  assert.ok(read.partitions.every(partition => !partition.bodyId.includes("state:nh")));
  assert.ok(await store.readPreparedReaderProjection("MEETING", "composed-reader-snapshot:US-AZ"));
  assert.equal(await store.readPreparedReaderProjection("MEETING", "composed-reader-snapshot:US-NH"), null);
});
