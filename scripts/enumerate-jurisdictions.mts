/**
 * `pnpm jurisdictions:enumerate` — **NAME EVERY LOCAL GOVERNMENT THAT CAN HOLD
 * AN ELECTION, BEFORE A READER NEEDS ONE.**
 * (Session C3, lane C, 2026-09-01. RULING 229, RULING 205, RULING 207.)
 *
 * Writes `data/jurisdictions/<state>.json`. **A GENERATED ARTIFACT** (RULING 92):
 * never hand-edited, and fixing this generator is not finished until the output
 * is regenerated and diffed (RULING 102).
 *
 * ## The defect, measured
 *
 * `data/campaign-finance/filing-regimes.json` routes Arizona correctly and knows
 * exactly TWO custodians by name: the Secretary of State, and Pima County. The
 * Arizona SOS's own bulk drop names **109 filing jurisdictions**. The 2022
 * Census of Governments names **675 Arizona governments**. Every one of those
 * that is not the SOS or Pima County was, until this file existed, not an open
 * obligation, not a debt row, not a denominator and not a name — it was
 * invisible, which is how a two-custodian corpus comes to be described as
 * "Arizona".
 *
 * ## THE SCOPE DISTINCTION IS THE POINT, and it is data
 *
 * `ftp://ftp.azsos.gov/cfsdata2/` is an ARIZONA route and belongs to all 675
 * rows. `https://pimacountyaz.easyvotecampaignfinance.com/...` is a PIMA route
 * and belongs to Pima County and to the districts A.R.S. § 16-928 routes
 * through the Pima County officer — and to nothing else. Every source row
 * carries `scope`, so the difference is checkable rather than conventional.
 *
 * ## Where the routing comes from
 *
 * A.R.S. § 16-928, read from `https://www.azleg.gov/ars/16/00928.htm` on
 * 2026-08-26 and quoted VERBATIM in
 * `data/campaign-finance/filing-regimes.json`. Nothing here paraphrases it: a
 * paraphrase of a routing rule is a different routing rule.
 *
 * New Hampshire and New Jersey get the same treatment from the same Census
 * enumeration, with their own statutes cited where this repository has read
 * them and an explicit OPEN QUESTION where it has not. A statute nobody read is
 * recorded as unread; a plausible citation typed from memory would be a
 * fabrication in the one field whose whole job is being checkable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COVERED_STATES } from "../lib/coverage/states.ts";
import { readRecords } from "../lib/reference/index.ts";
import type {
  Jurisdiction,
  JurisdictionClass,
  JurisdictionRegistry,
  JurisdictionSource,
  EnumerationDisagreement,
} from "../lib/hunt/jurisdiction-universe.ts";
import { adaptedSplit, completenessCaveat } from "../lib/hunt/jurisdiction-universe.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "data", "jurisdictions");
const GENERATOR = "scripts/enumerate-jurisdictions.mts";
const AS_OF = today();

/* ------------------------------------------------------------- the sources */

const CENSUS_CITATION =
  "data/reference/census_govt_units_2022.csv — U.S. Census Bureau, 2022 Census of Governments: " +
  "Organization — Governments Integrated Directory (staged 2026-08-19, sha256 recorded in the .md note)";
const DEP_CITATION =
  "data/reference/census_govt_units_2022_dependent_school_systems.csv — the same directory's " +
  "DEPENDENT school systems sheet: school operations run as an agency of another government";
const AZ_FILING_JURISDICTIONS_PATH = join(
  ROOT,
  "tests",
  "fixtures",
  "campaign-finance",
  "azsos-cfsdata2-Jurisdictions.txt",
);
const AZ_FILING_CITATION =
  "tests/fixtures/campaign-finance/azsos-cfsdata2-Jurisdictions.txt — the Arizona Secretary of " +
  "State's OWN filing-jurisdiction table, retrieved from ftp://ftp.azsos.gov/cfsdata2/ (FTP RETR 226, " +
  "2026-08-29, recorded in data/campaign-finance/az-pima-2026-held.json)";
const ARS_16_928 =
  "A.R.S. § 16-928, read 2026-08-26 from https://www.azleg.gov/ars/16/00928.htm and quoted verbatim " +
  "in data/campaign-finance/filing-regimes.json";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

/* --------------------------------------------------- the Census enumeration */

interface CensusUnit {
  readonly name: string;
  readonly govType: string;
  readonly county: string;
  readonly web: string;
  readonly pid: string;
  readonly active: boolean;
}

function censusUnits(stateCode: string): CensusUnit[] {
  return readRecords("census_govt_units_2022")
    .filter((r) => r.state === stateCode)
    .map((r) => ({
      name: r.unit_name,
      govType: r.gov_type,
      county: r.county_area_name || "",
      web: r.web_address || "",
      pid: r.census_id_pid6,
      active: r.is_active !== "N",
    }));
}

function dependentSchoolSystems(stateCode: string): CensusUnit[] {
  return readRecords("census_govt_units_2022_dependent_school_systems")
    .filter((r) => r.state === stateCode)
    .map((r) => ({
      name: r.unit_name,
      govType: "DEPENDENT SCHOOL SYSTEM",
      county: r.county_area_name || "",
      web: r.web_address || "",
      pid: r.census_id_pid6,
      active: r.is_active !== "N",
    }));
}

const CLASS_OF: Readonly<Record<string, JurisdictionClass>> = {
  COUNTY: "COUNTY",
  MUNICIPAL: "CITY_OR_TOWN",
  TOWNSHIP: "CITY_OR_TOWN",
  "SCHOOL DISTRICT": "SCHOOL_DISTRICT",
  "SPECIAL DISTRICT": "SPECIAL_DISTRICT",
  "DEPENDENT SCHOOL SYSTEM": "DEPENDENT_SCHOOL_SYSTEM",
};

const PREFIX_OF: Readonly<Record<JurisdictionClass, string>> = {
  STATE: "state",
  COUNTY: "county",
  CITY_OR_TOWN: "city",
  SCHOOL_DISTRICT: "school",
  DEPENDENT_SCHOOL_SYSTEM: "depschool",
  COMMUNITY_COLLEGE_DISTRICT: "cc",
  SPECIAL_DISTRICT: "special",
};

/**
 * The government's OWN published address, where the Census recorded one.
 *
 * This is a DISCOVERY source, never an adapted one: an address is not an
 * adapter, and calling a URL "acquired" is the `URL != RECORD` error with a
 * different noun. What it buys is that the discovery obligation has an ADDRESS
 * rather than only a name, which is the difference between a next move and a
 * research project.
 */
const OWN_SITE_SOURCE: JurisdictionSource = {
  recordClass: "MEETINGS",
  authority: "this government itself",
  authorityBasis: "the government's own published web address, as the Census of Governments recorded it",
  scope: "THIS_JURISDICTION",
  routeId: null,
  /* The address is per-government and lives on the jurisdiction row as
     `ownWebAddress`. Repeating it here would put one URL in two places, and the
     two would disagree the first time either was corrected. */
  url: null,
  state: "DISCOVERY_OWED",
  owed:
    "walk this row's `ownWebAddress` for the body's own meeting notices, agendas, minutes and " +
    "officeholder roster, under RULING 166's body-own-publication-first order. The address is " +
    "recorded; no adapter in this repository opens it, and an address is not an acquisition.",
  citation: CENSUS_CITATION,
};

function ownSiteSource(unit: CensusUnit): JurisdictionSource | null {
  return unit.web ? OWN_SITE_SOURCE : null;
}

function ownWebAddress(unit: CensusUnit): string | null {
  if (!unit.web) return null;
  return /^https?:\/\//i.test(unit.web) ? unit.web : `http://${unit.web}`;
}

/* -------------------------------------------------------- Arizona, by statute */

/** The 15 counties whose filing officer this repository has NAMED. */
const AZ_COUNTY_ADAPTED = new Map<string, { routeId: string; url: string; citation: string }>([
  [
    "PIMA",
    {
      routeId: "az-pima-easyvote-public-filings",
      url: "https://pimacountyaz.easyvotecampaignfinance.com/home/publicfilings",
      citation:
        "data/campaign-finance/az-pima-2026-held.json — the EasyVote tenant API answered HTTP 200 on " +
        "2026-08-29 with 138 filers and 680 filing records for Pima County",
    },
  ],
]);

/** City/town clerks whose campaign-finance PAGE this repository has walked. */
const AZ_CITY_PAGE = new Map<string, { url: string; citation: string }>([
  [
    "TUCSON",
    {
      url: "https://www.tucsonaz.gov/Departments/Clerks/Campaign-Finance-Information",
      citation: "states/az/sources.md — City of Tucson campaign finance, HTTP 200, walked 2026-08-26",
    },
  ],
]);

function azStatewideFinanceSources(): JurisdictionSource[] {
  return [
    {
      recordClass: "CAMPAIGN_FINANCE",
      authority: "Arizona Secretary of State",
      authorityBasis: `${ARS_16_928} — "The secretary of state is the filing officer for statewide and legislative elections"`,
      scope: "STATEWIDE",
      routeId: "az-sos-seethemoney-datatables",
      url: "https://seethemoney.az.gov/Reporting/GetNEWTableData/",
      state: "ADAPTED",
      owed: null,
      citation:
        "lib/control-plane/scheduler/providers/campaign-finance.ts — registered, walked 2026-08-31, " +
        "recordsTotal 370 for the 2025-2026 cycle at JurisdictionId=0",
    },
    {
      recordClass: "CAMPAIGN_FINANCE",
      authority: "Arizona Secretary of State",
      authorityBasis: `${ARS_16_928}; the state's own Bulk Filing Guide names the drop`,
      scope: "STATEWIDE",
      routeId: "az-sos-cfs-bulk-ftp",
      url: "ftp://ftp.azsos.gov/cfsdata2/",
      state: "REQUIRES_NEW_ADAPTER",
      owed:
        "write an FTP client. The drop is anonymous and live (FTP RETR 226, 2026-08-29) and carries " +
        "8,828 committees and the state's 109 filing jurisdictions. The missing piece is entirely on " +
        "our side, which is a fact about our tooling and never a fact about the record.",
      citation: AZ_FILING_CITATION,
    },
  ];
}

/** The route from the statute's ROLE to a named county office. Owed, and named. */
function azCountyFinanceSource(countyName: string): JurisdictionSource {
  const adapted = AZ_COUNTY_ADAPTED.get(countyName.toUpperCase());
  if (adapted) {
    return {
      recordClass: "CAMPAIGN_FINANCE",
      authority: `${countyName} County officer in charge of elections`,
      authorityBasis: `${ARS_16_928} — "The county officer in charge of elections is the filing officer for county, school district, community college district and special taxing district elections"`,
      scope: "PER_COUNTY",
      routeId: adapted.routeId,
      url: adapted.url,
      state: "ADAPTED",
      owed: null,
      citation: adapted.citation,
    };
  }
  return {
    recordClass: "CAMPAIGN_FINANCE",
    authority: `${countyName} County officer in charge of elections`,
    authorityBasis: `${ARS_16_928} — the ROLE is defined by statute; WHICH ${countyName} County office holds it is not read here, and in Arizona it is not always the recorder`,
    scope: "PER_COUNTY",
    routeId: null,
    url: null,
    state: "DISCOVERY_OWED",
    owed:
      `name the ${countyName} County officer in charge of elections and find that office's ` +
      "campaign-finance publication. The next move is recorded: " +
      "https://azsos.gov/elections/about-elections/county-election-contact-info — HTTP 200, 320,910 B, " +
      "walked 2026-08-26, all 15 counties named.",
    citation:
      "data/campaign-finance/filing-regimes.json — custodianUnresolvedRoutes, AZ_SOS_COUNTY_ELECTION_CONTACTS",
  };
}

function azBallotSource(countyName: string): JurisdictionSource {
  return {
    recordClass: "BALLOT_AND_CANDIDATES",
    authority: `${countyName} County officer in charge of elections`,
    authorityBasis:
      "the county conducts the election and publishes the certified ballot for every contest inside it, " +
      "including the districts A.R.S. § 16-928 routes through the county officer",
    scope: "PER_COUNTY",
    routeId: null,
    url: null,
    state: "DISCOVERY_OWED",
    owed:
      `acquire ${countyName} County's certified candidate and contest list for the applicable cycle. ` +
      "Arizona's statewide contests come from the Secretary of State and are already held; the " +
      "county-and-below contests are the county's own publication and are not.",
    citation:
      "data/ballot/az-pima-2026.json — Pima County's certified list is held; no other Arizona county's is",
  };
}

function arizonaSources(unit: CensusUnit, govClass: JurisdictionClass): JurisdictionSource[] {
  const out: JurisdictionSource[] = [];
  const county = unit.county || "";

  if (govClass === "STATE") {
    out.push(...azStatewideFinanceSources());
    out.push({
      recordClass: "BALLOT_AND_CANDIDATES",
      authority: "Arizona Secretary of State",
      authorityBasis: "the Secretary of State certifies and publishes statewide and legislative candidate lists",
      scope: "STATEWIDE",
      routeId: "az-sos-candidate-filings",
      /*
       * THE URL THIS ROW USED TO CARRY —
       * `azsos.gov/elections/results-data/candidate-filings` — ANSWERED HTTP 404
       * ON 2026-09-01. The document it was supposed to lead to answers 200.
       * That is RULING 206 in one line: the record is the Secretary's filing
       * list, never the navigation path that served it, and a dead landing page
       * is not a lost record.
       */
      url: "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
      state: "ADAPTED",
      owed:
        "ACQUIRED 2026-09-01 as a corpus at data/candidates/az-2026-sos-candidate-filings.json — 266 " +
        "candidacies across 76 contests, the Secretary's complete applicable universe for the offices " +
        "he is the filing officer for (federal congressional, statewide executive, legislative). WHAT " +
        "IS STILL OWED IS A DIFFERENT RECORD, and it is the 15 county rows below: county, municipal, " +
        "school-district and special-district candidacies are filed with the county officer in charge " +
        "of elections and are not on this list. Nor are independent and no-party candidates, write-in " +
        "nominees, or nonpartisan and judicial offices — each an absence from THIS DOCUMENT and never " +
        "from the ballot.",
      citation:
        "data/candidates/az-2026-sos-candidate-filings.json — HTTP 200, 183,097 B, last-modified " +
        "2026-03-31, sha256 a13d2a82f83b52206d3697a840382403b1c3d5cb6c80481e383b42d360669016, read " +
        "2026-09-01. Extracted twice by independent mechanisms, both returning 266 rows; " +
        "`pnpm acquire:az-sos-candidates` re-runs it and tests/az-sos-candidate-filings.test.ts " +
        "reproduces the parse offline from the committed bytes.",
    });
    return out;
  }

  /* Every Arizona government below the state is ALSO a subject of the statewide
     bulk drop, which is what "one route success never collapses the source
     universe" means when it is written as data rather than as a slogan. */
  out.push({
    recordClass: "CAMPAIGN_FINANCE",
    authority: "Arizona Secretary of State (bulk reference tables)",
    authorityBasis: "the state's own Jurisdictions.txt enumerates every filing jurisdiction in Arizona",
    scope: "STATEWIDE",
    routeId: "az-sos-cfs-bulk-ftp",
    url: "ftp://ftp.azsos.gov/cfsdata2/",
    state: "REQUIRES_NEW_ADAPTER",
    owed: "an FTP client. See the state row.",
    citation: AZ_FILING_CITATION,
  });

  if (govClass === "COUNTY") {
    const name = unit.name.replace(/^COUNTY OF /i, "").trim();
    out.push(azCountyFinanceSource(name));
    out.push(azBallotSource(name));
  } else if (govClass === "CITY_OR_TOWN") {
    const page = AZ_CITY_PAGE.get(unit.name.replace(/^(CITY|TOWN) OF /i, "").trim().toUpperCase());
    out.push({
      recordClass: "CAMPAIGN_FINANCE",
      authority: `${unit.name} clerk`,
      authorityBasis: `${ARS_16_928} — "The city or town clerk is the filing officer for city and town elections."`,
      scope: "THIS_JURISDICTION",
      routeId: null,
      url: page?.url ?? null,
      state: "DISCOVERY_OWED",
      owed: page
        ? "extract the FILINGS behind this clerk's page. The page itself is walked (HTTP 200, 2026-08-26); " +
          "whether the filings are served there is not established, and a walked page is not an acquired record."
        : "find this clerk's campaign-finance publication. The routing rule is settled by statute and the " +
          "address is not read here.",
      citation: page?.citation ?? ARS_16_928,
    });
    if (county) out.push(azBallotSource(county));
  } else {
    /* School, community college and special taxing districts all route to the
       COUNTY officer by the same sentence of § 16-928. The district is the
       government; the county officer is the custodian. */
    if (county) {
      out.push(azCountyFinanceSource(county));
      out.push(azBallotSource(county));
    }
  }

  const own = ownSiteSource(unit);
  if (own) out.push(own);
  return out;
}

/* ----------------------------------------- New Hampshire and New Jersey */

const NH_STATUTE =
  "RSA 664:6 and RSA 664:7, named in data/campaign-finance/filing-regimes.json's noRegimeRoutes note as " +
  "ANSWERED for New Hampshire. The statute text itself is NOT read into this repository, so this row " +
  "carries the citation and an explicit open question rather than a quotation it cannot support.";
const NJ_STATUTE =
  "New Jersey's filing officer is recorded as ANSWERED in data/campaign-finance/filing-regimes.json's " +
  "noRegimeRoutes note; the statute text is NOT read into this repository. The operative custodian in " +
  "every route this project has walked is the Election Law Enforcement Commission.";

function newHampshireSources(unit: CensusUnit, govClass: JurisdictionClass): JurisdictionSource[] {
  /*
   * **THE STATEWIDE CFS IS NOT ASSERTED TO COVER LOCAL CANDIDATES.**
   *
   * The New Hampshire CFS filer index is ADAPTED and its acquisition matched the
   * publisher's own declared total, 5,738 of 5,738. What it holds is state and
   * county filers; WHETHER a town, school-district or village-district
   * candidate files with the Secretary of State at all is NOT read into this
   * repository. Marking every one of the state's 551 local governments ADAPTED
   * on the strength of a state API would be exactly the flattering arithmetic
   * this registry exists to prevent — so the local rows carry the state route as
   * DISCOVERY_OWED with the open question stated, and the state row carries it
   * as ADAPTED, which is the only place it is proven.
   */
  const proven = govClass === "STATE" || govClass === "COUNTY";
  const out: JurisdictionSource[] = [
    {
      recordClass: "CAMPAIGN_FINANCE",
      authority: "New Hampshire Secretary of State — Campaign Finance System",
      authorityBasis: NH_STATUTE,
      scope: "STATEWIDE",
      routeId: "nh-cfs-filing-entity-details",
      url: "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails",
      state: proven ? "ADAPTED" : "DISCOVERY_OWED",
      owed: proven
        ? null
        : "establish WHETHER a candidate for this government files with the state CFS, and where they " +
          "file if they do not. The CFS index is acquired in full (5,738 of 5,738 declared) and its rows " +
          "carry office and county; that a local candidacy is absent from it is not evidence that the " +
          "candidacy filed nothing.",
      citation:
        "scripts/state-money-nh.mts — the statewide filer index answers a plain server-side POST; the " +
        "acquisition matched the publisher's own declared total 5,738 of 5,738",
    },
  ];
  if (govClass !== "STATE") {
    out.push({
      recordClass: "BALLOT_AND_CANDIDATES",
      authority:
        govClass === "COUNTY" ? `${unit.name} — county election officials` : `${unit.name} town or city clerk`,
      authorityBasis:
        "New Hampshire conducts elections through town and city clerks under the Secretary of State; " +
        "which office publishes the certified local candidate list is not read here",
      scope: "THIS_JURISDICTION",
      routeId: null,
      url: null,
      state: "DISCOVERY_OWED",
      owed:
        "find this government's certified candidate and contest publication. The state list is held; the " +
        "local list is not.",
      citation: "data/ballot/nh-merrimack-2026.json — one county's certified list is held; no other's is",
    });
  }
  const own = ownSiteSource(unit);
  if (own) out.push(own);
  return out;
}

function newJerseySources(unit: CensusUnit, govClass: JurisdictionClass): JurisdictionSource[] {
  const out: JurisdictionSource[] = [
    {
      recordClass: "CAMPAIGN_FINANCE",
      authority: "New Jersey Election Law Enforcement Commission",
      authorityBasis: NJ_STATUTE,
      scope: "STATEWIDE",
      routeId: "nj-elec-entity-search",
      url: "https://www.njelecefilesearch.com/",
      state: "ADAPTED",
      owed: null,
      citation:
        "lib/hunt/nj-elec.ts and scripts/state-money-nj.mts — elec.nj.gov is Imperva-walled and answers " +
        "HTTP 200 with a challenge page; the records sit one hop away on njelecefilesearch.com at rung 2",
    },
  ];
  if (govClass !== "STATE") {
    out.push({
      recordClass: "BALLOT_AND_CANDIDATES",
      authority:
        govClass === "COUNTY" ? `${unit.name} County Clerk` : `${unit.name} municipal clerk`,
      authorityBasis:
        "New Jersey county clerks certify and publish the ballot for every contest inside the county, " +
        "including municipal and school-board contests",
      scope: govClass === "COUNTY" ? "THIS_JURISDICTION" : "PER_COUNTY",
      routeId: null,
      url: null,
      state: "DISCOVERY_OWED",
      owed:
        "acquire this county clerk's certified candidate and contest list for the applicable cycle. " +
        "Morris County's is held; no other New Jersey county's is.",
      citation: "data/ballot/nj-morris-2026.json",
    });
  }
  const own = ownSiteSource(unit);
  if (own) out.push(own);
  return out;
}

/* ------------------------------------------------------------ the assembly */

/**
 * **THE COVERED-STATE LIST IS DERIVED, NEVER KEPT HERE.**
 *
 * `lib/coverage/states.ts` is the manifest and onboarding a state is an edit
 * there and nowhere else. A second hand-kept list of covered states is exactly
 * what `tests/coverage-manifest.test.ts` exists to catch, and it caught this
 * file on the first run: a fourth state onboarded in the manifest would
 * otherwise have silently had no jurisdiction registry, which reads downstream
 * as a state with no local government.
 *
 * The ROUTING for a state — which statute names its filing officer, which
 * custodians this repository has actually walked — is not derivable from a
 * manifest and stays written down per state below. A covered state with no
 * routing entry is REFUSED at generation time rather than being emitted with a
 * default nobody read.
 */
interface StatePlan {
  readonly code: string;
  readonly name: string;
  readonly sourcesFor: (u: CensusUnit, c: JurisdictionClass) => JurisdictionSource[];
  readonly extraDisagreements: (units: CensusUnit[]) => EnumerationDisagreement[];
  readonly extraEnumerations: () => {
    readonly id: string;
    readonly describe: string;
    readonly path: string;
    readonly rowsRead: number;
  }[];
}

/**
 * Arizona's own filing-jurisdiction table, READ rather than remembered.
 *
 * The generator does not hardcode 109. It reads the state's file and counts it,
 * so a re-pull that changes the number changes this output — which is the whole
 * difference between a denominator and a number in a comment.
 */
function azFilingJurisdictions(): { total: number; byType: Map<string, number> } {
  const text = readFileSync(AZ_FILING_JURISDICTIONS_PATH, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  if (rows.length === 0) {
    throw new Error(
      `${AZ_FILING_JURISDICTIONS_PATH} yielded zero rows. A zero-row extraction is a FAILED extraction, ` +
        "never an empty table, and this generator refuses to publish an Arizona denominator it did not read.",
    );
  }
  const byType = new Map<string, number>();
  for (const r of rows) {
    const t = (r[2] ?? "").trim();
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  return { total: rows.length, byType };
}

const ROUTING: Omit<StatePlan, "code">[] = [
  {
    name: "Arizona",
    sourcesFor: arizonaSources,
    extraEnumerations: () => {
      const f = azFilingJurisdictions();
      return [
        {
          id: "azsos-jurisdictions",
          describe:
            "Arizona Secretary of State, Jurisdictions.txt — the state's OWN campaign-finance filing " +
            `jurisdiction table (${[...f.byType].map(([k, v]) => `${v} ${k}`).join(", ")})`,
          path: "tests/fixtures/campaign-finance/azsos-cfsdata2-Jurisdictions.txt",
          rowsRead: f.total,
        },
      ];
    },
    extraDisagreements: (units) => {
      const f = azFilingJurisdictions();
      const censusMunis = units.filter((u) => u.govType === "MUNICIPAL").length;
      const azCityTown = f.byType.get("City/Town") ?? 0;
      const out: EnumerationDisagreement[] = [
        {
          about: "how many Arizona city/town governments there are",
          counts: [
            { source: "Arizona Secretary of State, Jurisdictions.txt (City/Town filing jurisdictions)", count: azCityTown },
            { source: "2022 Census of Governments (MUNICIPAL units)", count: censusMunis },
          ],
          whyItIsNotReconciledHere:
            "Two authorities counting two slightly different things: a CAMPAIGN-FINANCE FILING " +
            "jurisdiction is not identical to a Census MUNICIPAL government, and the two files were " +
            "produced four years apart. Both are recorded. Silently choosing either number would be " +
            "inventing a denominator, and averaging them would be worse.",
        },
        {
          about: "Arizona community college districts",
          counts: [
            { source: "A.R.S. § 16-928 — names community college district elections as a routed class", count: 1 },
            { source: "2022 Census of Governments — no Arizona unit is classified as one", count: 0 },
          ],
          whyItIsNotReconciledHere:
            "The statute names a class of election this repository holds NO enumeration of. That is an " +
            "OPEN ENUMERATION OBLIGATION, not a finding that Arizona has no community college districts. " +
            "Naming them from memory would be a fabrication in a denominator.",
        },
      ];
      return out;
    },
  },
  {
    name: "New Hampshire",
    sourcesFor: newHampshireSources,
    extraEnumerations: () => [],
    extraDisagreements: () => [],
  },
  {
    name: "New Jersey",
    sourcesFor: newJerseySources,
    extraEnumerations: () => [],
    extraDisagreements: () => [],
  },
];

/**
 * USPS -> the state name the routing entry above is written under.
 *
 * This is the one place this file names a state code, and it is per-state
 * CONTENT rather than a coverage list - the same category as
 * `scripts/fetch-voting-sites.mts` and `lib/funding/state-vocabulary.ts` on
 * `tests/coverage-manifest.test.ts`'s allowlist, and for the same reason: no
 * manifest can generate A.R.S. 16-928, and a state whose filing-officer statute
 * nobody has read must never be defaulted into one.
 *
 * A covered state absent from here throws BY NAME at generation time, which is
 * the behaviour the coverage guard is actually protecting: onboarding a fourth
 * state must not silently produce a state with no local government.
 */
const STATE_NAME: Readonly<Record<string, string>> = {
  AZ: "arizona",
  NH: "new hampshire",
  NJ: "new jersey",
};

function stateNameHint(usps: string): string {
  return STATE_NAME[usps] ?? "__no routing recorded for " + usps;
}

/**
 * The plans, JOINED to the coverage manifest — which is the list, not this file.
 *
 * A covered state with no routing entry is REFUSED here by name. That is the
 * whole value of the join: onboarding a fourth state in
 * `lib/coverage/states.ts` now FAILS this generator with "AK is covered and has
 * no filing-officer routing" instead of quietly producing no registry for it,
 * which downstream would read as a state with no local government.
 */
const PLANS: StatePlan[] = COVERED_STATES.map((s) => {
  const routing = ROUTING.find((r) => r.name.toLowerCase().startsWith(stateNameHint(s.usps)));
  if (!routing) {
    throw new Error(
      `${s.usps} is in lib/coverage/states.ts and this generator holds no filing-officer routing for ` +
        "it. Which statute names the filing officer, and what it routes to whom, is not derivable from " +
        "a coverage manifest and is never defaulted. Add its routing here, with the statute read from " +
        "the legislature's own site.",
    );
  }
  return { ...routing, code: s.usps };
});

function build(plan: StatePlan): JurisdictionRegistry {
  const units = censusUnits(plan.code);
  if (units.length === 0) {
    throw new Error(
      `the Census enumeration yielded ZERO ${plan.code} governments. That is a failed read of ` +
        "data/reference/census_govt_units_2022.csv, never a state with no local government.",
    );
  }
  const dependents = dependentSchoolSystems(plan.code);

  const jurisdictions: Jurisdiction[] = [];
  const seen = new Set<string>();

  /*
   * THE CATALOG, and why the indirection is not premature.
   *
   * One sentence of A.R.S. § 16-928 routes 44 Pima County districts to one
   * county officer. Writing that route out 44 times produced a 2.3 MB file
   * whose every diff would be noise, and — worse — hid the SHARING: a route
   * used by 300 governments should look like one route used by 300 governments.
   * The key is a digest of the route's own content, so two rows that describe
   * the same route collapse and two that differ in one word do not.
   */
  const catalog: Record<string, JurisdictionSource> = {};
  const catalogKey = (s: JurisdictionSource): string => {
    const base = `${s.recordClass}:${s.scope}:${s.routeId ?? slug(s.authority)}`;
    let key = base;
    let n = 1;
    while (catalog[key] && JSON.stringify(catalog[key]) !== JSON.stringify(s)) {
      n += 1;
      key = `${base}#${n}`;
    }
    catalog[key] = s;
    return key;
  };

  const push = (unit: CensusUnit, govClass: JurisdictionClass, enumeratedFrom: string) => {
    let id = `${plan.code.toLowerCase()}:${PREFIX_OF[govClass]}:${slug(unit.name)}`;
    if (seen.has(id)) id = `${id}-${unit.pid}`;
    seen.add(id);
    jurisdictions.push({
      id,
      stateCode: plan.code,
      name: unit.name,
      govClass,
      countyName: unit.county || null,
      enumeratedFrom,
      ownWebAddress: ownWebAddress(unit),
      sourceIds: plan.sourcesFor(unit, govClass).map(catalogKey),
    });
  };

  /* The state itself is a jurisdiction, and it is the one whose routes are
     STATEWIDE. Leaving it out would make "statewide" a property of nothing. */
  push(
    { name: plan.name, govType: "STATE", county: "", web: "", pid: "state", active: true },
    "STATE",
    "the-state-itself",
  );

  for (const u of units) {
    const govClass = CLASS_OF[u.govType];
    if (!govClass) continue;
    push(u, govClass, "census-govt-units-2022");
  }
  for (const u of dependents) push(u, "DEPENDENT_SCHOOL_SYSTEM", "census-dependent-school-systems-2022");

  const counts: Record<string, number> = {};
  for (const j of jurisdictions) counts[j.govClass] = (counts[j.govClass] ?? 0) + 1;

  return {
    formatVersion: 1,
    stateCode: plan.code,
    generatedBy: GENERATOR,
    generatedOn: AS_OF,
    _note: [
      "GENERATED ARTIFACT — never hand-edited (RULING 92). Regenerate with `pnpm jurisdictions:enumerate`.",
      "",
      "THIS IS WHAT THE PROJECT KNOWS NOW. It is never a complete list of this state's governments, and",
      "it may never be read as one. A government absent from every enumeration read here is absent from",
      "THIS FILE. That is a fact about this file and never a fact about the state.",
      "",
      "RULING 229: a jurisdiction is enumerated so that it can be an OPEN OBLIGATION with a clock BEFORE",
      "a reader needs it. Activating a ZIP inside one of these governments must be applicability work,",
      "never a fresh external hunt for a record the authority already owed.",
      "",
      "SCOPE IS DATA, NOT A NAMING CONVENTION. `scope: STATEWIDE` means the route answers for the whole",
      "state and this row is one of its subjects. `PER_COUNTY` means the route belongs to the county this",
      "row sits in. `THIS_JURISDICTION` means it belongs to this government and to no other. A route that",
      "belongs to Pima County is never presented as an Arizona route.",
      "",
      "`state: ADAPTED` means this repository can OPEN the route today. `DISCOVERY_OWED` means the",
      "authority is known and the address or the extraction is not. `REQUIRES_NEW_ADAPTER` means the",
      "address is known and this process holds no client for it — a fact about our tooling, never about",
      "the record.",
    ],
    enumerationSources: [
      {
        id: "the-state-itself",
        describe:
          "the state itself — the authority every STATEWIDE route in this file belongs to. Leaving it " +
          "out would make `scope: STATEWIDE` a property of nothing.",
        path: "(not an external enumeration)",
        rowsRead: 1,
      },
      {
        id: "census-govt-units-2022",
        describe: "U.S. Census Bureau, 2022 Census of Governments: Organization",
        path: "data/reference/census_govt_units_2022.csv",
        rowsRead: units.length,
      },
      {
        id: "census-dependent-school-systems-2022",
        describe: "the same directory's DEPENDENT school systems sheet",
        path: "data/reference/census_govt_units_2022_dependent_school_systems.csv",
        rowsRead: dependents.length,
      },
      ...plan.extraEnumerations(),
    ],
    counts,
    disagreements: plan.extraDisagreements(units),
    sourceCatalog: catalog,
    jurisdictions,
  };
}

/* ------------------------------------------------------------------- main */

const DRY = process.argv.includes("--dry");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log(`jurisdictions:enumerate · as of ${AS_OF}\n`);
for (const plan of PLANS) {
  const registry = build(plan);
  const split = adaptedSplit(registry);
  const empty =
    `the ${plan.code} enumeration yielded no government at all — a failed read of the Census directory, ` +
    "never a state without local government";
  console.log(
    `  ${floorLine(
      floored(
        `${plan.code} jurisdictions reachable by SOME adapted route`,
        `every ${plan.code} government this project has enumerated`,
        split.enumerated,
        split.adapted,
        empty,
      ),
    )}`,
  );
  console.log(
    `  ${floorLine(
      floored(
        `${plan.code} jurisdictions adapted at LOCAL scope`,
        `every ${plan.code} government this project has enumerated`,
        split.enumerated,
        split.locallyAdapted,
        empty,
      ),
    )}`,
  );
  console.log(`      ${completenessCaveat(registry)}`);
  for (const [k, v] of Object.entries(registry.counts).sort()) {
    console.log(`      ${k.padEnd(28)} ${v}`);
  }
  for (const d of registry.disagreements) {
    console.log(`      DISAGREEMENT — ${d.about}: ${d.counts.map((c) => `${c.count} (${c.source})`).join(" vs ")}`);
  }
  const out = join(OUT_DIR, `${plan.code.toLowerCase()}.json`);
  if (DRY) {
    console.log(`      --dry: nothing written. Would write ${out}`);
  } else {
    writeFileSync(out, `${JSON.stringify(registry, null, 1)}\n`, "utf8");
    console.log(`      wrote ${out}`);
  }
  console.log("");
}
