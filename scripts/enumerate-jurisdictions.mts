/**
 * `pnpm jurisdictions:enumerate` — every local government that can hold an
 * election, named before a reader needs one, with the routes that serve it.
 *
 * Builds the reviewed jurisdiction-routing projection from the Census of
 * Governments and submits it to the production candidate/event/promotion
 * plane. It never writes a tracked repository file.
 *
 * Every source row carries `scope` (STATEWIDE, PER_COUNTY, THIS_JURISDICTION),
 * so a county's route is never presented as a state's. Statutes are cited where
 * read and quoted verbatim in `data/campaign-finance/filing-regimes.json`; an
 * unread statute is recorded as an open question, never paraphrased.
 */
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { NAME_BY_USPS } from "../lib/coverage/artifacts.ts";
import type {
  Jurisdiction,
  JurisdictionClass,
  JurisdictionRegistry,
  JurisdictionSource,
  EnumerationDisagreement,
} from "../lib/hunt/jurisdiction-universe.ts";
import { adaptedSplit, completenessCaveat } from "../lib/hunt/jurisdiction-universe.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import {
  JURISDICTION_REFERENCE_STATES,
  jurisdictionOperationalReferenceCandidate,
  jurisdictionOperationalReferenceFailureCandidate,
  type JurisdictionReferenceState,
} from "../lib/civic-data/operational-references.ts";
import {
  acquireJurisdictionReferenceInputs,
  AZ_BULK_FILING_GUIDE_URL,
  CENSUS_GOVERNMENT_UNITS_URL,
  type CensusJurisdictionUnitInput,
  type JurisdictionReferenceAcquisitionFailure,
} from "../lib/civic-data/jurisdiction-reference-acquisition.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { acquireWebsiteCorrections, type WebsiteCorrectionOutcome } from "../lib/civic-data/website-correction-acquisition.ts";
import {
  applicableWebsiteCorrections,
  WEBSITE_CORRECTIONS,
  websiteCorrectionFor,
  websiteCorrectionNote,
} from "../lib/civic-data/website-corrections.ts";
import { memoryInProcess, nodeResearchGet } from "../lib/hunt/robots-first-fetch.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";

const GENERATOR = "scripts/enumerate-jurisdictions.mts";
let asOf = "";
let acquiredCensusUnits: readonly CensusJurisdictionUnitInput[] = [];
let acquiredDependentSchoolSystems: readonly CensusJurisdictionUnitInput[] = [];
/** Each reviewed website correction's reading at this promotion, by jurisdiction id. */
let websiteCorrectionOutcomes: ReadonlyMap<string, WebsiteCorrectionOutcome> = new Map();

/* ------------------------------------------------------------- the sources */

const CENSUS_CITATION =
  `${CENSUS_GOVERNMENT_UNITS_URL} — U.S. Census Bureau, 2022 Census of Governments: ` +
  "Organization — Governments Integrated Directory; acquired during this exact candidate run";
const AZ_FILING_CITATION =
  `${AZ_BULK_FILING_GUIDE_URL} — the Arizona Secretary of State's current Bulk Filing Guide, ` +
  "acquired over HTTPS during this exact candidate run; it defines Jurisdictions.txt but does not " +
  "publish that table's current row set over HTTPS, so this projection makes no live row-count claim for it";
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
  return acquiredCensusUnits
    .filter((r) => r.state === stateCode)
    .map((r) => ({
      name: r.name,
      govType: r.govType,
      county: r.county,
      web: r.web,
      pid: r.pid,
      active: r.active,
    }));
}

function dependentSchoolSystems(stateCode: string): CensusUnit[] {
  return acquiredDependentSchoolSystems
    .filter((r) => r.state === stateCode)
    .map((r) => ({
      name: r.name,
      govType: r.govType,
      county: r.county,
      web: r.web,
      pid: r.pid,
      active: r.active,
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

/** The government's own published address, where the Census recorded one: a DISCOVERY source, never an adapted one. */
const OWN_SITE_SOURCE: JurisdictionSource = {
  recordClass: "MEETINGS",
  authority: "this government itself",
  authorityBasis: "the government's own published web address, as the Census of Governments recorded it",
  scope: "THIS_JURISDICTION",
  routeId: null,
  /* The address is per-government and lives on the jurisdiction row as `ownWebAddress`. */
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
        "the EasyVote tenant API answered HTTP 200 on 2026-08-29 with 138 filers and 680 filing records for Pima County",
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
        "acquire the current external reference tables through a publisher-supported production transport. " +
        "The official HTTPS guide documents the legacy FTP route and the Jurisdictions table, but the table's " +
        "current rows are not promoted or counted here without an authoritative HTTPS response.",
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
      "data/states/az/ballot/az-pima-2026.json — Pima County's certified list is held; no other Arizona county's is",
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
      /* The record is the Secretary's filing list itself, not the landing page that served it. */
      url: "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
      state: "ADAPTED",
      owed:
        "ACQUIRED 2026-09-01 — 266 " +
        "candidacies across 76 contests, the Secretary's complete applicable universe for the offices " +
        "he is the filing officer for (federal congressional, statewide executive, legislative). WHAT " +
        "IS STILL OWED IS A DIFFERENT RECORD, and it is the 15 county rows below: county, municipal, " +
        "school-district and special-district candidacies are filed with the county officer in charge " +
        "of elections and are not on this list. Nor are independent and no-party candidates, write-in " +
        "nominees, or nonpartisan and judicial offices — each an absence from THIS DOCUMENT and never " +
        "from the ballot.",
      citation:
        "HTTP 200, 183,097 B, last-modified 2026-03-31, sha256 " +
        "a13d2a82f83b52206d3697a840382403b1c3d5cb6c80481e383b42d360669016, read 2026-09-01. " +
        "Extracted twice by independent mechanisms, both returning 266 rows.",
    });
    return out;
  }

  /* Every Arizona government below the state is also a subject of the statewide bulk drop. */
  out.push({
    recordClass: "CAMPAIGN_FINANCE",
    authority: "Arizona Secretary of State (bulk reference tables)",
    authorityBasis: "the state's own Jurisdictions.txt enumerates every filing jurisdiction in Arizona",
    scope: "STATEWIDE",
    routeId: "az-sos-cfs-bulk-ftp",
    url: "ftp://ftp.azsos.gov/cfsdata2/",
    state: "REQUIRES_NEW_ADAPTER",
    owed: "a publisher-supported production transport for the current reference rows. See the state row.",
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
       county officer under § 16-928: the district is the government, the officer the custodian. */
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
   * The statewide CFS holds state and county filers; whether a local candidate
   * files there is not established, so local rows carry it as DISCOVERY_OWED.
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
      citation: "one county's certified list is held; no other's is",
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
      citation: "Morris County's certified list is held; no other New Jersey county's is",
    });
  }
  const own = ownSiteSource(unit);
  if (own) out.push(own);
  return out;
}

/* ------------------------------------------------------------ the assembly */

/** The held statutory routing below is separate from artifact availability. */
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

const ROUTING: Omit<StatePlan, "code">[] = [
  {
    name: "Arizona",
    sourcesFor: arizonaSources,
    extraEnumerations: () => [],
    extraDisagreements: () => {
      const out: EnumerationDisagreement[] = [
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

/** Generate the routes actually held; a different domain cannot make them compulsory. */
const PLANS: StatePlan[] = ROUTING.map(routing => {
  const state = US_JURISDICTIONS.find(state => NAME_BY_USPS[state.usps]?.toLowerCase() === routing.name.toLowerCase());
  if (!state) throw new Error(`Held routing has no sourced geography identity: ${routing.name}`);
  return { ...routing, code: state.usps };
});

function build(plan: StatePlan): JurisdictionRegistry {
  const units = censusUnits(plan.code);
  if (units.length === 0) {
    throw new Error(
      `the Census enumeration yielded ZERO ${plan.code} governments. That is a failed read of ` +
        `${CENSUS_GOVERNMENT_UNITS_URL}, never a state with no local government.`,
    );
  }
  const dependents = dependentSchoolSystems(plan.code);

  const jurisdictions: Jurisdiction[] = [];
  const seen = new Set<string>();

  /* Shared routes are catalogued once and referenced by key; rows that differ in one word get distinct keys. */
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
    /*
     * A reviewed website correction replaces the Census address only while Census still records the address it
     * replaces, and only as this promotion read its sources again: refused, the Census address stays and says why.
     */
    const census = ownWebAddress(unit);
    const correction = websiteCorrectionFor(id, census);
    const reading = correction === null ? undefined : websiteCorrectionOutcomes.get(id);
    jurisdictions.push({
      id,
      stateCode: plan.code,
      name: unit.name,
      govClass,
      countyName: unit.county || null,
      enumeratedFrom,
      ownWebAddress: correction !== null && reading !== undefined && reading.disposition !== "REFUSED" ? correction.corrected : census,
      ...(correction === null || reading === undefined
        ? {}
        : { ownWebAddressCorrection: websiteCorrectionNote(correction, reading.disposition, reading.detail) }),
      sourceIds: plan.sourcesFor(unit, govClass).map(catalogKey),
    });
  };

  /* The state itself is a jurisdiction: the owner of every STATEWIDE route. */
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
    generatedOn: asOf,
    _note: [
      "CANONICAL DATA-PLANE PROJECTION — never hand-edited. Rebuild and validate with `pnpm jurisdictions:check`; promote only with the owner-invoked `pnpm jurisdictions:promote`.",
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
        path: CENSUS_GOVERNMENT_UNITS_URL,
        rowsRead: units.length,
      },
      {
        id: "census-dependent-school-systems-2022",
        describe: "the same directory's DEPENDENT school systems sheet",
        path: `${CENSUS_GOVERNMENT_UNITS_URL}#Govt_Units_2022_Final.xlsx/DEP School Dist`,
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

const CHECK = process.argv.includes("--check");
const PROMOTE = process.argv.includes("--promote");
const selectedStates: readonly JurisdictionReferenceState[] = JURISDICTION_REFERENCE_STATES;
const contractId = "jurisdiction-operational-reference";
if (CHECK === PROMOTE) {
  throw new Error("JURISDICTION_REFERENCE_MODE_REQUIRED: choose exactly one of --check or --promote");
}
if (PROMOTE) prepareProductionCivicDataWrite();

const store = CHECK ? new MemoryRoutineDataStore() : new PostgresRoutineDataStore();

async function recordFailedAttempt(failure: JurisdictionReferenceAcquisitionFailure): Promise<never> {
  const candidate = jurisdictionOperationalReferenceFailureCandidate(failure);
  const outcome = await processRegisteredManualCandidate(
    store,
    contractId,
    candidate,
    candidate.retrieval.retrievedAt,
  );
  throw new Error(
    `JURISDICTION_REFERENCE_PROMOTION_REFUSED:${outcome.candidate.state}:` +
      `${outcome.candidate.failureCode ?? failure.stage}:${outcome.candidate.failureDetail ?? failure.detail}`,
  );
}

const acquisition = await acquireJurisdictionReferenceInputs();
if (acquisition.kind === "FAILED") {
  await recordFailedAttempt(acquisition);
  throw new Error("JURISDICTION_REFERENCE_FAILED_ATTEMPT_DID_NOT_TERMINATE");
}
acquiredCensusUnits = acquisition.censusUnits;
acquiredDependentSchoolSystems = acquisition.dependentSchoolSystems;
/* Each reviewed website correction is read again, robots.txt first, before it may replace a Census address. */
const corrections = await acquireWebsiteCorrections([...applicableWebsiteCorrections(WEBSITE_CORRECTIONS).values()], {
  get: nodeResearchGet,
  memory: memoryInProcess(),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
websiteCorrectionOutcomes = new Map(corrections.outcomes.map((outcome) => [outcome.jurisdictionId, outcome]));
for (const outcome of corrections.outcomes) {
  console.log(`website correction ${outcome.jurisdictionId}: ${outcome.disposition} — ${outcome.detail}`);
}
const sourceReceipts = [...acquisition.receipts, ...corrections.receipts];
const retrievedAt = sourceReceipts.map((receipt) => receipt.retrievedAt).sort().at(-1)!;
asOf = retrievedAt.slice(0, 10);

console.log(`jurisdictions:enumerate · acquired authoritative inputs as of ${asOf}\n`);
const built = new Map<JurisdictionReferenceState, JurisdictionRegistry>();
try {
  for (const plan of PLANS.filter(plan => selectedStates.includes(plan.code.toLowerCase() as JurisdictionReferenceState))) {
    const registry = build(plan);
    const state = plan.code.toLowerCase() as JurisdictionReferenceState;
    if (!JURISDICTION_REFERENCE_STATES.includes(state)) {
      throw new Error(`JURISDICTION_REFERENCE_STATE_UNREGISTERED:${plan.code}`);
    }
    built.set(state, registry);
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
    console.log("      candidate projection built; no repository file written");
    console.log("");
  }
} catch (error) {
  const censusReceipt = acquisition.receipts.find(({ sourceId }) => sourceId === "census-government-units-2022")!;
  await recordFailedAttempt({
    kind: "FAILED",
    stage: "WORKBOOK",
    requestedUrl: censusReceipt.requestedUrl,
    finalUrl: censusReceipt.finalUrl,
    httpStatus: censusReceipt.httpStatus,
    retrievedAt,
    rawHash: censusReceipt.rawHash,
    byteCount: censusReceipt.byteCount,
    detail: `jurisdiction projection build failed: ${error instanceof Error ? error.message : String(error)}`,
    receipts: acquisition.receipts,
  });
}

if (selectedStates.some((state) => !built.has(state))) {
  const censusReceipt = acquisition.receipts.find(({ sourceId }) => sourceId === "census-government-units-2022")!;
  await recordFailedAttempt({
    kind: "FAILED",
    stage: "WORKBOOK",
    requestedUrl: censusReceipt.requestedUrl,
    finalUrl: censusReceipt.finalUrl,
    httpStatus: censusReceipt.httpStatus,
    retrievedAt,
    rawHash: censusReceipt.rawHash,
    byteCount: censusReceipt.byteCount,
    detail: `jurisdiction projection omitted required states: ${[...built.keys()].join(",")}`,
    receipts: acquisition.receipts,
  });
}
const registries = Object.fromEntries(selectedStates.map((state) => [state, built.get(state)!])) as Record<JurisdictionReferenceState, JurisdictionRegistry>;
const candidate = jurisdictionOperationalReferenceCandidate({
  registries,
  sourceReceipts,
  workbook: acquisition.workbook,
  retrievedAt,
});
const outcome = await processRegisteredManualCandidate(
  store,
  contractId,
  candidate,
  candidate.retrieval.retrievedAt,
);
if (outcome.candidate.state !== "PROMOTED") {
  throw new Error(
    `JURISDICTION_REFERENCE_PROMOTION_REFUSED:${outcome.candidate.state}:` +
      `${outcome.candidate.failureCode ?? "UNKNOWN"}:${outcome.candidate.failureDetail ?? "no detail"}`,
  );
}
console.log(
  `${CHECK ? "validated in the deterministic memory store" : "promoted to the production data plane"}: ` +
    `${candidate.id}; ${candidate.normalization.outputRecords} jurisdiction rows; ` +
    `${outcome.candidate.candidate.changeSet?.outcome ?? "change outcome unavailable"}`,
);
