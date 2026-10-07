/** Fixture registries use jurisdiction `ZZ` and `fixture:` ids; a test below checks none of them reached the committed data file. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  FEC_AUTHORITY,
  PIMA_COUNTY_FILING_OFFICER,
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
  validateFilingRegimeRegistry,
  type RegistryIssueCode,
} from "../lib/control-plane/campaign-finance/filing-regime.ts";
import { METHOD_FIXTURE_PATH } from "./method-store-fixture.ts";

const ROOT = resolve(import.meta.dirname, "..");
const CAMPAIGN_FINANCE_DIR = join(ROOT, "lib", "control-plane", "campaign-finance");


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


test("the committed registry loads, and every regime carries provenance that exists on disk", () => {
  const registry = filingRegimeRegistry();

  assert.equal(registry.formatVersion, FILING_REGIME_FORMAT_VERSION);
  assert.deepEqual(
    registry.jurisdictions.map((j) => j.jurisdiction).sort(),
    ["AZ", "US"],
    "the registry is what this project knows NOW — two jurisdictions, and the file says so itself",
  );
  assert.equal(registry.regimes.length, 4, "one federal regime and A.R.S. § 16-928's three branches");
  assert.ok(registry.noRegimeRoutes.length > 0, "an unread jurisdiction must always have a next move");

  const note = registry.note.join(" ");
  assert.match(note, /CANONICAL DATA/);
  assert.match(note, /NEVER a complete list/);
  assert.match(note, /WHAT THIS PROJECT KNOWS NOW|IT IS WHAT THIS PROJECT KNOWS NOW/);

  const azSources = readFileSync(join(ROOT, "states", "az", "sources.md"), "utf8");
  for (const regime of registry.regimes) {
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
      assert.ok(
        regime.provenance.officialRecord.length > 0,
        `${regime.regimeId} has neither a quote nor an official record`,
      );
      assert.ok(
        regime.provenance.openQuestion !== null,
        `${regime.regimeId} has no quoted statute and does not say that the statute is owed`,
      );
    }

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
  const registry = filingRegimeRegistry();
  const knowledge = JSON.parse(
    readFileSync(METHOD_FIXTURE_PATH, "utf8"),
  ) as { routes: { identity?: { id?: string }; id?: string }[] };
  const known = new Set(knowledge.routes.map((r) => r.identity?.id ?? r.id));

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
  const registry = filingRegimeRegistry();
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

  const pima = county.custodians.find((c) => c.scopeKey === "pima");
  assert.ok(pima);
  assert.equal(pima.authority.id, PIMA_COUNTY_FILING_OFFICER.id);
  assert.equal(pima.publisher?.isVendorPlatform, true);
  assert.match(pima.publisher?.name ?? "", /EasyVote/);
});


test("A a jurisdiction with no regime resolves NO_REGIME_ON_RECORD — not FEC, not closed", () => {
  // NOT VACUOUS: Wyoming really is absent from the committed registry. If it
  // were ever added, this test would be asserting NO_REGIME_ON_RECORD about a
  // jurisdiction that has one, and would need a different unread jurisdiction.
  const registry = filingRegimeRegistry();
  assert.equal(
    registry.jurisdictions.some((j) => j.jurisdiction === "WY"),
    false,
    "WY is now in the registry — pick another unread jurisdiction for this guard",
  );

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

  const verdict = unresolvedAuthorityKeepsCoverageOpen({
    contestId: "fixture:wy-school-board",
    resolution: wy,
  });
  assert.equal(verdict.coverageState, "OPEN");
  assert.equal(verdict.closesTheContest, false);
  assert.equal(verdict.routingState, "NO_REGIME_ON_RECORD");
  assert.ok(verdict.owedRoutes.length > 0);
  assert.match(verdict.why, /never about a government|not a statement about whether these filings exist/);

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


test("a NEW jurisdiction routes correctly as a DATA change, with no file under lib/ naming it", () => {
  const registry = loadFixture();

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

  const committed = readFileSync(
    join(ROOT, "data", "campaign-finance", "filing-regimes.json"),
    "utf8",
  );
  assert.equal(committed.includes("TEST FIXTURE"), false, "a fixture reached the canonical registry");
  assert.equal(committed.includes("NOT A REAL STATUTE"), false);
});


test("B two regimes claiming one contest with no supersession is REFUSED, not tie-broken", () => {
  const twin = fixtureRegimeRaw({ regimeId: "fixture:zz:school-district-rival" });
  const codes = refusalCodes(fixtureRegistryRaw({ regimes: [fixtureRegimeRaw(), twin] }));
  assert.ok(
    codes.includes("REGIME_AMBIGUOUS_OVERLAP"),
    `expected REGIME_AMBIGUOUS_OVERLAP, got ${codes.join(", ")}`,
  );

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

  assert.equal(loadFixture().regimes.length, 1);
});


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

  const in2026 = resolveFilingAuthority(query, { registry, asOf: "2026-11-03" });
  assert.equal(in2026.regimeId, "fixture:zz:school-district");
  assert.equal(in2026.authority?.id, "fixture:zz:borough:auditor");
  assert.equal(in2026.supersedes, "fixture:zz:school-district-2022");

  const in2023 = resolveFilingAuthority(query, { registry, asOf: "2023-06-01" });
  assert.equal(in2023.regimeId, "fixture:zz:school-district-2022");
  assert.equal(in2023.authority?.id, "fixture:zz:old-custodian");
  assert.equal(in2023.supersededBy, "fixture:zz:school-district");
  assert.notEqual(in2023.authority?.id, in2026.authority?.id, "the two periods route differently");

  const noDate = resolveFilingAuthority(query, { registry });
  assert.equal(noDate.regimeId, "fixture:zz:school-district");

  const in2019 = resolveFilingAuthority(query, { registry, asOf: "2019-01-01" });
  assert.equal(in2019.status, "NO_REGIME_ON_RECORD");
  assert.equal(in2019.authority, null);
  assert.match(in2019.why, /none is in force on 2019-01-01/);

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

  const { registry, issues } = validateFilingRegimeRegistry(fixtureRegistryRaw(), FIXTURE_CITATION);
  assert.deepEqual(issues, [], "the clean fixture must load — otherwise this battery proves nothing");
  assert.ok(registry);
});

test("selectRegime never falls through, and refuses an in-memory ambiguity rather than guessing", () => {
  const registry = loadFixture();

  const unrouted = selectRegime(registry, { jurisdiction: "ZZ", officeLevel: "STATEWIDE" });
  assert.equal(unrouted.regime, null, "no nearest-match, no jurisdiction-wide default");
  assert.equal(unrouted.ambiguity, null);
  assert.match(unrouted.why, /fact about this registry/);

  const federal = selectRegime(filingRegimeRegistry(), {
    jurisdiction: "AZ",
    officeLevel: "FEDERAL",
  });
  assert.equal(federal.regime?.regimeId, "us:federal:fec");

  const ambiguous = {
    ...registry,
    regimes: [...registry.regimes, { ...registry.regimes[0], regimeId: "fixture:zz:rival" }],
  };
  const selection = selectRegime(ambiguous, { jurisdiction: "ZZ", officeLevel: "SCHOOL_DISTRICT" });
  assert.equal(selection.regime, null);
  assert.equal(selection.ambiguity?.code, "REGIME_AMBIGUOUS_OVERLAP");
  assert.match(selection.why, /nothing is guessed/);

  assert.equal(
    selectRegime(registry, { jurisdiction: "ZZ", officeLevel: "SCHOOL_DISTRICT" }).regime?.regimeId,
    "fixture:zz:school-district",
  );
});


test("levelMismatchNote fires on any jurisdiction's mismatch and stays silent on agreement", () => {
  const arizona = levelMismatchNote(
    "SCHOOL_DISTRICT",
    "COUNTY",
    "The county officer in charge of elections is the filing officer",
    "A.R.S. § 16-928",
  );
  assert.match(arizona ?? "", /LEVEL MISMATCH/);
  assert.match(arizona ?? "", /A\.R\.S\. § 16-928 routes by WHICH ELECTION/);

  const fixture = levelMismatchNote(
    "SCHOOL_DISTRICT",
    "MUNICIPAL",
    "FIXTURE QUOTE, NOT A REAL STATUTE",
    "FIXTURE PROVISION",
  );
  assert.match(fixture ?? "", /the filing authority's level is MUNICIPAL/);
  assert.match(fixture ?? "", /FIXTURE PROVISION routes by WHICH ELECTION/);

  assert.equal(levelMismatchNote("LEGISLATIVE", "STATE", "quote", "basis"), null);
  assert.equal(levelMismatchNote("FEDERAL", "FEDERAL", "quote", null), null);
});
