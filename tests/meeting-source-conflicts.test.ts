import assert from "node:assert/strict";
import test from "node:test";
import { mergeReaderSittings } from "../lib/meetings/sitting-merge.ts";
import { mergeScopeArtifacts, partitionSnapshotByScope } from "../lib/meetings/edge-artifacts.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
const at = "2026-10-05T12:00:00Z";
const meeting = (id: string, extra: Partial<Meeting> = {}): Meeting => ({ id, bodyId: "body", bodyName: "Board", jurisdiction: "County", title: "Meeting", ocdId: "ocd-division/country:us/state:az/county:example", startsAt: "2026-10-06T18:00:00Z", timeZone: "UTC", location: null, agendaUrl: null, status: "SCHEDULED", provenance: { kind: "OFFICIAL", sourceUrl: `https://office.gov/${id}`, sourceOrg: "Clerk", collectedAt: at, verifiedAt: at }, ...extra });
test("CP-18: two doors with different times merge, retaining the official value, other useful fields, and the losing value", () => {
  const official = meeting("portal:1");
  const news = meeting("calendar:1", { startsAt: "2026-10-06T19:00:00Z", agendaUrl: "https://office.gov/agenda", provenance: { ...official.provenance, kind: "NEWS", collectedAt: "2026-10-05T13:00:00Z" } });
  const merged = mergeReaderSittings([official, news]);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.rows[0].startsAt, official.startsAt);
  assert.equal(merged.rows[0].agendaUrl, news.agendaUrl);
  assert.equal(merged.rows[0].fieldSources?.agendaUrl.kind, "NEWS");
  assert.ok(merged.conflicts.some(row => row.code === "CONFLICT_SUPERSEDED" && (row.record as { field: string }).field === "startsAt"));
  assert.deepEqual(mergeReaderSittings([news, official]), merged);
});
test("CP-18: a second same-day sitting stays distinct, and an exact cross-door match still merges", () => {
  const a = meeting("portal:1"), b = meeting("portal:2", { startsAt: "2026-10-06T20:00:00Z" });
  assert.equal(mergeReaderSittings([a, b, meeting("calendar:1", { startsAt: "2026-10-06T19:00:00Z" })]).rows.length, 3);
  assert.equal(mergeReaderSittings([a, b, meeting("calendar:1")]).rows.length, 2);
  assert.equal(mergeReaderSittings([a, meeting("calendar:1", { bodyId: "another-body" })]).rows.length, 2);
});
test("CP-18: edge composition retains both source ids and an agenda belonging to the merged-away row", () => {
  const old = meeting("calendar:1");
  const fresh = meeting("portal:1", { startsAt: "2026-10-06T19:00:00Z", provenance: { ...old.provenance, collectedAt: "2026-10-05T13:00:00Z" } });
  const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: at, sources: [], counts: snapshotCounts([old, fresh], 0), meetings: [old, fresh], agendaDocuments: [{ id: "agenda", meetingId: old.id, ocdId: old.ocdId } as MeetingsSnapshot["agendaDocuments"][number]] };
  const result = mergeScopeArtifacts(partitionSnapshotByScope(snapshot, at), snapshot);
  assert.equal(result.meetings.length, 1);
  assert.equal(result.meetings[0].startsAt, fresh.startsAt);
  assert.equal(result.agendaDocuments[0].meetingId, fresh.id);
  assert.deepEqual(result.meetings[0].mergedMeetingIds, [old.id, fresh.id]);
  const again = mergeReaderSittings(result.meetings);
  assert.deepEqual(again.rows, result.meetings);
});
