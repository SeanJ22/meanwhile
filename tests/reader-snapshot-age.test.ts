import assert from "node:assert/strict";
import test from "node:test";
import { heldSnapshot, snapshotInView, wireSnapshot } from "../lib/meetings/freshness.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

const EPOCH = "1970-01-01T00:00:00.000Z", AT = "2026-10-21T12:00:00.000Z";

const placeRow = (meetingRows: unknown[]) => [{
  entities: [], fields: [], rosters: [], comments: [], sittings: [], meeting_rows: meetingRows, parts: {}, governments: [], divisions: [], registration_held: false,
}];

test("a place with no held calendar has no snapshot date, and the wire says so instead of 1970", async () => {
  const none = await readPlacePackage({ state: "MI", divisionIds: [] }, async () => placeRow([]));
  assert.equal(none.snapshotHeldAt, null);
  assert.equal(wireSnapshot(none.snapshotHeldAt, none.snapshot.sources), null);
});

test("a place with a held calendar keeps its real snapshot date", async () => {
  const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: AT, sources: [], counts: snapshotCounts([], 0), meetings: [], agendaDocuments: [] };
  const held = await readPlacePackage({ state: "AZ", divisionIds: [] }, async () =>
    placeRow([{ scope: "source:ical:body:x", payload: snapshot, current_version_id: "v-1", confirmation: null }]));
  assert.equal(held.snapshotHeldAt, AT);
  assert.deepEqual(wireSnapshot(held.snapshotHeldAt, held.snapshot.sources), { version: 2, generatedAt: AT, failed: [] });
});

test("the wire snapshot lists the sources that could not be reached", () => {
  const wire = wireSnapshot(AT, [
    { source: "ok", ok: true }, { source: "down", ok: false, unreachableOcdIds: ["ocd-division/country:us/state:az"] }, { source: "quiet", ok: false },
  ]);
  assert.deepEqual(wire?.failed, [{ source: "down", ocdIds: ["ocd-division/country:us/state:az"] }, { source: "quiet", ocdIds: [] }]);
});

test("a stored 1970 or unreadable date never reaches the Checked line", () => {
  const status = (generatedAt: string) => ({ version: 2, generatedAt, failed: [] });
  assert.equal(heldSnapshot(status(EPOCH)), null);
  assert.equal(heldSnapshot(status("")), null);
  assert.equal(heldSnapshot(status("not a date")), null);
  assert.equal(heldSnapshot(null), null);
  assert.equal(heldSnapshot(undefined), null);
  assert.equal(snapshotInView(status(EPOCH), []), null);
  assert.equal(snapshotInView({ ...status(EPOCH), carried: { count: 1, lastFreshAt: AT } }, [{ carried: { lastFreshAt: AT } }]), null);
  const real = status(AT);
  assert.equal(heldSnapshot(real), real);
  assert.equal(snapshotInView(real, [])?.generatedAt, AT);
});
