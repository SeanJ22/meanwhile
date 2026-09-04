import assert from "node:assert/strict";
import test from "node:test";

import { computeReadinessSnapshot } from "../lib/control-plane/readiness/compute.ts";
import { type CellState } from "../lib/control-plane/readiness/gates.ts";
import {
  type StateAuthorities,
  chooseReadinessStoreTarget,
  deriveStateInputs,
} from "../lib/control-plane/readiness/extract.ts";
import {
  READINESS_DERIVATION_CONTRACT,
  type EvidenceWalk,
  type ReadinessStateSnapshot,
} from "../lib/control-plane/readiness/model.ts";
import { readinessRowOutcome } from "../lib/control-plane/readiness/read.ts";

/**
 * THE READINESS DERIVATION IS INSTRUMENT-DRIVEN AND TRUTHFUL (CC-F1..F6, 2026-09-04).
 *
 * Every gate traces to a committed instrument or is NOT_WALKED; denominators are
 * independent external authorities or a named gap; absence evidence must match
 * the exact capability and be unexpired; national FEC is never shown per-state;
 * meetings "acquired" is not inferred from a registry source-status; and a
 * snapshot under a superseded derivation contract is quarantined.
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
function coverageOf(caps: ReturnType<typeof snap>["capabilities"], id: string) {
  return caps.find((r) => r.capabilityId === id)!.coverage;
}
function snap(a: StateAuthorities) {
  return computeReadinessSnapshot(deriveStateInputs(a, META, []), NOW);
}

/** An AZ-shaped authorities bundle with the real external cd universe (9). */
function azAuthorities(over: Partial<StateAuthorities> = {}): StateAuthorities {
  return {
    code: "az",
    name: "Arizona",
    counts: { COUNTY: 15, CITY_OR_TOWN: 91, SCHOOL_DISTRICT: 242, SPECIAL_DISTRICT: 327 },
    heldDivisions: { cd: 9, county: 7, place: 263, school_district: 151, sldu: 30, sldl: 30 },
    divisionsAsOf: "2026-08-27",
    cdUniverse: 9,
    bodies: {
      county: { sourceLocated: 6, live: 5, asOf: "2026-08-27" },
      place: { sourceLocated: 59, live: 30, asOf: "2026-08-27" },
      school: { sourceLocated: 4, live: 4, asOf: "2026-08-27" },
    },
    fec: null,
    ballotFilings: { covered: 27, total: 30, authority: "AZ SoS certified canvass", asOf: "2026-09-01" },
    stateDisclosure: { covered: 716, total: 716, authority: "AZ SeeTheMoney", asOf: "2026-09-01" },
    officialsClosedWalk: null,
    ...over,
  };
}

/** A minimal EvidenceWalk for the ClosedWalkInstrument fixtures. */
function walkFor(capabilityId: string): EvidenceWalk {
  return {
    ref: "test-walk",
    capabilityId,
    jurisdiction: "test",
    rungCount: 1,
    sessionCount: 1,
    vaultId: "test",
    closed: true,
    nextUnwalkedRung: null,
    absenceArgument: "argued",
    rungs: [{ at: "2026-08-26", path: "x", observed: "y", outcome: "DOES_NOT_EXIST", nextHop: null, vaultRef: "v" }],
  };
}

test("SHOWN_TO_READER and ASK_ANSWERS are NOT_WALKED for EVERY capability", () => {
  const s = snap(azAuthorities());
  for (const row of s.capabilities) {
    for (const gate of ["SHOWN_TO_READER", "ASK_ANSWERS"] as const) {
      const g = row.gates.find((x) => x.gate === gate);
      assert.equal(g?.state, "NOT_WALKED", `${row.capabilityId} ${gate} is not NOT_WALKED`);
    }
  }
});

/* ---------------------------------------------------- CC-F2 no self-denominators */

test("CC-F2: congressional uses the INDEPENDENT cd119 universe, never held/held", () => {
  // held 8 of an external 9 must read 8/9, and ACQUIRED partial — never 8/8.
  const caps = snap(azAuthorities({ heldDivisions: { cd: 8, county: 7, school_district: 151, sldu: 30 }, cdUniverse: 9 })).capabilities;
  const cov = coverageOf(caps, "districts.congressional");
  assert.equal(cov.held, true);
  if (cov.held) {
    assert.equal(cov.value.value, 8);
    assert.equal(cov.value.denominator, 9);
  }
  assert.equal(cellFor(caps, "districts.congressional", "ACQUIRED"), "PARTIAL_OR_STALE");
});

test("CC-F2: congressional with NO external universe is a named gap, never held/held", () => {
  const caps = snap(azAuthorities({ cdUniverse: null })).capabilities;
  assert.equal(coverageOf(caps, "districts.congressional").held, false);
  const row = caps.find((r) => r.capabilityId === "districts.congressional")!;
  assert.ok(row.gates.every((g) => g.state === "NOT_WALKED"), "congressional claimed a gate off a self-denominator");
});

test("CC-F2: state-legislative has no committed statewide denominator → named gap, no gate CURRENT", () => {
  // Even though 30 sldu boundaries are held, there is no independent statewide
  // count, so the row is a named gap and no gate self-denominates.
  const caps = snap(azAuthorities()).capabilities;
  assert.equal(coverageOf(caps, "districts.state-legislative").held, false);
  const row = caps.find((r) => r.capabilityId === "districts.state-legislative")!;
  assert.ok(row.gates.every((g) => g.state === "NOT_WALKED"));
});

test("CC-F2 also covers the summary: reader-visible jurisdictions is a named gap, not held/held", () => {
  const s = snap(azAuthorities());
  assert.equal(s.summary.readerVisibleJurisdictions.held, false);
});

test("external Census denominators drive county/school/special/municipal-wards", () => {
  const caps = snap(azAuthorities()).capabilities;
  const school = coverageOf(caps, "districts.school");
  if (school.held) assert.equal(school.value.denominator, 242);
  const special = coverageOf(caps, "districts.special");
  if (special.held) assert.equal(special.value.denominator, 327);
  const wards = coverageOf(caps, "districts.municipal-wards");
  if (wards.held) assert.equal(wards.value.denominator, 91);
  assert.equal(cellFor(caps, "districts.municipal-wards", "ACQUIRED"), "NOT_WALKED"); // no wards held
});

/* ---------------------------------------------------- CC-F4 meetings acquisition */

test("CC-F4: a known meeting source does NOT render ACQUIRED — registry LIVE is source-known, not held", () => {
  const caps = snap(azAuthorities()).capabilities;
  // county has sourceLocated 6, live 5 — SOURCE_KNOWN partial, ACQUIRED NOT_WALKED.
  assert.equal(cellFor(caps, "meetings.county-boards", "SOURCE_KNOWN"), "PARTIAL_OR_STALE");
  assert.equal(cellFor(caps, "meetings.county-boards", "ACQUIRED"), "NOT_WALKED");
  assert.equal(cellFor(caps, "meetings.city-councils", "ACQUIRED"), "NOT_WALKED");
  assert.equal(cellFor(caps, "meetings.school-boards", "ACQUIRED"), "NOT_WALKED");
});

/* ---------------------------------------------------- CC-F5 FEC is state-addressable */

test("CC-F5: with no derivable state slice, federal FEC is a named state gap — never the national number", () => {
  const caps = snap(azAuthorities({ fec: null })).capabilities;
  assert.equal(coverageOf(caps, "finance.federal-fec").held, false);
  const row = caps.find((r) => r.capabilityId === "finance.federal-fec")!;
  assert.ok(row.gates.every((g) => g.state === "NOT_WALKED"));
  // The national ballotTotal (38) must not appear as ANY capability's denominator.
  for (const r of caps) {
    if (r.coverage.held) assert.notEqual(r.coverage.value.denominator, 38, `${r.capabilityId} inherited the national FEC denominator`);
  }
});

test("CC-F5: a genuine state slice IS used when provided", () => {
  const caps = snap(
    azAuthorities({ fec: { matched: 5, total: 6, authority: "FEC (AZ federal candidates)", asOf: "2026-09-04" } }),
  ).capabilities;
  const cov = coverageOf(caps, "finance.federal-fec");
  assert.equal(cov.held, true);
  if (cov.held) {
    assert.equal(cov.value.value, 5);
    assert.equal(cov.value.denominator, 6);
  }
  assert.equal(cellFor(caps, "finance.federal-fec", "VERIFIED"), "PARTIAL_OR_STALE"); // 5 of 6
});

/* AZ state-specific reconciliations still verify (they are already state-scoped). */
test("AZ candidate filings and state disclosure verify against their external authorities", () => {
  const caps = snap(azAuthorities()).capabilities;
  assert.equal(cellFor(caps, "ballot.candidate-filings", "VERIFIED"), "PARTIAL_OR_STALE"); // 27 of 30
  assert.equal(cellFor(caps, "finance.state-disclosure", "VERIFIED"), "CURRENT"); // 716 of 716
});

/* ---------------------------------------------------- CC-F1 absence must match */

test("CC-F1 #1/#2: a candidate-field / wrong-capability closed walk satisfies NOTHING and is NOT projected", () => {
  // The walk is scoped to ballot.candidate-filings — it must not render officials
  // absent, and it must not be shipped as an orphan into evidenceWalks.
  const s = snap(
    azAuthorities({
      officialsClosedWalk: {
        ref: "az-cand",
        asOf: "2026-08-26",
        capabilityId: "ballot.candidate-filings",
        expiresOn: "2027-01-01",
        walk: walkFor("ballot.candidate-filings"),
      },
    }),
  );
  const row = s.capabilities.find((r) => r.capabilityId === "officials.state-federal-seats")!;
  assert.ok(row.gates.every((g) => g.state === "NOT_WALKED"), "a wrong-capability walk rendered officials ARGUED_ABSENT");
  assert.equal(s.evidenceWalks.length, 0, "a mis-scoped walk was projected into evidenceWalks");
});

test("CC-F1 #3: an EXPIRED correctly-scoped closed walk cannot render ARGUED_ABSENT and is NOT projected", () => {
  const s = snap(
    azAuthorities({
      officialsClosedWalk: {
        ref: "az-off",
        asOf: "2026-08-26",
        capabilityId: "officials.state-federal-seats",
        expiresOn: "2026-09-02", // < NOW (2026-09-10) → expired
        walk: walkFor("officials.state-federal-seats"),
      },
    }),
  );
  const acquired = s.capabilities.find((r) => r.capabilityId === "officials.state-federal-seats")!.gates.find((g) => g.gate === "ACQUIRED");
  assert.equal(acquired?.state, "NOT_WALKED", "an expired absence rendered ARGUED_ABSENT");
  assert.equal(s.evidenceWalks.length, 0, "an expired walk was projected into evidenceWalks");
});

test("CC-F1 #4: an UNEXPIRED, correctly-scoped closed walk still renders ARGUED_ABSENT and is projected", () => {
  const s = snap(
    azAuthorities({
      officialsClosedWalk: {
        ref: "az-off",
        asOf: "2026-09-05",
        capabilityId: "officials.state-federal-seats",
        expiresOn: "2027-01-01", // > NOW → unexpired
        walk: walkFor("officials.state-federal-seats"),
      },
    }),
  );
  const acquired = s.capabilities.find((r) => r.capabilityId === "officials.state-federal-seats")!.gates.find((g) => g.gate === "ACQUIRED");
  assert.equal(acquired?.state, "ARGUED_ABSENT");
  assert.equal(s.evidenceWalks.length, 1, "a usable closed walk was not projected into the drawer");
});

/* ---------------------------------------------------- CC-F3 store target */

test("CC-F3: only the explicit control-plane target selects production; a generic refresh never does", () => {
  assert.equal(chooseReadinessStoreTarget(undefined), "file"); // generic refresh
  assert.equal(chooseReadinessStoreTarget("file"), "file");
  assert.equal(chooseReadinessStoreTarget("control-plane"), "control-plane"); // readiness:publish
  // The production URL is not an input here at all — its mere presence can never
  // flip a generic refresh to production.
});

/* ---------------------------------------------------- CC-F6 quarantine */

function currentSnapshot(): ReadinessStateSnapshot {
  return snap(azAuthorities());
}

test("CC-F6: a snapshot under the current derivation contract is HELD", () => {
  const s = currentSnapshot();
  assert.equal(s.derivationContract, READINESS_DERIVATION_CONTRACT);
  const outcome = readinessRowOutcome(s, "control plane", "Arizona");
  assert.equal(outcome.kind, "HELD");
});

test("CC-F6: a legacy or marker-less snapshot is QUARANTINED (REQUIRES_REPUBLISH), never trusted", () => {
  const legacy = { ...currentSnapshot(), derivationContract: "readiness/hand-authored@0" };
  const out1 = readinessRowOutcome(legacy, "control plane", "Arizona");
  assert.equal(out1.kind, "REQUIRES_REPUBLISH");

  const markerless = { ...currentSnapshot() } as Record<string, unknown>;
  delete markerless.derivationContract;
  const out2 = readinessRowOutcome(markerless as unknown as ReadinessStateSnapshot, "control plane", "Arizona");
  assert.equal(out2.kind, "REQUIRES_REPUBLISH");
});

test("CC-F6: a null row is NOT_RECORDED (no snapshot), distinct from a quarantined one", () => {
  const outcome = readinessRowOutcome(null, "control plane", "Arizona");
  assert.equal(outcome.kind, "NOT_RECORDED");
});
