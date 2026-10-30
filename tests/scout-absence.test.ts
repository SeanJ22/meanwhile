/**
 * A recorded absence holds the next reading until it expires.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { scheduleObligation, isScheduled, type FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";

const NOW = "2026-09-19T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const BASE: FreshnessObligation = {
  id: "freshness:candidate-enrichment:nj:2026:x:y#candidate-authored-awaits-site",
  recordClass: "positions",
  subjectId: "ocd-division/country:us/state:nj/place:x",
  routeId: "candidate-authored-awaits-site",
  active: true,
  readerImpactAt: null,
  observedChangeRateHours: null,
  lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString(),
};

test("a standing (future) absence holds the next reading to the expiry, not the ordinary cadence", () => {
  const until = new Date(NOW_MS + 30 * 86_400_000).toISOString();
  const row = scheduleObligation({ ...BASE, absentUntil: until }, NOW_MS);
  assert.ok(isScheduled(row));
  if (!isScheduled(row)) return;
  assert.equal(row.nextDueAt, until);
  assert.equal(row.cadenceSource, "ARGUED_ABSENT");
  // Without the absence this same row (daily default, worked 48h ago) is due now.
  const plain = scheduleObligation(BASE, NOW_MS);
  assert.ok(isScheduled(plain) && Date.parse(plain.nextDueAt) <= NOW_MS, "the same row is due now without the absence");
});

test("an EXPIRED absence is ignored — the row comes due on its ordinary cadence again", () => {
  const past = new Date(NOW_MS - 3_600_000).toISOString(); // expired an hour ago
  const row = scheduleObligation({ ...BASE, absentUntil: past }, NOW_MS);
  assert.ok(isScheduled(row));
  if (!isScheduled(row)) return;
  assert.notEqual(row.cadenceSource, "ARGUED_ABSENT");
  assert.ok(Date.parse(row.nextDueAt) <= NOW_MS, "an expired absence does not delay the reading");
});
