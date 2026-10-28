import assert from "node:assert/strict";
import test from "node:test";
import { databaseReadingSentence, databaseReadingView } from "../lib/control-plane/admin-view/database-reading.ts";
import type { HourlyDatabaseTransfer } from "../lib/db/transfer.ts";

const hour = (at: string, database: "reader" | "control-plane", requestBytes: number, responseBytes: number): HourlyDatabaseTransfer =>
  ({ hour: new Date(at).toISOString(), database, requests: 1, requestBytes, responseBytes });

test("Now's reading line sums request and response bytes of both databases by Eastern day", () => {
  const view = databaseReadingView([
    hour("2026-10-27T04:00:00Z", "reader", 1e9, 2e9), // 12 AM EDT Oct 27: yesterday
    hour("2026-10-28T03:00:00Z", "control-plane", 0.5e9, 0.5e9), // 11 PM EDT Oct 27: yesterday
    hour("2026-10-28T04:00:00Z", "reader", 0, 4e9), // 12 AM EDT Oct 28: today
    hour("2026-10-28T21:00:00Z", "control-plane", 0.25e9, 1.75e9),
  ], "2026-10-28T22:10:00Z");
  assert.deepEqual(view, { yesterday: { day: "2026-10-27", gb: 4 }, today: { day: "2026-10-28", gb: 6 }, targetGb: 10, asOf: "2026-10-28T22:10:00Z" });
  assert.equal(databaseReadingSentence(view), "Database reading: yesterday 4.0 GB, today 6.0 GB so far, against the 10 GB a day target.");
});

test("Eastern days stay whole across the fall time change, and an hour with nothing read counts as zero", () => {
  const view = databaseReadingView([
    hour("2026-11-01T04:00:00Z", "reader", 0, 1e9), // 12 AM EDT Nov 1
    hour("2026-11-01T06:00:00Z", "reader", 0, 1e9), // 1 AM EST, the repeated hour
    hour("2026-11-02T04:30:00Z", "reader", 0, 1e9), // 11:30 PM EST Nov 1
    hour("2026-11-02T05:00:00Z", "reader", 0, 3e9), // 12 AM EST Nov 2
  ], "2026-11-02T15:00:00Z");
  assert.deepEqual([view.yesterday, view.today], [{ day: "2026-11-01", gb: 3 }, { day: "2026-11-02", gb: 3 }]);
  assert.deepEqual(databaseReadingView([], "2026-11-02T15:00:00Z").today, { day: "2026-11-02", gb: 0 });
});
