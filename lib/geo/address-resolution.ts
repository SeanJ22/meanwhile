import type { Division, DivisionType } from "@/lib/registry/types";

/**
 * The address standard for the whole product. Pure: geometry answers come in
 * as arguments.
 *
 * Ambiguity is measured per level on whether the sampled points land in the
 * same divisions, not on how far apart they are. A street split only at the
 * congressional level confirms county and municipal at once and hedges only
 * that row, and the follow-up question names the boundary it crosses.
 *
 * A level no sampled point reached is unheld (our gap), reported separately
 * from a level the street genuinely crosses.
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

/** Plain-language labels; no identifier, enum value or OCD-ID reaches a reader. */
export const LEVEL_LABEL: Record<LevelKey, string> = {
  place: "your town or city",
  school_district: "your school district",
  county: "your county",
  sldl: "your state assembly district",
  sldu: "your state senate district",
  cd: "your U.S. House district",
};

/**
 * What a split at this level changes for the reader, so the prompt names the
 * boundary and the office it decides.
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
  /** Every candidate the samples produced, when they disagreed, so the follow-up can name both. */
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
       * The ZIP this address does resolve to, when an unconstrained geocode
       * placed it cleanly in another ZIP. Still `FAILED`: nothing silently
       * moves the reader.
       */
      resolvesInZip?: string;
    };

/** One sampled point's answer: every division containing it. */
export type Sample = readonly Pick<Division, "ocdId" | "divisionType" | "label">[];

function keyOf(ids: readonly string[]): string {
  return [...ids].sort().join("|");
}

/**
 * Per level, did every sampled point land in the same divisions? Levels no
 * sample reached are `unheld`; a level reached by some samples and not
 * others is ambiguous.
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
 * The whole answer, from the sampled points' division sets. Zero samples is
 * `FAILED`, never an absence of jurisdictions. One sample (an exact house
 * number) makes every level certain.
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

/** The sentence the prompt shows when it asks for a house number, with its reason. */
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
