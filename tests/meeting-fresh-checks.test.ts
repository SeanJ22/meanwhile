import assert from "node:assert/strict";
import test from "node:test";

import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  applyMeetingFreshChecks,
  confirmationCheckedAt,
  meetingFreshChecks,
  meetingRouteKey,
  meetingVersionRoutes,
} from "../lib/meetings/fresh-checks.ts";
import { freshnessDisclosure, lastReadByDivision, staleDivisionRead } from "../lib/meetings/freshness.ts";
import { snapshotClientMeta, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import {
  ACQUIRED_URL, HOUR, NEWBURY, PIMA, T1, T2, T3, T4, at, failedCheck, freshEdge, publishPass, readPartition, readPlace, row,
} from "./helpers/meeting-body-fixtures.ts";

const collectedOf = (snapshot: MeetingsSnapshot, partition: { readonly bodyId: string }) =>
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

test("controlled clock, the place read: a receipt-only period advances Last checked and the re-read listings of its own place; a failed check does not; changed information publishes as before", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  const pimaV1 = await readPartition(store, PIMA, T1, ["a", "b"]);
  const newburyV1 = await readPartition(store, NEWBURY, T1, ["x"]);
  await publishPass(store, edge, at(T1, HOUR));
  const place = async (partition: { readonly ocdId: string | null }, now: string) => {
    const read = await readPlace(edge, store, [partition.ocdId!], now);
    assert.equal(read.kind, "PROMOTED");
    return (read as Extract<typeof read, { kind: "PROMOTED" }>).value;
  };
  const before = await place(PIMA, at(T1, HOUR));
  assert.equal(before.generatedAt, T1);
  const footerBefore = footer(before);

  // Pima re-checked 40 hours later and found nothing new: a receipt, not a version.
  const recheck = await readPartition(store, PIMA, T2, ["a", "b"]);
  assert.ok(recheck.confirmed, "the re-check was confirmed on the pointed version");
  assert.equal(recheck.promoted!.versionId, pimaV1.promoted!.versionId, "readers stay on their version");
  await publishPass(store, edge, at(T2, 5 * 60_000));
  const quiet = await place(PIMA, at(T2, 5 * 60_000));
  assert.equal(quiet.generatedAt, T2, "Last checked is the receipt's fresh check");
  assert.deepEqual(collectedOf(quiet, PIMA), [T2], "Pima's re-read listings say they were read then");
  assert.deepEqual(collectedOf(await place(NEWBURY, at(T2, 5 * 60_000)), NEWBURY), [T1], "Newbury was not re-checked: its listings keep their read");
  const footerQuiet = footer(quiet);
  assert.deepEqual(footerQuiet.failed, footerBefore.failed, "a receipt fires no failed-refresh disclosure");
  assert.equal(footerQuiet.carried, null);
  const reads = lastReadByDivision(quiet.meetings, Date.parse(at(T2, 5 * 60_000)));
  assert.equal(staleDivisionRead(reads[PIMA.ocdId!], Date.parse(at(T2, 5 * 60_000))), null);
  const newburyReads = lastReadByDivision((await place(NEWBURY, at(T2, 5 * 60_000))).meetings, Date.parse(at(T2, 5 * 60_000)));
  assert.equal(staleDivisionRead(newburyReads[NEWBURY.ocdId!], Date.parse(at(T2, 5 * 60_000)))?.at, T1, "Newbury, 40 hours unread, is dated as stale");

  // Newbury's check fails: nothing it holds or Last checked moves.
  await failedCheck(store, NEWBURY, T3);
  await publishPass(store, edge, at(T3, 60_000));
  const failed = await place(NEWBURY, at(T3, 60_000));
  assert.equal(failed.generatedAt, T1, "a failed request is never a check");
  assert.deepEqual(collectedOf(failed, NEWBURY), [T1]);

  // Newbury changed: a new version publishes as before, with its new sitting.
  const newburyV2 = await readPartition(store, NEWBURY, T4, ["x", "y"]);
  assert.equal(newburyV2.confirmed, undefined);
  assert.notEqual(newburyV2.promoted!.versionId, newburyV1.promoted!.versionId);
  await publishPass(store, edge, at(T4, 60_000));
  const changed = await place(NEWBURY, at(T4, 60_000));
  assert.equal(changed.generatedAt, T4);
  assert.equal(changed.meetings.filter((m) => m.bodyId === NEWBURY.bodyId).length, 2);
  assert.deepEqual(collectedOf(changed, NEWBURY), [T4]);
  assert.deepEqual(collectedOf(await place(PIMA, at(T4, 60_000)), PIMA), [T2], "Pima keeps its receipt's check");
});

test("controlled clock, the supervisor pass: a receipt moves one body's pointer alone, reads no whole partition, and the edge and the database say the same when it was checked", async () => {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  await readPartition(store, PIMA, T1, ["a", "b"]);
  await readPartition(store, NEWBURY, T1, ["x"]);
  const first = await publishPass(store, edge, at(T1, 60_000));
  assert.equal(first.status, "PUBLISHED");
  const manifestBefore = (await edge.readManifest())!.manifest;

  await readPartition(store, PIMA, T2, ["a", "b"]);
  // Nothing whole is read: no partition payload, no candidate.
  const wholeReads: string[] = [];
  const restore = (["readPromotions", "readPromotion", "readCandidates", "readCandidate"] as const).map((name) => {
    const original = store[name].bind(store) as (...args: unknown[]) => Promise<unknown>;
    (store as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => { wholeReads.push(name); return original(...args); };
    return () => { (store as unknown as Record<string, unknown>)[name] = original; };
  });
  const quiet = await publishPass(store, edge, at(T2, 60_000));
  for (const undo of restore) undo();
  assert.deepEqual(wholeReads, [], "the pass reads pointer identities and the body's coupling alone");
  assert.equal(quiet.status, "CURRENT", "the manifest does not move for a check");
  assert.deepEqual(quiet.plan.stats.states, ["AZ"]);
  assert.equal(quiet.plan.stats.pointersWritten, 1);
  assert.equal(quiet.plan.stats.indexesWritten, 0);
  assert.equal(quiet.plan.stats.composed, 0, "the same versions: nothing is recomposed");
  assert.equal(quiet.plan.stats.recordsWritten, 0);
  const manifestAfter = (await edge.readManifest())!.manifest;
  assert.deepEqual(manifestAfter, manifestBefore);

  // The reader from the edge and the reader from the database row agree.
  const fromEdge = await readPlace(edge, store, [PIMA.ocdId!], at(T2, 2 * 60_000));
  assert.equal(fromEdge.kind === "PROMOTED" && fromEdge.value.generatedAt, T2);
  const noEdge = await readPlace(null as never, store, [PIMA.ocdId!], at(T2, 2 * 60_000));
  assert.equal(noEdge.kind === "PROMOTED" && noEdge.value.meetings.length, 2);

  // Newbury's check fails: the pass finds nothing owed.
  await failedCheck(store, NEWBURY, T3);
  assert.equal((await publishPass(store, edge, at(T3, 60_000))).status, "CURRENT");

  // Newbury changed: its record, row and pointer are written; Arizona's are not.
  await readPartition(store, NEWBURY, T4, ["x", "y"]);
  const changed = await publishPass(store, edge, at(T4, 60_000));
  assert.equal(changed.plan.stats.composed, 1);
  assert.equal(changed.plan.stats.recordsWritten, 1);
  assert.deepEqual(changed.plan.stats.states, ["NH"]);
  const reread = await readPlace(edge, store, [NEWBURY.ocdId!], at(T4, 2 * 60_000));
  assert.equal(reread.kind === "PROMOTED" && reread.value.meetings.filter((m) => m.bodyId === NEWBURY.bodyId).length, 2, "the new sitting reaches readers");
});
