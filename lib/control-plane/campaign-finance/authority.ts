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
 * Three consequences, all encoded rather than remembered:
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
 *      it, and the correction is carried in the registry.
 *
 *   3. **Local campaign finance in Arizona is FEDERATED BY STATUTE**, across
 *      **109 filing jurisdictions — 1 State, 15 County, 93 City/Town**, from the
 *      state's own `Jurisdictions.txt` pulled 2026-08-26. A claim of
 *      campaign-finance coverage in Arizona without that denominator is
 *      meaningless, so the denominator travels with the regime.
 *
 * ## WHERE THE ROUTING NOW LIVES, and why it moved
 *
 * Every routing rule above is **DATA**, in
 * `data/campaign-finance/filing-regimes.json`, loaded and validated by
 * `filing-regime.ts`. This file resolves; it does not remember.
 *
 * The reason is national expansion. The same three facts hold in fifty states
 * with fifty different answers, and the shape that cannot carry them is an
 * `if (state === "AZ") … else if (state === "NH") …` tree — not because it is
 * ugly, but because **a state nobody has read falls off the end of it into
 * whatever the last branch says.** A fall-through in a filing-authority
 * resolver hands a jurisdiction a custodian nobody checked, and an absence then
 * gets asserted about a government that was never asked. There is no
 * fall-through here: a jurisdiction absent from the registry resolves to
 * `NO_REGIME_ON_RECORD`, which keeps the contest open and names the statute
 * still owed.
 *
 * Adding a state is therefore a change to the JSON and to nothing under `lib/`.
 * `tests/filing-regime-registry.test.ts` proves that against a fixture
 * jurisdiction rather than asserting it in prose.
 *
 * ## When it cannot resolve
 *
 * It returns `OPEN` (the routing rule is known, the office holding it is not) or
 * `NO_REGIME_ON_RECORD` (we have not read the rule), and names the routes still
 * to walk. It never guesses a custodian. A guessed custodian produces a hunt
 * against the wrong government, and then an absence about the right one.
 *
 * ## Time
 *
 * Nothing here reads a clock. `asOf` is a caller-supplied parameter throughout,
 * and omitting it selects by SUPERSESSION rather than by a guessed today.
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
import {
  FILING_REGIME_REGISTRY_PATH,
  authoritiesById,
  jurisdictionFilingRegime,
  loadFilingRegimeRegistry,
  requireAuthority,
  selectCustodian,
  selectRegime,
  type FilingRegimeRecord,
  type FilingRegimeRegistry,
  type RegimeEffectivePeriod,
  type RegimePublisher,
} from "./filing-regime.ts";

/* ── The registry, loaded once ────────────────────────────────────────────── */

/**
 * The path is resolved from THIS MODULE rather than from `process.cwd()`.
 *
 * The constants below are module-level and therefore evaluate at import time, so
 * a cwd-relative read would make importing this file depend on which directory a
 * script happened to start in. `lib/funding/snapshot.ts` reads its snapshot
 * lazily inside a function and can afford `process.cwd()`; a module constant
 * cannot.
 */
const REGISTRY_FILE = join(import.meta.dirname, "..", "..", "..", ...FILING_REGIME_REGISTRY_PATH);
const REGISTRY_CITATION = FILING_REGIME_REGISTRY_PATH.join("/");

let registryCache: FilingRegimeRegistry | null = null;

/**
 * The committed filing-regime registry, validated.
 *
 * A malformed or ambiguous registry throws `FilingRegimeRegistryInvalid` here,
 * at import, rather than resolving half the jurisdictions and leaving the rest
 * looking unread. Refusal is whole on purpose: a partial routing table sends
 * money questions to the wrong government and reports the answer as a fact.
 */
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

/**
 * The FEC.
 *
 * `statutoryBasis` is **null on purpose**, and the registry carries that null.
 * This repository has read Arizona's filing-officer statute from `azleg.gov` and
 * quoted it; it has NOT read whichever federal provision names the FEC as the
 * federal filing officer. `states/az/sources.md` poses that as the generalising
 * question asked of every state — answered for AZ (§ 16-928), NH (RSA 664:7 and
 * 664:6) and NJ. The federal answer is not in this repository, so the field
 * stays null and the open question is named. A plausible citation would be a
 * fabrication in the one field whose whole job is being checkable.
 */
export const FEC_AUTHORITY: FilingAuthority = requireAuthority(REGISTRY, "us:federal:fec");

/** The Arizona Secretary of State, as a custodian rather than as a portal. */
export const AZ_SECRETARY_OF_STATE: FilingAuthority = requireAuthority(
  REGISTRY,
  "az:state:secretary-of-state",
);

/**
 * The Pima County officer in charge of elections.
 *
 * **Named by ROLE, because the statute names a role.** The individual office
 * holding that role in Pima County is not asserted — `states/az/sources.md`
 * records that the county-level officer is *the county officer in charge of
 * elections*, "a single defined role and in Arizona is not always the recorder",
 * correcting a brief that had said "county recorder, county elections department
 * or board of supervisors". Which office that is in Pima County is an OPEN
 * identification, carried on `statutoryOpenQuestion` in the registry.
 */
export const PIMA_COUNTY_FILING_OFFICER: FilingAuthority = requireAuthority(
  REGISTRY,
  "az:county:pima:officer-in-charge-of-elections",
);

/** The City of Tucson clerk — the statute's municipal branch, for Pima's largest city. */
export const TUCSON_CITY_CLERK: FilingAuthority = requireAuthority(
  REGISTRY,
  "az:municipal:tucson:city-clerk",
);

/**
 * The Citizens Clean Elections Commission — a SECOND authority over the same
 * money, not a substitute for the first.
 *
 * Carried in the registry as a `coRegulator` rather than as a custodian, because
 * a model with one custodian slot per contest would silently drop it. The FEC's
 * own combined directory lists it under ARIZONA with "Regulation of Campaign
 * Finance Reports" among its functions, beside the Secretary of State.
 */
export const AZ_CLEAN_ELECTIONS_COMMISSION: FilingAuthority = requireAuthority(
  REGISTRY,
  "az:state:clean-elections-commission",
);

/** Every authority the registry knows, by id. */
export const AUTHORITIES_BY_ID: ReadonlyMap<string, FilingAuthority> = authoritiesById(REGISTRY);

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

export const FEDERAL_REGIME: FilingRegime = requireRegime("US");

/**
 * Arizona's regime, assembled from the three § 16-928 routing rules.
 *
 * Read the `authorityLevel` column against the `officeLevel` column. Four of the
 * seven rows disagree, and that disagreement is the finding.
 */
export const ARIZONA_REGIME: FilingRegime = requireRegime("AZ");

/** The regimes this repository has read a routing rule for. Never a complete list. */
export const REGIMES: readonly FilingRegime[] = REGISTRY.jurisdictions
  .map((j) => jurisdictionFilingRegime(REGISTRY, j.jurisdiction))
  .filter((r): r is FilingRegime => r !== null);

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
