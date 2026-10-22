import assert from "node:assert/strict";
import test from "node:test";
import { hotMeetingPartitions } from "../lib/doors/hot-partitions.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";

test("publish-now's meeting heat check skips empty scopes but still reads every existing clock", async () => {
  const existing = MEETING_PARTITION_CONTRACTS.find(contract => contract.derivedFamily === null)!;
  const now = Date.parse("2026-10-22T20:00:00.000Z");
  const seen: string[] = [];
  const hot = await hotMeetingPartitions({
    query: async (_text, params) => (params[1] as string[]).includes(existing.scope) ? [{ scope: existing.scope }] : [],
    readClock: async task => {
      seen.push(task.id);
      return { lastAttemptedAt: "2026-10-22T20:00:00.000Z", sittingStarts: ["2026-12-01T20:00:00.000Z"] };
    },
    db: { select: () => { throw new Error("No stated ends are held"); } },
  }, now);
  assert.deepEqual(seen, [existing.id]);
  assert.equal(hot.has(existing.id), false, "the proven sitting outside the window is cold");
  assert.equal(hot.size, MEETING_PARTITION_CONTRACTS.length - 1, "unread boards retain the unknown-as-hot policy");
});
