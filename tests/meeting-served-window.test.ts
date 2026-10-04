import assert from "node:assert/strict";
import test from "node:test";

import { readReaderEdgeMeetings } from "../lib/meetings/edge-serving.ts";
import type { MeetingsProjectionReadResult } from "../lib/meetings/snapshot.ts";

/** DB-01: partitions hold 120 days of history; each read hands back only the window it asks for. */
const NOW = "2026-09-08T13:00:00.000Z";
const at = (days: number) => new Date(Date.parse(NOW) + days * 86_400_000).toISOString();
const row = (id: string, days: number) => ({ id, startsAt: at(days), status: "CONCLUDED" });

function heldRead(): MeetingsProjectionReadResult {
  const meetings = [row("recent", -10), row("ninety-five", -95), row("far", -130), row("soon", 30), row("later", 100)];
  return {
    kind: "PROMOTED",
    value: {
      formatVersion: 1,
      generatedAt: NOW,
      counts: { fresh: meetings.length, carried: 0, total: meetings.length },
      sources: [],
      meetings,
      agendaDocuments: [{ id: "doc-ninety-five", meetingId: "ninety-five" }, { id: "doc-recent", meetingId: "recent" }],
    },
    metadata: {},
    partitions: [],
    detail: "test",
  } as unknown as MeetingsProjectionReadResult;
}

const idsOf = (read: MeetingsProjectionReadResult) =>
  read.kind === "PROMOTED" ? read.value.meetings.map(({ id }) => id) : [];

test("SHOWN is 90 days each way; HELD adds the history out to 120 days back", async () => {
  const shown = await readReaderEdgeMeetings({ now: NOW, fallback: async () => heldRead() });
  assert.deepEqual(idsOf(shown), ["recent", "soon"]);
  const held = await readReaderEdgeMeetings({ now: NOW, window: "HELD", fallback: async () => heldRead() });
  assert.deepEqual(idsOf(held), ["recent", "ninety-five", "soon"]);
});

test("the window follows its meetings: agenda documents and counts agree", async () => {
  const shown = await readReaderEdgeMeetings({ now: NOW, fallback: async () => heldRead() });
  assert.equal(shown.kind, "PROMOTED");
  if (shown.kind !== "PROMOTED") return;
  assert.deepEqual(shown.value.agendaDocuments.map(({ id }) => id), ["doc-recent"]);
  assert.equal(shown.value.counts.total, shown.value.meetings.length);
});
