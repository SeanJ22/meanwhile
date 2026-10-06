/**
 * TWO PROVING OBLIGATIONS — one federal, one genuinely local.
 *
 * A domain model that only ever runs against its own fixtures proves nothing.
 * These two obligations are attached to REAL contests on a REAL committed
 * ballot, `data/states/az/ballot/az-pima-2026.json`, election `az-2026-11-03`, and every
 * fact in them is either read from a committed artifact at call time or cited to
 * the file it was read from. Where a value is unknown it is null and the
 * obligation stays OPEN. Nothing here invents a committee, an amount or a
 * filing.
 *
 * ## (a) FEDERAL — `ballot-az-pima:us-house-6`
 *
 * U.S. Representative, District 6. Four candidacies on the certified list, and
 * the federal money for all four is ALREADY ACQUIRED: `data/fec/fec-2026.json`,
 * the committed FEC snapshot written by `scripts/fetch-fec.mts` and read by
 * `lib/funding/snapshot.ts`. This obligation reads that snapshot rather than
 * transcribing it, so a refreshed snapshot cannot leave a stale number here.
 *
 * It still does not close, and the reason is exactly the model's point:
 * `docs/sources.md` records OpenFEC as "WIRED for committee TOTALS only", and
 * **independent expenditures (FEC Schedule E) are not read at all** — tracker
 * `D51`, held behind `PB10`/`D23`, the election-law counsel review of the
 * 52 U.S.C. § 30111(a)(4) sale-or-use restriction. Money spent ABOUT this race
 * by groups that gave these campaigns nothing is unmeasured, so the contest's
 * money is not fully described. That is an OPEN route with a named next move,
 * not an absence.
 *
 * ## (b) LOCAL ARIZONA — `ballot-az-pima:prop-423`
 *
 * Proposition 423, the Vail Unified School District No. 20 budget override
 * continuation, on the same ballot, consolidated with the November 3 general
 * election under A.R.S. § 15-481(P). It is genuinely local: a school-district
 * question, in one district, inside Pima County.
 *
 * **Its filing authority is resolved by statute, and the answer is not the
 * obvious one.** A.R.S. § 16-928 (read 2026-08-26 from `azleg.gov`, quoted in
 * `states/az/sources.md`) routes school-district elections to *the county
 * officer in charge of elections* — NOT to the Secretary of State, and not to
 * the school district. The authority's level is COUNTY while the office's level
 * is SCHOOL_DISTRICT, and no amount of portal-hunting produces that answer.
 *
 * **Nothing of its money is acquired**, and every route is recorded with the
 * disposition it actually has:
 *
 *   - See The Money answers HTTP 200 with an SPA shell (rung 2), and **rung 6,
 *     the live browser, is recorded as NOT YET WALKED** — `lib/funding/
 *     state-vocabulary.ts`, the AZ refusal, collected 2026-08-19.
 *   - The Pima County filing officer's own page is walked (HTTP 200) and its
 *     filings are not extracted.
 *   - The Pima County EasyVote portal is **not walked**.
 *   - **Whether an EasyVote tenant list exists is UNANSWERED as of 2026-08-26**,
 *     rowed as `AZ21` — the vendor question that would turn one county into many.
 *   - The anonymous FTP reference tables are walked and counted and **NOT YET
 *     WIRED** (`AZ19`).
 *
 * This obligation MUST stay OPEN. Absence is not completion, and a session with
 * no further avenue says "I have run out of ideas" — a claim about the session —
 * never "this is not published", which would be a claim about a government.
 */

import type { Disposition, PermissionState, TransportState } from "../../workstate/types.ts";
import { createWorkItem, type WorkItem } from "../work-item.ts";
import { fundingForTarget } from "../../funding/snapshot.ts";
import type { FundingCandidate } from "../../funding/types.ts";
import {
  FEC_AUTHORITY,
  PIMA_COUNTY_FILING_OFFICER,
  fecAbsenceIsNotClosure,
  resolveFilingAuthority,
  type FecAbsenceVerdict,
  type FilingAuthorityResolution,
} from "./authority.ts";
import type {
  CampaignFinanceCoverage,
  CandidateFinanceCoverage,
  PlannedRoute,
} from "./model.ts";

export const PROJECT = "we-the-people";
/** The runtime provider uses this scoped ballot/data-door path. Historical
 * proving obligations below remain the rollout way back until live acceptance. */
export { ballotFinanceObligations, ballotFinanceScheduledId, type BallotFinanceInputs } from "./ballot-obligations.ts";

/** The Pima body id this project already uses for the county's governing body. */
export const PIMA_BODY_ID = "ocd-division/country:us/state:az/county:pima#governing";

export const AZ_PIMA_ELECTION_ID = "az-2026-11-03";
export const AZ_PIMA_ELECTION_DATE = "2026-11-03";
export const BALLOT_CITATION = "data/states/az/ballot/az-pima-2026.json";

/** The four candidacies certified for AZ-06, as `data/states/az/ballot/az-pima-2026.json` lists them. */
export const US_HOUSE_6_CANDIDACIES: readonly { candidacyId: string; displayName: string }[] = [
  { candidacyId: "ballot-az-pima:us-house-6:mendoza-joanna", displayName: "JoAnna Mendoza" },
  { candidacyId: "ballot-az-pima:us-house-6:bah-iman", displayName: "Iman Bah" },
  { candidacyId: "ballot-az-pima:us-house-6:peters-jereme-lance", displayName: "Jereme Lance Peters" },
  { candidacyId: "ballot-az-pima:us-house-6:ciscomani-juan", displayName: "Juan Ciscomani" },
];

function plannedRoute(input: {
  routeId: string;
  label: string;
  target: string;
  disposition: Disposition;
  note: string;
  citation: string;
  permission?: PermissionState;
  transport?: TransportState | null;
  rung?: number | null;
  lastAttemptedOn?: string | null;
}): PlannedRoute {
  return {
    declaration: { routeId: input.routeId, label: input.label, target: input.target },
    disposition: input.disposition,
    note: input.note,
    citation: input.citation,
    permission: input.permission ?? "CANNOT_TELL",
    transport: input.transport ?? null,
    rung: input.rung ?? null,
    lastAttemptedOn: input.lastAttemptedOn ?? null,
  };
}

export interface CampaignFinanceObligation {
  readonly item: WorkItem;
  readonly resolution: FilingAuthorityResolution;
  readonly coverage: CampaignFinanceCoverage;
  /** Every route, with the disposition it actually has. */
  readonly routes: readonly PlannedRoute[];
  /** Routes with no terminal disposition — the exact remaining work. */
  readonly openRoutes: readonly PlannedRoute[];
  /** Committed artifacts this obligation has already acquired. */
  readonly acquiredEvidencePaths: readonly string[];
  /** Present on the local obligation: why federal silence does not close it. */
  readonly fecAbsence: FecAbsenceVerdict | null;
}

const TERMINAL: readonly Disposition[] = ["INGESTED", "WALKED_NO_YIELD", "NOT_APPLICABLE"];

export function openRoutesOf(routes: readonly PlannedRoute[]): readonly PlannedRoute[] {
  return routes.filter((r) => !TERMINAL.includes(r.disposition));
}

/* ── (a) The federal obligation ───────────────────────────────────────────── */

export const FEDERAL_ROUTES: readonly PlannedRoute[] = [
  plannedRoute({
    routeId: "FEC_COMMITTEE_TOTALS_SNAPSHOT",
    label: "OpenFEC committee totals, committed as a snapshot",
    target: "api.open.fec.gov",
    disposition: "INGESTED",
    note:
      "data/fec/fec-2026.json, written by scripts/fetch-fec.mts and read by lib/funding/snapshot.ts. " +
      "No live FEC call happens at request time and the API key never reaches runtime code.",
    citation: "lib/funding/snapshot.ts",
    permission: "ALLOWED",
    transport: "REACHABLE",
    rung: 1,
    lastAttemptedOn: "2026-08-26",
  }),
  plannedRoute({
    routeId: "FEC_SCHEDULE_A_SECOND_HOP",
    label: "A contributing committee's own itemized receipts, one level down",
    target: "api.open.fec.gov",
    disposition: "INGESTED",
    note:
      "The snapshot's secondHop records. A joint-fundraising committee is itself an FEC filer with " +
      "its own books, and 'who gave to that fund' is answered by that committee's own Schedule A, " +
      "never by inference from this one.",
    citation: "lib/funding/types.ts",
    permission: "ALLOWED",
    transport: "REACHABLE",
    rung: 1,
    lastAttemptedOn: "2026-08-26",
  }),
  plannedRoute({
    routeId: "FEC_SCHEDULE_E_INDEPENDENT_EXPENDITURES",
    label: "FEC Schedule E — money spent ABOUT this race by groups that gave the campaigns nothing",
    target: "api.open.fec.gov",
    disposition: "BLOCKED_CURRENTLY",
    note:
      "NOT READ. docs/sources.md records OpenFEC as 'WIRED for committee TOTALS only'; tracker D51 " +
      "holds the independent-expenditure surface and PB10/D23 is the BLOCKING PRECONDITION — " +
      "election-law counsel must rule on the 52 U.S.C. § 30111(a)(4) sale-or-use restriction before " +
      "any campaign-finance feature built on this ships. A blocked route is not a blocked fact: " +
      "these expenditures exist or do not independently of our being allowed to read them.",
    citation: "docs/tracker-working.csv — D51, PB10",
    permission: "CANNOT_TELL",
    transport: null,
    rung: null,
    lastAttemptedOn: null,
  }),
  plannedRoute({
    routeId: "FEC_REPORTING_CALENDAR",
    label: "The FEC's own reporting calendar — which periods are DUE for this cycle",
    target: "www.fec.gov",
    disposition: "UNWALKED",
    note:
      "The expected-period DENOMINATOR. data/fec/fec-2026.json carries each filer's " +
      "totals.coverageEndDate — how far its money is reported THROUGH — but not how many reports " +
      "the cycle owes. Without the calendar, 'filings acquired' has no denominator, and a " +
      "denominator that measures our own output is the coverage attack mode.",
    citation: "data/fec/fec-2026.json",
  }),
];

/**
 * Per-candidate coverage for AZ-06, DERIVED from the committed snapshot.
 *
 * Read rather than transcribed on purpose: a hand-copied `latestThroughDate`
 * survives a snapshot refresh and becomes a false statement about a named
 * person's money. `deps.fundingForTarget` defaults to the real reader.
 */
export function federalPerCandidateCoverage(deps?: {
  fundingForTarget?: (targetKey: string) => FundingCandidate | null;
}): readonly CandidateFinanceCoverage[] {
  const read = deps?.fundingForTarget ?? fundingForTarget;
  const rows = US_HOUSE_6_CANDIDACIES.map((c) => ({ c, funding: read(c.candidacyId) }));
  const newestThrough = rows
    .map((r) => r.funding?.totals?.coverageEndDate ?? null)
    .filter((d): d is string => typeof d === "string")
    .sort()
    .at(-1);

  return rows.map(({ c, funding }) => {
    const through = funding?.totals?.coverageEndDate ?? null;
    /**
     * The one legitimate asymmetry in this contest, and it is a property of the
     * FILINGS rather than of how hard we looked: two of the four filers' most
     * recent reports cover through a later date than the other two's. The value
     * is read from the snapshot's own `coverageEndDate`, which is the filer's
     * own report period, so the explanation cites the artifact it came from.
     */
    const asymmetryExplanation =
      through !== null && newestThrough !== undefined && through < newestThrough
        ? {
            reason:
              `This filer's most recent report on file covers THROUGH ${through}, while another ` +
              `filer in the same contest is reported through ${newestThrough}. The difference is ` +
              "the filers' own report periods as filed, not a difference in how hard either " +
              "candidate was hunted: both were acquired by the same route, in the same run.",
            sourceCitation: "data/fec/fec-2026.json — totals.coverageEndDate, per filer",
            recordedOn: "2026-08-26",
          }
        : null;

    return {
      candidacyId: c.candidacyId,
      displayName: c.displayName,
      committeeIds: funding?.principalCommitteeId ? [funding.principalCommitteeId] : [],
      filingAuthorityResolved: true,
      filingAuthorityIds: [FEC_AUTHORITY.id],
      filingsAcquired: funding ? [`${funding.fecCandidateId}:cycle-${funding.cycle}-totals`] : [],
      // NULL, and it is the honest value: the FEC's reporting calendar has not
      // been read, so we do not know how many reports this cycle owes.
      filingPeriodsExpected: null,
      filingPeriodsMissing: [],
      latestThroughDate: through,
      acquisitionDepth: funding ? "ITEMIZED_TRANSACTIONS" : "AUTHORITY_RESOLVED",
      openRouteIds: ["FEC_SCHEDULE_E_INDEPENDENT_EXPENDITURES", "FEC_REPORTING_CALENDAR"],
      identityGaps: [],
      amendmentGaps: [],
      asymmetryExplanation,
    };
  });
}

export function federalObligation(
  now: string,
  deps?: { fundingForTarget?: (targetKey: string) => FundingCandidate | null },
): CampaignFinanceObligation {
  const contestId = "ballot-az-pima:us-house-6";
  const resolution = resolveFilingAuthority({
    jurisdiction: "US",
    officeLevel: "FEDERAL",
    contestId,
  });

  const coverage: CampaignFinanceCoverage = {
    contestId,
    contestTitle: "U.S. Representative, District 6",
    electionId: AZ_PIMA_ELECTION_ID,
    electionDate: AZ_PIMA_ELECTION_DATE,
    jurisdictionOcdId: "ocd-division/country:us/state:az/cd:6",
    officeLevel: "FEDERAL",
    // DERIVED from the resolution, never typed. A hand-written "RESOLVED" here
    // would keep claiming the custodian is known after the registry stopped
    // saying so.
    filingRegimeState: resolution.status,
    filingRegimeId: resolution.regimeId,
    candidateUniverse: US_HOUSE_6_CANDIDACIES.map((c) => c.candidacyId),
    candidateUniverseSource: `${BALLOT_CITATION} — candidacies for ${contestId}`,
    committeeUniverse: [],
    expectedFilingAuthorityIds: [FEC_AUTHORITY.id],
    expectedFilingPeriods: [],
    filingsAcquired: ["data/fec/fec-2026.json"],
    filingsMissing: [],
    latestThroughDate: null,
    perCandidate: federalPerCandidateCoverage(deps),
    routes: FEDERAL_ROUTES,
    identityGaps: [],
    amendmentGaps: [],
    status: "OPEN",
    completeAsOf: null,
  };

  const item = createWorkItem({
    project: PROJECT,
    subject: contestId,
    obligation:
      "Describe the money in AZ-06 completely: committee receipts and disbursements for every " +
      "candidacy on the ballot, AND the independent expenditures made about the race.",
    why:
      "The committed FEC snapshot already answers the receipts half for all four certified " +
      "candidacies. The independent-expenditure half is unread (D51, blocked behind PB10/D23), and " +
      "the FEC's reporting calendar — the expected-period denominator — has not been read. Receipts " +
      "shown without outside spending misstates who is behind a candidate.",
    priority: "P2",
    contract: {
      inheritedRouteFloor: FEDERAL_ROUTES.map((r) => r.declaration.routeId),
      requiresValidation: true,
      requiresAudit: true,
      requiresCompleteDenominator: true,
      /**
       * **NULL, AND THAT IS A DECISION RATHER THAN AN OMISSION.**
       *
       * `acceptableDispositions` narrows the inherited route floor: a floor
       * route landing outside the named set refuses completion with
       * `DISPOSITION_OUTSIDE_CONTRACT`. The governed default — the
       * `OPEN_DISPOSITIONS` / `TERMINAL_DISPOSITIONS` split in
       * `lib/workstate/types.ts` — is the correct list HERE, and the tempting
       * narrowing is a trap.
       *
       * The narrowing that suggests itself is "a finance obligation may not
       * close on `WALKED_NO_YIELD`", so that the FEC answering with nothing
       * cannot end the hunt. It is refused, because it asserts something this
       * repository's law does not say anywhere: that a route which REACHED its
       * publisher and honestly found nothing does not count. The opposite is
       * already settled law here — `isRenderable` in `lib/funding/state-money.ts`
       * renders `NO_REPORTS_ON_FILE`, a sourced and dated absence, precisely
       * because a walked route that comes back empty is a FINDING, while a
       * `LEAD` is not. Refusing `WALKED_NO_YIELD` would demote that finding back
       * to a gap and make a truthful record unreportable.
       *
       * **What actually protects a local race from federal silence is not this
       * field.** It is that the FEC route is never the only route on the floor,
       * and that `fecAbsenceIsNotClosure` has no input that closes a contest:
       * `coverageState` is the literal `"OPEN"` and `closesTheContest` the
       * literal `false`. That invariant lives in the types and in test #12,
       * where it cannot be lost by editing a list.
       *
       * **What would justify a narrowing here:** a rule, statute or proven
       * invariant stating that a specific disposition cannot terminate a
       * campaign-finance route. None exists. Until one does, tightening this
       * list would be the model legislating.
       */
      acceptableDispositions: null,
    },
    now,
  });

  return {
    item,
    resolution,
    coverage,
    routes: FEDERAL_ROUTES,
    openRoutes: openRoutesOf(FEDERAL_ROUTES),
    acquiredEvidencePaths: ["data/fec/fec-2026.json", "lib/funding/snapshot.ts"],
    fecAbsence: null,
  };
}

/* ── (b) The Arizona local obligation ─────────────────────────────────────── */

/**
 * Every route to Vail USD's ballot-measure money, with the disposition each one
 * actually has as of the date it was walked. Four of the six have never been
 * attempted, and saying so is the point of the record.
 */
export const AZ_LOCAL_ROUTES: readonly PlannedRoute[] = [
  plannedRoute({
    routeId: "AZ_SEETHEMONEY_PLAIN_FETCH",
    label: "See The Money (Arizona Secretary of State), plain fetch",
    target: "seethemoney.az.gov",
    disposition: "BLOCKED_CURRENTLY",
    note:
      "HTTP 200, 109 KB — an SPA shell. The filing vocabulary and the money are not in the served " +
      "HTML. A 200 that carries no record is not a walked route; it is a wall wearing a success code.",
    citation: "lib/funding/state-vocabulary.ts — the AZ refusal, collected 2026-08-19",
    permission: "CANNOT_TELL",
    transport: "REACHABLE",
    rung: 2,
    lastAttemptedOn: "2026-08-19",
  }),
  plannedRoute({
    routeId: "AZ_SEETHEMONEY_LIVE_BROWSER",
    label: "See The Money driven in a live browser, watching the app's own XHR calls",
    target: "seethemoney.az.gov",
    disposition: "UNWALKED",
    note:
      "NOT YET WALKED — recorded as the named next rung, and the one that worked on New Hampshire's " +
      "equivalent in the g20 session. A guessed report endpoint (/Reporting/GetNEWTableData) returned " +
      "HTTP 404 at rung 7, and a guessed path is not a finding either way; the app's REAL endpoint is " +
      "unknown until rung 6 observes it.",
    citation: "lib/funding/state-vocabulary.ts — the AZ refusal, rung 6",
    permission: "CANNOT_TELL",
    transport: null,
    rung: 6,
    lastAttemptedOn: null,
  }),
  plannedRoute({
    routeId: "AZ_SOS_FTP_CFSDATA2",
    label: "ftp://ftp.azsos.gov/cfsdata2/ — the state's own campaign-finance reference tables",
    target: "ftp.azsos.gov",
    disposition: "REQUIRES_NEW_ADAPTER",
    note:
      "Anonymous FTP, no key, fourteen files listed 2026-08-26: Committees.txt (8,828 rows), " +
      "Jurisdictions.txt (109 — 1 State, 15 County, 93 City/Town), Counties.txt (15), Elections.txt " +
      "(37), BallotMeasures.txt and the transaction vocabulary. WALKED AND COUNTED, NOT YET WIRED — " +
      "the wiring is tracker AZ19. It carries the committee REGISTER and the jurisdiction universe; " +
      "the Bulk Filing Guide is an UPLOAD specification, so there is no documented bulk download of " +
      "the transactions themselves.",
    citation: "states/az/sources.md — ftp://ftp.azsos.gov/cfsdata2/, walked 2026-08-26",
    permission: "ALLOWED",
    transport: "REACHABLE",
    rung: 1,
    lastAttemptedOn: "2026-08-26",
  }),
  plannedRoute({
    routeId: "AZ_PIMA_COUNTY_CAMPAIGN_FINANCE_PAGE",
    label: "Pima County campaign finance — the § 16-928 county filing officer's own page",
    target: "www.pima.gov",
    disposition: "DISCOVERED",
    note:
      "HTTP 200, walked 2026-08-26 and classified PRIMARY (county filing officer). The page was " +
      "reached; the FILINGS behind it were not extracted, and WHICH Pima County office holds the " +
      "statutory role of 'officer in charge of elections' is not yet named.",
    citation: "states/az/sources.md — Municipal and county",
    permission: "CANNOT_TELL",
    transport: "REACHABLE",
    rung: 2,
    lastAttemptedOn: "2026-08-26",
  }),
  plannedRoute({
    routeId: "AZ_PIMA_EASYVOTE_PUBLIC_FILINGS",
    label: "Pima County EasyVote public filings portal — PRIMARY records on a VENDOR platform",
    target: "pimacountyaz.easyvotecampaignfinance.com",
    disposition: "UNWALKED",
    note:
      "https://pimacountyaz.easyvotecampaignfinance.com/home/publicfilings — recorded 2026-08-26 as " +
      "NOT WALKED. The records are primary; the platform is commercial, which changes the permission " +
      "question and nothing about who the custodian is.",
    citation: "states/az/sources.md — Pima County EasyVote portal",
    permission: "CANNOT_TELL",
    transport: null,
    rung: null,
    lastAttemptedOn: null,
  }),
  plannedRoute({
    routeId: "EASYVOTE_TENANT_LIST",
    label: "Does an EasyVote tenant list exist? — the vendor question, asked once for all tenants",
    target: "easyvotecampaignfinance.com",
    disposition: "UNWALKED",
    note:
      "OPEN LEAD, UNANSWERED as of 2026-08-26, rowed as AZ21. A vendor serving one county serves " +
      "others; local campaign-finance portals get the treatment agenda platforms already get — " +
      "identify the vendor, then ask whether a tenant list exists. One county at a time does not " +
      "scale to 109 Arizona filing jurisdictions, let alone nationally.",
    citation: "states/az/sources.md — THE VENDOR OBSERVATION",
    permission: "CANNOT_TELL",
    transport: null,
    rung: null,
    lastAttemptedOn: null,
  }),
  plannedRoute({
    routeId: "PIMA_COUNTY_SCHOOL_SUPERINTENDENT",
    label: "Pima County School Superintendent — the office that numbered this proposition",
    target: "www.schools.pima.gov",
    disposition: "UNWALKED",
    note:
      "The proposition NUMBER is the Pima County School Superintendent's and the question and fiscal " +
      "terms are Vail USD No. 20's own Notice of Election. Arguments were due to the Superintendent " +
      "by 5:00 p.m. on 2026-08-07. Whether that office publishes committee registrations or filings " +
      "for school-district measure committees is UNASKED. It is not the § 16-928 filing officer; it " +
      "is a route to knowing which committees exist.",
    citation: `${BALLOT_CITATION} — ballot-az-pima:prop-423 provenance`,
    permission: "CANNOT_TELL",
    transport: null,
    rung: null,
    lastAttemptedOn: null,
  }),
];

export function arizonaLocalObligation(now: string): CampaignFinanceObligation {
  const contestId = "ballot-az-pima:prop-423";

  /**
   * THE STATUTORY ROUTING, exercised rather than asserted. A.R.S. § 16-928 sends
   * a SCHOOL DISTRICT election to the COUNTY officer in charge of elections.
   */
  const resolution = resolveFilingAuthority({
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    contestId,
    county: "Pima",
  });

  const fecAbsence = fecAbsenceIsNotClosure({
    contestId,
    jurisdiction: "AZ",
    officeLevel: "SCHOOL_DISTRICT",
    county: "Pima",
    knownLocalRoutes: AZ_LOCAL_ROUTES,
  });

  /**
   * A ballot-measure contest has no candidacies, so the owed subject is the
   * MEASURE COMMITTEE universe — and that universe is not known. The gap is
   * carried explicitly rather than as an empty list that would read as zero.
   */
  const coverage: CampaignFinanceCoverage = {
    contestId,
    contestTitle: "Proposition 423: Vail Unified School District budget override continuation",
    electionId: AZ_PIMA_ELECTION_ID,
    electionDate: AZ_PIMA_ELECTION_DATE,
    jurisdictionOcdId: "ocd-division/country:us/state:az/school_district:vail_unified_district",
    officeLevel: "SCHOOL_DISTRICT",
    // DERIVED, and here it is the § 16-928 routing rule that answers: a
    // SCHOOL_DISTRICT contest routes to the COUNTY officer, and the rule id
    // travels with the coverage record so a later session can see WHICH rule
    // was applied rather than re-deriving it.
    filingRegimeState: resolution.status,
    filingRegimeId: resolution.regimeId,
    candidateUniverse: [],
    candidateUniverseSource: `${BALLOT_CITATION} — a MEASURE contest, so the owed universe is committees, not candidacies`,
    committeeUniverse: [],
    expectedFilingAuthorityIds: [PIMA_COUNTY_FILING_OFFICER.id],
    expectedFilingPeriods: [],
    filingsAcquired: [],
    filingsMissing: [
      "Vail USD No. 20 budget-override measure committees: the committee universe itself is unknown — " +
        "no register has been read for this district, so we cannot yet say which filings are owed",
    ],
    latestThroughDate: null,
    perCandidate: [],
    routes: AZ_LOCAL_ROUTES,
    identityGaps: [
      "WHICH Pima County office holds the statutory role of 'officer in charge of elections' is not " +
        "named. states/az/sources.md records that in Arizona this is a single defined role and is NOT " +
        "always the recorder — the brief that said 'county recorder, county elections department or " +
        "board of supervisors' was corrected on that point.",
    ],
    amendmentGaps: [],
    status: "OPEN",
    completeAsOf: null,
  };

  const item = createWorkItem({
    project: PROJECT,
    subject: contestId,
    obligation:
      "Acquire the campaign-finance filings for the Vail Unified School District No. 20 budget " +
      "override continuation on the 2026-11-03 Pima County ballot, from the filing officer A.R.S. " +
      "§ 16-928 names.",
    why:
      "School-district money is exactly the tier this product reaches for and nobody else does. " +
      "A.R.S. § 16-928 routes it to the county officer in charge of elections — not the Secretary of " +
      "State, not the district — and the FEC's own state disclosure directory lists no Arizona county " +
      "officer at all, so federal silence says nothing here. Nothing of this money is acquired: the " +
      "state portal is an SPA shell, rung 6 is unwalked, the county's EasyVote portal is unwalked, " +
      "and whether a vendor tenant list exists is unanswered (AZ21).",
    priority: "P2",
    contract: {
      inheritedRouteFloor: AZ_LOCAL_ROUTES.map((r) => r.declaration.routeId),
      requiresValidation: true,
      requiresAudit: true,
      requiresCompleteDenominator: true,
      /**
       * **NULL, AND THAT IS A DECISION RATHER THAN AN OMISSION.**
       *
       * The narrowing considered and refused here is different from the federal
       * one, and closer to justified: A.R.S. § 16-928 makes the county officer
       * in charge of elections THE filing officer for a school-district
       * election, so a session could never honestly mark that officer's route
       * `NOT_APPLICABLE` while the statute stands. Naming
       * `["INGESTED", "WALKED_NO_YIELD"]` would encode exactly that.
       *
       * It is refused because **`acceptableDispositions` governs the WHOLE
       * inherited floor, and this floor is not uniform.** Two of its seven
       * routes can legitimately land on `NOT_APPLICABLE`:
       *
       *   - `EASYVOTE_TENANT_LIST` asks whether the vendor publishes a tenant
       *     list at all. "It does not" is an ANSWER to that question, not a
       *     failure to ask it.
       *   - `PIMA_COUNTY_SCHOOL_SUPERINTENDENT` is recorded above as explicitly
       *     "not the § 16-928 filing officer" — a route to knowing which
       *     committees exist, which a register found elsewhere can retire.
       *
       * A list that is right about two routes and wrong about two others is not
       * a tightening; it is a mis-aimed one, and it would refuse completion on
       * an honest record. The safe expression of the statutory point is
       * PER-ROUTE, and the contract has no per-route form today.
       *
       * **What would justify a narrowing here:** a per-route disposition
       * contract, or a floor consisting only of routes the statute names as the
       * custodian. Either is a real change to `CompletionContract` and belongs
       * in `lib/control-plane/`, not in a list written from this file. Recorded
       * as a cross-workstream request rather than worked around.
       */
      acceptableDispositions: null,
    },
    now,
  });

  return {
    item,
    resolution,
    coverage,
    routes: AZ_LOCAL_ROUTES,
    openRoutes: openRoutesOf(AZ_LOCAL_ROUTES),
    acquiredEvidencePaths: [],
    fecAbsence,
  };
}

export function campaignFinanceObligations(
  now: string,
  deps?: { fundingForTarget?: (targetKey: string) => FundingCandidate | null },
): readonly CampaignFinanceObligation[] {
  return [federalObligation(now, deps), arizonaLocalObligation(now)];
}
