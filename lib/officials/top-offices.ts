import type { SeatHolder } from "./lookup.ts";

/** Who runs this body: whoever presides and whoever runs it day to day, whatever those offices are called. */

/** Matched case-insensitively against the body's own published office title. */
interface OfficePattern {
  /** What this role IS, in reader language — never an enum, never a key. */
  role: string;
  test: RegExp;
}

/** A deputy holds a different, junior office and is never picked. */
const SUBORDINATE = /\b(vice|deputy|assistant)\b/i;

/** Holding this office temporarily: ranked behind a substantive holder of the same office, never refused. */
const TEMPORARY = /\b(acting|interim)\b/i;

/**
 * The ELECTED head — whoever the body's own published title says leads it.
 * Ordered by seniority of office, not by roster position.
 */
const HEAD: OfficePattern[] = [
  { role: "Mayor", test: /\bmayor\b/i },
  { role: "Presides", test: /\bcommissioner director\b/i },
  { role: "Presides", test: /\b(president|chair(man|woman|person)?)\b/i },
  { role: "Presides", test: /\b(speaker|majority leader)\b/i },
];

/** The APPOINTED executive — hired by the body, not elected to it. */
const EXECUTIVE: OfficePattern[] = [
  { role: "Runs it day to day", test: /\bsuperintendent\b/i },
  { role: "Runs it day to day", test: /\b(administrator|manager)\b/i },
  { role: "Runs it day to day", test: /\bexecutive director\b/i },
  { role: "Runs it day to day", test: /\b(county|city|town) executive\b/i },
];

export interface TopOffice {
  holder: SeatHolder;
  /** What this person does here, in reader language. Never the raw title. */
  role: string;
}

/**
 * The honest line for a body whose top offices are not sourced yet.
 *
 * Describes OUR research, never the body — a body always has someone presiding,
 * and saying otherwise would be a claim about a government we have no record
 * for.
 */
export const TOP_OFFICES_GAP =
  "We haven’t sourced who leads this body yet.";

/**
 * Up to two holders: whoever presides, then whoever runs it day to day; never padded. A single-seat division returns its
 * one officeholder.
 */
export function topOfficesFor(holders: readonly SeatHolder[]): TopOffice[] {
  const found: TopOffice[] = [];

  const pick = (patterns: OfficePattern[]): TopOffice | null => {
    for (const pattern of patterns) {
      const eligible = holders.filter((h) => {
        const title = h.officeTitle ?? "";
        if (!pattern.test.test(title)) return false;
        // A vice chair is not who presides, and a deputy administrator is not who runs it.
        if (SUBORDINATE.test(title)) return false;
        return !found.some((f) => f.holder.id === h.id);
      });
      if (eligible.length === 0) continue;
      // A substantive holder outranks a temporary one for the same office; a temporary holder outranks the next pattern.
      const hit =
        eligible.find((h) => !TEMPORARY.test(h.officeTitle ?? "")) ?? eligible[0]!;
      return { holder: hit, role: pattern.role };
    }
    return null;
  };

  const head = pick(HEAD);
  if (head) found.push(head);

  const executive = pick(EXECUTIVE);
  if (executive) {
    found.push(executive);
  } else {
    // No appointed executive: a second elected head is the next most senior office, else one row.
    const second = pick(HEAD);
    if (second) found.push(second);
  }

  // A single-seat division: the one officeholder is the representation.
  if (found.length === 0 && holders.length === 1) {
    return [{ holder: holders[0], role: holders[0].officeTitle ?? "Represents this district" }];
  }

  return found;
}

/**
 * Whether "Who runs it" applies: only where the office holds executive authority over a governing entity, never a
 * legislative district or Senate seat. Accepts both the registry and map vocabularies; anything unrecognised is false.
 */
const RUNS_SOMETHING = new Set([
  // registry vocabulary
  "county",
  "place",
  "school_district",
  // map vocabulary
  "municipal",
  "school-unified",
  "school-elementary",
  "school-secondary",
]);

export function runsSomething(divisionType: string | null | undefined): boolean {
  if (divisionType === null || divisionType === undefined) return false;
  return RUNS_SOMETHING.has(divisionType);
}

/**
 * The appointed executive first, then everyone else in published order: a stable partition by the EXECUTIVE table's
 * seniority, a substantive holder ahead of a temporary one. Orders offices, never people.
 */
export function rosterInReadingOrder<T extends { officeTitle: string | null }>(
  holders: readonly T[],
): T[] {
  /** Which EXECUTIVE pattern this title matches, or -1. Lower is more senior. */
  const executiveRank = (holder: T): number => {
    const title = holder.officeTitle ?? "";
    if (SUBORDINATE.test(title)) return -1;
    return EXECUTIVE.findIndex((pattern) => pattern.test.test(title));
  };

  const executives = holders
    .map((holder, index) => ({ holder, index, rank: executiveRank(holder) }))
    .filter((entry) => entry.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        /* A substantive holder ahead of an acting or interim one. */
        Number(TEMPORARY.test(a.holder.officeTitle ?? "")) -
          Number(TEMPORARY.test(b.holder.officeTitle ?? "")) ||
        /* Otherwise the body's own published order, untouched. */
        a.index - b.index,
    )
    .map((entry) => entry.holder);

  const rest = holders.filter((holder) => executiveRank(holder) < 0);
  return [...executives, ...rest];
}
