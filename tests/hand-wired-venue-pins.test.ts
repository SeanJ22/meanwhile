/**
 * A hand-wired body's newly published address gets a map point from the
 * Census geocoder in the same partition pass, with no reviewed row and no ZIP
 * required in the published text.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ChildRunReport } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";

const PARTITION = MEETING_PARTITION_CONTRACTS.find((partition) =>
  partition.meetingSource === "civicplus" && partition.wiring !== null && partition.ocdId !== null)!;
const FEED = PARTITION.wiring!.config.icalUrl as string;
const NOW = "2026-10-04T08:30:00.000Z";
const ADDRESS = "1415 W Melody Ln Bisbee AZ";
const GEO = { result: { addressMatches: [{
  matchedAddress: "1415 W MELODY LN, BISBEE, AZ, 85603",
  coordinates: { x: -109.92566533383, y: 31.393935355772 },
  addressComponents: { city: "BISBEE", state: "AZ", zip: "85603", streetName: "MELODY", preDirection: "W", suffixType: "LN" },
}] } };

const meeting = (n: number): Meeting => ({
  id: `civicplus:hand_wired:${n}`, ocdId: PARTITION.ocdId, bodyId: PARTITION.bodyId, bodyName: "Council", title: "Council",
  startsAt: "2026-10-20T19:00:00-07:00", timeZone: "America/Phoenix", location: null,
  venueGap: { kind: "STATED_NOT_PLACED", publishedText: `${ADDRESS} #${n}`, publisher: "County" },
  agendaUrl: null, jurisdiction: "County", status: "SCHEDULED",
  provenance: { sourceUrl: FEED, sourceOrg: "County", collectedAt: NOW, verifiedAt: null },
} as unknown as Meeting);

const report = (): ChildRunReport => ({
  source: "civicplus", ok: true, error: null, fetched: 25, normalized: 25,
  drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
  acquisitions: [{ source: "civicplus", requestedUrl: FEED, finalUrl: FEED, httpStatus: 200,
    rawHash: createHash("sha256").update("x").digest("hex"), byteCount: 1 }],
});

test("BX-08: every new address of a hand-wired body is pinned in one pass, past the old cap of 20", async () => {
  let calls = 0;
  const [result] = await promoteMeetingPartitions({
    store: new MemoryRoutineDataStore(), partitions: [PARTITION],
    meetings: Array.from({ length: 25 }, (_, i) => meeting(i)), agendaDocuments: [], reports: [report()], generatedAt: NOW,
    venueFetch: (async () => { calls++; return new Response(JSON.stringify(GEO), { status: 200 }); }) as typeof fetch,
  });
  assert.equal(calls, 25);
  assert.equal(result?.outcome.candidate.state, "PROMOTED");
  const model = result!.candidate.readModel as unknown as { meetings: Meeting[] };
  assert.equal(model.meetings.filter((row) => row.location?.lat === 31.393935355772).length, 25);
  assert.equal(model.meetings.some((row) => row.venueGap), false);
});

test("BX-08: a failed geocode leaves the address visible and the partition still promotes", async () => {
  const [result] = await promoteMeetingPartitions({
    store: new MemoryRoutineDataStore(), partitions: [PARTITION], meetings: [meeting(1)], agendaDocuments: [],
    reports: [report()], generatedAt: NOW,
    venueFetch: (async () => new Response("no", { status: 503 })) as typeof fetch,
  });
  assert.equal(result?.outcome.candidate.state, "PROMOTED");
  const model = result!.candidate.readModel as unknown as { meetings: Meeting[] };
  assert.equal(model.meetings[0]?.location, null);
  assert.ok(model.meetings[0]?.venueGap);
});
