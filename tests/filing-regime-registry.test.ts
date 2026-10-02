/**
 * THE FILING-REGIME REGISTRY — the seeded failures of national expansion.
 *
 * `tests/control-plane-campaign-finance.test.ts` proves the domain: an
 * independent expenditure is not a receipt, an amendment supersedes without
 * deleting, three of four fails closed, and A.R.S. § 16-928 sends a
 * school-district election to the COUNTY officer. This file proves that the last
 * of those can be carried into a fifty-first jurisdiction without an
 * `if (state === …)` tree — and, much more importantly, what happens at the
 * jurisdiction NOBODY HAS READ.
 *
 * The failures seeded here:
 *
 *   **A** A jurisdiction absent from the registry acquires a custodian anyway,
 *   by falling through to a default — the state authority, or the FEC, or worse,
 *   a closed contest. This is how an absence gets asserted about a government
 *   that was never asked, and it is the failure a `else { … }` at the bottom of
 *   a resolver produces for free.
 *
 *   **B** Two routing rules claim one contest and the loader picks one. Picking
 *   either picks WHICH GOVERNMENT holds a candidate's money, with no evidence
 *   for the choice.
 *
 *   **C** A repealed regime routes a current contest, because nothing carries an
 *   effective period.
 *
 *   **D** A peer candidate is silently omitted from a contest's coverage, and
 *   the symmetry guard — which sweeps the records that ARE present — reports the
 *   contest symmetric. The shallower side is not in the list being swept.
 *
 *   **E** An unresolved authority is read as no money to report.
 *
 * ## Fixtures versus findings
 *
 * The committed registry, `data/campaign-finance/filing-regimes.json`, is
 * asserted against the artifacts it cites: `states/az/sources.md`,
 * `data/method/knowledge.json`, and the files its `officialRecord` entries name.
 *
 * Everything else is a FIXTURE registry built in this file. Its jurisdiction is
 * `ZZ`, its ids all begin `fixture:`, and every citation it carries says
 * `TEST FIXTURE` in capitals. It asserts nothing about any government — and a
 * test below proves none of those strings ever reached the committed data file.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import {
  fecAbsenceIsNotClosure,
  filingRegimeRegistry,
  levelMismatchNote,
  resolveFilingAuthority,
  unresolvedAuthorityKeepsCoverageOpen,
} from "../lib/control-plane/campaign-finance/authority.ts";
import {
  FILING_REGIME_FORMAT_VERSION,
  FilingRegimeRegistryInvalid,
  effectivePeriodsOverlap,
  loadFilingRegimeRegistry,
  regimeEffectiveOn,
  selectRegime,
  requireAuthority,
  filingRegimePath,
  validateFilingRegimeRegistry,
  type RegistryIssueCode,
} from "../lib/control-plane/campaign-finance/filing-regime.ts";
import {
  candidateFinanceFeatureEligibility,
  evaluateCoverage,
  symmetryCheck,
} from "../lib/control-plane/campaign-finance/coverage.ts";
import type { CandidateFinanceCoverage } from "../lib/control-plane/campaign-finance/model.ts";
import { coverageFixture } from "./control-plane-fixtures.ts";
import { METHOD_FIXTURE_PATH } from "./method-store-fixture.ts";

const ROOT = resolve(import.meta.dirname, "..");
const AS_OF = "2026-08-28";
const CAMPAIGN_FINANCE_DIR = join(ROOT, "lib", "control-plane", "campaign-finance");

/* ── The FIXTURE registry. Every string says so out loud. ─────────────────── */

const FIXTURE_CITATION =
  "TEST FIXTURE — tests/filing-regime-registry.test.ts. Asserts nothing about any government.";

function fixtureRoute(routeId: string): Record<string, unknown> {
  return {
    routeId,
    label: `TEST FIXTURE route ${routeId}`,
    target: "fixture.invalid",
    disposition: "UNWALKED",
    note: "TEST FIXTURE. Never walked, because there is nothing at the other end of it.",
    citation: FIXTURE_CITATION,
    permission: "CANNOT_TELL",
    transport: null,
    rung: null,
    lastAttemptedOn: null,
  };
}

function fixtureAuthority(id: string, level: string, jurisdiction: string): Record<string, unknown> {
  return {
    id,
    name: `TEST FIXTURE authority ${id}`,
    level,
    jurisdiction,
    recordClasses: ["CANDIDATE_COMMITTEE_REPORT"],
    statutoryBasis: "FIXTURE PROVISION — NOT A REAL STATUTE",
    statutoryQuote:
      "FIXTURE QUOTE, NOT A REAL STATUTE: the borough auditor is the filing officer for school " +
      "district elections",
    statutoryOpenQuestion: null,
    discoveredVia: [FIXTURE_CITATION],
    filingsUrl: null,
    vendorPlatform: null,
  };
}

/**
 * ONE FIXTURE JURISDICTION, `ZZ`, whose statute routes a SCHOOL_DISTRICT contest
 * to a BOROUGH-level auditor.
 *
 * The office level and the authority level disagree, and they disagree
 * DIFFERENTLY from the way Arizona's do — Arizona sends school districts to a
 * COUNTY officer, this fixture sends them to a MUNICIPAL one. That is the point:
 * if the routing were code, expressing a second shape would mean editing code.
 */
function fixtureRegimeRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    regimeId: "fixture:zz:school-district",
    jurisdiction: "ZZ",
    officeLevels: ["SCHOOL_DISTRICT"],
    authorityLevel: "MUNICIPAL",
    custodianRole: "borough auditor",
    custodianScope: "PER_MUNICIPALITY",
    provenance: {
      statutoryBasis: "FIXTURE PROVISION — NOT A REAL STATUTE",
      statutoryQuote:
        "FIXTURE QUOTE, NOT A REAL STATUTE: the borough auditor is the filing officer for school " +
        "district elections",
      statutorySourceUrl: null,
      statutoryReadOn: null,
      openQuestion: null,
      officialRecord: [FIXTURE_CITATION],
    },
    effective: { from: null, through: null, openQuestion: null },
    supersedes: null,
    supersededBy: null,
    methodRouteIds: [],
    applicableRouteIds: ["FIXTURE_ZZ_AUDITOR_FILINGS"],
    custodians: [
      {
        scopeKey: "fixtureborough",
        authority: fixtureAuthority("fixture:zz:borough:auditor", "MUNICIPAL", "ZZ:FixtureBorough"),
        publisher: {
          name: "TEST FIXTURE publisher",
          url: null,
          isVendorPlatform: true,
          note: "TEST FIXTURE. Named to prove the publisher is a separate party from the authority.",
        },
      },
    ],
    coRegulators: [],
    custodianUnresolvedNote:
      'TEST FIXTURE: the rule names the borough auditor and borough "{scope}" has not been walked.',
    custodianUnresolvedRoutes: [fixtureRoute("FIXTURE_ZZ_BOROUGH_DIRECTORY")],
    ...over,
  };
}

function fixtureRegistryRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: FILING_REGIME_FORMAT_VERSION,
    _note: ["TEST FIXTURE registry. Not canonical data and not a claim about any government."],
    jurisdictions: [
      {
        jurisdiction: "ZZ",
        name: "TEST FIXTURE jurisdiction",
        federated: true,
        filingJurisdictionCount: 2,
        filingJurisdictionBreakdown: "TEST FIXTURE: 1 State, 1 Borough",
        denominatorSource: FIXTURE_CITATION,
        statutoryBasis: "FIXTURE PROVISION — NOT A REAL STATUTE",
        statutorySourceUrl: null,
        statutoryReadOn: null,
        statutoryOpenQuestion: null,
      },
    ],
    regimes: [fixtureRegimeRaw()],
    noRegimeRoutes: [fixtureRoute("FIXTURE_STATUTE_READ")],
    ...over,
  };
}

function fixtureCandidate(
  over: Partial<CandidateFinanceCoverage> & { candidacyId: string; displayName: string },
): CandidateFinanceCoverage {
  return {
    committeeIds: ["fixture:committee:a"],
    filingAuthorityResolved: true,
    filingAuthorityIds: ["fixture:authority"],
    filingsAcquired: ["fixture:filing:q1"],
    filingPeriodsExpected: ["2026 Q1"],
    filingPeriodsMissing: [],
    latestThroughDate: "2026-03-31",
    acquisitionDepth: "ITEMIZED_TRANSACTIONS",
    openRouteIds: [],
    identityGaps: [],
    amendmentGaps: [],
    asymmetryExplanation: null,
    ...over,
  };
}


/** Load a fixture registry, asserting it was ACCEPTED — the positive control shape. */
function loadFixture(over: Record<string, unknown> = {}) {
  return loadFilingRegimeRegistry(fixtureRegistryRaw(over), FIXTURE_CITATION);
}

/** Load a fixture registry expecting refusal, and return the issue codes. */
function refusalCodes(raw: unknown): RegistryIssueCode[] {
  const { registry, issues } = validateFilingRegimeRegistry(raw, FIXTURE_CITATION);
  assert.equal(registry, null, "the registry was ACCEPTED — this seeded failure is not caught");
  return issues.map((i) => i.code);
}

/* ══ The committed registry is real, and its provenance is checkable ══════ */

// These tests compare the two held source editions, rather than load a country registry.
function heldRegistry() {
  const registries = [filingRegimeRegistry("US"), filingRegimeRegistry("AZ")];
  return { ...registries[0], jurisdictions: registries.flatMap(registry => registry.jurisdictions),
    regimes: registries.flatMap(registry => registry.regimes) };
}
const FEC_AUTHORITY = requireAuthority(filingRegimeRegistry("US"), "us:federal:fec");
const PIMA_COUNTY_FILING_OFFICER = requireAuthority(filingRegimeRegistry("AZ"), "az:county:pima:officer-in-charge-of-elections");

test("the committed registry loads, and every regime carries provenance that exists on disk", () => {
  const registry = heldRegistry();

  // Not vacuous: the file really was read and really has both jurisdictions.
  assert.equal(registry.formatVersion, FILING_REGIME_FORMAT_VERSION);
  assert.deepEqual(
    registry.jurisdictions.map((j) => j.jurisdiction).sort(),
    ["AZ", "US"],
    "the registry is what this project knows NOW — two jurisdictions, and the file says so itself",
  );
  assert.equal(registry.regimes.length, 4, "one federal regime and A.R.S. § 16-928's three branches");
  assert.ok(registry.noRegimeRoutes.length > 0, "an unread jurisdiction must always have a next move");

  // The file states, in its own words, that it is not a complete list.
  const note = registry.note.join(" ");
  assert.match(note, /CANONICAL DATA/);
  assert.match(note, /NEVER a complete list/);
  assert.match(note, /WHAT THIS PROJECT KNOWS NOW|IT IS WHAT THIS PROJECT KNOWS NOW/);

  const azSources = readFileSync(join(ROOT, "states", "az", "sources.md"), "utf8");
  for (const regime of registry.regimes) {
    // A quote is verbatim from the state's own record, or there is no quote.
    if (regime.provenance.statutoryQuote !== null) {
      assert.ok(
        regime.provenance.statutoryBasis !== null,
        `${regime.regimeId} quotes a sentence with no provision named`,
      );
      const words = regime.provenance.statutoryQuote.replace(/[.,]/g, "").split(" ");
      assert.ok(
        words.every((w) => azSources.includes(w)),
        `${regime.regimeId}'s quote is not traceable to states/az/sources.md — a paraphrase of a ` +
          "routing rule is a different routing rule",
      );
    } else {
      // No quote is allowed ONLY with official corroboration and an open question.
      assert.ok(
        regime.provenance.officialRecord.length > 0,
        `${regime.regimeId} has neither a quote nor an official record`,
      );
      assert.ok(
        regime.provenance.openQuestion !== null,
        `${regime.regimeId} has no quoted statute and does not say that the statute is owed`,
      );
    }

    // Every officialRecord entry that names a repo path names a file that EXISTS.
    for (const entry of regime.provenance.officialRecord) {
      const path = entry.split(/\s+/)[0].replace(/^`|`$/g, "");
      if (!/^[a-z0-9_.-]+\/[\w./-]+$/i.test(path)) continue;
      assert.doesNotThrow(
        () => readFileSync(join(ROOT, path), "utf8"),
        `${regime.regimeId} cites ${path}, which is not in this repository`,
      );
    }
  }
});

test("every methodRouteId in the registry is a route the method store actually carries", () => {
  const registry = heldRegistry();
  const knowledge = JSON.parse(
    readFileSync(METHOD_FIXTURE_PATH, "utf8"),
  ) as { routes: { identity?: { id?: string }; id?: string }[] };
  const known = new Set(knowledge.routes.map((r) => r.identity?.id ?? r.id));

  // Not vacuous: the method store really was read.
  assert.ok(known.size > 50, `only ${known.size} method routes read — the sweep never looked`);

  let checked = 0;
  for (const regime of registry.regimes) {
    for (const routeId of regime.methodRouteIds) {
      checked += 1;
      assert.ok(
        known.has(routeId),
        `${regime.regimeId} names method route "${routeId}", which is not in the method store fixture`,
      );
    }
  }
  assert.ok(checked >= 3, `only ${checked} method route ids checked — the registry names too few to be a test`);
});

test("the AZ regimes reproduce the § 16-928 routing table, with the level mismatch intact", () => {
  const registry = heldRegistry();
  const az = registry.regimes.filter((r) => r.jurisdiction === "AZ");

  const covered = az.flatMap((r) => r.officeLevels).sort();
  assert.deepEqual(covered, [
    "CITY_OR_TOWN",
    "COMMUNITY_COLLEGE_DISTRICT",
    "COUNTY",
    "LEGISLATIVE",
    "SCHOOL_DISTRICT",
    "SPECIAL_TAXING_DISTRICT",
    "STATEWIDE",
  ]);

  // The four office classes the statute routes UPWARD, out of their own tier.
  const county = az.find((r) => r.regimeId === "az:16-928:county-and-districts");
  assert.ok(county);
  assert.equal(county.authorityLevel, "COUNTY");
  assert.equal(county.custodianRole, "county officer in charge of elections");
  assert.equal(county.custodianScope, "PER_COUNTY");
  assert.ok(county.officeLevels.includes("SCHOOL_DISTRICT"));
  assert.notEqual(
    county.authorityLevel,
    "SCHOOL_DISTRICT",
    "the authority's level need not match the office's, and this is the row where it does not",
  );

  // The publisher is a THIRD party — neither the office nor the authority.
  const pima = county.custodians.find((c) => c.scopeKey === "pima");
  assert.ok(pima);
  assert.equal(pima.authority.id, PIMA_COUNTY_FILING_OFFICER.id);
  assert.equal(pima.publisher?.isVendorPlatform, true);
  assert.match(pima.publisher?.name ?? "", /EasyVote/);
});

/* ══ A — a jurisdiction with NO registry entry ════════════════════════════ */

test("A a jurisdiction with no regime resolves NO_REGIME_ON_RECORD — not FEC, not closed", () => {
  // NOT VACUOUS: Wyoming really is absent from the committed registry. If it
  // were ever added, this test would be asserting NO_REGIME_ON_RECORD about a
  // jurisdiction that has one, and would need a different unread jurisdiction.
  const registry = heldRegistry();
  assert.equal(
    registry.jurisdictions.some((j) => j.jurisdiction === "WY"),
    false,
    "WY is now in the registry — pick another unread jurisdiction for this guard",
  );

  // SEEDED FAILURE: Wyoming is not in the registry. Nobody has read its statute.
  const wy = resolveFilingAuthority({
    jurisdiction: "WY",
    officeLevel: "SCHOOL_DISTRICT",
    contestId: "fixture:wy-school-board",
    county: "Laramie",
  });

  // Captured BEFORE the null assertion: `assert.equal(x, null)` narrows `x` to
  // `never` for the rest of the block, and a comparison against `never` is a
  // type error rather than the check it looks like.
  const wyAuthorityId = wy.authority === null ? null : (wy.authority as { id: string }).id;
  assert.equal(wy.status, "NO_REGIME_ON_RECORD", "an unread jurisdiction has its own named state");
  assert.notEqual(wyAuthorityId, FEC_AUTHORITY.id, "and it is never the FEC");
  assert.equal(wyAuthorityId, null, "an unresolved custodian is null, never a fallback");
  assert.equal(wy.authority, null);
  assert.equal(wy.regimeId, null);
  assert.equal(wy.statutoryQuote, null, "no rule was read, so no rule is quoted");
  assert.ok(wy.openRoutes.length > 0, "an unread jurisdiction must always name the next move");
  assert.equal(wy.openRoutes[0].declaration.routeId, "STATUTE_FILING_OFFICER_READ");
  assert.match(wy.why, /statement about this repository and never about a government/);

  // AND IT DOES NOT CLOSE THE CONTEST. There is no input that makes it.
  const verdict = unresolvedAuthorityKeepsCoverageOpen({
    contestId: "fixture:wy-school-board",
    resolution: wy,
  });
  assert.equal(verdict.coverageState, "OPEN");
  assert.equal(verdict.closesTheContest, false);
  assert.equal(verdict.routingState, "NO_REGIME_ON_RECORD");
  assert.ok(verdict.owedRoutes.length > 0);
  assert.match(verdict.why, /never about a government|not a statement about whether these filings exist/);

  // FEC silence about it is still not closure either, and the resolution it
  // carries is the unread one rather than a federal one.
  const fecSilence = fecAbsenceIsNotClosure({
    contestId: "fixture:wy-school-board",
    jurisdiction: "WY",
    officeLevel: "SCHOOL_DISTRICT",
    county: "Laramie",
  });
  assert.equal(fecSilence.coverageState, "OPEN");
  assert.equal(fecSilence.closesTheContest, false);
  assert.equal(fecSilence.resolution.status, "NO_REGIME_ON_RECORD");
  assert.equal(fecSilence.acquisitionDepth, "NONE");

  // POSITIVE CONTROL: the same call shape on a jurisdiction we HAVE read resolves.
  const az = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    contestId: "ballot-az-pima:prop-423",
    county: "Pima",
  });
  assert.equal(az.status, "RESOLVED");
  assert.equal(az.authority?.id, PIMA_COUNTY_FILING_OFFICER.id);
  assert.notEqual(
    az.status,
    wy.status,
    "if both came back the same, this guard would be reporting green about nothing",
  );

  // And the SECOND unresolved state is distinct from the first: Yavapai has a
  // KNOWN rule and an UNKNOWN office, which is not the same claim as WY's.
  const yavapai = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    contestId: "fixture:yavapai-school-board",
    county: "Yavapai",
  });
  assert.equal(yavapai.status, "OPEN");
  assert.equal(yavapai.authority, null);
  assert.equal(yavapai.custodianRole, "county officer in charge of elections", "the RULE is known");
  assert.equal(yavapai.regimeId, "az:16-928:county-and-districts");
  assert.match(yavapai.why, /Yavapai/);
  assert.notEqual(yavapai.status, wy.status, "'rule known, office unknown' is not 'rule unread'");
});

/* ══ Adding a jurisdiction is a DATA change and nothing else ══════════════ */

test("a NEW jurisdiction routes correctly as a DATA change, with no file under lib/ naming it", () => {
  const registry = loadFixture();

  // The fixture jurisdiction routes, with a level mismatch of a SHAPE Arizona
  // does not have: SCHOOL_DISTRICT -> MUNICIPAL rather than -> COUNTY.
  const resolved = resolveFilingAuthority(
    {
      jurisdiction: "ZZ",
      officeLevel: "SCHOOL_DISTRICT",
      contestId: "fixture:zz-school-board",
      municipality: "FixtureBorough",
    },
    { registry },
  );
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(resolved.authority?.id, "fixture:zz:borough:auditor");
  assert.equal(resolved.officeLevel, "SCHOOL_DISTRICT");
  assert.equal(resolved.authorityLevel, "MUNICIPAL");
  assert.notEqual(resolved.authorityLevel, resolved.officeLevel);
  assert.match(resolved.levelMismatchNote ?? "", /LEVEL MISMATCH/);
  assert.equal(resolved.custodianRole, "borough auditor");
  assert.equal(resolved.publisher?.isVendorPlatform, true);
  assert.deepEqual(resolved.applicableRouteIds, ["FIXTURE_ZZ_AUDITOR_FILINGS"]);

  // An unwalked borough in the SAME fixture jurisdiction is OPEN, not resolved
  // to the one borough we do know — the per-scope rule is data-driven too.
  const otherBorough = resolveFilingAuthority(
    {
      jurisdiction: "ZZ",
      officeLevel: "SCHOOL_DISTRICT",
      contestId: "fixture:zz-other-school-board",
      municipality: "SomeOtherBorough",
    },
    { registry },
  );
  assert.equal(otherBorough.status, "OPEN");
  assert.equal(otherBorough.authority, null);
  assert.match(otherBorough.why, /SomeOtherBorough/);
  assert.equal(otherBorough.openRoutes[0].declaration.routeId, "FIXTURE_ZZ_BOROUGH_DIRECTORY");

  // NO CODE EDIT MADE THAT WORK. No file in the campaign-finance domain names
  // the fixture jurisdiction, its regime, its custodian or its route — the
  // routing came entirely from the record handed in.
  const needles = [
    "fixture:zz:school-district",
    "fixture:zz:borough:auditor",
    "FIXTURE_ZZ_AUDITOR_FILINGS",
    "borough auditor",
  ];
  const files = readdirSync(CAMPAIGN_FINANCE_DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 5, "the domain directory was not read");
  for (const file of files) {
    const text = readFileSync(join(CAMPAIGN_FINANCE_DIR, file), "utf8");
    for (const needle of needles) {
      assert.equal(
        text.includes(needle),
        false,
        `lib/control-plane/campaign-finance/${file} names "${needle}" — then adding this ` +
          "jurisdiction was not a data change after all",
      );
    }
  }

  // And the fixture never leaked into the canonical data file.
  const committed = readFileSync(
    join(ROOT, "data", "states", "az", "campaign-finance", "filing-regimes.json"),
    "utf8",
  );
  assert.equal(committed.includes("TEST FIXTURE"), false, "a fixture reached the canonical registry");
  assert.equal(committed.includes("NOT A REAL STATUTE"), false);
});

test("a sourced nonpilot jurisdiction is published as data and reads no sibling registry", () => {
  const root = mkdtempSync(join(tmpdir(), "filing-regime-state-"));
  try {
    const raw = JSON.parse(JSON.stringify(fixtureRegistryRaw()).replaceAll("ZZ", "TN").replaceAll("zz", "tn"));
    const input = join(root, "sources.jsonl");
    writeFileSync(input, JSON.stringify(raw) + "\n" + JSON.stringify({ jurisdictions: [{ jurisdiction: "AZ" }], formatVersion: -1 }) + "\n");
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/filing-regimes.mts", `--input=${input}`, `--root=${root}`, "--jurisdictions=TN"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TN: 1 sourced filing regimes/);
    const sibling = filingRegimePath("AZ", root);
    mkdirSync(join(root, "data", "states", "az", "campaign-finance"), { recursive: true });
    writeFileSync(sibling, "CORRUPT UNRELATED STATE");
    const registry = filingRegimeRegistry("TN", { root });
    assert.deepEqual(registry.jurisdictions.map(row => row.jurisdiction), ["TN"]);
    const answer = resolveFilingAuthority({ jurisdiction: "TN", officeLevel: "SCHOOL_DISTRICT", contestId: "fixture:tn-school", municipality: "fixtureborough" }, { registry });
    assert.equal(answer.status, "RESOLVED");
    assert.equal(answer.authority?.id, "fixture:tn:borough:auditor");
    assert.match(answer.statutoryQuote!, /FIXTURE QUOTE, NOT A REAL STATUTE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/* ══ B — an ambiguous registry is refused by name, never resolved ═════════ */

test("B two regimes claiming one contest with no supersession is REFUSED, not tie-broken", () => {
  // SEEDED FAILURE: a second rule for the same jurisdiction, same office class,
  // overlapping (here: unbounded) dates, with no supersession link.
  const twin = fixtureRegimeRaw({ regimeId: "fixture:zz:school-district-rival" });
  const codes = refusalCodes(fixtureRegistryRaw({ regimes: [fixtureRegimeRaw(), twin] }));
  assert.ok(
    codes.includes("REGIME_AMBIGUOUS_OVERLAP"),
    `expected REGIME_AMBIGUOUS_OVERLAP, got ${codes.join(", ")}`,
  );

  // The refusal is a NAMED error carrying the codes, not a string.
  assert.throws(
    () => loadFilingRegimeRegistry(fixtureRegistryRaw({ regimes: [fixtureRegimeRaw(), twin] }), "fixture"),
    (error: unknown) => {
      assert.ok(error instanceof FilingRegimeRegistryInvalid);
      assert.ok(error.issues.some((i) => i.code === "REGIME_AMBIGUOUS_OVERLAP"));
      const ambiguity = error.issues.find((i) => i.code === "REGIME_AMBIGUOUS_OVERLAP");
      assert.match(ambiguity?.detail ?? "", /fixture:zz:school-district-rival/);
      assert.match(ambiguity?.whatItPrevents ?? "", /WHICH GOVERNMENT/);
      return true;
    },
  );

  // POSITIVE CONTROL 1: the SAME two records, with a supersession link, load —
  // so the refusal is about ambiguity and not about having two records.
  const older = fixtureRegimeRaw({
    regimeId: "fixture:zz:school-district-2022",
    effective: { from: "2022-01-01", through: "2025-12-31", openQuestion: null },
    supersededBy: "fixture:zz:school-district",
  });
  const newer = fixtureRegimeRaw({
    effective: { from: "2026-01-01", through: null, openQuestion: null },
    supersedes: "fixture:zz:school-district-2022",
  });
  const linked = loadFilingRegimeRegistry(
    fixtureRegistryRaw({ regimes: [older, newer] }),
    FIXTURE_CITATION,
  );
  assert.equal(linked.regimes.length, 2, "BOTH versions stay in the file — neither is dropped");

  // POSITIVE CONTROL 2: one record alone loads.
  assert.equal(loadFixture().regimes.length, 1);
});

/* ══ C — effective periods, and both versions staying traceable ═══════════ */

test("C a regime that applied in 2022 does not route a 2026 contest, and both stay traceable", () => {
  const older = fixtureRegimeRaw({
    regimeId: "fixture:zz:school-district-2022",
    custodianRole: "county sheriff (TEST FIXTURE, superseded rule)",
    effective: { from: "2022-01-01", through: "2025-12-31", openQuestion: null },
    supersededBy: "fixture:zz:school-district",
    custodians: [
      {
        scopeKey: "fixtureborough",
        authority: fixtureAuthority("fixture:zz:old-custodian", "COUNTY", "ZZ:FixtureBorough"),
        publisher: null,
      },
    ],
  });
  const newer = fixtureRegimeRaw({
    effective: { from: "2026-01-01", through: null, openQuestion: null },
    supersedes: "fixture:zz:school-district-2022",
  });
  const registry = loadFilingRegimeRegistry(
    fixtureRegistryRaw({ regimes: [older, newer] }),
    FIXTURE_CITATION,
  );

  const query = {
    jurisdiction: "ZZ",
    officeLevel: "SCHOOL_DISTRICT" as const,
    contestId: "fixture:zz-school-board",
    municipality: "FixtureBorough",
  };

  // SEEDED FAILURE: the repealed rule routing a current contest.
  const in2026 = resolveFilingAuthority(query, { registry, asOf: "2026-11-03" });
  assert.equal(in2026.regimeId, "fixture:zz:school-district");
  assert.equal(in2026.authority?.id, "fixture:zz:borough:auditor");
  assert.equal(in2026.supersedes, "fixture:zz:school-district-2022");

  // AND THE OLDER VERSION IS STILL REACHABLE — the same rule an amendment runs
  // under: a superseded claim is not deleted, it is superseded.
  const in2023 = resolveFilingAuthority(query, { registry, asOf: "2023-06-01" });
  assert.equal(in2023.regimeId, "fixture:zz:school-district-2022");
  assert.equal(in2023.authority?.id, "fixture:zz:old-custodian");
  assert.equal(in2023.supersededBy, "fixture:zz:school-district");
  assert.notEqual(in2023.authority?.id, in2026.authority?.id, "the two periods route differently");

  // With NO asOf, supersession decides — never a guessed today.
  const noDate = resolveFilingAuthority(query, { registry });
  assert.equal(noDate.regimeId, "fixture:zz:school-district");

  // A date BEFORE either rule was in force is not routed by the nearest one.
  const in2019 = resolveFilingAuthority(query, { registry, asOf: "2019-01-01" });
  assert.equal(in2019.status, "NO_REGIME_ON_RECORD");
  assert.equal(in2019.authority, null);
  assert.match(in2019.why, /none is in force on 2019-01-01/);

  // The period predicates themselves, so the selector is not the only witness.
  assert.equal(regimeEffectiveOn(registry.regimes[0], "2023-06-01"), true);
  assert.equal(regimeEffectiveOn(registry.regimes[0], "2026-11-03"), false);
  assert.equal(
    effectivePeriodsOverlap(
      { from: "2022-01-01", through: "2025-12-31", openQuestion: null },
      { from: "2026-01-01", through: null, openQuestion: null },
    ),
    false,
  );
  assert.equal(
    effectivePeriodsOverlap(
      { from: null, through: null, openQuestion: null },
      { from: "2026-01-01", through: null, openQuestion: null },
    ),
    true,
    "two unbounded rules DO overlap — which is why the committed registry may hold only one per class",
  );
});

/* ══ Every other refusal, each with a positive control ════════════════════ */

test("the loader refuses each malformed shape by its own stable code", () => {
  const cases: { name: string; raw: unknown; code: RegistryIssueCode }[] = [
    {
      name: "a later format version read by this reader",
      raw: fixtureRegistryRaw({ formatVersion: FILING_REGIME_FORMAT_VERSION + 1 }),
      code: "REGISTRY_FORMAT_VERSION_UNSUPPORTED",
    },
    {
      name: "no route offered when nothing governs the question",
      raw: fixtureRegistryRaw({ noRegimeRoutes: [] }),
      code: "REGISTRY_NO_UNRESOLVED_ROUTES",
    },
    {
      name: "two regimes sharing an id",
      raw: fixtureRegistryRaw({
        regimes: [
          fixtureRegimeRaw({ effective: { from: "2020-01-01", through: "2021-01-01", openQuestion: null } }),
          fixtureRegimeRaw({ effective: { from: "2022-01-01", through: "2023-01-01", openQuestion: null } }),
        ],
      }),
      code: "REGIME_ID_DUPLICATED",
    },
    {
      name: "a regime whose jurisdiction has no declared row",
      raw: fixtureRegistryRaw({ regimes: [fixtureRegimeRaw({ jurisdiction: "QQ" })] }),
      code: "REGIME_JURISDICTION_NOT_DECLARED",
    },
    {
      name: "an office level outside the governed vocabulary",
      raw: fixtureRegistryRaw({ regimes: [fixtureRegimeRaw({ officeLevels: ["DOGCATCHER"] })] }),
      code: "REGIME_VOCABULARY_UNKNOWN",
    },
    {
      name: "a regime routing no office class at all",
      raw: fixtureRegistryRaw({ regimes: [fixtureRegimeRaw({ officeLevels: [] })] }),
      code: "REGIME_NO_OFFICE_LEVELS",
    },
    {
      name: "a per-municipality regime whose custodian answers for everywhere",
      raw: fixtureRegistryRaw({
        regimes: [
          fixtureRegimeRaw({
            custodians: [
              {
                scopeKey: null,
                authority: fixtureAuthority("fixture:zz:anyone", "MUNICIPAL", "ZZ"),
                publisher: null,
              },
            ],
          }),
        ],
      }),
      code: "REGIME_CUSTODIAN_SCOPE_MISMATCH",
    },
    {
      name: "two custodians claiming one place",
      raw: fixtureRegistryRaw({
        regimes: [
          fixtureRegimeRaw({
            custodians: [
              {
                scopeKey: "fixtureborough",
                authority: fixtureAuthority("fixture:zz:a", "MUNICIPAL", "ZZ"),
                publisher: null,
              },
              {
                scopeKey: "FixtureBorough",
                authority: fixtureAuthority("fixture:zz:b", "MUNICIPAL", "ZZ"),
                publisher: null,
              },
            ],
          }),
        ],
      }),
      code: "REGIME_CUSTODIAN_SCOPE_DUPLICATED",
    },
    {
      name: "an effective window that ends before it starts",
      raw: fixtureRegistryRaw({
        regimes: [
          fixtureRegimeRaw({
            effective: { from: "2026-01-01", through: "2022-01-01", openQuestion: null },
          }),
        ],
      }),
      code: "REGIME_EFFECTIVE_PERIOD_INVERTED",
    },
    {
      name: "a supersession link to a regime that is not in the file",
      raw: fixtureRegistryRaw({ regimes: [fixtureRegimeRaw({ supersedes: "fixture:zz:ghost" })] }),
      code: "REGIME_SUPERSESSION_DANGLING",
    },
    {
      name: "a regime that supersedes itself",
      raw: fixtureRegistryRaw({
        regimes: [fixtureRegimeRaw({ supersededBy: "fixture:zz:school-district" })],
      }),
      code: "REGIME_SUPERSESSION_SELF",
    },
    {
      name: "a regime backed by nothing at all",
      raw: fixtureRegistryRaw({
        regimes: [
          fixtureRegimeRaw({
            provenance: {
              statutoryBasis: null,
              statutoryQuote: null,
              statutorySourceUrl: null,
              statutoryReadOn: null,
              openQuestion: null,
              officialRecord: [],
            },
          }),
        ],
      }),
      code: "REGIME_PROVENANCE_ABSENT",
    },
    {
      name: "a citation with no verbatim quote of the operative sentence",
      raw: fixtureRegistryRaw({
        regimes: [
          fixtureRegimeRaw({
            provenance: {
              statutoryBasis: "FIXTURE PROVISION — NOT A REAL STATUTE",
              statutoryQuote: null,
              statutorySourceUrl: null,
              statutoryReadOn: null,
              openQuestion: null,
              officialRecord: [FIXTURE_CITATION],
            },
          }),
        ],
      }),
      code: "REGIME_PROVENANCE_INCOMPLETE",
    },
    {
      name: "an owed route with no citation",
      raw: fixtureRegistryRaw({
        regimes: [
          fixtureRegimeRaw({
            custodianUnresolvedRoutes: [{ ...fixtureRoute("FIXTURE_X"), citation: "   " }],
          }),
        ],
      }),
      code: "REGIME_ROUTE_INVALID",
    },
    {
      name: "a disposition outside the governed vocabulary",
      raw: fixtureRegistryRaw({
        noRegimeRoutes: [{ ...fixtureRoute("FIXTURE_X"), disposition: "PROBABLY_FINE" }],
      }),
      code: "REGIME_VOCABULARY_UNKNOWN",
    },
    {
      name: "a transport reading invented for an unattempted route",
      raw: fixtureRegistryRaw({
        noRegimeRoutes: [{ ...fixtureRoute("FIXTURE_X"), transport: "PROBABLY_UP" }],
      }),
      code: "REGIME_VOCABULARY_UNKNOWN",
    },
    { name: "a file that is not a registry", raw: [1, 2, 3], code: "REGISTRY_MALFORMED" },
  ];

  for (const c of cases) {
    const codes = refusalCodes(c.raw);
    assert.ok(codes.includes(c.code), `${c.name}: expected ${c.code}, got ${codes.join(", ") || "(none)"}`);
  }

  // POSITIVE CONTROL for the whole battery: the unmutated fixture is ACCEPTED.
  // Without this, a validator that refused everything would pass every case above.
  const { registry, issues } = validateFilingRegimeRegistry(fixtureRegistryRaw(), FIXTURE_CITATION);
  assert.deepEqual(issues, [], "the clean fixture must load — otherwise this battery proves nothing");
  assert.ok(registry);
});

test("selectRegime never falls through, and refuses an in-memory ambiguity rather than guessing", () => {
  const registry = loadFixture();

  // A class the fixture jurisdiction does not route.
  const unrouted = selectRegime(registry, { jurisdiction: "ZZ", officeLevel: "STATEWIDE" });
  assert.equal(unrouted.regime, null, "no nearest-match, no jurisdiction-wide default");
  assert.equal(unrouted.ambiguity, null);
  assert.match(unrouted.why, /fact about this registry/);

  // A federal office files federally wherever it is printed.
  const federal = selectRegime(heldRegistry(), {
    jurisdiction: "AZ",
    officeLevel: "FEDERAL",
  });
  assert.equal(federal.regime?.regimeId, "us:federal:fec");

  // An ambiguity BUILT IN MEMORY — bypassing the loader — is still not guessed.
  const ambiguous = {
    ...registry,
    regimes: [...registry.regimes, { ...registry.regimes[0], regimeId: "fixture:zz:rival" }],
  };
  const selection = selectRegime(ambiguous, { jurisdiction: "ZZ", officeLevel: "SCHOOL_DISTRICT" });
  assert.equal(selection.regime, null);
  assert.equal(selection.ambiguity?.code, "REGIME_AMBIGUOUS_OVERLAP");
  assert.match(selection.why, /nothing is guessed/);

  // POSITIVE CONTROL: the unmutated registry selects exactly one.
  assert.equal(
    selectRegime(registry, { jurisdiction: "ZZ", officeLevel: "SCHOOL_DISTRICT" }).regime?.regimeId,
    "fixture:zz:school-district",
  );
});

/* ══ E — an unresolved authority keeps coverage OPEN ══════════════════════ */

test("E an unresolved filing regime keeps coverage OPEN and blocks every finance feature", () => {
  const universe = ["fixture:e:a", "fixture:e:b"];
  const people = universe.map((id, i) => fixtureCandidate({ candidacyId: id, displayName: `Cand ${i}` }));

  // SEEDED FAILURE: every per-candidate record looks complete, and nobody knows
  // which government holds the filings. Without the contest-level guard this
  // reads COMPLETE_AS_OF and renders money sourced to an unidentified custodian.
  const unresolved = coverageFixture({
    contestId: "fixture:e:unread-jurisdiction",
    filingRegimeState: "NO_REGIME_ON_RECORD",
    filingRegimeId: null,
    candidateUniverse: universe,
    perCandidate: people,
  });

  const verdict = evaluateCoverage(unresolved, AS_OF);
  assert.notEqual(verdict.status, "COMPLETE_AS_OF", "an unread rule may never reach completeness");
  assert.equal(verdict.completeAsOf, null);
  const regimeGap = verdict.gaps.find((g) => g.kind === "FILING_REGIME_UNRESOLVED");
  assert.ok(regimeGap, "the contest-level routing gap must be NAMED");
  assert.equal(regimeGap.subject, "fixture:e:unread-jurisdiction");
  assert.match(regimeGap.nextMove, /filing-regimes\.json/);

  const eligibility = candidateFinanceFeatureEligibility(unresolved);
  assert.equal(eligibility.eligible, false, "features fail closed at the contest level");
  assert.match(eligibility.blockedBy.join(" "), /NO_REGIME_ON_RECORD/);

  // The 'rule known, office unknown' state blocks too — a KNOWN rule is not a
  // known custodian, and the money is filed with an office, not with a statute.
  const ruleKnown = candidateFinanceFeatureEligibility(
    coverageFixture({
      contestId: "fixture:e:rule-known",
      filingRegimeState: "OPEN",
      filingRegimeId: "az:16-928:county-and-districts",
      candidateUniverse: universe,
      perCandidate: people,
    }),
  );
  assert.equal(ruleKnown.eligible, false);
  assert.match(ruleKnown.blockedBy.join(" "), /az:16-928:county-and-districts/);

  // POSITIVE CONTROL: the SAME candidates under a RESOLVED regime pass. Without
  // this the guard could be refusing everything and look identical.
  const resolved = evaluateCoverage(
    coverageFixture({
      contestId: "fixture:e:resolved",
      candidateUniverse: universe,
      perCandidate: people,
    }),
    AS_OF,
  );
  assert.equal(resolved.status, "COMPLETE_AS_OF");
  assert.equal(resolved.completeAsOf, AS_OF);
  assert.equal(resolved.featureEligibility.eligible, true);
  assert.equal(resolved.gaps.filter((g) => g.kind === "FILING_REGIME_UNRESOLVED").length, 0);
});

/* ══ D — the peer who is not in the list being swept ══════════════════════ */

test("D a candidate omitted from coverage FAILS symmetry — the check reads the BALLOT", () => {
  const universe = ["fixture:d:incumbent", "fixture:d:challenger"];

  // SEEDED FAILURE: the challenger has no coverage record at all. Every record
  // that IS present is identical, so a self-comparison reports SYMMETRIC.
  const omitted = coverageFixture({
    contestId: "fixture:d:omitted-peer",
    candidateUniverse: universe,
    candidateUniverseSource: "fixture ballot",
    perCandidate: [fixtureCandidate({ candidacyId: "fixture:d:incumbent", displayName: "Incumbent" })],
  });

  const report = symmetryCheck(omitted);
  assert.equal(report.verdict, "FAILURE", "a silently omitted peer is the deepest asymmetry there is");
  assert.equal(report.unexplained.length, 1);
  assert.equal(report.unexplained[0].dimension, "COVERAGE_RECORD_ABSENT");
  assert.equal(report.unexplained[0].shallower, "fixture:d:challenger");
  assert.match(report.unexplained[0].detail, /carries NO finance coverage record/);
  assert.equal(
    report.unexplained[0].explainedBy,
    null,
    "the record that would carry an explanation is the thing that is missing",
  );

  // It also fires when peers ARE present — the omission is found alongside the
  // ordinary dimensions rather than instead of them.
  const three = symmetryCheck(
    coverageFixture({
      contestId: "fixture:d:three-of-four",
      candidateUniverse: [...universe, "fixture:d:third"],
      perCandidate: [
        fixtureCandidate({ candidacyId: "fixture:d:incumbent", displayName: "Incumbent" }),
        fixtureCandidate({ candidacyId: "fixture:d:challenger", displayName: "Challenger" }),
      ],
    }),
  );
  assert.equal(three.verdict, "FAILURE");
  assert.ok(three.findings.some((f) => f.shallower === "fixture:d:third"));

  // POSITIVE CONTROL 1: the same two candidates, both with records, pass.
  const complete = symmetryCheck(
    coverageFixture({
      contestId: "fixture:d:complete",
      candidateUniverse: universe,
      perCandidate: universe.map((id) => fixtureCandidate({ candidacyId: id, displayName: id })),
    }),
  );
  assert.equal(complete.verdict, "SYMMETRIC");

  // POSITIVE CONTROL 2: a genuinely single-candidate contest is still the
  // "absence of the question", not a failure — the old behaviour survives.
  const lonely = symmetryCheck(
    coverageFixture({
      contestId: "fixture:d:one",
      candidateUniverse: ["fixture:d:only"],
      perCandidate: [fixtureCandidate({ candidacyId: "fixture:d:only", displayName: "Only" })],
    }),
  );
  assert.equal(lonely.verdict, "SYMMETRIC");
  assert.match(lonely.why, /absence of the question/);
});

/* ══ No library in this domain reads a clock ══════════════════════════════ */

test("no campaign-finance library file reads the clock", () => {
  const files = readdirSync(CAMPAIGN_FINANCE_DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 5, "the domain directory was not read — this guard would pass vacuously");

  const CLOCK = /\bDate\.now\s*\(|\bnew\s+Date\s*\(/;
  for (const file of files) {
    const text = readFileSync(join(CAMPAIGN_FINANCE_DIR, file), "utf8");
    assert.equal(
      CLOCK.test(text),
      false,
      `lib/control-plane/campaign-finance/${file} reads the clock. An agent does not know today's ` +
        "date, and a library that thinks it does misdates every conclusion built on it — including " +
        "which filing regime was in force.",
    );
  }

  // The instrument shown catching an instance (RULING 110): a planted line in
  // the shape the sweep looks for must be found, or the green above means nothing.
  assert.equal(CLOCK.test("const today = new Date().toISOString();"), true);
  assert.equal(CLOCK.test("const t = Date.now();"), true);
  // And it must not flag prose that merely says the words.
  assert.equal(CLOCK.test(" * Nothing here reads a clock; every date is a parameter."), false);
});

/* ══ levelMismatchNote is generic, not Arizona-shaped ═════════════════════ */

test("levelMismatchNote fires on any jurisdiction's mismatch and stays silent on agreement", () => {
  const arizona = levelMismatchNote(
    "SCHOOL_DISTRICT",
    "COUNTY",
    "The county officer in charge of elections is the filing officer",
    "A.R.S. § 16-928",
  );
  assert.match(arizona ?? "", /LEVEL MISMATCH/);
  assert.match(arizona ?? "", /A\.R\.S\. § 16-928 routes by WHICH ELECTION/);

  // A DIFFERENT shape of mismatch, named by a different provision.
  const fixture = levelMismatchNote(
    "SCHOOL_DISTRICT",
    "MUNICIPAL",
    "FIXTURE QUOTE, NOT A REAL STATUTE",
    "FIXTURE PROVISION",
  );
  assert.match(fixture ?? "", /the filing authority's level is MUNICIPAL/);
  assert.match(fixture ?? "", /FIXTURE PROVISION routes by WHICH ELECTION/);

  // POSITIVE CONTROL: agreement is silent, so the note means something.
  assert.equal(levelMismatchNote("LEGISLATIVE", "STATE", "quote", "basis"), null);
  assert.equal(levelMismatchNote("FEDERAL", "FEDERAL", "quote", null), null);
});
