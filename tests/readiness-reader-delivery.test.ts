import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";

import { GATE_ORDER } from "../lib/control-plane/readiness/gates.ts";
import {
  READINESS_DERIVATION_CONTRACT,
  type ReadinessStateSnapshot,
} from "../lib/control-plane/readiness/model.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { REGISTRATION_TARGETS } from "../lib/registration/publication.ts";
import { MEETING_PARTITION_CONTRACTS, observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  READINESS_AUTHORITY_COVERAGE,
  STATIC_READINESS_REFERENCES,
  readinessAuthorityCoverageIssues,
} from "../lib/civic-data/readiness-authority.ts";

/**
 * **THE ADMIN MUST NOT CONTRADICT THE LIVE PRODUCT** (ADM-40 / §9A.9, ADM-41 /
 * §9A.10, ADM-39 / §9A.7 — the 9.6.26 owner feedback), proved END TO END against
 * the repository's real committed holdings rather than a fixture.
 *
 * The owner's finding, verbatim:
 *
 * > *"we have candidate listings in New Hampshire and New Jersey on the site.
 * > Live right now. So saying that we don't have candidate filings for state or
 * > anything like that, that doesn't make any sense at all. We also absolutely
 * > have federal FEC campaign finance, and it's blank across the board."*
 *
 * > *"Arizona, New Hampshire and New Jersey all have … the exact same
 * > breakdown."*
 *
 * A unit test over a hand-built `StateAuthorities` cannot catch either defect,
 * because both were failures of the PUBLISHER's tallies — the facts were on
 * disk the whole time and nothing read them. So this runs the real publisher
 * into a throwaway file store outside the repository and reads back what it
 * wrote. It is the only test here that spends ten seconds, and it is the only
 * one that could have caught what the owner caught.
 */

const ROOT = process.cwd();
let store: string;
let snapshots: Record<string, ReadinessStateSnapshot>;

function publishSnapshots(out: string, overlay?: string): Record<string, ReadinessStateSnapshot> {
  // The publisher's default target is the local file store (CC-F3); `--out`
  // moves that store outside the repository so the run leaves nothing behind
  // and cannot be mistaken for a committed artifact.
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      join(ROOT, "scripts/readiness-refresh.mts"),
      `--out=${out}`,
      "--fixture-operational-reference",
      ...(overlay ? [`--fixture-input-overlay=${overlay}`] : []),
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 240_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_ENV: "test" } },
  );
  const dir = join(out, "aggregates", "readiness-snapshots");
  const result: Record<string, ReadinessStateSnapshot> = {};
  for (const file of readdirSync(dir)) {
    const record = JSON.parse(readFileSync(join(dir, file), "utf8")) as { value?: ReadinessStateSnapshot } & ReadinessStateSnapshot;
    const snapshot = (record.value ?? record) as ReadinessStateSnapshot;
    result[snapshot.state] = snapshot;
  }
  return result;
}

before(() => {
  store = mkdtempSync(join(tmpdir(), "wtp-readiness-"));
  snapshots = publishSnapshots(store);
}, { timeout: 300_000 });

after(() => {
  if (store) rmSync(store, { recursive: true, force: true });
});

function snap(state: string): ReadinessStateSnapshot {
  const s = snapshots[state];
  assert.ok(s, `the publisher wrote no snapshot for ${state}`);
  return s;
}

function cell(state: string, capabilityId: string, gate: string) {
  const row = snap(state).capabilities.find((r) => r.capabilityId === capabilityId);
  assert.ok(row, `${state} has no ${capabilityId} row`);
  const g = row.gates.find((x) => x.gate === gate);
  assert.ok(g, `${state} ${capabilityId} has no ${gate} gate`);
  return g;
}

/** The whole grid as one comparable string: 23 rows × 5 gates, plus coverage. */
function gridSignature(state: string): string {
  return snap(state)
    .capabilities.map((r) => `${r.capabilityId}|${r.gates.map((g) => g.state).join(",")}|${r.coverageLabel}`)
    .join("\n");
}

/* ============================================================ the derivation */

test("the publisher writes all three pilot states under the CURRENT derivation contract", () => {
  assert.deepEqual(Object.keys(snapshots).sort(), ["az", "nh", "nj"]);
  for (const state of ["az", "nh", "nj"]) {
    assert.equal(snap(state).derivationContract, READINESS_DERIVATION_CONTRACT);
    assert.equal(snap(state).capabilities.length, 23);
    for (const row of snap(state).capabilities) assert.equal(row.gates.length, GATE_ORDER.length);
  }
});

/* ============================================================ ADM-40 §9A.9 */

test("PDC: ballot candidacy and state-finance readiness never reproject tracked manual-production seeds", () => {
  for (const state of ["az", "nh", "nj"]) {
    for (const capabilityId of ["ballot.candidate-filings", "finance.state-disclosure"]) {
      const row = snap(state).capabilities.find((candidate) => candidate.capabilityId === capabilityId)!;
      assert.equal(row.coverage.held, false, `${state} ${capabilityId} manufactured readiness from a tracked seed`);
      assert.ok(row.gates.every(({ state: gateState }) => gateState === "NOT_WALKED"));
      assert.equal(snap(state).delivery.some((delivery) => delivery.capabilityId === capabilityId), false);
    }
  }
});

test("PDC: Federal FEC readiness never reprojects the retired tracked corpus", () => {
  for (const state of ["az", "nh", "nj"]) {
    const row = snap(state).capabilities.find((r) => r.capabilityId === "finance.federal-fec")!;
    assert.equal(row.coverage.held, false, `${state} manufactured FEC readiness outside canonical Admin`);
    assert.equal(snap(state).delivery.some((delivery) => delivery.capabilityId === "finance.federal-fec"), false);
    assert.ok(row.gates.every(({ state: gateState }) => gateState === "NOT_WALKED"));
  }
});

test("§9A.9: something the Reader is served says so — never 'no data' and never an empty cell", () => {
  for (const state of ["az", "nh", "nj"]) {
    const delivered = snap(state).delivery;
    assert.ok(delivered.length > 0, `${state} declares no reader delivery at all`);
    for (const d of delivered) {
      assert.ok(d.rows > 0, `${state} ${d.capabilityId} declares a delivery of zero rows`);
      assert.ok(d.surfaces.length > 0 || d.routes.length > 0, `${state} ${d.capabilityId} names no surface or route`);
      const shown = cell(state, d.capabilityId, "SHOWN_TO_READER");
      assert.equal(shown.says, "Shown on the Reader · verification proof needs a fresh check");
      assert.notEqual(shown.state, "NOT_WALKED");
      assert.notEqual(shown.state, "CURRENT", "a standing declaration must never read as a verified rendering");
    }
    // Only adopted static division/geography deliveries remain here. Runtime
    // civic-data delivery is proved by canonical Admin.
    const ids = new Set(delivered.map((d) => d.capabilityId));
    assert.ok(ids.has("districts.congressional"), `${state} does not declare the districts served`);
    assert.ok(!ids.has("finance.federal-fec"), `${state} duplicates canonical FEC delivery`);
    assert.ok(!ids.has("finance.state-disclosure"), `${state} duplicates canonical state-finance delivery`);
    assert.ok(!ids.has("ballot.candidate-filings"), `${state} duplicates canonical ballot delivery`);
    assert.ok(![...ids].some((id) => id.startsWith("meetings.")), `${state} duplicates canonical meeting delivery`);
  }
});

test("PDC-7: Admin does not report retired Plural/OpenStates state rosters as Reader delivery", () => {
  for (const state of ["az", "nh", "nj"]) {
    assert.ok(
      !snap(state).delivery.some(({ capabilityId }) => capabilityId === "officials.state-federal-seats"),
      `${state} still publishes an intermediary state-roster delivery`,
    );
    const row = snap(state).capabilities.find(({ capabilityId }) => capabilityId === "officials.state-federal-seats");
    assert.ok(row, `${state} has no explicit officials capability gap`);
    assert.equal(row.coverage.held, false);
    assert.ok(row.gates.every(({ state: gateState }) => gateState === "NOT_WALKED"));
  }
});

test("§9A.9: every cell says something, and no cell says a machine constant", () => {
  for (const state of ["az", "nh", "nj"]) {
    for (const row of snap(state).capabilities) {
      for (const g of row.gates) {
        assert.ok(g.says.trim() !== "", `${state} ${row.capabilityId} ${g.gate} renders no words`);
        assert.doesNotMatch(g.says, /[A-Z]{2,}_[A-Z]/, `${state} ${row.capabilityId} ${g.gate} says "${g.says}"`);
        assert.doesNotMatch(g.detail, /NOT_WALKED|ARGUED_ABSENT|PARTIAL_OR_STALE|SOURCE_KNOWN|SHOWN_TO_READER|ASK_ANSWERS/);
      }
      assert.doesNotMatch(row.coverageLabel, /no external denominator/);
    }
  }
});

/* ============================================================ the owner's third finding */

test("ADM-40: the remaining static readiness denominators retain real state differences", () => {
  const az = gridSignature("az");
  const nh = gridSignature("nh");
  const nj = gridSignature("nj");
  assert.notEqual(az, nh, "Arizona and New Hampshire produce an identical grid");
  assert.notEqual(az, nj, "Arizona and New Jersey produce an identical grid");
  assert.notEqual(nh, nj, "New Hampshire and New Jersey produce an identical grid");

  assert.notEqual(
    snap("az").capabilities.find((row) => row.capabilityId === "districts.congressional")?.coverageLabel,
    snap("nh").capabilities.find((row) => row.capabilityId === "districts.congressional")?.coverageLabel,
  );
  for (const state of ["az", "nh", "nj"]) {
    for (const capabilityId of ["ballot.candidate-filings", "finance.state-disclosure"]) {
      assert.ok(
        snap(state).capabilities.find((row) => row.capabilityId === capabilityId)?.gates.every(({ state: gateState }) => gateState === "NOT_WALKED"),
        `${state} ${capabilityId} must be answered by canonical Admin, not used to manufacture a legacy-grid difference`,
      );
    }
  }
});

/* ============================================================ ADM-39 */

test("ADM-39: neither summary tile is a dash — both hold a measurement with a denominator", () => {
  for (const state of ["az", "nh", "nj"]) {
    const s = snap(state).summary;
    assert.equal(s.capabilitiesServedToReaders.held, true, `${state} still cannot count what the Reader is served`);
    if (s.capabilitiesServedToReaders.held) {
      assert.equal(s.capabilitiesServedToReaders.value.denominator, 23);
      assert.ok(s.capabilitiesServedToReaders.value.value > 0);
    }
    assert.equal(s.oldestEvidence.held, true, `${state} still cannot date its oldest evidence`);
    if (s.oldestEvidence.held) assert.match(s.oldestEvidence.value, /^\d{4}-\d{2}-\d{2}$/);
  }
});

/* ============================================================ ADM-41 §9A.10 */

test("PDC: readiness authority coverage accounts for every production contract", () => {
  const contracts = [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS];
  // 159 from 2026-09-23: + meetings:official-page-events for Tucson Unified's own page.
  // 161 from 2026-09-24: + the Newbury Library Trustees' and Energy Committee's own pages (C9).
  // 162 from 2026-09-24: + meetings:schedulepage for Chandler's City Council schedule table (C14).
  // 167 from 2026-09-24: + the meeting-source wiring, three derived state families and the meeting-body crosswalk (C16).
  // 169 from 2026-09-25: − meetings:diligent for Newbury's Selectboard (its CivicWeb host no longer resolves),
  // + Mesa's council decisions read off its minutes (NH332), + Holbrook's (document listing) and Winslow's
  // (SuiteOne) City Council partitions; + the automatic crosswalk (C16 option A), and a derived family for every
  // registered state (53 more than AZ, NH, NJ). + the verified campaign sites the runner publishes (2026-09-25).
  // + the state legislators' capitol and district offices, refreshed daily (member-offices, 2026-09-30).
  assert.equal(
    contracts.length,
    169 + 56 + 1 + (REGISTRATION_TARGETS.length - 3) + 1 + 1 + 1 + 1 + 1, // official filing facts, AZ operational reference, member offices, general ballot contests
    "the coverage guard must move when the production contract denominator moves (56: one registration per FIPS state, DC and territory)",
  );
  assert.deepEqual(
    ROUTINE_SOURCE_CONTRACTS.map(({ id }) => id),
    [
      "fec-funding", "nh-members", "az-state-legislators", "nj-state-legislators", "az-state-rollcalls", "nh-state-rollcalls", "nj-state-rollcalls", "census-acs-population", "census-geography-overlaps", "nj-morris-filing", "pima-legistar-outcomes", "mesa-legistar-minutes-outcomes", "dotgov",
      ...REGISTRATION_TARGETS.map(({ contractId }) => contractId),
      "meeting-body-crosswalk-derived",
      "meeting-source-wiring",
      "candidate-campaign-sites-derived",
    ],
    "the guard must move when the canonical contract denominator moves",
  );
  // 129 source/body partitions (Newbury's CivicWeb route retired; Holbrook's and Winslow's councils added)
  // and one derived family per registered state.
  assert.equal(MEETING_PARTITION_CONTRACTS.length, 129 + REGISTRATION_TARGETS.length);
  assert.equal(contracts.some(({ id }) => id === "meetings"), false);
  assert.deepEqual(readinessAuthorityCoverageIssues(), []);
  assert.deepEqual(
    READINESS_AUTHORITY_COVERAGE.map(({ contractId }) => contractId).sort(),
    contracts.map(({ id }) => id).sort(),
  );
  assert.ok(READINESS_AUTHORITY_COVERAGE.every(({ legacyTrackedBootstrap }) => legacyTrackedBootstrap === "FORBIDDEN"));
  assert.deepEqual(
    READINESS_AUTHORITY_COVERAGE.filter(({ disposition }) => disposition === "CANONICAL_READINESS_INPUT").map(({ contractId }) => contractId),
    ["jurisdiction-operational-reference"],
  );
  assert.deepEqual(
    READINESS_AUTHORITY_COVERAGE.filter(({ disposition }) => disposition === "CANONICAL_NON_READER").map(({ contractId }) => contractId),
    ["dotgov"],
  );
  assert.deepEqual(STATIC_READINESS_REFERENCES.map(({ id }) => id), ["registry-division-identities", "census-gis-geography"]);
  assert.ok(STATIC_READINESS_REFERENCES.every(({ mayAssertRuntimeFreshness }) => mayAssertRuntimeFreshness === false));
  assert.ok(STATIC_READINESS_REFERENCES.every(({ mayAssertProductionContractDelivery }) => mayAssertProductionContractDelivery === false));
  const source = readFileSync(join(ROOT, "scripts", "readiness-refresh.mts"), "utf8");
  assert.match(source, /PRODUCTION_CONTRACT_IDS = READINESS_AUTHORITY_COVERAGE\.map\(\(\{ contractId \}\) => contractId\)/);
  for (const retiredTrackedAuthority of [
    "data/fec/fec-2026.json",
    "data/meetings-snapshot.json",
    "state-money-${code}-2026.json",
    "ballotFiles(",
    "stateDisclosureFor(",
    "azStateDisclosureVerification(",
    "refreshPopulationFromPromoted",
    "zipPopulationReading",
    "statePopulation(",
  ]) {
    assert.equal(source.includes(retiredTrackedAuthority), false, `readiness still calls ${retiredTrackedAuthority}`);
  }
  for (const state of ["az", "nh", "nj"]) {
    assert.ok(snap(state).zips.every(({ population }) => !population.held), `${state} copied ACS values into readiness`);
    assert.equal(snap(state).summary.populationInCompleteZip.held, false);
    for (const capabilityId of ["finance.federal-fec", "officials.state-federal-seats", "meetings.county-boards", "meetings.city-councils", "meetings.school-boards"]) {
      assert.equal(snap(state).delivery.some((row) => row.capabilityId === capabilityId), false, `${state} duplicated ${capabilityId}`);
    }
    assert.equal(snap(state).delivery.some((row) => row.capabilityId === "finance.state-disclosure"), false);
    assert.equal(snap(state).delivery.some((row) => row.capabilityId === "ballot.candidate-filings"), false);
  }
});

test("PDC: changing the five tracked manual-production bootstrap families cannot alter readiness", () => {
  const targetIds = new Set([
    "az-sos-ballot",
    "nh-curated-ballot",
    "az-sos-campaign-finance",
    "nh-sos-campaign-finance",
    "nj-elec-campaign-finance",
  ]);
  const overlay = mkdtempSync(join(tmpdir(), "wtp-readiness-poison-"));
  const output = mkdtempSync(join(tmpdir(), "wtp-readiness-poison-output-"));
  try {
    for (const contract of MANUAL_PRODUCTION_SOURCE_CONTRACTS.filter(({ id }) => targetIds.has(id))) {
      for (const rel of contract.bootstrapFixturePaths) {
        const path = join(overlay, rel);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({
          generatedAt: "2099-12-31T23:59:59.000Z",
          collectedAt: "2099-12-31T23:59:59.000Z",
          contests: Array.from({ length: 97 }, (_, index) => ({ id: `poison-${index}`, type: "MEASURE", ocdId: "ocd-division/country:us/state:az" })),
          candidacies: Array.from({ length: 101 }, (_, index) => ({ id: `poison-${index}` })),
          measures: Array.from({ length: 97 }, (_, index) => ({ contestId: `poison-${index}` })),
          records: Array.from({ length: 103 }, (_, index) => ({ id: `poison-${index}` })),
          split: { candidaciesInScope: 103, filed: 103 },
          reconciliation: { committeesTested: 103, agreed: 103 },
        }), "utf8");
      }
    }
    const poisoned = publishSnapshots(output, overlay);
    for (const state of ["az", "nh", "nj"]) {
      assert.deepEqual(poisoned[state].capabilities, snap(state).capabilities, `${state} readiness changed with poisoned tracked seeds`);
      assert.deepEqual(poisoned[state].delivery, snap(state).delivery, `${state} delivery changed with poisoned tracked seeds`);
      assert.deepEqual(poisoned[state].summary, snap(state).summary, `${state} summary changed with poisoned tracked seeds`);
    }
  } finally {
    rmSync(overlay, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});

test("ADM-41: a Census county division is not rendered as though it were the town", () => {
  // "Arivaca — 32 people" paired a CCD's name with a different, tiny ZCTA's
  // count. The number was the ZIP's; the name was a statistical area's, and
  // stripping its " CCD" suffix is what made it read as the town.
  const row = snap("az").zips.find((z) => z.zip === "85633");
  assert.ok(row);
  assert.equal(row.place.held, true);
  if (row.place.held) {
    assert.match(row.place.value, /census county division$/, "a CCD is being shown as a town name again");
    assert.notEqual(row.place.value, "Arivaca");
  }
  // An incorporated place is still rendered plainly, with no suffix invented.
  const tucson = snap("az").zips.find((z) => z.zip === "85701");
  if (tucson?.place.held) assert.doesNotMatch(tucson.place.value, /census county division/);
});
