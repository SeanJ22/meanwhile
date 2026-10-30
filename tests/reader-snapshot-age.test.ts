import assert from "node:assert/strict";
import test from "node:test";
import { heldSnapshot, snapshotInView, wireSnapshot } from "../lib/meetings/freshness.ts";
import { PLACE_PAGES_SQL, readPlacePackage } from "../lib/reader/place.ts";
import { sittingRows } from "./helpers/meeting-fact-rows.ts";
import type { Meeting } from "../lib/sources/types.ts";

const EPOCH = "1970-01-01T00:00:00.000Z", AT = "2026-10-21T12:00:00.000Z";

const placeRow = (state: string, sittings: unknown[]) => [{
  page_id: `ocd-division/country:us/state:${state.toLowerCase()}`, page_kind: "place", built_at: AT, body_ids: [],
  row: { division_ids: [], entities: [], fields: [], rosters: [], comments: [], sittings, agenda_documents: [], agenda_document_links: [], agenda_texts: [], parts: {}, governments: [], divisions: [], registration_held: false },
}];

test("a place with no held calendar has no snapshot date, and the wire says so instead of 1970", async () => {
  const none = await readPlacePackage({ state: "MI", divisionIds: [] }, async sql => {
    assert.equal(sql, PLACE_PAGES_SQL);
    return placeRow("MI", []);
  });
  assert.equal(none.snapshotHeldAt, null);
  assert.equal(wireSnapshot(none.snapshotHeldAt, none.snapshot.sources), null);
});

test("a place with a held calendar keeps its real snapshot date", async () => {
  const sitting = { id: "ical:one", bodyId: "ocd-division/country:us/state:az#council", bodyName: "Council", ocdId: null, title: "Council", startsAt: "2026-10-22T12:00:00Z", timeZone: "UTC",
    location: null, agendaUrl: null, jurisdiction: "Local", status: "SCHEDULED", provenance: { sourceUrl: "https://example.gov/calendar", sourceOrg: "Example", collectedAt: AT, verifiedAt: AT } } as Meeting;
  const held = await readPlacePackage({ state: "AZ", divisionIds: [] }, async sql => {
    assert.equal(sql, PLACE_PAGES_SQL);
    return [{ ...placeRow("AZ", sittingRows([sitting]))[0]!, row: { ...placeRow("AZ", sittingRows([sitting]))[0]!.row,
      entities: [{ id: sitting.bodyId, name: "Council", division: "ocd-division/country:us/state:az" }] } }];
  });
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
