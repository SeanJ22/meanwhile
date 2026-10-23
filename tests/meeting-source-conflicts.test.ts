import assert from "node:assert/strict";
import test from "node:test";
import { mergeDuplicateSittingFields, mergeReaderSittings } from "../lib/meetings/sitting-merge.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { PIMA } from "./helpers/meeting-body-fixtures.ts";
import { collapseDuplicateSittings } from "../lib/sources/composite/index.ts";
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
test("CP-18: a body's composition retains both source ids and an agenda belonging to the merged-away row", async () => {
  const owned = { bodyId: PIMA.bodyId, ocdId: PIMA.ocdId };
  const old = meeting("calendar:1", owned);
  const fresh = meeting("portal:1", { ...owned, startsAt: "2026-10-06T19:00:00Z", provenance: { ...old.provenance, collectedAt: "2026-10-05T13:00:00Z" } });
  const report = (source: string) => ({ source, ok: true, error: null, fetched: 1, normalized: 1, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } });
  const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: at, sources: [report("calendar"), report("portal")], counts: snapshotCounts([old, fresh], 0), meetings: [old, fresh], agendaDocuments: [{ id: "agenda", meetingId: old.id, ocdId: old.ocdId } as MeetingsSnapshot["agendaDocuments"][number]] };
  const held = await readPlacePackage({state:"AZ",divisionIds:[PIMA.ocdId!],bodyIds:[PIMA.bodyId],includeAgenda:true},async()=>[{
    entities:[{id:PIMA.bodyId,division:PIMA.ocdId}],fields:[],rosters:[],comments:[],sittings:[],
    meeting_rows:[{scope:PIMA.scope,payload:snapshot,current_version_id:"v-1",confirmation:null}],parts:{},governments:[],divisions:[],registration_held:false,
  }]);
  const result = held.snapshot;
  assert.equal(result.meetings.length, 1);
  assert.equal(result.meetings[0].startsAt, fresh.startsAt);
  assert.equal(result.agendaDocuments[0].meetingId, fresh.id);
  assert.deepEqual(result.meetings[0].mergedMeetingIds, [old.id, fresh.id]);
  const again = mergeReaderSittings(result.meetings);
  assert.deepEqual(again.rows, result.meetings);
});

test("CP-18: composite collapse keeps field winners, losing evidence and source aliases before day reconciliation", () => {
  const old = meeting("calendar:1", { location: { name: "Old Hall", address: "Old address", lat: 1, lng: 2 } });
  const fresh = meeting("portal:1", { agendaUrl: "https://office.gov/new-agenda", location: { name: "New Hall", address: "New address", lat: 1, lng: 2 }, provenance: { ...old.provenance, collectedAt: "2026-10-05T13:00:00Z" } });
  const exact = collapseDuplicateSittings([old, fresh], mergeDuplicateSittingFields);
  assert.equal(exact.collapsed, 1);
  assert.deepEqual(exact.dropped, [old]);
  const final = mergeReaderSittings(exact.rows);
  assert.equal(final.rows.length, 1);
  assert.equal(final.rows[0].location?.name, "New Hall");
  assert.equal(final.rows[0].agendaUrl, fresh.agendaUrl);
  assert.deepEqual(final.rows[0].mergedMeetingIds, [old.id, fresh.id]);
  assert.ok(final.rows[0].publicationConflicts?.some(row => (row.record as { field: string }).field === "location"));
  assert.equal(final.aliases.get(old.id), fresh.id);
});
test("CP-18: exact collapse never joins different canonical bodies or conceals a second sitting from one door", () => {
  const a = meeting("portal:1"), other = meeting("calendar:1", { bodyId: "other-body" });
  assert.equal(collapseDuplicateSittings([a, other], mergeDuplicateSittingFields).rows.length, 2);
  const b = meeting("portal:2", { startsAt: "2026-10-06T20:00:00Z" });
  const exact = collapseDuplicateSittings([a, meeting("calendar:1"), b], mergeDuplicateSittingFields);
  assert.equal(exact.rows.length, 2);
  assert.equal(mergeReaderSittings(exact.rows).rows.length, 2, "the first record still represents both doors; the later portal sitting stays separate");
  const sameInstant = collapseDuplicateSittings([a, meeting("calendar:1"), meeting("portal:2")], mergeDuplicateSittingFields);
  assert.equal(mergeReaderSittings(sameInstant.rows).rows.length, 2, "two catalogue entries from the same source remain distinct");
});
