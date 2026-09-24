/**
 * **WHAT THE RUNNER MEASURED ABOUT EACH SELECTED SCOPE, THIS CYCLE.**
 * (Expansion controls, 2026-09-23.)
 *
 * The standing runner resolves every selected scope at the start of a cycle —
 * its ZCTAs from the published Census geography lookup, the registered work
 * whose territory overlaps them, the spend attributed to that work, and the
 * coverage the scope has — and writes the result here, on the research state
 * (`ResearchState.expansion`). The console renders it; it never re-derives it,
 * because the console has neither the registries nor the territory index, and
 * a second derivation is a second answer.
 *
 * ## Membership, in one sentence
 *
 * A piece of work is IN a scope when the government it is about certainly
 * overlaps the scope inside at least one ZCTA: it touches a ZCTA lying wholly
 * inside the scope, or inside one ZCTA its area share and the scope's sum past
 * the whole (`membership.ts` has the rule and the margin). Merely sharing a
 * border ZCTA is not enough — that is how neighbouring counties would leak in.
 * ZCTAs are the Census Bureau's ZIP-code tabulation areas, compared by AREA
 * share — not USPS ZIP codes, and not a claim about which residents a
 * government serves. A government's territory comes from the Census of
 * Governments unit it was enumerated from (`data/derived/census-unit-zips.json`
 * and the sampled overlap behind it, `data/derived/zip-governments.json`).
 * Statewide work (the state's own records) is in no sub-state scope: it serves
 * every scope in the state alike.
 *
 * Every count here is either a real count or null, and null renders as the
 * named reason it is null — never as zero.
 *
 * PURE. Types and small helpers only.
 */

export const EXPANSION_READING_FORMAT_VERSION = 1;

/** How membership is decided, in the words the page prints beside every count. */
export const MEMBERSHIP_METHOD =
  "In this geography means: the government the work is about certainly overlaps it inside at least one ZCTA (Census ZIP-code " +
  "tabulation areas, compared by area share — not USPS ZIP codes). Either the government reaches a ZCTA lying wholly inside the " +
  "geography, or inside one ZCTA the government's share and the geography's share add up to more than the whole. Sharing a " +
  "border ZCTA is not enough, so a neighbouring county is not pulled in. Statewide work is in no single geography.";

/** At most this many names travel in a list; the count beside it is always the whole count. */
export const READING_LIST_CAP = 25;

export type ScopeResolutionReading =
  | { readonly kind: "RESOLVED"; readonly zctaCount: number }
  | { readonly kind: "UNRESOLVED"; readonly why: string };

export interface ScopeCoverageReading {
  /** Registered governments (from the covered-jurisdiction registries) whose territory overlaps the scope. */
  readonly registeredJurisdictions: number;
  readonly registeredByClass: Readonly<Record<string, number>>;
  /** Of those, how many carry at least one standing obligation (a clock) today. */
  readonly withWork: number;
  /** Up to READING_LIST_CAP of the governments with work, by name. */
  readonly withWorkSample: readonly { readonly subjectId: string; readonly name: string; readonly govClass: string }[];
  /** Census of Governments units overlapping the scope that no covered registry carries (a state not launched). */
  readonly notRegisteredCensusUnits: number;
  readonly notRegisteredByType: Readonly<Record<string, number>>;
  /** Scope ZCTAs overlapped by at least one local government that has work. */
  readonly zctasWithLocalWork: number;
  /** Scope ZCTAs no local government with work overlaps: the gap. */
  readonly gapZctas: number;
  readonly gapSample: readonly string[];
}

export interface ScopeSpendReading {
  /** Attributed model spend in the rolling 24 hours before the cycle started. Null when any in-scope row is unmeasured. */
  readonly rolling24hUsd: number | null;
  readonly sevenDayUsd: number | null;
  readonly measuredRows24h: number;
  readonly unmeasuredRows24h: number;
  readonly measuredRows7d: number;
  readonly unmeasuredRows7d: number;
}

export interface ScopeWorkReading {
  /** Standing obligations registered for governments in the scope. */
  readonly registeredObligations: number;
  /** Distinct subjects those obligations are about. */
  readonly subjects: number;
  /** The subjects, capped at READING_LIST_CAP * 8 for the assignment filter; `subjects` is the whole count. */
  readonly subjectIds: readonly string[];
  readonly subjectIdsComplete: boolean;
  readonly dueThisCycle: number;
  /** Due rows this scope placed ahead of the rest in the Scout order. */
  readonly scoutRowsPlacedFirst: number;
  /** Paid Scouts admitted for work in this scope this cycle. Null until the dispatch phase ends. */
  readonly scoutAdmitted: number | null;
}

export interface ExpansionScopeReading {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly stateAbbr: string;
  readonly priority: number;
  readonly budgetUsd: number;
  readonly resolution: ScopeResolutionReading;
  /** Null while the scope is unresolved: nothing can be said to be in it. */
  readonly work: ScopeWorkReading | null;
  readonly spend: ScopeSpendReading | null;
  readonly coverage: ScopeCoverageReading | null;
  /** The budget verdict at cycle start, in plain words. */
  readonly budgetSays: string;
  /** Paid Scouts this scope's budget held this cycle (code SCOPE_BUDGET). Null until the dispatch phase ends. */
  readonly heldThisCycle: number | null;
}

export interface ExpansionCycleReading {
  readonly formatVersion: 1;
  /** The cycle start this reading belongs to. */
  readonly at: string;
  /** Which Census lookup backed the resolution. Anything but "published" resolves nothing. */
  readonly lookup: {
    readonly source: "published" | "bootstrap" | "unavailable" | "NOT_READ";
    readonly versionId: string | null;
    readonly detail: string | null;
  };
  /** The territory index the membership used, and how much of the registered work it could place. */
  readonly territory: {
    readonly method: string;
    /** Every standing obligation registered this cycle — the denominator for a scope's share. */
    readonly registeredObligations: number;
    readonly placedSubjects: number;
    readonly unplacedSubjects: number;
    readonly statewideSubjects: number;
    readonly detail: string | null;
  };
  /** Entries on the policy row that could not be read as a scope; while > 0 paid work is held. */
  readonly malformedScopes: number;
  readonly scopes: readonly ExpansionScopeReading[];
  /** How the order was applied this cycle, in plain words. */
  readonly orderSays: string;
}

/** A value on the research state that is not a reading reads as none, never as an empty scope list. */
export function isExpansionCycleReading(value: unknown): value is ExpansionCycleReading {
  return isVersionedCycleReading(value, EXPANSION_READING_FORMAT_VERSION, "scopes");
}

/**
 * The one check every per-cycle reading on the research state passes: an
 * object at the expected format version carrying its list. Anything else reads
 * as no reading at all — never as an empty list (the expansion reading here,
 * and the MW-028 dispatch-work reading).
 */
export function isVersionedCycleReading(value: unknown, formatVersion: number, listField: string): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { formatVersion?: unknown }).formatVersion === formatVersion &&
    Array.isArray((value as Record<string, unknown>)[listField])
  );
}
