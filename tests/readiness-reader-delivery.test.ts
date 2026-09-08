import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import { GATE_ORDER } from "../lib/control-plane/readiness/gates.ts";
import {
  READINESS_DERIVATION_CONTRACT,
  type ReadinessStateSnapshot,
} from "../lib/control-plane/readiness/model.ts";

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

before(() => {
  store = mkdtempSync(join(tmpdir(), "wtp-readiness-"));
  // The publisher's default target is the local file store (CC-F3); `--out`
  // moves that store outside the repository so the run leaves nothing behind
  // and cannot be mistaken for a committed artifact.
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/readiness-refresh.mts"), `--out=${store}`],
    { cwd: ROOT, encoding: "utf8", timeout: 240_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const dir = join(store, "aggregates", "readiness-snapshots");
  snapshots = {};
  for (const file of readdirSync(dir)) {
    const record = JSON.parse(readFileSync(join(dir, file), "utf8")) as { value?: ReadinessStateSnapshot } & ReadinessStateSnapshot;
    const snapshot = (record.value ?? record) as ReadinessStateSnapshot;
    snapshots[snapshot.state] = snapshot;
  }
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

test("ADM-40: New Hampshire and New Jersey candidate filings are no longer blank, and carry their real counts", () => {
  // 47 candidacies from sos.nh.gov; 275 from the Morris County Clerk. Both were
  // on disk and both rendered as nothing.
  for (const [state, filings, contests] of [["nh", 47, 13], ["nj", 275, 99]] as const) {
    const row = snap(state).capabilities.find((r) => r.capabilityId === "ballot.candidate-filings")!;
    assert.equal(row.coverageLabel, `${filings} filings · ${contests} contests`);
    assert.equal(cell(state, "ballot.candidate-filings", "SOURCE_KNOWN").state, "CURRENT");
    assert.equal(cell(state, "ballot.candidate-filings", "ACQUIRED").state, "CURRENT");
    assert.match(row.coverageSays ?? "", /Secretary of State|County Clerk/);
  }
  // The .gov / official-clerk provenance and the as-of reach the face.
  assert.match(
    snap("nh").capabilities.find((r) => r.capabilityId === "ballot.candidate-filings")!.coverageSays ?? "",
    /New Hampshire Secretary of State/,
  );
  assert.equal(
    snap("nj").capabilities.find((r) => r.capabilityId === "ballot.candidate-filings")!.asOf,
    "2026-09-06",
  );
});

test("ADM-40: Federal · FEC carries a REAL per-state denominator, never the national one", () => {
  // Every candidate row in data/fec/fec-2026.json carries its own `state`, and
  // every absence a state-bearing targetKey. The national ballot total (38) may
  // never appear as any state's denominator.
  const seen: Record<string, number> = {};
  for (const state of ["az", "nh", "nj"]) {
    const row = snap(state).capabilities.find((r) => r.capabilityId === "finance.federal-fec")!;
    assert.equal(row.coverage.held, true, `${state} federal FEC is still a gap`);
    if (row.coverage.held) {
      assert.ok(row.coverage.value.denominator > 0);
      assert.notEqual(row.coverage.value.denominator, 38, `${state} inherited the national FEC denominator`);
      assert.match(row.coverage.value.denominatorSource, new RegExp(state.toUpperCase()));
      seen[state] = row.coverage.value.denominator;
    }
    assert.equal(cell(state, "finance.federal-fec", "SOURCE_KNOWN").state, "CURRENT");
  }
  assert.equal(new Set(Object.values(seen)).size, 3, `the three states share an FEC denominator: ${JSON.stringify(seen)}`);
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
    // The capabilities the owner named as live are among them.
    const ids = new Set(delivered.map((d) => d.capabilityId));
    assert.ok(ids.has("districts.congressional"), `${state} does not declare the districts served`);
    assert.ok(ids.has("finance.federal-fec"), `${state} does not declare federal money served`);
  }
  assert.ok(
    new Set(snap("nh").delivery.map((d) => d.capabilityId)).has("ballot.candidate-filings"),
    "NH candidate listings are live and still not declared served",
  );
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

test("ADM-40: Arizona, New Hampshire and New Jersey do NOT produce the same breakdown", () => {
  const az = gridSignature("az");
  const nh = gridSignature("nh");
  const nj = gridSignature("nj");
  assert.notEqual(az, nh, "Arizona and New Hampshire produce an identical grid");
  assert.notEqual(az, nj, "Arizona and New Jersey produce an identical grid");
  assert.notEqual(nh, nj, "New Hampshire and New Jersey produce an identical grid");

  // Not merely different — different in the GATE PATTERN, not only in the
  // counts. The 9.4 grids differed only by coverage numbers, which is what let
  // three states read as "the exact same breakdown".
  const pattern = (state: string) =>
    snap(state).capabilities.map((r) => `${r.capabilityId}|${r.gates.map((g) => g.state).join(",")}`).join("\n");
  assert.notEqual(pattern("nh"), pattern("nj"), "NH and NJ still share a gate pattern; only the counts differ");
  assert.notEqual(pattern("az"), pattern("nh"));

  // And name one difference each, so the test explains itself when it fails.
  // NH: the Secretary of State now publishes one statewide question. The
  // source and question are held; an external reconciliation remains open.
  assert.equal(cell("nh", "ballot.statewide-propositions", "SOURCE_KNOWN").state, "CURRENT");
  assert.equal(cell("nh", "ballot.statewide-propositions", "ACQUIRED").state, "CURRENT");
  assert.equal(cell("nh", "ballot.statewide-propositions", "VERIFIED").state, "NOT_WALKED");
  // NJ: no such statement exists, so nobody has looked. A different fact.
  assert.equal(cell("nj", "ballot.statewide-propositions", "VERIFIED").state, "NOT_WALKED");
  // AZ: eleven statewide measure contests are known and none has question text.
  assert.equal(cell("az", "ballot.statewide-propositions", "SOURCE_KNOWN").state, "CURRENT");
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

test("ADM-41: the ZIP population is the ACS 2024 estimate, and a zero is never asserted as a count", () => {
  const az = snap("az");
  const zip = (code: string) => {
    const row = az.zips.find((z) => z.zip === code);
    assert.ok(row, `no AZ zip row for ${code}`);
    return row;
  };
  // Verified independently against api.census.gov on 2026-09-06.
  const sasabe = zip("85633");
  assert.equal(sasabe.population.held, true);
  if (sasabe.population.held) assert.equal(sasabe.population.value.value, 48);
  assert.equal(sasabe.populationMargin, 29);
  assert.equal(sasabe.populationBasis, "COUNTED");

  // The owner's exact objection: "0 people" presented as a fact.
  const rillito = zip("85654");
  assert.equal(rillito.populationBasis, "RECORDED_AS_NONE");
  if (rillito.population.held) assert.equal(rillito.population.value.value, 0);
  assert.equal(rillito.populationMargin, 14);

  // The vintage reaches the published record, so the page cannot label it wrong.
  const pilot = zip("85701");
  assert.equal(pilot.population.held, true);
  if (pilot.population.held) {
    assert.equal(pilot.population.value.value, 5498);
    assert.equal(pilot.population.value.denominator, 7_378_838);
    assert.match(pilot.population.value.denominatorSource, /American Community Survey, 5-Year estimates, 2024 release/);
    assert.match(pilot.population.value.contract, /ZIP Code Tabulation Area/);
  }
  assert.equal(pilot.populationMargin, 734);
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

test("ADM-41: the state denominators are the 2024 release, in the same run as the ZIP numerators", () => {
  const totals: Record<string, number> = { az: 7_378_838, nh: 1_394_868, nj: 9_343_809 };
  for (const [state, total] of Object.entries(totals)) {
    const held = snap(state).summary.populationInCompleteZip;
    assert.equal(held.held, true);
    if (held.held) {
      assert.equal(held.value.denominator, total, `${state} is still on a superseded ACS vintage`);
      assert.match(held.value.contract, /ACS 5-Year 2024/);
    }
  }
});
