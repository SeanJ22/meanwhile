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
    heldAgendas: {
      county: { bodies: 0, meetings: 0, asOf: null },
      place: { bodies: 0, meetings: 0, asOf: null },
      school: { bodies: 0, meetings: 0, asOf: null },
    },
    fec: null,
    ballotFilings: null,
    ballotVerification: { covered: 27, total: 30, authority: "AZ SoS certified canvass", asOf: "2026-09-01" },
    statewideMeasures: null,
    localMeasures: null,
    stateDisclosure: { covered: 44, total: 49, authority: "AZ state campaign-finance disclosure system", asOf: "2026-09-01" },
    stateDisclosureVerification: { covered: 716, total: 716, authority: "AZ SeeTheMoney", asOf: "2026-09-01" },
    officialsClosedWalk: null,
    sourcedAbsences: [],
    delivery: [],
    statePopulation: 7_268_175,
    ...over,
  };
}

/** The committed NH ballot holding, as the publisher tallies it (ADM-40). */
function nhBallotFilings(): NonNullable<StateAuthorities["ballotFilings"]> {
  return {
    candidacies: 47,
    sourced: 47,
    contests: 12,
    documents: 1,
    authority: "New Hampshire Secretary of State",
    officialSource: true,
    asOf: "2026-08-14",
  };
}

/** One reader-delivery declaration, as `deliveryFor` builds it. */
function delivery(over: Partial<StateAuthorities["delivery"][number]> = {}): StateAuthorities["delivery"][number] {
  return {
    capabilityId: "ballot.candidate-filings",
    holding: "data/states/nh/ballot/nh-merrimack-2026.json",
    rows: 47,
    unit: "candidacies",
    surfaces: ["ballot", "ask"],
    routes: ["ballot/page", "api/ask/grounded/route"],
    askAnswers: true,
    asOf: "2026-08-14",
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

/* ============================================================ ADM-40 / §9A.9 *
 * THE ADMIN MUST STOP CONTRADICTING THE LIVE PRODUCT.
 *
 * The owner disproved the grid by opening the site: NH and NJ candidate
 * listings are served, a senator's FEC money renders in detail, and the
 * districts the Reader and Ask use come from .gov geometry — while the Admin
 * showed blanks. These pin the seven facts §9A.9 requires the grid to keep
 * apart, and the two that used to collapse into one blank cell.
 * ============================================================================ */

test("§9A.9: with NO delivery declaration, SHOWN_TO_READER and ASK_ANSWERS stay NOT_WALKED", () => {
  // The honest floor: nothing declares the reader reads this state's holdings,
  // so no claim is made in either direction. This is the state every capability
  // was stuck in before the delivery instrument existed.
  const s = snap(azAuthorities({ delivery: [] }));
  for (const row of s.capabilities) {
    for (const gate of ["SHOWN_TO_READER", "ASK_ANSWERS"] as const) {
      const g = row.gates.find((x) => x.gate === gate);
      assert.equal(g?.state, "NOT_WALKED", `${row.capabilityId} ${gate} is not NOT_WALKED`);
      assert.equal(g?.says, "Not checked yet");
    }
  }
});

test("§9A.9: a declared reader delivery renders 'Shown on the Reader', never a blank and never CURRENT", () => {
  const caps = snap(azAuthorities({ ballotFilings: nhBallotFilings(), delivery: [delivery()] })).capabilities;
  const row = caps.find((r) => r.capabilityId === "ballot.candidate-filings")!;
  const shown = row.gates.find((g) => g.gate === "SHOWN_TO_READER")!;
  const ask = row.gates.find((g) => g.gate === "ASK_ANSWERS")!;
  assert.equal(shown.says, "Shown on the Reader · verification proof needs a fresh check");
  assert.equal(shown.state, "PARTIAL_OR_STALE", "a standing declaration must never compute CURRENT");
  assert.match(shown.detail, /47 candidacies/);
  assert.match(shown.detail, /nh-merrimack-2026\.json/);
  assert.match(ask.says, /^Ask is grounded in this holding/);
  // …and a delivery that does NOT reach grounded Ask leaves ASK_ANSWERS unclaimed.
  const noAsk = snap(
    azAuthorities({ ballotFilings: nhBallotFilings(), delivery: [delivery({ askAnswers: false, surfaces: ["ballot"], routes: ["ballot/page"] })] }),
  ).capabilities.find((r) => r.capabilityId === "ballot.candidate-filings")!;
  assert.equal(noAsk.gates.find((g) => g.gate === "ASK_ANSWERS")?.state, "NOT_WALKED");
});

test("§9A.9: a declaration with ZERO rows for this state claims nothing", () => {
  const caps = snap(azAuthorities({ ballotFilings: nhBallotFilings(), delivery: [delivery({ rows: 0 })] })).capabilities;
  const row = caps.find((r) => r.capabilityId === "ballot.candidate-filings")!;
  assert.equal(row.gates.find((g) => g.gate === "SHOWN_TO_READER")?.state, "NOT_WALKED");
});

test("ADM-40: NH/NJ candidate filings derive from the committed ballot holding, at §8 authority", () => {
  // The owner's exact finding. 47 candidacies sourced to sos.nh.gov are held and
  // served; the grid said nothing. §8: an official government source is
  // sufficient authority evidence — a "needs a second publisher" bar is not
  // project law and must not be invented to keep this row blank.
  const caps = snap(azAuthorities({ code: "nh", name: "New Hampshire", ballotFilings: nhBallotFilings(), ballotVerification: null })).capabilities;
  assert.equal(cellFor(caps, "ballot.candidate-filings", "SOURCE_KNOWN"), "CURRENT");
  assert.equal(cellFor(caps, "ballot.candidate-filings", "ACQUIRED"), "CURRENT");
  // …and VERIFIED stays unclaimed, because no EXTERNAL reconciliation exists.
  assert.equal(cellFor(caps, "ballot.candidate-filings", "VERIFIED"), "NOT_WALKED");
  const row = caps.find((r) => r.capabilityId === "ballot.candidate-filings")!;
  assert.equal(row.coverageLabel, "47 filings · 12 contests");
  assert.match(row.coverageSays ?? "", /New Hampshire Secretary of State/);
  assert.match(row.coverageSays ?? "", /not a count of how many exist statewide/);
  // R-D: the authority publishes filings, not a statewide total, so no fraction
  // is drawn against it — the counts go on the face, the denominator does not.
  assert.equal(row.coverage.held, false);
});

test("ADM-40: candidate filings with no held candidacies claim nothing at all", () => {
  const caps = snap(azAuthorities({ ballotFilings: null, ballotVerification: null })).capabilities;
  const row = caps.find((r) => r.capabilityId === "ballot.candidate-filings")!;
  assert.ok(row.gates.every((g) => g.state === "NOT_WALKED"));
});

test("ADM-40: a government's own statement of absence renders ARGUED_ABSENT with its sentence", () => {
  // NH publishes that no statewide ballot question is on the 2026 ballot. That
  // is a stronger absence than any ladder we could walk, and it is a different
  // fact from "nobody looked" (R-I) — which is what NJ, with no such statement,
  // correctly still reads.
  const withStatement = snap(
    azAuthorities({
      code: "nh",
      name: "New Hampshire",
      statewideMeasures: null,
      sourcedAbsences: [
        {
          capabilityId: "ballot.statewide-propositions",
          statement: "No statewide ballot question is on the November 3, 2026 ballot.",
          authority: "New Hampshire Secretary of State",
          ref: "https://www.sos.nh.gov/2026-election-details",
          asOf: "2026-08-14",
        },
      ],
    }),
  ).capabilities;
  for (const gate of ["SOURCE_KNOWN", "ACQUIRED", "VERIFIED"] as const) {
    assert.equal(cellFor(withStatement, "ballot.statewide-propositions", gate), "ARGUED_ABSENT");
  }
  const cell = withStatement
    .find((r) => r.capabilityId === "ballot.statewide-propositions")!
    .gates.find((g) => g.gate === "VERIFIED")!;
  assert.match(cell.detail, /No statewide ballot question/);
  assert.equal(cell.evidenceRef, "https://www.sos.nh.gov/2026-election-details");

  const without = snap(azAuthorities({ statewideMeasures: null, sourcedAbsences: [] })).capabilities;
  assert.equal(cellFor(without, "ballot.statewide-propositions", "ACQUIRED"), "NOT_WALKED");
});

test("ADM-40: a sourced absence scoped to a DIFFERENT capability argues nothing here (CC-F1)", () => {
  const caps = snap(
    azAuthorities({
      statewideMeasures: null,
      sourcedAbsences: [
        {
          capabilityId: "ballot.local-measures",
          statement: "No municipal seats are on the November 2026 ballot in this township.",
          authority: "Morris County Clerk",
          ref: "https://example.gov/x.pdf",
          asOf: "2026-09-06",
        },
      ],
    }),
  ).capabilities;
  assert.equal(cellFor(caps, "ballot.statewide-propositions", "ACQUIRED"), "NOT_WALKED");
});

test("ADM-40: held agenda material — not registry status — is what makes meetings ACQUIRED (CC-F4 superseded)", () => {
  const caps = snap(
    azAuthorities({
      heldAgendas: {
        county: { bodies: 2, meetings: 41, asOf: "2026-09-06" },
        place: { bodies: 16, meetings: 119, asOf: "2026-09-06" },
        school: { bodies: 0, meetings: 0, asOf: null },
      },
    }),
  ).capabilities;
  assert.equal(cellFor(caps, "meetings.county-boards", "ACQUIRED"), "PARTIAL_OR_STALE"); // 2 of 15
  assert.equal(cellFor(caps, "meetings.city-councils", "ACQUIRED"), "PARTIAL_OR_STALE"); // 16 of 91
  // No held meeting for a level is still NOT_WALKED: a located source is not
  // acquired material, which is what CC-F4 was protecting and still is.
  assert.equal(cellFor(caps, "meetings.school-boards", "ACQUIRED"), "NOT_WALKED");
  const acquired = caps
    .find((r) => r.capabilityId === "meetings.county-boards")!
    .gates.find((g) => g.gate === "ACQUIRED")!;
  assert.match(acquired.detail, /2 of 15 bodies with at least one meeting held \(41 meeting\(s\) on file\)/);
});

test("ADM-39: the summary figures are measurements, not em dashes", () => {
  const s = snap(
    azAuthorities({
      delivery: [delivery(), delivery({ capabilityId: "finance.federal-fec", holding: "data/fec/fec-2026.json", rows: 8 })],
    }),
  );
  assert.equal(s.summary.capabilitiesServedToReaders.held, true);
  if (s.summary.capabilitiesServedToReaders.held) {
    assert.equal(s.summary.capabilitiesServedToReaders.value.value, 2);
    assert.equal(s.summary.capabilitiesServedToReaders.value.denominator, 23);
  }
  // The oldest dated instrument on the grid, which is what "since the last full
  // pass" was reaching for and could never answer.
  assert.equal(s.summary.oldestEvidence.held, true);
  if (s.summary.oldestEvidence.held) assert.match(s.summary.oldestEvidence.value, /^\d{4}-\d{2}-\d{2}$/);
  // A state with nothing walked says so, rather than claiming a zero.
  const bare = snap(
    azAuthorities({
      cdUniverse: null,
      counts: {},
      divisionsAsOf: null,
      bodies: {
        county: { sourceLocated: 0, live: 0, asOf: null },
        place: { sourceLocated: 0, live: 0, asOf: null },
        school: { sourceLocated: 0, live: 0, asOf: null },
      },
      ballotVerification: null,
      stateDisclosure: null,
      stateDisclosureVerification: null,
      delivery: [],
    }),
  );
  assert.equal(bare.summary.oldestEvidence.held, false);
  assert.match(bare.summary.oldestEvidence.held ? "" : bare.summary.oldestEvidence.gap.says, /oldest evidence/);
});

test("ADM-40: the delivery declarations reach the published record, and zero-row ones do not", () => {
  const s = snap(azAuthorities({ delivery: [delivery(), delivery({ capabilityId: "finance.municipal", rows: 0 })] }));
  assert.equal(s.delivery.length, 1);
  assert.equal(s.delivery[0].capabilityId, "ballot.candidate-filings");
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

test("CC-F2 also covers the summary: with nothing declared served, the count is a measured ZERO of the rows tracked", () => {
  // Not a gap and not a dash: nothing is declared served, and that is a fact
  // with a denominator — 0 of the 23 rows this grid tracks (ADM-39).
  const s = snap(azAuthorities({ delivery: [] }));
  assert.equal(s.summary.capabilitiesServedToReaders.held, true);
  if (s.summary.capabilitiesServedToReaders.held) {
    assert.equal(s.summary.capabilitiesServedToReaders.value.value, 0);
    assert.equal(s.summary.capabilitiesServedToReaders.value.denominator, 23);
  }
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
  // Unchanged by ADM-40: registry `coverageStatus` still establishes only that a
  // source is located. What changed is that a SECOND instrument — held agenda
  // material in the meetings snapshot — now exists and is what ACQUIRED derives
  // from. With no held meetings, the answer is still that nobody has looked.
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

test("ADM-40: the FEC slice says what it looked up, and never puts verification ahead of acquisition", () => {
  // The owner: federal FEC money renders in detail on a senator's card while the
  // Admin's Federal · FEC row was blank across the board. 8 of AZ's 9 federal
  // candidacies hold filings; the ninth is a recorded absence with the FEC
  // search behind it. Both facts belong on the row, and neither may push
  // VERIFIED past ACQUIRED — that is an impossible state, not a stronger claim.
  const caps = snap(
    azAuthorities({ fec: { matched: 8, total: 9, authority: "Federal Election Commission (openFEC) — federal candidacies for AZ in the 2026 cycle", asOf: "2026-09-05" } }),
  ).capabilities;
  assert.equal(cellFor(caps, "finance.federal-fec", "SOURCE_KNOWN"), "CURRENT");
  assert.equal(cellFor(caps, "finance.federal-fec", "ACQUIRED"), "PARTIAL_OR_STALE");
  assert.equal(cellFor(caps, "finance.federal-fec", "VERIFIED"), "PARTIAL_OR_STALE");
  const source = caps
    .find((r) => r.capabilityId === "finance.federal-fec")!
    .gates.find((g) => g.gate === "SOURCE_KNOWN")!;
  assert.match(source.detail, /8 hold filings; 1 carr(y|ies) a recorded absence/);
  // No monotonicity violation: nothing claims to be verified past what is held.
  const s = snap(azAuthorities({ fec: { matched: 8, total: 9, authority: "FEC", asOf: "2026-09-05" } }));
  assert.deepEqual(
    s.monotonicityViolations.filter((v) => v.capabilityId === "finance.federal-fec"),
    [],
  );
});

/* AZ state-specific reconciliations still verify (they are already state-scoped). */
test("AZ candidate filings and state disclosure verify against their external authorities", () => {
  const caps = snap(azAuthorities({ ballotFilings: nhBallotFilings() })).capabilities;
  assert.equal(cellFor(caps, "ballot.candidate-filings", "VERIFIED"), "PARTIAL_OR_STALE"); // 27 of 30
  assert.equal(cellFor(caps, "finance.state-disclosure", "SOURCE_KNOWN"), "CURRENT"); // 49 routed
  assert.equal(cellFor(caps, "finance.state-disclosure", "ACQUIRED"), "PARTIAL_OR_STALE"); // 44 of 49
  // The SeeTheMoney reconciliation agreed 716 of 716 committees, which is a
  // different universe from the 49 candidacies in scope. The gate chain refuses
  // to read that as complete verification past a 44-of-49 acquisition, and the
  // disagreement is SURFACED rather than averaged away (R-B).
  assert.equal(cellFor(caps, "finance.state-disclosure", "VERIFIED"), "PARTIAL_OR_STALE");
  const s = snap(azAuthorities({ ballotFilings: nhBallotFilings() }));
  assert.equal(s.monotonicityViolations.some((v) => v.capabilityId === "finance.state-disclosure"), true);
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
