import assert from "node:assert/strict";
import test from "node:test";
import { packReadyPlace, unpackReadyPlace } from "../lib/reader/place-ready.ts";
import { READY_PLACE_SQL, placePageCacheIds, readPlacePackage } from "../lib/reader/place.ts";
import type { PlacePackage } from "../lib/reader/place-types.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

const BODY = "ocd-division/country:us/state:az/place:example#council";
const meeting: Meeting = { id: "calendar:exact-id", mergedMeetingIds: ["portal:prior-id"], bodyId: BODY,
  ocdId: BODY.split("#")[0]!, bodyName: "Public council", title: "Budget hearing — educación", startsAt: "2020-01-01T12:00:00Z",
  timeZone: "UTC", location: null, agendaUrl: "https://example.gov/agenda", jurisdiction: "Example", status: "SCHEDULED",
  provenance: { sourceUrl: "https://example.gov/calendar", sourceOrg: "Public council", collectedAt: "2026-10-24T12:00:00Z", verifiedAt: null } };
const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: "2026-10-24T12:00:00Z", meetings: [meeting],
  agendaDocuments: [{ id: "document:exact-id", meetingId: meeting.id, ocdId: meeting.ocdId, documentUrl: "https://example.gov/agenda",
    contentHash: "a".repeat(64), retrievedAt: "2026-10-24T12:00:00Z", contentType: "text/html", text: "Presupuesto público — 予算\n".repeat(100),
    extraction: "html", extractionNote: null, sourceUrl: "https://example.gov/agenda", sourceOrg: "Public council", collectedAt: "2026-10-24T12:00:00Z", verifiedAt: null }],
  sources: [], counts: snapshotCounts([meeting], 0) };
const page: PlacePackage = { registry: null, everydayRouting: null, publicationAttempts: [], bodies: [], governments: [], divisions: [],
  registrationHeld: false, meetings: [meeting], snapshot, snapshotHeldAt: snapshot.generatedAt, bodySnapshots: { [BODY]: snapshot },
  agendaDocumentLinks: [{ meetingId: meeting.id, documentUrl: "https://example.gov/agenda" }] };

test("ready compression preserves the complete JSON, exact event identities and Unicode source text", () => {
  const published = { ...page, futureSourceFields: { blank: "", absent: null, count: 0, enabled: false, values: ["résumé", "予算"] } };
  const packed = packReadyPlace(published);
  assert.deepEqual(Object.keys(packed), ["encoding", "data"]);
  assert.equal(packed.encoding, "gzip-json-v1");
  assert.deepEqual(unpackReadyPlace(packed), JSON.parse(JSON.stringify(published)));
  assert.ok(Buffer.byteLength(JSON.stringify(packed)) < Buffer.byteLength(JSON.stringify(published)) / 3);
});

test("compressed and legacy ready pages each resolve exact IDs through one existing reader query", async () => {
  for (const stored of [packReadyPlace(page), page]) {
    let queries = 0;
    const value = await readPlacePackage({ state: "AZ", placeId: BODY, divisionIds: [], includeHistory: true }, async (text, params) => {
      queries++;
      assert.equal(text, READY_PLACE_SQL);
      assert.deepEqual(params, [BODY, true]);
      return [{ page: stored, version: 2 }];
    });
    assert.equal(queries, 1);
    assert.deepEqual(value, page);
    assert.deepEqual(placePageCacheIds(value), [BODY]);
    assert.deepEqual(value.meetings[0].mergedMeetingIds, ["portal:prior-id"]);
  }
});

test("a corrupt compressed ready page fails its single read without querying source tables", async () => {
  assert.throws(() => unpackReadyPlace({ encoding: "another-format", data: "" }), /PLACE_PAGE_ENCODING_INVALID/);
  assert.throws(() => unpackReadyPlace({ encoding: "gzip-json-v1" }), /PLACE_PAGE_ENCODING_INVALID/);
  let queries = 0;
  await assert.rejects(readPlacePackage({ state: "AZ", placeId: BODY, divisionIds: [] }, async text => {
    queries++;
    assert.equal(text, READY_PLACE_SQL);
    return [{ page: { encoding: "gzip-json-v1", data: "corrupt-gzip" }, version: 2 }];
  }));
  assert.equal(queries, 1);
});
