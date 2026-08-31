import type { Division, DivisionType } from "@/lib/registry/types";

/**
 * **WGH-5 — THE ADDRESS STANDARD FOR THE WHOLE PRODUCT.**
 * (2026-08-22, the author's 8/22 walkthrough, item 9.)
 *
 * One resolver, one component, used everywhere an address is needed. This file
 * is the pure half: geometry answers come in as arguments, so it runs in a
 * test, in a route handler, or against tiles later without change.
 *
 * ## The three states, and why two were not enough
 *
 * The product had a success/failure shape. `lookupStreetInZip` had already
 * grown a third case — `CROSSES` — and it was the right instinct, but it was
 * measured the wrong way and used in only one place:
 *
 * - It decided ambiguity by **how far apart the sampled points were in
 *   kilometres** (`MAX_SPREAD_KM`). That is a proxy. A long straight street
 *   inside one township is spread out and perfectly unambiguous; a short
 *   street sitting exactly on a municipal line is compact and genuinely split.
 * - It was **all-or-nothing**. A street unambiguous at county and municipal
 *   level but split at the congressional level came back `CROSSES`, and the
 *   whole page stayed hedged over one row.
 *
 * So ambiguity is measured here on the thing it is actually about: **do the
 * sampled points land in the same divisions.** Per level, independently.
 *
 * ## Partial ambiguity resolves partially, and that is the point
 *
 * A street that is unambiguous at county and municipal level and split at the
 * congressional level **confirms county and municipal immediately** and hedges
 * only the congressional row. The page is never held hostage to one ambiguous
 * level. This is what makes the follow-up question honest: the reader is asked
 * for a house number for a NAMED reason — *this street crosses the line
 * between two U.S. House districts* — rather than as a generic form step.
 *
 * ## A level we hold no geometry for is OUR gap, never their split
 *
 * If no sampled point produced any division at a level, that level is not
 * ambiguous. It is **unheld**, and it is reported separately, because
 * "we haven't got this boundary" and "your street crosses this boundary" are
 * facts about different parties and may never render as the same sentence.
 * A render default may never manufacture a claim.
 */

/** The levels a reader can be resolved at. These are `DivisionType` verbatim. */
export type LevelKey = DivisionType;

/** Walked in this order everywhere, closest to the reader first. */
export const LEVEL_ORDER: readonly LevelKey[] = [
  "place",
  "school_district",
  "county",
  "sldl",
  "sldu",
  "cd",
] as const;

/**
 * Plain language, 15-year-old test. No identifier, no enum value, no OCD-ID
 * reaches a reader — these are the label map the reader-surface rule requires.
 */
export const LEVEL_LABEL: Record<LevelKey, string> = {
  place: "your town or city",
  school_district: "your school district",
  county: "your county",
  sldl: "your state assembly district",
  sldu: "your state senate district",
  cd: "your U.S. House district",
};

/**
 * What a split at this level actually changes for the reader.
 *
 * The ask must be visibly caused by the reader's own street, so the prompt
 * says which boundary is split AND which office it decides. "We need your
 * house number" is a form step; "this street runs along the line between two
 * U.S. House districts, so it decides which member of Congress is yours" is a
 * reason.
 */
export const LEVEL_OFFICE: Record<LevelKey, string> = {
  place: "your mayor and council",
  school_district: "your school board",
  county: "your county government",
  sldl: "your state assembly member",
  sldu: "your state senator",
  cd: "your member of Congress",
};

export interface LevelResolution {
  level: LevelKey;
  /** Reader-facing. Never an enum value. */
  label: string;
  /** The divisions every sampled point agreed on. Empty when not certain. */
  divisionIds: string[];
  /** Reader-facing names of the agreed divisions, for the confirmed line. */
  divisionLabels: string[];
  certain: boolean;
  /**
   * Every candidate the samples produced, when they disagreed. This is what
   * makes the follow-up question specific — the reader is told which two
   * places their street runs between.
   */
  candidates: { ocdId: string; label: string }[];
}

export type AddressResolution =
  | {
      status: "RESOLVED";
      levels: LevelResolution[];
      /** Levels no sampled point produced. OUR gap, stated as ours. */
      unheld: LevelKey[];
    }
  | {
      status: "AMBIGUOUS";
      levels: LevelResolution[];
      unheld: LevelKey[];
      /** The levels the street actually crosses. Never empty in this branch. */
      split: LevelKey[];
    }
  | {
      status: "FAILED";
      /** `NOT_FOUND` is about our lookup, never about the reader's address. */
      reason: "NOT_FOUND";
      /**
       * The ZIP this address DOES resolve to, when it resolves to a different
       * one. (BAL-38, 2026-08-31.)
       *
       * Absent on an ordinary failure, which is most of them. Present only
       * when an unconstrained geocode placed the same address cleanly in
       * another five-digit ZIP — which turns *"we couldn't place that"*, a
       * true and useless sentence about us, into an offer the reader can act
       * on.
       *
       * It stays inside `FAILED` deliberately: the address did NOT resolve in
       * the ZIP the reader is looking at, and nothing here silently moves them.
       * A reader who wants the other ballot asks for it.
       */
      resolvesInZip?: string;
    };

/** One sampled point's answer: every division containing it. */
export type Sample = readonly Pick<Division, "ocdId" | "divisionType" | "label">[];

function keyOf(ids: readonly string[]): string {
  return [...ids].sort().join("|");
}

/**
 * Per level, did every sampled point land in the same divisions?
 *
 * Levels no sample reached are returned in `unheld` rather than as an
 * ambiguous level — see the header. A level reached by SOME samples and not
 * others is genuinely ambiguous and is treated as such: the disagreement is
 * real even when one side of it is empty.
 */
export function resolveLevels(samples: readonly Sample[]): {
  levels: LevelResolution[];
  unheld: LevelKey[];
} {
  const levels: LevelResolution[] = [];
  const unheld: LevelKey[] = [];

  for (const level of LEVEL_ORDER) {
    const perSample = samples.map((s) => s.filter((d) => d.divisionType === level));
    const reached = perSample.filter((rows) => rows.length > 0);
    if (reached.length === 0) {
      unheld.push(level);
      continue;
    }

    const signatures = new Set(perSample.map((rows) => keyOf(rows.map((r) => r.ocdId))));
    const certain = signatures.size === 1;

    const byId = new Map<string, string>();
    for (const rows of perSample) for (const r of rows) byId.set(r.ocdId, r.label);

    levels.push({
      level,
      label: LEVEL_LABEL[level],
      divisionIds: certain ? [...byId.keys()].sort() : [],
      divisionLabels: certain ? [...byId.values()] : [],
      certain,
      candidates: certain ? [] : [...byId].map(([ocdId, label]) => ({ ocdId, label })),
    });
  }

  return { levels, unheld };
}

/**
 * The whole answer, from the sampled points' division sets.
 *
 * Zero samples is `FAILED` and nothing else — a lookup that found no point has
 * told us about our lookup, not about the street. It is never reported as an
 * absence of jurisdictions.
 *
 * One sample — which is what an exact house number produces — makes every
 * level certain by construction, and that is correct rather than a loophole:
 * a single address IS in exactly one set of divisions.
 */
export function resolveAddress(samples: readonly Sample[]): AddressResolution {
  if (samples.length === 0) return { status: "FAILED", reason: "NOT_FOUND" };

  const { levels, unheld } = resolveLevels(samples);
  const split = levels.filter((l) => !l.certain).map((l) => l.level);

  if (split.length === 0) return { status: "RESOLVED", levels, unheld };
  return { status: "AMBIGUOUS", levels, unheld, split };
}

/** Every division id the reader is CONFIRMED to be in, across all certain levels. */
export function confirmedDivisionIds(resolution: AddressResolution): string[] {
  if (resolution.status === "FAILED") return [];
  return resolution.levels.filter((l) => l.certain).flatMap((l) => l.divisionIds);
}

/**
 * The sentence the prompt shows when it asks for a house number.
 *
 * Written here rather than in the component so every surface asks the same
 * way, and so the reason is never dropped: a bare "what's your house number?"
 * is the generic form step this rebuild exists to delete.
 */
export function houseNumberReason(split: readonly LevelKey[]): string {
  const parts = split.map((level) => `${LEVEL_LABEL[level]} (which decides ${LEVEL_OFFICE[level]})`);
  const list =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? `${parts[0]} and ${parts[1]}`
        : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `Your street runs across the line for ${list}. A house number settles it.`;
}
