/**
 * Resolves the legally responsible filing custodian for a contest, committee
 * and period, which is not the same as which portal covers that level: the
 * custodian's level need not match the office's level (a school district may
 * file with a county officer).
 *
 * Routing rules are data in `data/campaign-finance/filing-regimes.json`,
 * validated by `filing-regime.ts`. A jurisdiction absent from the registry
 * resolves to `NO_REGIME_ON_RECORD`; nothing falls through to a guessed
 * custodian. When it cannot resolve it returns `OPEN` or `NO_REGIME_ON_RECORD`
 * and names the routes still to walk.
 *
 * Nothing here reads a clock. Omitting `asOf` selects by supersession.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  AcquisitionDepth,
  AuthorityResolutionStatus,
  FilingAuthority,
  FilingRegime,
  OfficeLevel,
  PlannedRoute,
} from "./model.ts";
import { FILING_REGIME_REGISTRY_PATH, jurisdictionFilingRegime, loadFilingRegimeRegistry, requireAuthority, selectCustodian, selectRegime, type FilingRegimeRecord, type FilingRegimeRegistry, type RegimeEffectivePeriod, type RegimePublisher } from "./filing-regime.ts";

/* ── The registry, loaded once ────────────────────────────────────────────── */

/** Resolved from this module, not `process.cwd()`: the constants below evaluate at import time. */
const REGISTRY_FILE = join(import.meta.dirname, "..", "..", "..", ...FILING_REGIME_REGISTRY_PATH);
const REGISTRY_CITATION = FILING_REGIME_REGISTRY_PATH.join("/");

let registryCache: FilingRegimeRegistry | null = null;

/** The committed filing-regime registry. A malformed or ambiguous registry throws at import; refusal is whole. */
export function filingRegimeRegistry(): FilingRegimeRegistry {
  if (!registryCache) {
    registryCache = loadFilingRegimeRegistry(
      JSON.parse(readFileSync(REGISTRY_FILE, "utf8")),
      REGISTRY_CITATION,
    );
  }
  return registryCache;
}

/* ── The authorities, READ FROM the registry rather than typed twice ──────── */

const REGISTRY = filingRegimeRegistry();

/** The FEC. `statutoryBasis` is null until the federal provision has been read from source. */
export const FEC_AUTHORITY: FilingAuthority = requireAuthority(REGISTRY, "us:federal:fec");

/** The Arizona Secretary of State, as a custodian rather than as a portal. */
export const AZ_SECRETARY_OF_STATE: FilingAuthority = requireAuthority(
  REGISTRY,
  "az:state:secretary-of-state",
);

/** The county officer in charge of elections, named by role; which office holds it is an open identification. */
export const PIMA_COUNTY_FILING_OFFICER: FilingAuthority = requireAuthority(
  REGISTRY,
  "az:county:pima:officer-in-charge-of-elections",
);

/** The city clerk: the statute's municipal branch. */
export const TUCSON_CITY_CLERK: FilingAuthority = requireAuthority(
  REGISTRY,
  "az:municipal:tucson:city-clerk",
);

/* ── The regimes, as the jurisdiction-level view ──────────────────────────── */

function requireRegime(jurisdiction: string): FilingRegime {
  const regime = jurisdictionFilingRegime(REGISTRY, jurisdiction);
  if (!regime) {
    throw new Error(
      `No jurisdiction row for "${jurisdiction}" in ${REGISTRY_CITATION}. This constant names a ` +
        "jurisdiction the registry no longer carries, which would resolve to undefined and report " +
        "a routing table that does not exist.",
    );
  }
  return regime;
}

/** Arizona's regime. Read `authorityLevel` against `officeLevel`: they need not agree. */
export const ARIZONA_REGIME: FilingRegime = requireRegime("AZ");

/* ── Resolution ───────────────────────────────────────────────────────────── */

/**
 * The custodian level a portal-first reading would expect (the office's own
 * tier). `levelMismatchNote` compares it with the rule's actual answer.
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
  statutoryBasis?: string | null,
): string | null {
  if (NAIVE_LEVEL_FOR_OFFICE[officeLevel] === authorityLevel) return null;
  const basis = statutoryBasis ?? "The filing-officer rule";
  return (
    `LEVEL MISMATCH, AND IT IS THE FINDING. The office level is ${officeLevel}; the tier a portal ` +
    `hunt would expect is ${NAIVE_LEVEL_FOR_OFFICE[officeLevel]}; the filing authority's level is ` +
    `${authorityLevel}. ${basis} routes by WHICH ELECTION the money influences, not by the ` +
    `tier of the body — "${quote}". The authority's level need not match the office's, and where ` +
    "the two disagree that is a fact about the law rather than an error in the record."
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

/** Defined in `model.ts` (which this module imports) and re-exported here. */
export {
  
  type AuthorityResolutionStatus,
} from "./model.ts";

/** The statuses under which a custodian is NOT known. Neither ever closes a contest. */
export const UNRESOLVED_AUTHORITY_STATUSES: readonly AuthorityResolutionStatus[] = [
  "OPEN",
  "NO_REGIME_ON_RECORD",
];

export interface FilingAuthorityResolution {
  readonly status: AuthorityResolutionStatus;
  /** Null whenever status is not RESOLVED. There is no partial custodian. */
  readonly authority: FilingAuthority | null;
  /** Co-existing authorities over the same money. Never a substitute for `authority`. */
  readonly alsoRegulatedBy: readonly FilingAuthority[];
  readonly regime: FilingRegime | null;
  /** The specific routing rule selected, when one was. */
  readonly regimeId: string | null;
  readonly regimeRecord: FilingRegimeRecord | null;
  /** The window the selected rule is evidence about. Null bounds carry their open question. */
  readonly effective: RegimeEffectivePeriod | null;
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  readonly statutoryBasis: string | null;
  readonly statutoryQuote: string | null;
  /** The custodian role in the rule's own words, even when the office is unknown. */
  readonly custodianRole: string | null;
  /** Who serves the records, which may be neither the office nor the authority. */
  readonly publisher: RegimePublisher | null;
  /** The office's own level, so a reader can see it differ from the authority's. */
  readonly officeLevel: OfficeLevel;
  /** Null when unresolved; otherwise the authority's level, which may differ. */
  readonly authorityLevel: FilingAuthority["level"] | null;
  /** Set when the two differ. */
  readonly levelMismatchNote: string | null;
  /** Adapter route ids bearing on this regime's records. */
  readonly applicableRouteIds: readonly string[];
  /** Routes still owed. Non-empty whenever the custodian is not resolved. */
  readonly openRoutes: readonly PlannedRoute[];
  readonly why: string;
}

export interface ResolveFilingAuthorityOptions {
  /** Defaults to the committed registry. A test may pass its own. */
  readonly registry?: FilingRegimeRegistry;
  /** The date the question is asked about. Omitted selects by supersession, never "today". */
  readonly asOf?: string | null;
}

/**
 * Resolve the custodian, or return an unresolved state naming what is still
 * owed. There is no fall-through to the state authority or the FEC.
 */
export function resolveFilingAuthority(
  query: FilingAuthorityQuery,
  options?: ResolveFilingAuthorityOptions,
): FilingAuthorityResolution {
  const registry = options?.registry ?? filingRegimeRegistry();
  const selection = selectRegime(registry, {
    jurisdiction: query.jurisdiction,
    officeLevel: query.officeLevel,
    asOf: options?.asOf ?? null,
  });

  if (!selection.regime) {
    const jurisdictionRegime =
      selection.jurisdictionRecord === null
        ? null
        : jurisdictionFilingRegime(registry, selection.jurisdictionRecord.jurisdiction, options?.asOf ?? null);
    return {
      status: "NO_REGIME_ON_RECORD",
      authority: null,
      alsoRegulatedBy: [],
      regime: jurisdictionRegime,
      regimeId: null,
      regimeRecord: null,
      effective: null,
      supersedes: null,
      supersededBy: null,
      statutoryBasis: selection.jurisdictionRecord?.statutoryBasis ?? null,
      statutoryQuote: null,
      custodianRole: null,
      publisher: null,
      officeLevel: query.officeLevel,
      authorityLevel: null,
      levelMismatchNote: null,
      applicableRouteIds: [],
      openRoutes: registry.noRegimeRoutes,
      why:
        `${selection.why}${selection.ambiguity ? ` AMBIGUITY: ${selection.ambiguity.detail}.` : ""} ` +
        "NO_REGIME_ON_RECORD is a statement about this repository and never about a government: it " +
        "does not close the contest, does not route to the FEC, and does not fall back to any " +
        "authority. The statute-reading route is owed and is named.",
    };
  }

  const regime = selection.regime;
  const { custodian, scopeAsked } = selectCustodian(regime, {
    county: query.county ?? null,
    municipality: query.municipality ?? null,
  });
  const jurisdictionRegime = jurisdictionFilingRegime(
    registry,
    regime.jurisdiction,
    options?.asOf ?? null,
  );

  if (!custodian) {
    return {
      status: "OPEN",
      authority: null,
      alsoRegulatedBy: [],
      regime: jurisdictionRegime,
      regimeId: regime.regimeId,
      regimeRecord: regime,
      effective: regime.effective,
      supersedes: regime.supersedes,
      supersededBy: regime.supersededBy,
      statutoryBasis: regime.provenance.statutoryBasis,
      statutoryQuote: null,
      custodianRole: regime.custodianRole,
      publisher: null,
      officeLevel: query.officeLevel,
      authorityLevel: null,
      levelMismatchNote: null,
      applicableRouteIds: regime.applicableRouteIds,
      openRoutes:
        regime.custodianUnresolvedRoutes.length > 0
          ? regime.custodianUnresolvedRoutes
          : registry.noRegimeRoutes,
      why:
        regime.custodianUnresolvedNote.replace("{scope}", scopeAsked ?? "(unnamed)") +
        " The ROUTING RULE is known and the OFFICE holding it is not; the custodian is therefore " +
        "null rather than the jurisdiction-wide authority, because answering the statute question " +
        "with the state portal is the error this file exists to prevent.",
    };
  }

  const authority = custodian.authority;
  const quote = regime.provenance.statutoryQuote;
  return {
    status: "RESOLVED",
    authority,
    alsoRegulatedBy: regime.coRegulators,
    regime: jurisdictionRegime,
    regimeId: regime.regimeId,
    regimeRecord: regime,
    effective: regime.effective,
    supersedes: regime.supersedes,
    supersededBy: regime.supersededBy,
    statutoryBasis: regime.provenance.statutoryBasis,
    statutoryQuote: quote,
    custodianRole: regime.custodianRole,
    publisher: custodian.publisher,
    officeLevel: query.officeLevel,
    authorityLevel: authority.level,
    levelMismatchNote:
      quote === null
        ? null
        : levelMismatchNote(query.officeLevel, authority.level, quote, regime.provenance.statutoryBasis),
    applicableRouteIds: regime.applicableRouteIds,
    openRoutes: [],
    why: selection.why,
  };
}

/* ── An unresolved authority never closes a contest ───────────────────────── */

export interface UnresolvedAuthorityVerdict {
  readonly contestId: string;
  /** Always "OPEN". There is no input to this function that closes a contest. */
  readonly coverageState: "OPEN";
  /** Never true. Present so a caller reading a boolean cannot read the wrong one. */
  readonly closesTheContest: false;
  readonly routingState: AuthorityResolutionStatus;
  readonly resolution: FilingAuthorityResolution;
  readonly owedRoutes: readonly PlannedRoute[];
  readonly why: string;
}

/**
 * An unresolved regime never closes a contest: `coverageState` is literal
 * `"OPEN"` and `closesTheContest` literal `false`.
 */
export function unresolvedAuthorityKeepsCoverageOpen(input: {
  contestId: string;
  resolution: FilingAuthorityResolution;
  /** Routes the caller already knows are owed. */
  knownRoutes?: readonly PlannedRoute[];
}): UnresolvedAuthorityVerdict {
  const owed = [...(input.knownRoutes ?? []), ...input.resolution.openRoutes];
  const unresolved = UNRESOLVED_AUTHORITY_STATUSES.includes(input.resolution.status);
  return {
    contestId: input.contestId,
    coverageState: "OPEN",
    closesTheContest: false,
    routingState: input.resolution.status,
    resolution: input.resolution,
    owedRoutes: owed,
    why: unresolved
      ? `The filing authority for ${input.contestId} is ${input.resolution.status}: ` +
        `${input.resolution.why} That is a statement about what this repository has read. It is not ` +
        "a statement about whether these filings exist, and it closes nothing. The owed routes are " +
        "named so the next session starts where this one stopped."
      : `The filing authority for ${input.contestId} is RESOLVED (${input.resolution.authority?.name}). ` +
        "Resolution is not completion either: knowing the custodian is AUTHORITY_RESOLVED depth, and " +
        "the filings themselves are still owed.",
  };
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
 * FEC absence is not closure: the FEC does not hold state and local filings.
 * The verdict is always `OPEN`, including for a jurisdiction whose statute has
 * never been read (`NO_REGIME_ON_RECORD`).
 */
export function fecAbsenceIsNotClosure(input: {
  contestId: string;
  jurisdiction: string;
  officeLevel: OfficeLevel;
  county?: string | null;
  municipality?: string | null;
  /** Routes the caller already knows are owed at the state/local tier. */
  knownLocalRoutes?: readonly PlannedRoute[];
  registry?: FilingRegimeRegistry;
  asOf?: string | null;
}): FecAbsenceVerdict {
  const resolution = resolveFilingAuthority(
    {
      jurisdiction: input.jurisdiction,
      officeLevel: input.officeLevel,
      contestId: input.contestId,
      county: input.county ?? null,
      municipality: input.municipality ?? null,
    },
    { registry: input.registry, asOf: input.asOf ?? null },
  );

  const boundary: PlannedRoute = {
    declaration: {
      routeId: "FEC_JURISDICTION_BOUNDARY",
      label: "Record that the FEC's jurisdiction ends above this contest",
      target: input.contestId,
    },
    disposition: "NOT_APPLICABLE",
    note:
      "data/reference/fec_combined_federal_state_disclosure_directory.csv lists, for ARIZONA, the " +
      "Secretary of State, the Corporation Commission and the Citizens Clean Elections Commission " +
      "— and no county officer and no city or town clerk. The federal directory does not reach " +
      "this tier, so its silence is a fact about its scope.",
    citation: "data/reference/fec_combined_federal_state_disclosure_directory.csv",
    permission: "CANNOT_TELL",
    transport: null,
    rung: null,
    lastAttemptedOn: null,
  };

  const owed = [...(input.knownLocalRoutes ?? []), ...resolution.openRoutes, boundary];

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
      "local custodians named by the filing rule are owed, and are listed. Absence is never asserted.",
  };
}
