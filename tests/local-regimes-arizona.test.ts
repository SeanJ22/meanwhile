import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./read-code.ts";
import {
  adaptedSplit,
  completenessCaveat,
  sourcesOf,
  type JurisdictionRegistry,
} from "../lib/hunt/jurisdiction-universe.ts";

/**
 * **ARIZONA'S LOCAL FILING REGIMES — enumerated, scoped, and never collapsed.**
 * (Session C3, lane C, 2026-09-01. RULING 229 item 5d; A.R.S. § 16-928.)
 *
 * ## The sentence these guards exist to make impossible
 *
 * *"Arizona campaign finance is acquired."* It was true of the Secretary of
 * State and of Pima County, and of nothing else — and A.R.S. § 16-928 routes
 * four classes of election to three different filing officers. The state's own
 * bulk table names 109 filing jurisdictions. A corpus covering two of them is
 * not a small corpus; it is a corpus whose denominator nobody stated.
 *
 * ## And the scope distinction, which is the other half
 *
 * A route that belongs to Pima County is Pima-specific. A route that belongs to
 * the Arizona Secretary of State is statewide. Recording either as the other is
 * how a county portal comes to be cited as a state's coverage, so the tests
 * below check the SCOPE FIELD against the URL rather than trusting the naming.
 */

const REGISTRY = join(ROOT, "data", "jurisdictions", "az.json");

function registry(): JurisdictionRegistry {
  return JSON.parse(readFileSync(REGISTRY, "utf8")) as JurisdictionRegistry;
}

/** A.R.S. § 16-928 routes county, school district, community college district
 *  and special taxing district elections to the county officer. */
const COUNTY_ROUTED = new Set([
  "COUNTY",
  "SCHOOL_DISTRICT",
  "DEPENDENT_SCHOOL_SYSTEM",
  "COMMUNITY_COLLEGE_DISTRICT",
  "SPECIAL_DISTRICT",
]);

const PIMA_URL = "https://pimacountyaz.easyvotecampaignfinance.com/home/publicfilings";
const STATEWIDE_HOSTS = ["seethemoney.az.gov", "ftp.azsos.gov", "azsos.gov"];

test("every Arizona county is enumerated — all 15, by name", () => {
  const reg = registry();
  const counties = reg.jurisdictions.filter((j) => j.govClass === "COUNTY");
  assert.equal(
    counties.length,
    15,
    `${counties.length} Arizona counties enumerated. The Secretary of State's own Counties.txt lists ` +
      "15, and a count that disagrees with the state's own table is a failed enumeration rather than a " +
      "smaller Arizona.",
  );
  /* The routing rule is known for all fifteen even where the OFFICE is not
     named — that is the difference between an unresolved custodian and an
     unknown jurisdiction, and only the first is an acceptable state. */
  for (const c of counties) {
    const cf = sourcesOf(reg, c).filter((s) => s.recordClass === "CAMPAIGN_FINANCE");
    assert.ok(
      cf.some((s) => /16-928/.test(s.authorityBasis)),
      `${c.name} carries no campaign-finance source citing A.R.S. § 16-928. The statute routes county ` +
        "elections to the county officer in charge of elections whether or not we have named that office.",
    );
  }
});

test("every class A.R.S. § 16-928 names is enumerated, or its absence is RECORDED", () => {
  const reg = registry();
  for (const cls of ["COUNTY", "CITY_OR_TOWN", "SCHOOL_DISTRICT", "SPECIAL_DISTRICT"]) {
    assert.ok(
      (reg.counts[cls] ?? 0) > 0,
      `no Arizona ${cls} is enumerated. § 16-928 names this class of election, so a zero here is a ` +
        "failed enumeration and never a state without them.",
    );
  }
  /*
   * Community college districts are the one class the statute names and no
   * committed enumeration holds. That MUST be a recorded disagreement rather
   * than a silent zero: a class nobody counted and a class that does not exist
   * are different facts, and only one of them is about Arizona.
   */
  assert.ok(
    reg.disagreements.some((d) => /community college/i.test(d.about)),
    "Arizona community college districts are absent from the registry and the absence is not RECORDED. " +
      "A.R.S. § 16-928 names them as a routed class; a silent zero would read as a finding about the state.",
  );
});

test("the two enumeration authorities DISAGREE about city/town counts, and the disagreement stands", () => {
  const reg = registry();
  const d = reg.disagreements.find((x) => /city\/town/i.test(x.about));
  assert.ok(d, "the AZ SOS's 93 filing jurisdictions and the Census's municipal count are not compared");
  const counts = d.counts.map((c) => c.count).sort();
  assert.notDeepEqual(
    counts,
    [counts[0], counts[0]],
    "the two authorities are recorded as agreeing. They do not: a CAMPAIGN-FINANCE FILING jurisdiction " +
      "is not a Census MUNICIPAL government, and a reconciliation that made them equal invented one.",
  );
  assert.ok(
    d.whyItIsNotReconciledHere.trim().length > 60,
    "a recorded disagreement with no stated reason is a number nobody can act on",
  );
});

test("A PIMA ROUTE IS NEVER AN ARIZONA ROUTE — scope is checked against the URL", () => {
  const reg = registry();
  for (const [key, s] of Object.entries(reg.sourceCatalog)) {
    if (s.url === PIMA_URL) {
      assert.notEqual(
        s.scope,
        "STATEWIDE",
        `source \`${key}\` points at Pima County's EasyVote tenant and claims STATEWIDE scope. A route ` +
          "that belongs to one county is never a fact about the state.",
      );
    }
    if (s.url && STATEWIDE_HOSTS.some((h) => s.url!.includes(h))) {
      assert.equal(
        s.scope,
        "STATEWIDE",
        `source \`${key}\` points at ${s.url} — an Arizona Secretary of State host — and is scoped ` +
          `${s.scope}. Filing a statewide route under one jurisdiction hides the other 687.`,
      );
    }
  }
});

test("the Pima county route reaches only Pima County and the districts § 16-928 routes through it", () => {
  const reg = registry();
  const offenders: string[] = [];
  for (const j of reg.jurisdictions) {
    const usesPima = sourcesOf(reg, j).some((s) => s.url === PIMA_URL);
    if (!usesPima) continue;
    const inPima = (j.countyName ?? "").toUpperCase() === "PIMA";
    const routed = COUNTY_ROUTED.has(j.govClass);
    if (!inPima || !routed) offenders.push(`${j.id} (${j.govClass}, county ${j.countyName ?? "none"})`);
  }
  assert.deepEqual(
    offenders,
    [],
    "these governments carry Pima County's filings route and are not Pima County governments whose " +
      `elections § 16-928 routes to the county officer: ${offenders.join(", ")}`,
  );
});

test("a source that cannot be opened says what is OWED, in the imperative", () => {
  const reg = registry();
  const silent: string[] = [];
  for (const [key, s] of Object.entries(reg.sourceCatalog)) {
    if (s.state === "ADAPTED") continue;
    if (!s.owed || s.owed.trim().length < 30 || /^(tbd|todo|unknown|n\/a)/i.test(s.owed.trim())) {
      silent.push(key);
    }
  }
  assert.deepEqual(
    silent,
    [],
    "these sources cannot be opened and state no next move. RULING 205: having run out of KNOWN " +
      `methods is not having run out of methods, and a gap with no next move is where that stops: ${silent.join(", ")}`,
  );
});

test("every enumerated government carries a citation and at least one source", () => {
  const reg = registry();
  const enumerationIds = new Set(reg.enumerationSources.map((e) => e.id));
  for (const j of reg.jurisdictions) {
    assert.ok(
      enumerationIds.has(j.enumeratedFrom),
      `${j.id} cites enumeration source \`${j.enumeratedFrom}\`, which the registry does not list. A row ` +
        "whose provenance does not resolve is a row nobody can check.",
    );
    assert.ok(sourcesOf(reg, j).length > 0, `${j.id} carries no source at all — not even a discovery obligation`);
  }
});

test("the registry REFUSES to be read as complete, and reports both adapted numbers", () => {
  const reg = registry();
  const split = adaptedSplit(reg);
  assert.ok(split.enumerated > 600, `only ${split.enumerated} Arizona governments enumerated`);
  assert.ok(
    split.notYetLocallyAdapted > 0,
    "the registry claims every Arizona government is adapted at local scope. If that ever becomes true " +
      "it is a finding worth arguing for, not a state to arrive at silently.",
  );
  assert.ok(
    split.locallyAdapted <= split.adapted,
    "more governments are adapted at LOCAL scope than by any route at all, which is arithmetically " +
      "impossible and means one of the two counts is measuring something else",
  );
  assert.match(
    completenessCaveat(reg),
    /never absent from the state/,
    "the registry's own caveat no longer says that absence from this file is a fact about the file",
  );
});
