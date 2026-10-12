/**
 * Which division levels may exclude each other. A surface may say "this does
 * not govern you" from a confirmed division at the same level key
 * (`levelKeyOf`, the deepest OCD segment) only when that level admits at most
 * one division per point, measured geometrically:
 *
 * ```
 * LEVEL KEY        POINTS IN 2+ DIVISIONS AT THE SAME LEVEL
 * cd                 0 / 23
 * sldl               0 / 101
 * sldu               0 / 76
 * county             0 / 22
 * state              0 / 3
 * place            439 / 590
 * school_district   39 / 104
 * ```
 *
 * `place` is drawn from two Census files (`place` and `cousub`) over the same
 * ground and does not tile; `school_district` is three layers (unified,
 * elementary, secondary) designed to overlap.
 *
 * Exclusion is inferred only for measured-exclusive levels; everything else
 * fails closed. {@link relationshipOfLevel} is a lookup whose miss is
 * `UNKNOWN_SEMANTICS`, so a new division type cannot reach the strong sentence.
 */

/**
 * What a level key says about two divisions that share it.
 *
 * `MUTUALLY_EXCLUSIVE_PARTITION` — a point is in AT MOST ONE division at this
 * level, measured. Only here may a surface say *this does not govern you*.
 *
 * `POTENTIALLY_OVERLAPPING` — a point is routinely in SEVERAL divisions at
 * this level, measured. A match on one says nothing about another.
 *
 * `UNKNOWN_SEMANTICS` — not measured; treated as cautiously as an overlap.
 */
export type LevelRelationship =
  | "MUTUALLY_EXCLUSIVE_PARTITION"
  | "POTENTIALLY_OVERLAPPING"
  | "UNKNOWN_SEMANTICS";

/**
 * The measured table; a row with no evidence is not written. The value type
 * excludes `UNKNOWN_SEMANTICS`, which is reachable only by absence.
 */
const CLASSIFIED_LEVELS: Readonly<
  Record<Exclude<LevelRelationship, "UNKNOWN_SEMANTICS">, readonly string[]>
> = {
  MUTUALLY_EXCLUSIVE_PARTITION: [
    // Seats in the US House: 0/23 interior points in two.
    "cd",
    // The two state legislative chambers: 0/101 and 0/76. Multi-member
    // districts share ONE division id, so they are one division at a point.
    "sldl",
    "sldu",
    // Counties tile a state and do not overlap: 0/22.
    "county",
    // States and state-equivalents: every point is in exactly one.
    "state",
  ],
  POTENTIALLY_OVERLAPPING: [
    /*
     * One map layer, two Census files, the same ground under both; places also
     * leave unincorporated territory uncovered.
     */
    "place",
    /*
     * Three layers designed to overlap: a reader can be governed by an
     * elementary board and a regional high school board at once.
     */
    "school_district",
    // Reservation and trust-land areas need their own polygon answer. A
    // district address never establishes or rules out a nation's membership.
    "aiannh",
  ],
};

/*
 * `territory` and `district` (DC) are unlisted: no geometry is held for them,
 * so nothing has measured them. A reader's own state-equivalent is answered
 * `CONFIRMED` by `standingOf` before this table is consulted.
 */

/** Segment key -> what was measured about it. Built once. */
const RELATIONSHIP_BY_LEVEL: ReadonlyMap<string, LevelRelationship> = new Map(
  (
    Object.entries(CLASSIFIED_LEVELS) as [
      Exclude<LevelRelationship, "UNKNOWN_SEMANTICS">,
      readonly string[],
    ][]
  ).flatMap(([relationship, keys]) =>
    keys.map((key) => [key, relationship] as const),
  ),
);

/** What is known about this level key. A miss is `UNKNOWN_SEMANTICS`; there is no default. */
export function relationshipOfLevel(
  levelKey: string | null,
): LevelRelationship {
  if (levelKey === null) return "UNKNOWN_SEMANTICS";
  return RELATIONSHIP_BY_LEVEL.get(levelKey) ?? "UNKNOWN_SEMANTICS";
}

/*
 * There is deliberately no `isExclusive(level): boolean` helper: a boolean
 * would merge "measured to overlap" with "not measured". Callers switch on the
 * union, which the compiler makes exhaustive.
 */

/** Every level key this table has an answer for, for the guard that walks the shipped data's level keys. */
export const CLASSIFIED_LEVEL_KEYS: readonly string[] = [
  ...RELATIONSHIP_BY_LEVEL.keys(),
];
