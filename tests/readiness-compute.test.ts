import assert from "node:assert/strict";
import test from "node:test";

import { type Held, type Measured, gap, held } from "../lib/control-plane/owner-surface.ts";
import {
  type CapabilityInput,
  type ZipInput,
  computeReadinessSnapshot,
  computeZipRow,
} from "../lib/control-plane/readiness/compute.ts";
import { NO_EVIDENCE } from "../lib/control-plane/readiness/gates.ts";
import {
  readinessCountClaims,
  rowIsCurrent,
  rowState,
} from "../lib/control-plane/readiness/model.ts";

/**
 * THE WHOLE SNAPSHOT, ASSEMBLED (State Readiness Control Panel, 2026-09-03).
 *
 * The gate unit tests prove each cell; this proves the record the panel renders.
 * The inputs mirror real Arizona authorities — including the CORRECTED Census
 * denominators (242 independent school districts, 327 special districts from the
 * Census of Governments 2022), NOT the screenshot's unreconciled 236/318, because
 * a denominator nobody established is exactly the false claim the panel forbids.
 */

const NOW = "2026-09-03T12:00:00.000Z";

/** A population we do not hold, typed as the Held<Measured> the field expects. */
function noPop(says: string): Held<Measured> {
  return gap<Measured>("OURS", says);
}

function congressional(): CapabilityInput {
  return {
    capabilityId: "districts.congressional",
    domain: "Districts and geography",
    label: "Congressional · legislative",
    level: "federal",
    coverage: {
      covered: 9,
      total: 9,
      authority: "Census 119th-Congress cartographic boundary (cd119)",
      contract: "AZ congressional districts with confirmed geometry over the state's districts",
      label: "9 of 9",
      asOf: "2026-08-30",
      says: null,
    },
    gates: {
      SOURCE_KNOWN: g(9, 9, "2026-08-30", 365),
      ACQUIRED: g(9, 9, "2026-08-30", 365),
      VERIFIED: g(9, 9, "2026-08-30", 365),
      SHOWN_TO_READER: g(9, 9, "2026-08-30", 365),
      ASK_ANSWERS: g(9, 9, "2026-08-30", 365),
    },
  };
}

function specialDistricts(): CapabilityInput {
  return {
    capabilityId: "districts.special",
    domain: "Districts and geography",
    label: "Special districts",
    level: "special",
    coverage: {
      covered: 0,
      total: 327, // Census of Governments 2022 — NOT the screenshot's 318.
      authority: "Census of Governments 2022",
      contract: "AZ special districts we have enumerated over the census universe",
      label: "0 of 327",
      asOf: null,
      says: null,
    },
    gates: {}, // nothing walked -> all NOT_WALKED
  };
}

function municipalFinanceVail(): CapabilityInput {
  // 85641 Vail is unincorporated: no municipal office, so no municipal committee
  // can file. A closed walk on record makes this ARGUED_ABSENT, never NOT_WALKED.
  return {
    capabilityId: "finance.municipal",
    domain: "Campaign finance",
    label: "Municipal",
    level: "municipal",
    coverage: {
      covered: 0,
      total: 91,
      authority: "AZ jurisdiction registry (Census of Governments municipalities)",
      contract: "AZ municipalities with a walked campaign-finance route over the municipal universe",
      label: "walk closed · absence argued",
      asOf: "2026-09-01",
      says: null,
    },
    gates: {
      SOURCE_KNOWN: g(91, 91, "2026-08-29", 90),
      ACQUIRED: closedWalk("az-cf-85641"),
      VERIFIED: closedWalk("az-cf-85641"),
      SHOWN_TO_READER: closedWalk("az-cf-85641"),
      ASK_ANSWERS: closedWalk("az-cf-85641"),
    },
  };
}

function g(covered: number, total: number, asOf: string, staleAfterDays: number) {
  return { ...NO_EVIDENCE, covered, total, asOf, staleAfterDays };
}
function closedWalk(ref: string) {
  return { ...NO_EVIDENCE, asOf: "2026-09-01", walkClosed: true, evidenceRef: ref };
}

function inputs(caps: CapabilityInput[], zips: ZipInput[]) {
  return {
    state: "az",
    stateName: "Arizona",
    publishedAt: NOW,
    publishedFromSha: "deadbeef",
    publisher: "readiness-refresh (test)",
    capabilities: caps,
    zips,
    capabilitiesServedToReaders: held({
      value: 1,
      denominator: 23,
      contract: "capability rows whose committed holdings for this state are a declared input to a Reader surface",
      denominatorSource: "lib/holdings/datasets.ts and lib/holdings/reader-trace.ts",
    }),
    populationInCompleteZip: noPop("no state population is on file, so a population-weighted completeness cannot be computed"),
    oldestEvidence: held("2026-08-30"),
    delivery: [
      {
        capabilityId: "districts.congressional",
        holding: "lib/registry/registry.json",
        rows: 9,
        unit: "congressional district boundaries",
        surfaces: ["map", "ballot"],
        routes: ["ballot/page"],
        askAnswers: false,
        asOf: "2026-08-30",
      },
    ],
  };
}

test("R-K: every stated N equals its rendered row count across the snapshot", () => {
  const snap = computeReadinessSnapshot(
    inputs([congressional(), specialDistricts(), municipalFinanceVail()], []),
    NOW,
  );
  for (const claim of readinessCountClaims(snap)) {
    assert.equal(claim.stated, claim.rendered, claim.label);
  }
  assert.equal(snap.capabilities.length, 3);
});

test("a complete, fresh capability is all-CURRENT and rowIsCurrent", () => {
  const snap = computeReadinessSnapshot(inputs([congressional()], []), NOW);
  const row = snap.capabilities[0];
  assert.ok(row.gates.every((c) => c.state === "CURRENT"));
  assert.equal(rowIsCurrent(row), true);
  assert.equal(rowState(row), "CURRENT");
});

test("R-7: an unwalked capability is fully NOT_WALKED and distinct from ARGUED_ABSENT", () => {
  const snap = computeReadinessSnapshot(inputs([specialDistricts()], []), NOW);
  const row = snap.capabilities[0];
  assert.ok(row.gates.every((c) => c.state === "NOT_WALKED"));
  assert.equal(rowState(row), "NOT_WALKED");
});

test("R-6: a closed walk renders ARGUED_ABSENT with its evidence ref, never NOT_WALKED", () => {
  const snap = computeReadinessSnapshot(inputs([municipalFinanceVail()], []), NOW);
  const row = snap.capabilities[0];
  const acquired = row.gates.find((c) => c.gate === "ACQUIRED");
  assert.equal(acquired?.state, "ARGUED_ABSENT");
  assert.equal(acquired?.evidenceRef, "az-cf-85641");
  // ...and it is NOT the same as the unwalked special-districts row.
  assert.notEqual(rowState(row), "NOT_WALKED");
});

test("R-D: coverage never fakes a denominator; the special-districts total is the cited 327", () => {
  const snap = computeReadinessSnapshot(inputs([specialDistricts()], []), NOW);
  const cov = snap.capabilities[0].coverage;
  assert.equal(cov.held, true);
  if (cov.held) {
    assert.equal(cov.value.denominator, 327);
    assert.equal(cov.value.denominatorSource, "Census of Governments 2022");
  }
});

test("R-B: a monotonicity violation in the inputs is surfaced on the snapshot, not hidden", () => {
  const bad: CapabilityInput = {
    capabilityId: "officials.municipal",
    domain: "Officials and offices",
    label: "Municipal offices",
    level: "municipal",
    coverage: { covered: 11, total: 91, authority: "registry", contract: "x", label: "11 of 91", asOf: "2026-08-22", says: null },
    gates: {
      SOURCE_KNOWN: g(91, 91, "2026-08-22", 365),
      ACQUIRED: g(11, 91, "2026-08-22", 365), // partial (gap)
      VERIFIED: g(91, 91, "2026-08-22", 365), // CURRENT past the gap -> violation
    },
  };
  const snap = computeReadinessSnapshot(inputs([bad], []), NOW);
  assert.equal(snap.monotonicityViolations.length, 1);
  assert.equal(snap.monotonicityViolations[0].gate, "VERIFIED");
  const verified = snap.capabilities[0].gates.find((c) => c.gate === "VERIFIED");
  assert.equal(verified?.monotonicityOk, false);
});

/* ------------------------------------------------------------------ zips (R-F) */

function body(state: ZipInput["bodies"][number]["state"], gapText: string) {
  return { state, gap: gapText };
}

test("R-F: a zip's state is worst-of its bodies, even when the worst differs from the modal body", () => {
  // Four bodies fully answered, one blocked: the modal state is CURRENT, but the
  // zip's readiness is BLOCKED — worst-of, never the mode and never an average.
  const zip: ZipInput = {
    zip: "85701",
    place: held("Tucson · downtown"),
    population: noPop("population not on file"),
    populationBasis: "NO_TABULATION_AREA" as const,
    populationMargin: null,
    tierLabel: "TIER_2",
    bodies: [
      body("CURRENT", "county"),
      body("CURRENT", "city council"),
      body("CURRENT", "legislative"),
      body("CURRENT", "congressional"),
      body("BLOCKED", "school board agendas"),
    ],
  };
  const row = computeZipRow(zip);
  assert.equal(row.worstState, "BLOCKED");
  assert.equal(row.worstGap, "school board agendas");
  assert.equal(row.bodyCount, 5);
  assert.equal(row.isPilot, true);
});

test("R-F: a zip with an UNKNOWN tier renders a named gap for its level, never Level 0", () => {
  const zip: ZipInput = {
    zip: "86301",
    place: held("Prescott"),
    population: noPop("population not on file"),
    populationBasis: "NO_TABULATION_AREA" as const,
    populationMargin: null,
    tierLabel: null, // UNKNOWN
    bodies: [body("NOT_WALKED", "no source walked")],
  };
  const row = computeZipRow(zip);
  assert.equal(row.level.held, false);
  if (!row.level.held) assert.match(row.level.gap.says, /not Level 0/);
  assert.equal(row.worstState, "NOT_WALKED");
});

test("R-10: the four pilot zips are identifiable at a glance", () => {
  for (const z of ["85701", "85641", "07866", "03255"]) {
    const row = computeZipRow({
      zip: z,
      place: held("x"),
      population: noPop("n/a"),
      populationBasis: "NO_TABULATION_AREA" as const,
      populationMargin: null,
      tierLabel: "TIER_0",
      bodies: [body("NOT_WALKED", "x")],
    });
    assert.equal(row.isPilot, true, z);
  }
  const notPilot = computeZipRow({
    zip: "99999",
    place: held("x"),
    population: noPop("n/a"),
    populationBasis: "NO_TABULATION_AREA" as const,
    populationMargin: null,
    tierLabel: "TIER_0",
    bodies: [body("NOT_WALKED", "x")],
  });
  assert.equal(notPilot.isPilot, false);
});
