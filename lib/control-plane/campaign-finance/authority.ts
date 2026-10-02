/** Resolve filing custody from the selected jurisdiction's sourced data. */
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { AcquisitionDepth, AuthorityResolutionStatus, FilingAuthority, FilingRegime, OfficeLevel, PlannedRoute } from "./model.ts";
import {
  FILING_REGIME_ROUTES_PATH, filingRegimePath, jurisdictionFilingRegime,
  loadFilingRegimeRegistry, selectCustodian, selectRegime, FilingRegimeRegistryInvalid,
  type FilingRegimeRecord, type FilingRegimeRegistry, type RegimeEffectivePeriod, type RegimePublisher,
} from "./filing-regime.ts";

const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..", "..");
let registryCache: { path: string; mtime: number; size: number; registry: FilingRegimeRegistry } | null = null;

/** A request loads its jurisdiction only; an absent holding keeps custody unresolved. */
export function filingRegimeRegistry(jurisdiction: string, options: { root?: string } = {}): FilingRegimeRegistry {
  const root = options.root ?? REPOSITORY_ROOT;
  const code = jurisdiction.toUpperCase();
  let path = filingRegimePath(code, root);
  let exists = true;
  try { statSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    exists = false;
    path = join(/* turbopackIgnore: true */ root, ...FILING_REGIME_ROUTES_PATH);
  }
  const stat = statSync(path);
  if (registryCache?.path === path && registryCache.mtime === stat.mtimeMs && registryCache.size === stat.size) return registryCache.registry;
  const source = relative(root, path).replaceAll("\\", "/");
  const registry = loadFilingRegimeRegistry(JSON.parse(readFileSync(path, "utf8")), source);
  if (exists ? registry.jurisdictions.length !== 1 || registry.jurisdictions[0].jurisdiction !== code || registry.regimes.some(regime => regime.jurisdiction !== code)
    : registry.jurisdictions.length > 0 || registry.regimes.length > 0) {
    throw new FilingRegimeRegistryInvalid([{ code: "REGIME_FIELD_INVALID", regimeId: null,
      detail: `Holding for ${code} contains another jurisdiction`, whatItPrevents: "Filing custody being read from another jurisdiction's holding." }], source);
  }
  registryCache = { path, mtime: stat.mtimeMs, size: stat.size, registry };
  return registry;
}

/* ── Resolution ───────────────────────────────────────────────────────────── */

/**
 * What a session that reasoned from PORTALS rather than from the STATUTE would
 * naively expect the custodian's level to be: the same tier as the office.
 *
 * This table exists only to be contradicted. `levelMismatchNote` compares it
 * against the routing rule's actual answer and states the difference out loud,
 * so the mismatch is a reported finding rather than something a reader has to
 * notice.
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

/**
 * The three routing states — `RESOLVED`, `OPEN`, `NO_REGIME_ON_RECORD` — defined
 * once, in `model.ts`, and re-exported here so callers that speak to the
 * resolver need not know which file holds the vocabulary.
 *
 * It is DEFINED there rather than here because `CampaignFinanceCoverage` carries
 * the value and this module already imports that file: defining it here would be
 * a cycle, and defining it in both places would be two vocabularies free to
 * drift apart (RULING 103). The reasoning for the third value lives with the
 * definition.
 */
export {
  AUTHORITY_RESOLUTION_STATUSES,
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
  /** WHO SERVES THE RECORDS — which may be neither the office nor the authority. */
  readonly publisher: RegimePublisher | null;
  /** The office's own level, so a reader can see it differ from the authority's. */
  readonly officeLevel: OfficeLevel;
  /** Null when unresolved; otherwise the authority's level, which may differ. */
  readonly authorityLevel: FilingAuthority["level"] | null;
  /** Set when the two differ. This is the finding, stated rather than implied. */
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
  /**
   * The date the question is asked ABOUT. Omitted means "select by supersession",
   * never "today": a library that guesses today misdates every conclusion.
   */
  readonly asOf?: string | null;
}

/**
 * Resolve the custodian, or return an unresolved state naming what is still owed.
 *
 * There is deliberately no fall-through that picks the state authority when a
 * local one is not known, and none that picks the FEC when a jurisdiction is not
 * in the registry. "The state portal is the only one I can see" is the portal
 * question, and answering the statute question with it is the exact error this
 * file exists to prevent.
 */
export function resolveFilingAuthority(
  query: FilingAuthorityQuery,
  options?: ResolveFilingAuthorityOptions,
): FilingAuthorityResolution {
  const registry = options?.registry ?? filingRegimeRegistry(query.officeLevel === "FEDERAL" ? "US" : query.jurisdiction);
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
 * **A REGIME WE COULD NOT RESOLVE IS NEVER A REASON TO CLOSE A CONTEST.**
 *
 * It is a reason to keep hunting, and this function is the shape that makes that
 * checkable rather than remembered: `coverageState` is the literal `"OPEN"` and
 * `closesTheContest` the literal `false`, so no argument to it produces closure
 * and no caller reading either field can read the wrong answer.
 *
 * The failure it prevents is the quiet one. A resolver that returns "unknown"
 * hands a caller a falsy value, and a caller with a falsy authority writes
 * "no filing authority — no money to report", which is an absence asserted about
 * a government on the strength of this repository not having read a statute. A
 * finite attempt count never earns an absence, and neither does an unread one:
 * the honest sentence is "I have run out of ideas", which is a claim about the
 * session, never "this is not published", which is a claim about a government.
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
 * **It now runs through the registry**, so the same guarantee holds for a
 * jurisdiction whose statute has never been read: the resolution comes back
 * `NO_REGIME_ON_RECORD`, the statute route is owed and named, and the verdict is
 * still `OPEN`. There is no argument to this function that yields a closed
 * contest.
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
      "The FEC holds federal filings. State and local custody must be read from the selected " +
      "jurisdiction's filing rule; the national disclosure directory supplies office leads " +
      "and does not establish that this contest's state or local reports are absent.",
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
