import assert from "node:assert/strict";
import test from "node:test";

import {
  contractHealthLevel,
  gap,
  held,
  measured,
  pilotHealthView,
  type Measured,
  type OwnerContractReading,
  type OwnerSnapshot,
} from "../lib/control-plane/owner-surface.ts";

/**
 * The pilot-health view is a pure projection: `overall` follows `pilotGreen` exactly, and the view only adds the
 * failing-vs-stale distinction (RED vs AMBER) the contract states already carry.
 */

const NOW = "2026-09-04T12:00:00.000Z";

function reading(
  contract: OwnerContractReading["contract"],
  state: string,
  denom: OwnerContractReading["denominator"],
  runAt: string | null,
): OwnerContractReading {
  return { contract, state, reason: `${contract} is ${state}`, denominator: denom, proofClass: "SESSION_MEASURED", runSha: "abc1234", runAt };
}

function snap(pilotGreen: boolean | null, contracts: OwnerContractReading[]): OwnerSnapshot {
  return { pilotGreen, contracts } as unknown as OwnerSnapshot;
}

const d = (v: number, n: number) => held(measured(v, n, "x", "src"));

test("no snapshot is UNKNOWN, never a green or a red", () => {
  const view = pilotHealthView(null, NOW);
  assert.equal(view.overall, "UNKNOWN");
  assert.equal(view.cards.length, 0);
});

test("all three GREEN rolls up GREEN with no next actions", () => {
  const view = pilotHealthView(
    snap(true, [
      reading("READER", "GREEN", d(12, 12), "2026-09-04T09:00:00.000Z"),
      reading("TRUTH", "GREEN", d(8, 8), "2026-09-04T09:00:00.000Z"),
      reading("FRESHNESS", "GREEN", d(3, 3), "2026-09-04T09:00:00.000Z"),
    ]),
    NOW,
  );
  assert.equal(view.overall, "GREEN");
  assert.match(view.reason, /All three contracts are met/);
  assert.ok(view.cards.every((c) => c.level === "GREEN" && c.nextAction === null));
});

test("a measured failure is RED, and it is named as the blocker", () => {
  const view = pilotHealthView(
    snap(false, [
      reading("READER", "RED", d(4, 12), "2026-09-04T09:00:00.000Z"),
      reading("TRUTH", "GREEN", d(8, 8), "2026-09-04T09:00:00.000Z"),
      reading("FRESHNESS", "NOT_READY", gap<Measured>("OURS", "scheduler in shadow"), null),
    ]),
    NOW,
  );
  assert.equal(view.overall, "RED"); // any RED sinks the rollup to RED, not AMBER
  assert.match(view.reason, /READER failing/);
  const reader = view.cards.find((c) => c.contract === "READER")!;
  assert.equal(reader.level, "RED");
  assert.match(reader.nextAction ?? "", /Investigate/);
});

test("merely-not-proven (NOT_READY / AWAITING) without any RED is AMBER, not RED", () => {
  const view = pilotHealthView(
    snap(false, [
      reading("READER", "GREEN", d(12, 12), "2026-09-04T09:00:00.000Z"),
      reading("TRUTH", "AWAITING_OWNER_DATA", gap<Measured>("OURS", "no answer key"), null),
      reading("FRESHNESS", "NOT_READY", gap<Measured>("OURS", "scheduler in shadow"), null),
    ]),
    NOW,
  );
  assert.equal(view.overall, "AMBER");
  const truth = view.cards.find((c) => c.contract === "TRUTH")!;
  assert.equal(truth.level, "AMBER");
  assert.equal(truth.headline, "Awaiting owner data");
  const freshness = view.cards.find((c) => c.contract === "FRESHNESS")!;
  assert.equal(freshness.headline, "Not yet proven");
  assert.equal(freshness.proofAge, "no run recorded");
});

test("proof age is read from the run timestamp", () => {
  const view = pilotHealthView(
    snap(true, [reading("READER", "GREEN", d(1, 1), "2026-09-02T12:00:00.000Z")]),
    NOW,
  );
  assert.equal(view.cards[0].proofAge, "proof 2d old");
});

test("the level mapping is exactly the four states", () => {
  assert.equal(contractHealthLevel("GREEN"), "GREEN");
  assert.equal(contractHealthLevel("RED"), "RED");
  assert.equal(contractHealthLevel("NOT_READY"), "AMBER");
  assert.equal(contractHealthLevel("AWAITING_OWNER_DATA"), "AMBER");
  assert.equal(contractHealthLevel("nonsense"), "UNKNOWN");
});
