import assert from "node:assert/strict";
import test from "node:test";

import { paidLaneOf } from "../app/(admin)/_mw/data/research-lane.ts";
import type { ResearchState } from "../lib/control-plane/scheduler/research-policy.ts";

const closed = (reason: string, waiting: number | undefined) =>
  ({ modelLaneEnabled: false, modelLaneDisabledReason: reason, queue: { modelClassDeferredForLane: waiting } }) as unknown as ResearchState;

test("the paid lane line keeps the waiting count whichever closed reason the runner names first", () => {
  // The owner's pause now outranks the delivery gate (paid work fails closed),
  // so the paused sentence must carry the count the gate sentence used to.
  assert.equal(paidLaneOf(closed("paused by the owner (PAUSE:2026-09-23T17:25:04.443Z)", 1_234)).closedBecause, "paused by you; 1,234 paid items wait.");
  assert.match(paidLaneOf(closed("no delivery path is open: …", 12)).closedBecause ?? "", /; 12 paid items wait\.$/);
  // Unknown is never zero: an unread count adds no clause.
  assert.equal(paidLaneOf(closed("paused by the owner", undefined)).closedBecause, "paused by you.");
  assert.equal(paidLaneOf(closed("paused by the owner", 0)).closedBecause, "paused by you.");
});

test("the runner pause and an unreadable control each read in plain words, with the count", () => {
  assert.equal(paidLaneOf(closed("the owner paused the runner (intent PAUSE_RUNNER:x); no paid model work runs under it", 3)).closedBecause, "paused: you paused the runner; 3 paid items wait.");
  assert.equal(
    paidLaneOf(closed("held closed as if paused, because an owner spending control could not be read: research intents. Plain-code work continue", 3)).closedBecause,
    "held closed: a spending control could not be read, so paid work waits until it can be; 3 paid items wait.",
  );
});
