import assert from "node:assert/strict";
import test from "node:test";

import { validateSnapshot, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";

function meetingOf(id: string): Meeting {
  return {
    id,
    ocdId: "ocd-division/country:us/state:az/county:stub",
    bodyId: "ocd-division/country:us/state:az/county:stub#governing",
    bodyName: "Stub Board",
    title: "Stub Meeting",
    startsAt: "2026-09-01T19:00:00.000-07:00",
    timeZone: "America/Phoenix",
    location: { name: "Stub Hall", address: null, lat: 32.2, lng: -110.9 },
    agendaUrl: null,
    jurisdiction: "Stub, AZ",
    status: "SCHEDULED",
    provenance: { sourceUrl: null, sourceOrg: "Stub", collectedAt: "2026-08-13T00:00:00Z", verifiedAt: null },
  };
}

function validSnapshot(): MeetingsSnapshot {
  return {
    formatVersion: 1,
    generatedAt: "2026-08-13T12:00:00.000Z",
    counts: { fresh: 2, carried: 0, total: 2 },
    sources: [{
      source: "stub",
      ok: true,
      error: null,
      fetched: 2,
      normalized: 2,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    }],
    meetings: [meetingOf("stub:1"), meetingOf("stub:2")],
    agendaDocuments: [],
  };
}

test("PLANTED: a snapshot missing bodyId is REFUSED, not served", () => {
  const raw = validSnapshot() as unknown as { meetings: { bodyId?: string | null }[] };

  /* It must be VALID as it stands, or the refusal below proves nothing. */
  assert.doesNotThrow(() => validateSnapshot(structuredClone(raw)));

  const oldSchema = structuredClone(raw);
  for (const meeting of oldSchema.meetings) delete meeting.bodyId;

  assert.throws(
    () => validateSnapshot(oldSchema),
    /carry no bodyId/,
    "a snapshot with no body identity validated — the misattribution class can return through a merge",
  );
});

test("PLANTED: even ONE meeting without body identity is refused", () => {
  const raw = validSnapshot() as unknown as { meetings: { bodyId?: string | null }[] };

  const oneMissing = structuredClone(raw);
  delete oneMissing.meetings[0].bodyId;
  assert.throws(() => validateSnapshot(oneMissing), /carry no bodyId/);
});
