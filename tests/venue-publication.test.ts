import { scopedManualContractScope } from "../lib/civic-data/scoped-manual-contracts.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { manualProducerInvocationMatrix } from "../lib/civic-data/manual-producer-invocation.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { automaticVenuePackage } from "../lib/meetings/automatic-venue-resolutions.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { publishVenueResolutions } from "../lib/meetings/venue-publication.ts";

const T1 = "2026-09-28T08:30:00.000Z";
const T2 = "2026-09-29T08:30:00.000Z";
const FEED = "https://county.example.gov/common/modules/iCalendar/iCalendar.aspx?catID=31&feed=calendar";
const BODY = "ocd-division/country:us/state:az/county:cochise";
const ROUTES = new Map([["ical:county-governing", FEED]]);

const geo = (street: string, x: number, y: number) => ({ result: { addressMatches: [{
  matchedAddress: `${street.toUpperCase()}, BISBEE, AZ, 85603`, coordinates: { x, y },
  addressComponents: { city: "BISBEE", state: "AZ", zip: "85603", streetName: street.split(" ").slice(1, -1).join(" ").toUpperCase(), suffixType: "LN" },
} ] } });

const snapshot = (at: string, text: string): MeetingsSnapshot => ({
  generatedAt: at,
  meetings: [{
    id: `ical:county:${text}`, ocdId: BODY, bodyId: "county-governing", location: null,
    venueGap: { kind: "STATED_NOT_PLACED", publishedText: `${text} Bisbee AZ 85603`, publisher: "County" },
    provenance: { sourceUrl: FEED, sourceOrg: "County", collectedAt: at, verifiedAt: null },
  }],
  sources: [{ source: "ical", acquisitions: [{ source: "ical", requestedUrl: FEED, finalUrl: FEED, httpStatus: 200, rawHash: "a".repeat(64), byteCount: 3000 }] }],
}) as unknown as MeetingsSnapshot;

const fetchFor = (street: string, x: number, y: number) =>
  (async () => new Response(JSON.stringify(geo(street, x, y)), { status: 200 })) as typeof fetch;

test("an automatic match promotes its own pin, and the next pass keeps it (no person reviews it)", async () => {
  const store = new MemoryRoutineDataStore();
  const first = await automaticVenuePackage({ snapshot: snapshot(T1, "1415 Melody Ln"), existingIds: new Set(), memberRoutes: ROUTES,
    clock: () => T1, fetchImpl: fetchFor("1415 Melody Ln", -109.9, 31.39) });
  assert.ok(first.package, first.held.join("; "));
  const one = await publishVenueResolutions({ store, package: first.package, now: T1 });
  assert.equal(one.held, null);
  assert.ok(one.outcome?.promoted, JSON.stringify(one.outcome?.candidate.receipt));
  assert.equal(one.outcome?.candidate.receipt?.decision, "GOOD");

  const second = await automaticVenuePackage({ snapshot: snapshot(T2, "22 Cactus Ln"), existingIds: new Set(), memberRoutes: ROUTES,
    clock: () => T2, fetchImpl: fetchFor("22 Cactus Ln", -109.8, 31.4) });
  const two = await publishVenueResolutions({ store, package: second.package, now: T2 });
  assert.ok(two.outcome?.promoted, JSON.stringify(two.outcome?.candidate.receipt));

  const read = await readCuratedReaderProjection("venue-resolutions", { scope: scopedManualContractScope("venue-resolutions", BODY), store, now: T2, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(read.value.records.map((row) => row.address).sort(), ["1415 Melody Ln Bisbee AZ 85603", "22 Cactus Ln Bisbee AZ 85603"]);
});

test("a pass with no new match, or a refused one, changes nothing and never throws", async () => {
  const store = new MemoryRoutineDataStore();
  assert.deepEqual(await publishVenueResolutions({ store, package: null, now: T1 }), { records: 0, outcome: null, held: null });
  const first = await automaticVenuePackage({ snapshot: snapshot(T1, "1415 Melody Ln"), existingIds: new Set(), memberRoutes: ROUTES,
    clock: () => T1, fetchImpl: fetchFor("1415 Melody Ln", -109.9, 31.39) });
  // A coordinate outside the United States fails the validator: the pointer holds, nothing is promoted.
  const bad = { ...first.package!, payload: { kind: "venue-resolutions" as const,
    records: (first.package!.payload as { records: readonly Record<string, unknown>[] }).records.map((row) => ({ ...row, lat: 0, lng: 0 })) as never } };
  const held = await publishVenueResolutions({ store, package: bad, now: T1 });
  assert.equal(held.outcome?.promoted ?? null, null);
  assert.ok(held.held);
  const read = await readCuratedReaderProjection("venue-resolutions", { scope: scopedManualContractScope("venue-resolutions", BODY), store, now: T1, bypassCache: true });
  assert.notEqual(read.kind, "PROMOTED");
});

test("venue-resolutions publishes through its existing derived pass", () => {
  const row = manualProducerInvocationMatrix([], T1).find((entry) => entry.id === "venue-resolutions");
  assert.equal(row?.mode, "EXISTING_DERIVED");
});
