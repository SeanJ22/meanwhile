/**
 * **WHICH DIVISION LEVELS ARE ALLOWED TO EXCLUDE EACH OTHER.**
 * (WGH-16, 2026-08-28 — the corrective pass over WGH-15's browse copy.)
 *
 * ## The sentence this table exists to license
 *
 * WGH-15 shipped a strong sentence on the browse surfaces:
 *
 * ```
 * You're looking at State House District 19. Your address is in a different
 * one — this is here because you tapped it, not because it governs you.
 * ```
 *
 * That is the right sentence, and it is a CLAIM ABOUT A GOVERNMENT: *this
 * body does not govern you.* `CLAUDE.md` allows it only on evidence.
 *
 * ## What the evidence actually was, and where it ran out
 *
 * `standingOf` earned it like this: the reader resolved an address, the
 * address confirmed some division at the same LEVEL KEY, and the division on
 * screen was not that one. For a state house district that reasoning is
 * airtight — a point is in exactly one, so confirming District 17 excludes
 * every other `sldl:` division without testing any of them.
 *
 * **The level key is `levelKeyOf` — the deepest OCD segment — and it buckets
 * far more than legislative districts.** The measured set is below. Two of
 * those buckets are not exclusive at all, and for those the reasoning is not
 * merely weaker, it is INVALID: confirming one division at the level says
 * nothing whatsoever about a second one, because a point is routinely inside
 * both.
 *
 * And the second half of the defect is subtler. Absence from
 * `confirmedDivisionIds` conflates two facts:
 *
 * ```
 * the point sweep TESTED this polygon and it did not contain the point
 * the point sweep never HELD this polygon at all
 * ```
 *
 * `divisionsAt` (lib/registry/resolve.ts) sweeps the committed geometry, while
 * the rows a reader sees on the who-governs card arrive through the zip-AREA
 * widening from a different store — `lib/registry/server.ts` says in as many
 * words that the two are allowed to disagree. Under EXCLUSIVITY that gap is
 * harmless, because the exclusivity does all the work and the other polygon
 * never needed testing. Without exclusivity the claim rests entirely on a
 * sweep having held a specific polygon, which this module cannot see and
 * therefore may not assume.
 *
 * ## The measurement (not the reasoning)
 *
 * Every level key present in the shipped data, counted across
 * `lib/registry/registry.json`, the three-state ZIP index of the day (now the
 * baseline `tests/fixtures/zip-division-ids-three-state.json`),
 * `data/derived/body-forms.json` and every layer in `public/geo`:
 *
 * ```
 * place            5046    school_district  3646    state    1796
 * cd               1346    county            662    sldl      603
 * sldu              228    territory           5    district     1
 * ```
 *
 * Exclusivity was then measured GEOMETRICALLY rather than argued: an interior
 * point was computed for a sample of every polygon in each layer group and
 * tested against every other polygon carrying the same level key.
 *
 * ```
 * LEVEL KEY        POINTS IN 2+ DIVISIONS AT THE SAME LEVEL
 * cd                 0 / 23
 * sldl               0 / 101
 * sldu               0 / 76
 * county             0 / 22
 * state              0 / 3
 * place             75 / 113   (AZ)      364 / 477   (NJ)
 * school_district   39 / 104
 * ```
 *
 * The two failures are not edge cases, they are the normal shape of those
 * layers:
 *
 * - **`place`** is drawn by ONE map layer built from TWO Census files —
 *   `place` and `cousub` (see `DISTRICT_LAYERS.municipal`). A point in Tucson
 *   is inside `place:tucson` and inside `county:pima/place:tucson_ccd` at
 *   once, and in New Jersey the same municipality frequently appears under two
 *   identifiers at this level (`place:chester` and
 *   `county:morris/place:chester_borough`). Places also do not TILE: 125 of 250
 *   sampled Arizona points are in no place-level division at all, because
 *   unincorporated territory belongs to no place.
 * - **`school_district`** is drawn by THREE layers — `unsd`, `elsd`, `scsd` —
 *   which are designed to overlap. `districtsAt` in `lib/map/districts.ts`
 *   already says so: *"Rockaway 07866 is in a K-8 elementary district and a
 *   regional high school district simultaneously."* 105 of 250 sampled Arizona
 *   points sit in two of them.
 *
 * ## The rule
 *
 * **EXCLUSION IS INFERRED FROM A LEVEL ONLY WHERE THE LEVEL HAS BEEN MEASURED
 * TO ADMIT AT MOST ONE DIVISION PER POINT. EVERYTHING ELSE FAILS CLOSED.**
 *
 * "Fails closed" is structural here, not remembered: {@link relationshipOfLevel}
 * is a MISS on a lookup, so a level key nobody has classified — a division type
 * a new source introduces next month — returns `UNKNOWN_SEMANTICS` by arriving,
 * and the strong sentence is unreachable for it. There is deliberately no
 * permissive default and no fallthrough branch to forget to write. The same
 * refusal `tierForOcdId` makes for tiers, made here for exclusivity.
 */

/**
 * What a level key says about two divisions that share it.
 *
 * `MUTUALLY_EXCLUSIVE_PARTITION` — a point is in AT MOST ONE division at this
 * level, measured. Confirming one therefore excludes the others without
 * testing them, and only here may a surface say *this does not govern you*.
 *
 * `POTENTIALLY_OVERLAPPING` — a point is routinely in SEVERAL divisions at
 * this level, measured. A positive match on one is not evidence about any
 * other, in either direction.
 *
 * `UNKNOWN_SEMANTICS` — nobody has measured this level. It is not a claim that
 * the level overlaps; it is the absence of a claim either way, which is why it
 * is treated exactly as cautiously as an overlap and never more confidently.
 */
export type LevelRelationship =
  | "MUTUALLY_EXCLUSIVE_PARTITION"
  | "POTENTIALLY_OVERLAPPING"
  | "UNKNOWN_SEMANTICS";

/**
 * The measured table. **Every row carries its evidence, and a row with no
 * evidence is not written.**
 *
 * The value type EXCLUDES `UNKNOWN_SEMANTICS` on purpose: that state is
 * reachable only by being absent from this table, so no future edit can file a
 * level under it by hand and no reader of this table can mistake "unlisted" for
 * a third listed category.
 */
const CLASSIFIED_LEVELS: Readonly<
  Record<Exclude<LevelRelationship, "UNKNOWN_SEMANTICS">, readonly string[]>
> = {
  MUTUALLY_EXCLUSIVE_PARTITION: [
    // Seats in the US House. 0/23 interior points in two; 248 of 250 sampled
    // Arizona points in exactly one, the other 2 falling in the sliver between
    // a generalized state outline and a generalized district edge.
    "cd",
    // The two state legislative chambers. 0/101 and 0/76.
    //
    // Multi-member districts do not break this: several seats share ONE
    // division id, so they are one division and never two at a point.
    "sldl",
    "sldu",
    // Counties tile a state and do not overlap: 0/22, and 68 of 68 sampled
    // Arizona points that landed in any county landed in exactly one. The 182
    // that landed in none are OUR clipped geometry — `county-us.geojson` holds
    // Pima, Morris and Merrimack and their neighbours, not the nation — which
    // is a scope fact about this repository and not a gap in the partition.
    "county",
    // States and state-equivalents. 0/3 measured, and the partition is the
    // definition: every point in the country is in exactly one.
    "state",
  ],
  POTENTIALLY_OVERLAPPING: [
    /*
     * ONE map layer, TWO Census files, and the same ground under both.
     * 75/113 Arizona interior points and 364/477 New Jersey interior points
     * are inside two `place`-level divisions at once. Places also leave
     * unincorporated territory uncovered, so this level neither tiles nor
     * excludes.
     */
    "place",
    /*
     * THREE layers designed to overlap — unified, elementary and secondary.
     * 39/104 sampled interior points, and 105 of 250 Arizona points, are in
     * two school districts at once. This is not a data defect: a reader in
     * Rockaway is genuinely governed by an elementary board and a regional
     * high school board, and both are real governments with real elections.
     */
    "school_district",
  ],
};

/*
 * DELIBERATELY UNLISTED, and this comment is the record of the decision:
 *
 * `territory` (5 divisions in the registry) and `district` (1 — `district:dc`)
 * are state-equivalents, and almost certainly exclusive for the same reason
 * `state` is. **This repository commits no geometry for either**, so nothing
 * here has MEASURED them, and the table's rule is that a row without evidence
 * is not written. The cost of leaving them out is nil: a reader's address is
 * in one state-equivalent, so the only division that can be confirmed at those
 * keys is the one they are in, and `standingOf` answers `CONFIRMED` before the
 * relationship is ever consulted. A later session with the geometry may
 * measure them and add the rows; until then they fail closed like everything
 * else, which costs a sentence nobody would ever have read.
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

/**
 * What is known about this level key. **A miss is `UNKNOWN_SEMANTICS`.**
 *
 * There is no default parameter, no fallthrough and no permissive branch: an
 * unclassified level reaches the cautious answer by not being in the map, so
 * a division type introduced by a source next month inherits caution rather
 * than inheriting the strongest sentence on the surface.
 */
export function relationshipOfLevel(
  levelKey: string | null,
): LevelRelationship {
  if (levelKey === null) return "UNKNOWN_SEMANTICS";
  return RELATIONSHIP_BY_LEVEL.get(levelKey) ?? "UNKNOWN_SEMANTICS";
}

/*
 * There is deliberately NO `isExclusive(level): boolean` helper here.
 *
 * A boolean collapses `POTENTIALLY_OVERLAPPING` and `UNKNOWN_SEMANTICS` into
 * one "not exclusive" bucket, and those two are different facts that earn
 * different sentences — one is *measured to overlap*, the other is *nobody has
 * measured it*. Callers switch on the union instead, which the compiler makes
 * exhaustive, so adding a fourth relationship later breaks every consumer
 * loudly rather than routing it silently into a default.
 */

/**
 * Every level key this table has an answer for.
 *
 * Exported for the guard in `tests/resolved-location.test.ts`, which walks the
 * level keys actually present in the shipped data and fails when one of them
 * has silently entered the product unclassified. That is the test that turns
 * "fails closed" from a property of this file into a property of the data.
 */
export const CLASSIFIED_LEVEL_KEYS: readonly string[] = [
  ...RELATIONSHIP_BY_LEVEL.keys(),
];
