import assert from "node:assert/strict";
import test from "node:test";

import {
  CELL_STATES,
  GATE_ORDER,
  READINESS_RANK,
  type Gate,
  type GateCell,
  type GateEvidence,
  coverageCell,
  deriveGateCell,
  deriveGateCells,
  enforceMonotonicity,
  freshnessOf,
  isCurrent,
  worstOf,
} from "../lib/control-plane/readiness/gates.ts";

/**
 * THE READINESS GATE CORE (State Readiness Control Panel, 2026-09-03).
 *
 * The panel's entire value is that it cannot lie: it can never believe it has
 * data it has not verified (a false CURRENT), and never believe it is missing
 * data that does not exist (NOT_WALKED where the answer is ARGUED_ABSENT). Every
 * claim below is one of those two failures made impossible.
 */

const NOW = "2026-09-03T12:00:00.000Z";

function ev(partial: Partial<GateEvidence>): GateEvidence {
  return {
    covered: 0,
    total: 0,
    asOf: null,
    staleAfterDays: null,
    walkClosed: false,
    blockedReason: null,
    gatedReason: null,
    evidenceRef: null,
    ...partial,
  };
}

/* ------------------------------------------------------------------ R-A */

test("R-A: there are exactly six cell states, never two", () => {
  assert.equal(CELL_STATES.length, 6);
  assert.deepEqual([...CELL_STATES].sort(), [
    "ARGUED_ABSENT",
    "BLOCKED",
    "CURRENT",
    "GATED_ON_OPERATOR",
    "NOT_WALKED",
    "PARTIAL_OR_STALE",
  ]);
});

test("R-A: NOT_WALKED and ARGUED_ABSENT are the opposite ends of knowing, never equal", () => {
  // "we have not looked" ranks below everything; "we looked and it isn't there"
  // ranks with a complete answer. They can never collapse into one number.
  assert.equal(READINESS_RANK.NOT_WALKED, 0);
  assert.equal(READINESS_RANK.ARGUED_ABSENT, READINESS_RANK.CURRENT);
  assert.notEqual(READINESS_RANK.NOT_WALKED, READINESS_RANK.ARGUED_ABSENT);
});

/* ------------------------------------------------------------------ R-E/R-F worst-of */

test("R-E: worst-of takes the minimum, and an empty set is NOT_WALKED not CURRENT", () => {
  assert.equal(worstOf([]), "NOT_WALKED");
  assert.equal(worstOf(["CURRENT", "CURRENT"]), "CURRENT");
  assert.equal(worstOf(["CURRENT", "PARTIAL_OR_STALE"]), "PARTIAL_OR_STALE");
  // CURRENT and ARGUED_ABSENT are both top rank (both "resolved/ready"): worst-of
  // stays at the top rank, and a zip with both is ready. Tie-break order is not
  // semantic, so the invariant is the rank, not which of the two is returned.
  assert.equal(READINESS_RANK[worstOf(["CURRENT", "ARGUED_ABSENT"])], 5);
  assert.equal(worstOf(["CURRENT", "NOT_WALKED", "PARTIAL_OR_STALE"]), "NOT_WALKED");
  assert.equal(worstOf(["BLOCKED", "PARTIAL_OR_STALE"]), "BLOCKED");
});

test("R-E: worst-of never averages — one blocked body sinks an otherwise green set", () => {
  const states = ["CURRENT", "CURRENT", "CURRENT", "CURRENT", "BLOCKED"] as const;
  assert.equal(worstOf(states), "BLOCKED");
});

/* ------------------------------------------------------------------ gate derivation */

test("derives CURRENT only when complete and fresh", () => {
  const cell = deriveGateCell(
    "ACQUIRED",
    ev({ covered: 15, total: 15, asOf: "2026-09-01", staleAfterDays: 30 }),
    NOW,
  );
  assert.equal(cell.state, "CURRENT");
  assert.equal(cell.asOf, "2026-09-01");
});

test("R-G: a complete gate past its freshness threshold is PARTIAL_OR_STALE, not CURRENT", () => {
  const cell = deriveGateCell(
    "ACQUIRED",
    ev({ covered: 15, total: 15, asOf: "2026-07-01", staleAfterDays: 30 }),
    NOW,
  );
  assert.equal(cell.state, "PARTIAL_OR_STALE");
});

test("some-but-not-all is PARTIAL_OR_STALE", () => {
  const cell = deriveGateCell(
    "ACQUIRED",
    ev({ covered: 38, total: 236, asOf: "2026-08-22", staleAfterDays: 365 }),
    NOW,
  );
  assert.equal(cell.state, "PARTIAL_OR_STALE");
});

test("R-I: a zero with NO recorded walk is NOT_WALKED, never ARGUED_ABSENT", () => {
  const cell = deriveGateCell("ACQUIRED", ev({ covered: 0, total: 318, asOf: null }), NOW);
  assert.equal(cell.state, "NOT_WALKED");
});

test("R-I: ARGUED_ABSENT requires a closed walk on record", () => {
  const cell = deriveGateCell(
    "VERIFIED",
    ev({ covered: 0, total: 0, walkClosed: true, asOf: "2026-09-01", evidenceRef: "az-cf-85641" }),
    NOW,
  );
  assert.equal(cell.state, "ARGUED_ABSENT");
  assert.equal(cell.evidenceRef, "az-cf-85641");
});

test("BLOCKED and GATED_ON_OPERATOR each carry their named reason and override the fraction", () => {
  const blocked = deriveGateCell(
    "VERIFIED",
    ev({ covered: 4, total: 91, blockedReason: "the county disclosure portal returns 403 to every client" }),
    NOW,
  );
  assert.equal(blocked.state, "BLOCKED");
  assert.match(blocked.detail, /403/);

  const gated = deriveGateCell(
    "VERIFIED",
    ev({ covered: 0, total: 15, gatedReason: "records request needs Sean's signature before it can be sent" }),
    NOW,
  );
  assert.equal(gated.state, "GATED_ON_OPERATOR");
  assert.match(gated.detail, /Sean/);
});

test("a never-established (null) as-of with no coverage is NOT_WALKED and carries no date", () => {
  const cell = deriveGateCell("SOURCE_KNOWN", ev({ covered: 0, total: 0, asOf: null }), NOW);
  assert.equal(cell.state, "NOT_WALKED");
  assert.equal(cell.asOf, null);
});

/* ------------------------------------------------------------------ R-G freshness */

test("R-G: freshness is per-capability; a null as-of is unknown, never fresh", () => {
  assert.equal(freshnessOf(null, 30, NOW).fresh, false);
  assert.equal(freshnessOf("2026-09-01", 30, NOW).fresh, true);
  assert.equal(freshnessOf("2026-07-01", 30, NOW).fresh, false);
  // A boundary at rest: null threshold never goes stale.
  assert.equal(freshnessOf("2020-01-01", null, NOW).fresh, true);
});

/* ------------------------------------------------------------------ R-B monotonicity */

function cellOf(gate: Gate, state: GateCell["state"]): GateCell {
  return { gate, state, asOf: null, detail: "", evidenceRef: null, monotonicityOk: true };
}

test("R-B: a clean ladder raises no violation", () => {
  const cells = [
    cellOf("SOURCE_KNOWN", "CURRENT"),
    cellOf("ACQUIRED", "CURRENT"),
    cellOf("VERIFIED", "PARTIAL_OR_STALE"),
    cellOf("SHOWN_TO_READER", "NOT_WALKED"),
    cellOf("ASK_ANSWERS", "NOT_WALKED"),
  ];
  const { gates, violations } = enforceMonotonicity("districts.congressional", cells);
  assert.equal(violations.length, 0);
  assert.ok(gates.every((g) => g.monotonicityOk));
});

test("R-B: a CURRENT past a non-CURRENT gate to its left is a surfaced violation, not silent", () => {
  const cells = [
    cellOf("SOURCE_KNOWN", "CURRENT"),
    cellOf("ACQUIRED", "NOT_WALKED"), // gap
    cellOf("VERIFIED", "CURRENT"), // cannot be current past the gap
    cellOf("SHOWN_TO_READER", "NOT_WALKED"),
    cellOf("ASK_ANSWERS", "NOT_WALKED"),
  ];
  const { gates, violations } = enforceMonotonicity("officials.municipal", cells);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].gate, "VERIFIED");
  const verified = gates.find((g) => g.gate === "VERIFIED");
  assert.equal(verified?.monotonicityOk, false); // marked, not hidden
  assert.equal(verified?.state, "CURRENT"); // the claim is kept AND flagged, never erased
});

test("R-B: ARGUED_ABSENT propagates — a CURRENT to its right is a violation", () => {
  const cells = [
    cellOf("SOURCE_KNOWN", "CURRENT"),
    cellOf("ACQUIRED", "ARGUED_ABSENT"),
    cellOf("VERIFIED", "ARGUED_ABSENT"),
    cellOf("SHOWN_TO_READER", "CURRENT"), // showing "current" after the thing was proven absent
    cellOf("ASK_ANSWERS", "ARGUED_ABSENT"),
  ];
  const { violations } = enforceMonotonicity("finance.municipal", cells);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].gate, "SHOWN_TO_READER");
});

test("deriveGateCells always yields exactly five cells in GATE_ORDER and fills gaps with NOT_WALKED", () => {
  const { gates } = deriveGateCells(
    "districts.special",
    { SOURCE_KNOWN: ev({ covered: 0, total: 318, asOf: null }) },
    NOW,
  );
  assert.equal(gates.length, GATE_ORDER.length);
  assert.deepEqual(
    gates.map((g) => g.gate),
    [...GATE_ORDER],
  );
  assert.ok(gates.every((g) => g.state === "NOT_WALKED"));
});

/* ------------------------------------------------------------------ R-D coverage */

test("R-D: coverage without an external denominator is a named gap, not 0 of 0", () => {
  const cov = coverageCell({ covered: 4, total: null, authority: null, contract: "x" });
  assert.equal(cov.held, false);
  if (!cov.held) assert.equal(cov.gap.whose, "OURS");
});

test("R-D: coverage with an external denominator is measured and names its authority", () => {
  const cov = coverageCell({
    covered: 15,
    total: 15,
    authority: "Census of Governments 2022",
    contract: "counties with an enumerated governing body over the state's counties",
  });
  assert.equal(cov.held, true);
  if (cov.held) {
    assert.equal(cov.value.value, 15);
    assert.equal(cov.value.denominator, 15);
    assert.equal(cov.value.denominatorSource, "Census of Governments 2022");
  }
});

test("R-D: a numerator larger than its external denominator is refused, never rendered", () => {
  // measured() throws — we may not claim 'we found 4, so 4 of 4' then exceed it.
  assert.throws(() =>
    coverageCell({ covered: 20, total: 15, authority: "Census of Governments 2022", contract: "x" }),
  );
});

test("isCurrent is exact — only CURRENT is current", () => {
  assert.equal(isCurrent("CURRENT"), true);
  for (const s of CELL_STATES) if (s !== "CURRENT") assert.equal(isCurrent(s), false);
});
