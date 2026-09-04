import assert from "node:assert/strict";
import test from "node:test";

import { computeReadinessSnapshot } from "../lib/control-plane/readiness/compute.ts";
import { type CellState } from "../lib/control-plane/readiness/gates.ts";
import { type StateAuthorities, deriveStateInputs } from "../lib/control-plane/readiness/extract.ts";
import type { EvidenceWalk } from "../lib/control-plane/readiness/model.ts";

/**
 * THE READINESS DERIVATION IS DRIVEN BY INSTRUMENTS, NEVER AUTHORED (R-H).
 * (Control-centre resource-safety closure, 2026-09-04.)
 *
 * The publisher used to type in gate counts and dates. It now tallies committed
 * instruments and hands them here. These tests pin the honest rules against
 * synthetic instrument inputs: derived where an instrument exists, NOT_WALKED
 * where none does, and — the load-bearing invariant — SHOWN_TO_READER and
 * ASK_ANSWERS are NOT_WALKED everywhere, because no committed per-capability
 * delivery or grounded-Ask proof exists on current main.
 */

const NOW = "2026-09-10T00:00:00.000Z";
const META = { nowIso: NOW, sha: "deadbeef", publisher: "test" } as const;

function cellFor(caps: ReturnType<typeof snap>["capabilities"], id: string, gate: string): CellState {
  const row = caps.find((r) => r.capabilityId === id);
  assert.ok(row, `no capability ${id}`);
  const g = row.gates.find((x) => x.gate === gate);
  assert.ok(g, `no gate ${gate} on ${id}`);
  return g.state;
}

function snap(a: StateAuthorities) {
  return computeReadinessSnapshot(deriveStateInputs(a, META, []), NOW);
}

/** An AZ-shaped authorities bundle with every instrument present. */
function azAuthorities(): StateAuthorities {
  return {
    code: "az",
    name: "Arizona",
    counts: { COUNTY: 15, CITY_OR_TOWN: 91, SCHOOL_DISTRICT: 242, SPECIAL_DISTRICT: 327 },
    heldDivisions: { cd: 9, county: 7, place: 263, school_district: 151, sldu: 30, sldl: 30 },
    divisionsAsOf: "2026-08-27",
    bodies: {
      county: { sourceLocated: 6, live: 5, asOf: "2026-08-27" },
      place: { sourceLocated: 59, live: 30, asOf: "2026-08-27" },
      school: { sourceLocated: 4, live: 4, asOf: "2026-08-27" },
    },
    fec: { ballotMatched: 29, ballotTotal: 38, rosterMatched: 10, rosterTotal: 10, asOf: "2026-09-04" },
    ballotFilings: { covered: 27, total: 30, authority: "AZ SoS certified canvass", asOf: "2026-09-01" },
    stateDisclosure: { covered: 716, total: 716, authority: "AZ SeeTheMoney", asOf: "2026-09-01" },
    officialsClosedWalk: null,
  };
}

test("SHOWN_TO_READER and ASK_ANSWERS are NOT_WALKED for EVERY capability (no committed proof on main)", () => {
  const s = snap(azAuthorities());
  for (const row of s.capabilities) {
    for (const gate of ["SHOWN_TO_READER", "ASK_ANSWERS"] as const) {
      const g = row.gates.find((x) => x.gate === gate);
      assert.equal(g?.state, "NOT_WALKED", `${row.capabilityId} ${gate} is not NOT_WALKED`);
    }
  }
});

test("held boundaries drive SOURCE_KNOWN/ACQUIRED; VERIFIED is NOT_WALKED without an external instrument", () => {
  const caps = snap(azAuthorities()).capabilities;
  // Congressional: 9 held of the complete cd119 set → complete + fresh.
  assert.equal(cellFor(caps, "districts.congressional", "SOURCE_KNOWN"), "CURRENT");
  assert.equal(cellFor(caps, "districts.congressional", "ACQUIRED"), "CURRENT");
  // No committed external reconciliation of our held boundaries → VERIFIED NOT_WALKED.
  assert.equal(cellFor(caps, "districts.congressional", "VERIFIED"), "NOT_WALKED");
  // School: 151 held of 242 → partial acquisition.
  assert.equal(cellFor(caps, "districts.school", "ACQUIRED"), "PARTIAL_OR_STALE");
  assert.equal(cellFor(caps, "districts.school", "VERIFIED"), "NOT_WALKED");
});

test("we hold PLACE boundaries, not WARD boundaries, so municipal-wards is fully NOT_WALKED", () => {
  const caps = snap(azAuthorities()).capabilities;
  const row = caps.find((r) => r.capabilityId === "districts.municipal-wards")!;
  assert.ok(row.gates.every((g) => g.state === "NOT_WALKED"), "municipal-wards claimed a ward we do not hold");
  // ...but its coverage still carries the external denominator (91 municipalities).
  assert.equal(row.coverage.held, true);
  if (row.coverage.held) assert.equal(row.coverage.value.denominator, 91);
});

test("special districts are NOT_WALKED (none held) with a real external denominator, never 0 of 0", () => {
  const caps = snap(azAuthorities()).capabilities;
  const row = caps.find((r) => r.capabilityId === "districts.special")!;
  assert.ok(row.gates.every((g) => g.state === "NOT_WALKED"));
  assert.equal(row.coverage.held, true);
  if (row.coverage.held) assert.equal(row.coverage.value.denominator, 327);
});

test("FEC is the only VERIFIED for federal finance — ballot matched of ballot total", () => {
  const caps = snap(azAuthorities()).capabilities;
  assert.equal(cellFor(caps, "finance.federal-fec", "VERIFIED"), "PARTIAL_OR_STALE"); // 29 of 38
  assert.equal(cellFor(caps, "finance.federal-fec", "ACQUIRED"), "CURRENT"); // 38 of 38 held
  const row = caps.find((r) => r.capabilityId === "finance.federal-fec")!;
  assert.equal(row.coverage.held, true);
  if (row.coverage.held) {
    assert.equal(row.coverage.value.value, 29);
    assert.equal(row.coverage.value.denominator, 38);
  }
});

test("AZ candidate filings and state disclosure verify against their external authorities", () => {
  const caps = snap(azAuthorities()).capabilities;
  assert.equal(cellFor(caps, "ballot.candidate-filings", "VERIFIED"), "PARTIAL_OR_STALE"); // 27 of 30
  assert.equal(cellFor(caps, "finance.state-disclosure", "VERIFIED"), "CURRENT"); // 716 of 716
});

test("officials rosters have no committed instrument → NOT_WALKED, and NO 1-of-1 coverage anywhere", () => {
  const s = snap(azAuthorities());
  for (const id of ["officials.county", "officials.municipal", "officials.school-board", "officials.state-federal-seats"]) {
    const row = s.capabilities.find((r) => r.capabilityId === id)!;
    assert.ok(row.gates.every((g) => g.state === "NOT_WALKED"), `${id} claimed a gate with no instrument`);
  }
  // §7: no capability may render a "1 of 1" self-referential coverage.
  for (const row of s.capabilities) {
    if (row.coverage.held) {
      assert.ok(
        !(row.coverage.value.value === 1 && row.coverage.value.denominator === 1),
        `${row.capabilityId} renders a 1-of-1 coverage`,
      );
    }
  }
});

test("a state without the AZ instruments does not inherit them; a closed walk renders ARGUED_ABSENT", () => {
  const walk: EvidenceWalk = {
    ref: "nh-03255-verifiedpages",
    capabilityId: "officials.state-federal-seats",
    jurisdiction: "03255",
    rungCount: 1,
    sessionCount: 1,
    vaultId: "nh-03255",
    closed: true,
    nextUnwalkedRung: null,
    absenceArgument: "no municipal committee exists in an unincorporated place",
    rungs: [{ at: "2026-08-26", path: "x", observed: "y", outcome: "DOES_NOT_EXIST", nextHop: null, vaultRef: "vault:nh-03255#c:verifiedPage" }],
  };
  const nh: StateAuthorities = {
    code: "nh",
    name: "New Hampshire",
    counts: { COUNTY: 10, CITY_OR_TOWN: 236, SCHOOL_DISTRICT: 167, SPECIAL_DISTRICT: 128 },
    heldDivisions: { cd: 2, county: 7, place: 271, school_district: 149, sldu: 24, sldl: 149 },
    divisionsAsOf: "2026-08-27",
    bodies: {
      county: { sourceLocated: 6, live: 1, asOf: "2026-08-27" },
      place: { sourceLocated: 169, live: 67, asOf: "2026-08-27" },
      school: { sourceLocated: 10, live: 1, asOf: "2026-08-27" },
    },
    fec: { ballotMatched: 5, ballotTotal: 6, rosterMatched: 3, rosterTotal: 3, asOf: "2026-09-04" },
    ballotFilings: null, // AZ-only instrument must not be inherited
    stateDisclosure: null,
    officialsClosedWalk: { ref: walk.ref, asOf: "2026-08-26", walk },
  };
  const caps = snap(nh).capabilities;
  // No AZ reconciliations → these stay NOT_WALKED for NH.
  assert.equal(cellFor(caps, "ballot.candidate-filings", "VERIFIED"), "NOT_WALKED");
  assert.equal(cellFor(caps, "finance.state-disclosure", "VERIFIED"), "NOT_WALKED");
  // The closed walk renders ARGUED_ABSENT on the officials gates and is projected.
  assert.equal(cellFor(caps, "officials.state-federal-seats", "ACQUIRED"), "ARGUED_ABSENT");
  assert.equal(cellFor(caps, "officials.state-federal-seats", "VERIFIED"), "ARGUED_ABSENT");
  const s = snap(nh);
  assert.equal(s.evidenceWalks.length, 1);
  assert.equal(s.evidenceWalks[0].ref, "nh-03255-verifiedpages");
  // FEC still applies (it is national/federal).
  assert.equal(cellFor(caps, "finance.federal-fec", "VERIFIED"), "PARTIAL_OR_STALE");
});
