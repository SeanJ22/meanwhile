import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factDb } from "./helpers/fact-db.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishOwnerChoice } from "../lib/facts/owner-choices-edge.ts";
import { readerRecordsWithOwnerChoices } from "../lib/facts/owner-flags.ts";
import { meetingVenueChoiceHash, meetingVenueChoices } from "../lib/civic-data/meeting-venue-inputs.ts";
import type { VenueEntry } from "../lib/meetings/venue-cache.ts";

test("producer venue decisions use the canonical choice and the same semantic snapshot even while the reader edge is older", async () => {
  const db = await factDb(), dir = await mkdtemp(join(tmpdir(), "meeting-owner-inputs-"));
  const previous = process.env.WTP_READER_EDGE_DIR, at = "2026-10-26T12:00:00Z", oldAt = "2026-10-26T11:00:00Z";
  const venue: VenueEntry & {id:string} = { id: "venue:test", sourceId: "ical", bodyOcdId: "ocd-division/country:us/state:nh/place:testville",
    match: "Town Hall", name: "Town Hall", address: "Original address", lat: 43, lng: -71,
    addressSourceUrl: "https://city.example.gov/hall", coordinateSourceUrl: "https://city.example.gov/map", verifiedAt: oldAt };
  try {
    process.env.WTP_READER_EDGE_DIR = dir;
    await publishOwnerChoice("venue-resolutions", { ...venue }, { id: 1, resolvedAt: oldAt, choice: "TYPED_VALUE", values: { address: "Old edge address" },
      sourceUrl: "https://city.example.gov/old-address" }, new LocalFileArtifactStore(dir));
    await db.query(`INSERT INTO owner_flag(kind,reader_family,reader_id,resolved,owner_values,owner_source_url,resolved_at)
      VALUES('AUDIT_LOOKS_WRONG','venue-resolutions',$1,'TYPED_VALUE',$2::jsonb,$3,$4)`,
      [venue.id, JSON.stringify({ address: "Current canonical address", name: "Current Hall", lat: 43.5 }), "https://city.example.gov/current-address", at]);
    const digest = await meetingVenueChoiceHash(db.query);
    const [selected] = await meetingVenueChoices(db.query, [venue], digest);
    assert.equal(selected!.address, "Current canonical address"); assert.equal(selected!.name, "Current Hall"); assert.equal(selected!.lat, 43.5);
    assert.equal(venue.address, "Original address", "the raw source record is not mutated by an owner decision");
    assert.deepEqual((selected as VenueEntry & {fieldSources:unknown}).fieldSources, Object.fromEntries(["address", "name", "lat"].map(field => [field,
      { sourceUrl: "https://city.example.gov/current-address", sourceOrg: "Sean", collectedAt: new Date(at).toISOString(), verifiedAt: new Date(at).toISOString(), provenance: "OWNER" }])));
    assert.equal((await readerRecordsWithOwnerChoices(db.query, "venue-resolutions", [venue]))[0]!.address, "Old edge address",
      "the public reader keeps its existing edge behavior");
    await db.query(`INSERT INTO owner_flag(kind,reader_family,reader_id,resolved,resolved_at)
      VALUES('AUDIT_LOOKS_WRONG','venue-resolutions',$1,'REMOVE',$2)`, [venue.id, "2026-10-26T12:01:00Z"]);
    await assert.rejects(meetingVenueChoices(db.query, [venue], digest), /MEETING_VENUE_OWNER_INPUT_CHANGED/);
    assert.deepEqual(await meetingVenueChoices(db.query, [venue], await meetingVenueChoiceHash(db.query)), [], "a new canonical removal is applied on continuation");
  } finally {
    if (previous === undefined) delete process.env.WTP_READER_EDGE_DIR; else process.env.WTP_READER_EDGE_DIR = previous;
    await rm(dir, { recursive: true, force: true }); await db.pg.close();
  }
});
