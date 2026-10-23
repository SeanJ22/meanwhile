import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import { readReaderEdgeMeetings } from "../lib/meetings/edge-serving.ts";
import type { ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";
import { ACQUIRED_URL, PIMA, freshEdge, publishPass, row } from "./helpers/meeting-body-fixtures.ts";

/** Partitions hold 120 days of history; each read hands back only the window it asks for. */
const NOW = "2026-09-08T13:00:00.000Z";
const at = (days: number) => new Date(Date.parse(NOW) + days * 86_400_000).toISOString();
const sitting = (suffix: string, days: number): Meeting => ({ ...row(PIMA, suffix, at(days), NOW), status: "CONCLUDED", agendaUrl: `https://example.gov/agenda/${suffix}` });

const agendaDocument = (meeting: Meeting): AgendaDocument => ({
  id: `${meeting.id}@${"b".repeat(64)}`, meetingId: meeting.id, ocdId: meeting.ocdId, documentUrl: `${ACQUIRED_URL}?agenda=${meeting.id}`,
  contentHash: "b".repeat(64), retrievedAt: NOW, contentType: "text/html", text: "Official agenda", extraction: "html", extractionNote: null,
  sourceUrl: ACQUIRED_URL, sourceOrg: meeting.provenance.sourceOrg, collectedAt: NOW, verifiedAt: null,
});

async function heldEdge(): Promise<{ readonly store: MemoryRoutineDataStore; readonly edge: ReaderArtifactStore }> {
  const store = new MemoryRoutineDataStore();
  const edge = freshEdge();
  const meetings = [sitting("recent", -10), sitting("ninety-five", -95), sitting("far", -130), { ...sitting("soon", 30), status: "SCHEDULED" as const }, { ...sitting("later", 100), status: "SCHEDULED" as const }];
  const [result] = await promoteMeetingPartitions({
    store, partitions: [PIMA], meetings,
    agendaDocuments: meetings.filter(({ id }) => id.endsWith("ninety-five") || id.endsWith("recent")).map(agendaDocument),
    reports: [{
      source: PIMA.meetingSource, ok: true, error: null, fetched: meetings.length, normalized: meetings.length,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      acquisitions: [{ source: PIMA.meetingSource, requestedUrl: ACQUIRED_URL, finalUrl: ACQUIRED_URL, httpStatus: 200, rawHash: createHash("sha256").update("held").digest("hex"), byteCount: 4 }],
    }],
    generatedAt: NOW,
  });
  assert.ok(result?.outcome.promoted, result?.outcome.candidate.failureDetail ?? "");
  await publishPass(store, edge, NOW);
  return { store, edge };
}

const idsOf = (read: Awaited<ReturnType<typeof readReaderEdgeMeetings>>) =>
  read.kind === "PROMOTED" ? read.value.meetings.map(({ id }) => id.split(":").at(-1)!) : [];

const readPima = (held: Awaited<ReturnType<typeof heldEdge>>, options: { readonly window?: "SHOWN" | "HELD"; readonly settings?: ReturnType<typeof meetingSettingsFromValues> } = {}) =>
  readReaderEdgeMeetings({ ocdIds: [PIMA.ocdId!], now: NOW, settings: meetingSettingsFromValues(), ...options });

test("SHOWN is 90 days each way; HELD keeps all kept history", async () => {
  const held = await heldEdge();
  assert.deepEqual(idsOf(await readPima(held)), ["recent", "soon"]);
  assert.deepEqual(idsOf(await readPima(held, { window: "HELD" })), ["far", "ninety-five", "recent", "soon"]);
});

test("the window follows its meetings: agenda documents and counts agree", async () => {
  const shown = await readPima(await heldEdge());
  assert.equal(shown.kind, "PROMOTED");
  if (shown.kind !== "PROMOTED") return;
  assert.deepEqual(shown.value.agendaDocuments.map(({ id }) => id.split(":").at(-1)!.split("@")[0]), ["recent"]);
  assert.equal(shown.value.counts.total, shown.value.meetings.length);
});

test("published shown window changes and undo are applied to the same held record", async () => {
  const held = await heldEdge();
  const wider = await readPima(held, { settings: meetingSettingsFromValues({ "meetings.shownAheadDays": 110 }) });
  assert.deepEqual(idsOf(wider), ["recent", "soon", "later"]);
  const restored = await readPima(held, { settings: meetingSettingsFromValues() });
  assert.deepEqual(idsOf(restored), ["recent", "soon"]);
  assert.deepEqual(idsOf(await readPima(held, { window: "HELD" })), ["far", "ninety-five", "recent", "soon"], "settings never delete held history");
});
