/**
 * WHO IS THE FILING AUTHORITY?
 *
 * ## The question this file asks, and the one it refuses to ask
 *
 * The discovery question for campaign finance is **"who is the legally
 * responsible custodian for this contest, this committee and this period?"** It
 * is NOT "which API covers this level". Those two questions give different
 * answers, and the second one is how a whole tier of American campaign money
 * goes missing: a session that reasons from portals finds the state portal,
 * finds no county portal, and writes down an absence about a government.
 *
 * **Arizona is the state that taught this project the difference.**
 * `states/az/sources.md`, reading `https://www.azleg.gov/ars/16/00928.htm` on
 * 2026-08-26 (HTTP 200, 3,387 bytes, titled *16-928 - Filing officer;
 * statements and reports*), quotes the statute directly:
 *
 * > "The secretary of state is the filing officer for statewide and legislative
 * > elections"
 *
 * > "The county officer in charge of elections is the filing officer for county,
 * > school district, community college district and special taxing district
 * > elections"
 *
 * > "The city or town clerk is the filing officer for city and town elections."
 *
 * Three consequences, all encoded below rather than remembered:
 *
 *   1. **The authority's level need not match the office's level.** A school
 *      district is not a county, and its money files with the county officer in
 *      charge of elections anyway. Same for community college districts and
 *      special taxing districts. `resolveFilingAuthority` returns an authority
 *      whose `level` is `COUNTY` for an office whose level is `SCHOOL_DISTRICT`,
 *      and `tests/control-plane-campaign-finance.test.ts` asserts exactly that.
 *
 *   2. **It is the county officer IN CHARGE OF ELECTIONS** — a single defined
 *      role, which in Arizona is not always the recorder. `states/az/sources.md`
 *      records that correction against an earlier brief rather than smoothing
 *      it, and the correction is carried here.
 *
 *   3. **Local campaign finance in Arizona is FEDERATED BY STATUTE**, across
 *      **109 filing jurisdictions — 1 State, 15 County, 93 City/Town**, from the
 *      state's own `Jurisdictions.txt` pulled 2026-08-26. A claim of
 *      campaign-finance coverage in Arizona without that denominator is
 *      meaningless, so the denominator travels with the regime.
 *
 * ## When it cannot resolve
 *
 * It returns OPEN and names the routes still to walk. It never guesses a
 * custodian. A guessed custodian produces a hunt against the wrong government,
 * and then an absence about the right one.
 */

import type { Disposition } from "../../workstate/types.ts";
import type {
  AcquisitionDepth,
  FilingAuthority,
  FilingRegime,
  OfficeLevel,
  PlannedRoute,
} from "./model.ts";

/* ── The federal regime ───────────────────────────────────────────────────── */

/**
 * The FEC.
 *
 * `statutoryBasis` is **null on purpose**. This repository has read Arizona's
 * filing-officer statute from `azleg.gov` and quoted it; it has NOT read
 * whichever federal provision names the FEC as the federal filing officer.
 * `states/az/sources.md` poses that as the generalising question asked of every
 * state — answered for AZ (§ 16-928), NH (RSA 664:7 and 664:6) and NJ. The
 * federal answer is not in this repository, so the field stays null and the
 * open question is named. A plausible citation would be a fabrication in the one
 * field whose whole job is being checkable.
 */
export const FEC_AUTHORITY: FilingAuthority = {
  id: "us:federal:fec",
  name: "Federal Election Commission",
  level: "FEDERAL",
  jurisdiction: "US",
  recordClasses: [
    "CANDIDATE_COMMITTEE_REPORT",
    "PAC_REPORT",
    "PARTY_COMMITTEE_REPORT",
    "INDEPENDENT_EXPENDITURE_REPORT",
    "STATEMENT_OF_ORGANIZATION",
  ],
  statutoryBasis: null,
  statutoryQuote: null,
  statutoryOpenQuestion:
    "Which federal provision names the FEC as the filing officer has NOT been read from source " +
    "in this repository. states/az/sources.md asks that question of every state and answers it " +
    "for AZ, NH and NJ; the federal answer is owed and is not written down here as a guess.",
  discoveredVia: [
    "docs/sources.md — OpenFEC, WIRED for committee TOTALS only",
    "lib/funding/snapshot.ts",
    "data/fec/fec-2026.json",
    "data/reference/fec_combined_federal_state_disclosure_directory.csv",
  ],
  filingsUrl: "https://www.fec.gov/data/",
  vendorPlatform: null,
};

export const FEDERAL_REGIME: FilingRegime = {
  jurisdiction: "US",
  statutoryBasis: null,
  statutorySourceUrl: null,
  statutoryReadOn: null,
  federated: false,
  filingJurisdictionCount: 1,
  filingJurisdictionBreakdown: "1 federal filing officer",
  denominatorSource: "docs/sources.md — OpenFEC",
  routing: [
    {
      officeLevel: "FEDERAL",
      authorityLevel: "FEDERAL",
      custodianRole: "Federal Election Commission",
      quote:
        "NOT QUOTED — the federal filing-officer provision has not been read from source in this repository.",
    },
  ],
};

/* ── The Arizona regime, A.R.S. § 16-928 as data ──────────────────────────── */

const AZ_QUOTE_SOS =
  "The secretary of state is the filing officer for statewide and legislative elections";
const AZ_QUOTE_COUNTY =
  "The county officer in charge of elections is the filing officer for county, school district, " +
  "community college district and special taxing district elections";
const AZ_QUOTE_CITY = "The city or town clerk is the filing officer for city and town elections.";

/**
 * The routing table, one row per office level the statute names.
 *
 * Read the `authorityLevel` column against the `officeLevel` column. Four of the
 * eight rows disagree, and that disagreement is the finding.
 */
export const ARIZONA_REGIME: FilingRegime = {
  jurisdiction: "AZ",
  statutoryBasis: "A.R.S. § 16-928",
  statutorySourceUrl: "https://www.azleg.gov/ars/16/00928.htm",
  statutoryReadOn: "2026-08-26",
  federated: true,
  filingJurisdictionCount: 109,
  filingJurisdictionBreakdown: "1 State, 15 County, 93 City/Town",
  denominatorSource:
    "states/az/sources.md — Jurisdictions.txt, pulled 2026-08-26 from ftp://ftp.azsos.gov/cfsdata2/",
  routing: [
    { officeLevel: "STATEWIDE", authorityLevel: "STATE", custodianRole: "secretary of state", quote: AZ_QUOTE_SOS },
    { officeLevel: "LEGISLATIVE", authorityLevel: "STATE", custodianRole: "secretary of state", quote: AZ_QUOTE_SOS },
    {
      officeLevel: "COUNTY",
      authorityLevel: "COUNTY",
      custodianRole: "county officer in charge of elections",
      quote: AZ_QUOTE_COUNTY,
    },
    {
      officeLevel: "SCHOOL_DISTRICT",
      authorityLevel: "COUNTY",
      custodianRole: "county officer in charge of elections",
      quote: AZ_QUOTE_COUNTY,
    },
    {
      officeLevel: "COMMUNITY_COLLEGE_DISTRICT",
      authorityLevel: "COUNTY",
      custodianRole: "county officer in charge of elections",
      quote: AZ_QUOTE_COUNTY,
    },
    {
      officeLevel: "SPECIAL_TAXING_DISTRICT",
      authorityLevel: "COUNTY",
      custodianRole: "county officer in charge of elections",
      quote: AZ_QUOTE_COUNTY,
    },
    {
      officeLevel: "CITY_OR_TOWN",
      authorityLevel: "MUNICIPAL",
      custodianRole: "city or town clerk",
      quote: AZ_QUOTE_CITY,
    },
  ],
};

/** The Arizona Secretary of State, as a custodian rather than as a portal. */
export const AZ_SECRETARY_OF_STATE: FilingAuthority = {
  id: "az:state:secretary-of-state",
  name: "Arizona Secretary of State",
  level: "STATE",
  jurisdiction: "AZ",
  recordClasses: [
    "CANDIDATE_COMMITTEE_REPORT",
    "PAC_REPORT",
    "PARTY_COMMITTEE_REPORT",
    "BALLOT_MEASURE_COMMITTEE_REPORT",
    "INDEPENDENT_EXPENDITURE_REPORT",
    "STATEMENT_OF_ORGANIZATION",
  ],
  statutoryBasis: "A.R.S. § 16-928",
  statutoryQuote: AZ_QUOTE_SOS,
  statutoryOpenQuestion: null,
  discoveredVia: [
    "states/az/sources.md — A.R.S. § 16-928, read 2026-08-26 from https://www.azleg.gov/ars/16/00928.htm",
    "data/reference/fec_combined_federal_state_disclosure_directory.csv — ARIZONA, SECRETARY OF STATE",
  ],
  filingsUrl: "https://seethemoney.az.gov/",
  vendorPlatform: null,
};

/**
 * The Pima County officer in charge of elections.
 *
 * **Named by ROLE, because the statute names a role.** The individual office
 * holding that role in Pima County is not asserted here — `states/az/sources.md`
 * records that the county-level officer is *the county officer in charge of
 * elections*, "a single defined role and in Arizona is not always the recorder",
 * correcting a brief that had said "county recorder, county elections department
 * or board of supervisors". Which office that is in Pima County is an OPEN
 * identification, carried on `statutoryOpenQuestion`, and the county's own
 * campaign-finance page is the route to it.
 */
export const PIMA_COUNTY_FILING_OFFICER: FilingAuthority = {
  id: "az:county:pima:officer-in-charge-of-elections",
  name: "Pima County officer in charge of elections",
  level: "COUNTY",
  jurisdiction: "AZ:Pima",
  recordClasses: [
    "CANDIDATE_COMMITTEE_REPORT",
    "PAC_REPORT",
    "BALLOT_MEASURE_COMMITTEE_REPORT",
    "INDEPENDENT_EXPENDITURE_REPORT",
    "STATEMENT_OF_ORGANIZATION",
  ],
  statutoryBasis: "A.R.S. § 16-928",
  statutoryQuote: AZ_QUOTE_COUNTY,
  statutoryOpenQuestion:
    "WHICH Pima County office currently holds the role of 'officer in charge of elections' is not " +
    "asserted here. states/az/sources.md records that in Arizona this is a single defined role and " +
    "is NOT always the recorder; naming the office is owed, and https://www.pima.gov/620/Campaign-Finance " +
    "is the route to it.",
  discoveredVia: [
    "states/az/sources.md — A.R.S. § 16-928, read 2026-08-26 from https://www.azleg.gov/ars/16/00928.htm",
    "states/az/sources.md — Pima County campaign finance, https://www.pima.gov/620/Campaign-Finance, HTTP 200, walked 2026-08-26",
  ],
  filingsUrl: "https://www.pima.gov/620/Campaign-Finance",
  vendorPlatform: "EasyVote",
};

/** The City of Tucson clerk — the statute's municipal branch, for Pima's largest city. */
export const TUCSON_CITY_CLERK: FilingAuthority = {
  id: "az:municipal:tucson:city-clerk",
  name: "City of Tucson Clerk",
  level: "CLERK",
  jurisdiction: "AZ:Tucson",
  recordClasses: ["CANDIDATE_COMMITTEE_REPORT", "PAC_REPORT", "BALLOT_MEASURE_COMMITTEE_REPORT"],
  statutoryBasis: "A.R.S. § 16-928",
  statutoryQuote: AZ_QUOTE_CITY,
  statutoryOpenQuestion: null,
  discoveredVia: [
    "states/az/sources.md — City of Tucson campaign finance, https://www.tucsonaz.gov/Departments/Clerks/Campaign-Finance-Information, HTTP 200, walked 2026-08-26",
  ],
  filingsUrl: "https://www.tucsonaz.gov/Departments/Clerks/Campaign-Finance-Information",
  vendorPlatform: null,
};

/**
 * The Citizens Clean Elections Commission — a SECOND authority over the same
 * money, not a substitute for the first.
 *
 * Recorded because a model with one custodian slot per contest would silently
 * drop it. The FEC's own combined directory lists it under ARIZONA with
 * "Regulation of Campaign Finance Reports" among its functions, beside the
 * Secretary of State, and `states/az/sources.md` records that `Committees.txt`
 * already types 810 committees as participating in Clean Elections against 3,767
 * not participating.
 */
export const AZ_CLEAN_ELECTIONS_COMMISSION: FilingAuthority = {
  id: "az:state:clean-elections-commission",
  name: "Citizens Clean Elections Commission",
  level: "ETHICS_COMMISSION",
  jurisdiction: "AZ",
  recordClasses: ["CANDIDATE_COMMITTEE_REPORT"],
  statutoryBasis: null,
  statutoryQuote: null,
  statutoryOpenQuestion:
    "The Commission's own enabling statute has not been read from source in this repository. " +
    "It is recorded as a co-existing authority, not as the § 16-928 filing officer.",
  discoveredVia: [
    "data/reference/fec_combined_federal_state_disclosure_directory.csv — ARIZONA, CITIZENS CLEAN ELECTIONS COMMISSION, 'Regulation of Campaign Finance Reports'",
    "states/az/sources.md — Committees.txt types 810 participating vs 3,767 not participating",
  ],
  filingsUrl: "https://www.azcleanelections.gov",
  vendorPlatform: null,
};

/* ── Resolution ───────────────────────────────────────────────────────────── */

/**
 * What a session that reasoned from PORTALS rather than from the STATUTE would
 * naively expect the custodian's level to be: the same tier as the office.
 *
 * This table exists only to be contradicted. `levelMismatchNote` compares it
 * against the statute's actual answer and states the difference out loud, so the
 * mismatch is a reported finding rather than something a reader has to notice.
 */
export const NAIVE_LEVEL_FOR_OFFICE: Readonly<Record<OfficeLevel, FilingAuthority["level"]>> = {
  FEDERAL: "FEDERAL",
  STATEWIDE: "STATE",
  LEGISLATIVE: "STATE",
  COUNTY: "COUNTY",
  SCHOOL_DISTRICT: "SCHOOL_DISTRICT",
  COMMUNITY_COLLEGE_DISTRICT: "SPECIAL_DISTRICT",
  SPECIAL_TAXING_DISTRICT: "SPECIAL_DISTRICT",
  CITY_OR_TOWN: "MUNICIPAL",
};

export function levelMismatchNote(
  officeLevel: OfficeLevel,
  authorityLevel: FilingAuthority["level"],
  quote: string,
): string | null {
  if (NAIVE_LEVEL_FOR_OFFICE[officeLevel] === authorityLevel) return null;
  return (
    `LEVEL MISMATCH, AND IT IS THE FINDING. The office level is ${officeLevel}; the tier a portal ` +
    `hunt would expect is ${NAIVE_LEVEL_FOR_OFFICE[officeLevel]}; the filing authority's level is ` +
    `${authorityLevel}. A.R.S. § 16-928 routes by WHICH ELECTION the money influences, not by the ` +
    `tier of the body — "${quote}". The authority's level need not match the office's, and in ` +
    "Arizona it frequently does not."
  );
}

export interface FilingAuthorityQuery {
  /** Two-letter postal code, or "US" for a federal office. */
  readonly jurisdiction: string;
  readonly officeLevel: OfficeLevel;
  /** The contest this is being asked about — for the OPEN report's benefit. */
  readonly contestId: string;
  /** County name, when the routing rule lands at COUNTY. */
  readonly county?: string | null;
  /** City or town name, when the routing rule lands at MUNICIPAL. */
  readonly municipality?: string | null;
}

export const AUTHORITY_RESOLUTION_STATUSES = ["RESOLVED", "OPEN"] as const;
export type AuthorityResolutionStatus = (typeof AUTHORITY_RESOLUTION_STATUSES)[number];

export interface FilingAuthorityResolution {
  readonly status: AuthorityResolutionStatus;
  /** Null whenever status is OPEN. There is no partial custodian. */
  readonly authority: FilingAuthority | null;
  /** Co-existing authorities over the same money. Never a substitute for `authority`. */
  readonly alsoRegulatedBy: readonly FilingAuthority[];
  readonly regime: FilingRegime | null;
  readonly statutoryBasis: string | null;
  readonly statutoryQuote: string | null;
  /** The office's own level, so a reader can see it differ from the authority's. */
  readonly officeLevel: OfficeLevel;
  /** Null when unresolved; otherwise the authority's level, which may differ. */
  readonly authorityLevel: FilingAuthority["level"] | null;
  /** Set when the two differ. This is the finding, stated rather than implied. */
  readonly levelMismatchNote: string | null;
  /** Routes still owed. Non-empty whenever status is OPEN. */
  readonly openRoutes: readonly PlannedRoute[];
  readonly why: string;
}

/** The regimes this repository has read a statute for. */
export const REGIMES: readonly FilingRegime[] = [FEDERAL_REGIME, ARIZONA_REGIME];

/**
 * Resolve the custodian, or return OPEN naming what is still owed.
 *
 * There is deliberately no fall-through that picks the state authority when a
 * local one is not known. "The state portal is the only one I can see" is the
 * portal question, and answering the statute question with it is the exact error
 * this file exists to prevent.
 */
export function resolveFilingAuthority(query: FilingAuthorityQuery): FilingAuthorityResolution {
  if (query.jurisdiction === "US" || query.officeLevel === "FEDERAL") {
    return {
      status: "RESOLVED",
      authority: FEC_AUTHORITY,
      alsoRegulatedBy: [],
      regime: FEDERAL_REGIME,
      statutoryBasis: FEC_AUTHORITY.statutoryBasis,
      statutoryQuote: FEC_AUTHORITY.statutoryQuote,
      officeLevel: "FEDERAL",
      authorityLevel: "FEDERAL",
      levelMismatchNote: null,
      openRoutes: [],
      why:
        "A federal office files federally. The custodian is resolved; the STATUTE naming it is " +
        "not read from source in this repository and is carried as an open question on the authority.",
    };
  }

  if (query.jurisdiction === "AZ") {
    const rule = ARIZONA_REGIME.routing.find((r) => r.officeLevel === query.officeLevel);
    if (!rule) {
      return openResolution(
        query,
        `A.R.S. § 16-928 as read on 2026-08-26 routes statewide/legislative, county/school ` +
          `district/community college district/special taxing district, and city/town elections. ` +
          `Office level ${query.officeLevel} matches none of those rows, so the custodian is NOT ` +
          "resolved and is not guessed. Re-read the statute for the omitted class.",
        [statuteRereadRoute(query.contestId)],
      );
    }

    if (rule.authorityLevel === "STATE") {
      return {
        status: "RESOLVED",
        authority: AZ_SECRETARY_OF_STATE,
        alsoRegulatedBy: [AZ_CLEAN_ELECTIONS_COMMISSION],
        regime: ARIZONA_REGIME,
        statutoryBasis: ARIZONA_REGIME.statutoryBasis,
        statutoryQuote: rule.quote,
        officeLevel: query.officeLevel,
        authorityLevel: AZ_SECRETARY_OF_STATE.level,
        levelMismatchNote: levelMismatchNote(query.officeLevel, AZ_SECRETARY_OF_STATE.level, rule.quote),
        openRoutes: [],
        why: `A.R.S. § 16-928: "${rule.quote}".`,
      };
    }

    if (rule.authorityLevel === "COUNTY") {
      if ((query.county ?? "").toLowerCase() === "pima") {
        return {
          status: "RESOLVED",
          authority: PIMA_COUNTY_FILING_OFFICER,
          alsoRegulatedBy: [],
          regime: ARIZONA_REGIME,
          statutoryBasis: ARIZONA_REGIME.statutoryBasis,
          statutoryQuote: rule.quote,
          officeLevel: query.officeLevel,
          authorityLevel: PIMA_COUNTY_FILING_OFFICER.level,
          levelMismatchNote: levelMismatchNote(
            query.officeLevel,
            PIMA_COUNTY_FILING_OFFICER.level,
            rule.quote,
          ),
          openRoutes: [],
          why:
            `A.R.S. § 16-928: "${rule.quote}". The custodian is the COUNTY officer, not the ` +
            "Secretary of State, and not the school district itself.",
        };
      }
      return openResolution(
        query,
        `A.R.S. § 16-928 routes this to the county officer in charge of elections — "${rule.quote}" — ` +
          `and this repository has walked that officer's page for Pima County only. County ` +
          `"${query.county ?? "(unnamed)"}" is unresolved. Arizona has 15 counties ` +
          "(states/az/sources.md, Counties.txt), and the routing rule is known while the custodian is not.",
        [countyContactsRoute(query.contestId)],
      );
    }

    if ((query.municipality ?? "").toLowerCase() === "tucson") {
      return {
        status: "RESOLVED",
        authority: TUCSON_CITY_CLERK,
        alsoRegulatedBy: [],
        regime: ARIZONA_REGIME,
        statutoryBasis: ARIZONA_REGIME.statutoryBasis,
        statutoryQuote: rule.quote,
        officeLevel: query.officeLevel,
        authorityLevel: TUCSON_CITY_CLERK.level,
        levelMismatchNote: levelMismatchNote(query.officeLevel, TUCSON_CITY_CLERK.level, rule.quote),
        openRoutes: [],
        why: `A.R.S. § 16-928: "${rule.quote}".`,
      };
    }
    return openResolution(
      query,
      `A.R.S. § 16-928 routes this to the city or town clerk — "${rule.quote}" — and this repository ` +
        `has walked that clerk for Tucson only. Municipality "${query.municipality ?? "(unnamed)"}" is ` +
        "unresolved. Arizona has 93 city/town filing jurisdictions (states/az/sources.md, Jurisdictions.txt).",
      [municipalDirectoryRoute(query.contestId)],
    );
  }

  return openResolution(
    query,
    `No filing regime has been read from source for jurisdiction "${query.jurisdiction}". ` +
      "states/az/sources.md poses the generalising question — which statute defines the filing " +
      "officer, and what does it route to whom — and it is answered for AZ, NH and NJ. It is not " +
      "answered here, and a custodian is not guessed from a portal.",
    [statuteRereadRoute(query.contestId)],
  );
}

function openResolution(
  query: FilingAuthorityQuery,
  why: string,
  openRoutes: readonly PlannedRoute[],
): FilingAuthorityResolution {
  return {
    status: "OPEN",
    authority: null,
    alsoRegulatedBy: [],
    regime: query.jurisdiction === "AZ" ? ARIZONA_REGIME : null,
    statutoryBasis: query.jurisdiction === "AZ" ? ARIZONA_REGIME.statutoryBasis : null,
    statutoryQuote: null,
    officeLevel: query.officeLevel,
    authorityLevel: null,
    levelMismatchNote: null,
    openRoutes,
    why,
  };
}

function route(
  routeId: string,
  label: string,
  target: string,
  disposition: Disposition,
  note: string,
  citation: string,
): PlannedRoute {
  return {
    declaration: { routeId, label, target },
    disposition,
    note,
    citation,
    permission: "CANNOT_TELL",
    transport: null,
    rung: null,
    lastAttemptedOn: null,
  };
}

function statuteRereadRoute(contestId: string): PlannedRoute {
  return route(
    "STATUTE_FILING_OFFICER_READ",
    "Read the jurisdiction's filing-officer statute from the legislature's own site",
    contestId,
    "UNWALKED",
    "The generalising question, asked of every state: which statute defines the filing officer, " +
      "and what does it route to whom? Answered for AZ (A.R.S. § 16-928), NH (RSA 664:7 and 664:6) " +
      "and NJ. Unanswered here.",
    "states/az/sources.md",
  );
}

function countyContactsRoute(contestId: string): PlannedRoute {
  return route(
    "AZ_SOS_COUNTY_ELECTION_CONTACTS",
    "Arizona Secretary of State county election contact info — all 15 counties named",
    contestId,
    "DISCOVERED",
    "https://azsos.gov/elections/about-elections/county-election-contact-info — HTTP 200, 320,910 B, " +
      "walked 2026-08-26, all 15 counties named. The route from the statute's ROLE to a named office.",
    "states/az/sources.md",
  );
}

function municipalDirectoryRoute(contestId: string): PlannedRoute {
  return route(
    "AZ_LEAGUE_LOCAL_GOVERNMENT_DIRECTORY",
    "League of Arizona Cities and Towns local government directory",
    contestId,
    "DISCOVERED",
    "http://lgd.azleague.org/ — HTTP 200, 232,717 B, walked 2026-08-26. Classified DERIVED-POINTER: " +
      "a league of municipalities is a membership organisation, not a government body, so it points " +
      "at the clerk and is never the record.",
    "states/az/sources.md",
  );
}

/* ── FEC absence never closes a local race ────────────────────────────────── */

export interface FecAbsenceVerdict {
  readonly contestId: string;
  /** Always "OPEN". There is no input to this function that closes a contest. */
  readonly coverageState: "OPEN";
  /** Never true. Present so a caller reading a boolean cannot read the wrong one. */
  readonly closesTheContest: false;
  readonly acquisitionDepth: AcquisitionDepth;
  readonly resolution: FilingAuthorityResolution;
  readonly owedRoutes: readonly PlannedRoute[];
  readonly why: string;
}

/**
 * **FEC ABSENCE IS NOT CLOSURE.**
 *
 * The FEC holds federal filings. It does not hold Arizona's, because A.R.S.
 * § 16-928 routes Arizona's money to the Secretary of State, fifteen county
 * officers and ninety-three city and town clerks. "The FEC has no record for
 * this contest" is therefore a fact about the FEC's jurisdiction and says
 * nothing whatever about whether the money was filed.
 *
 * The corroborating artifact is already committed:
 * `data/reference/fec_combined_federal_state_disclosure_directory.csv` is the
 * FEC's OWN directory of state disclosure offices, and for ARIZONA it lists the
 * Secretary of State, the Corporation Commission and the Citizens Clean
 * Elections Commission — and **no county officer and no city clerk at all.** The
 * federal directory stops one tier above the tier this product reaches for. A
 * session that treated the federal view as complete would report an absence
 * about ninety-three governments it never asked.
 *
 * So this function returns OPEN, always, and names the state and local routes
 * owed. There is no argument to it that yields a closed contest.
 */
export function fecAbsenceIsNotClosure(input: {
  contestId: string;
  jurisdiction: string;
  officeLevel: OfficeLevel;
  county?: string | null;
  municipality?: string | null;
  /** Routes the caller already knows are owed at the state/local tier. */
  knownLocalRoutes?: readonly PlannedRoute[];
}): FecAbsenceVerdict {
  const resolution = resolveFilingAuthority({
    jurisdiction: input.jurisdiction,
    officeLevel: input.officeLevel,
    contestId: input.contestId,
    county: input.county ?? null,
    municipality: input.municipality ?? null,
  });

  const owed = [
    ...(input.knownLocalRoutes ?? []),
    ...resolution.openRoutes,
    route(
      "FEC_JURISDICTION_BOUNDARY",
      "Record that the FEC's jurisdiction ends above this contest",
      input.contestId,
      "NOT_APPLICABLE",
      "data/reference/fec_combined_federal_state_disclosure_directory.csv lists, for ARIZONA, the " +
        "Secretary of State, the Corporation Commission and the Citizens Clean Elections Commission " +
        "— and no county officer and no city or town clerk. The federal directory does not reach " +
        "this tier, so its silence is a fact about its scope.",
      "data/reference/fec_combined_federal_state_disclosure_directory.csv",
    ),
  ];

  return {
    contestId: input.contestId,
    coverageState: "OPEN",
    closesTheContest: false,
    acquisitionDepth: resolution.status === "RESOLVED" ? "AUTHORITY_RESOLVED" : "NONE",
    resolution,
    owedRoutes: owed,
    why:
      `The FEC holds federal filings. "No FEC record for ${input.contestId}" is a statement about ` +
      "the FEC's jurisdiction, not about whether this candidate or committee filed. The state and " +
      "local custodians named by statute are owed, and are listed. Absence is never asserted.",
  };
}
