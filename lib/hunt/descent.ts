/**
 * THE DESCENT — coverage built by walking DOWN the tiers of government.
 * (2026-08-26, the descent session. **RULING 169** made checkable.)
 *
 * ## Why this exists
 *
 * RULING 93 has said *ask what the tier above publishes about the tier below*
 * since 2026-08-22. RULING 166 says the body's own publication is rung one.
 * RULING 90 says exhaustion is argued, never asserted. Behaviour did not
 * change, and the reason is that **not one of them produces a number.** A
 * session can satisfy all three in its own belief and be graded identically to
 * a session that walked one page.
 *
 * So this module is the COUNT. A walk that ran through it has links found,
 * followed, yielded and declined-with-reason per level; a walk that did not has
 * a sentence. RULING 169: *a walk is counted or it did not happen.*
 *
 * ## What is a tier and what is a level
 *
 * A **TIER** is a rank of government — state, county, city. Seven of them, in
 * descent order, and the list deliberately does not stop at its own bottom: a
 * state with a layer not named here gets that layer added, and **the addition
 * is a finding** rather than a patch.
 *
 * A **LEVEL** is one walk at one tier in one state — the unit the counts are
 * kept per. Never one number for a run: a run total hides the level that
 * returned nothing, which is the level somebody needed.
 *
 * ## Fail closed
 *
 * RULING 159 — zero is a result that must be EARNED. A tier that returns no
 * bodies in a state that certainly has some is a broken walk, not a finding,
 * and `assertLevel` throws rather than reporting a clean zero.
 */

/** The seven tiers, in descent order. Order is the rule, not a convention. */
export const TIERS = [
  {
    id: "state",
    rank: 1,
    title: "State",
    detail:
      "the state itself, its Secretary of State by division, its legislature, its redistricting body, " +
      "its courts, its education agency, its open-data and transparency portals, its comptroller or " +
      "auditor, its division of local government",
  },
  {
    id: "multi-county",
    rank: 2,
    title: "Statewide and multi-county districts",
    detail:
      "congressional, legislative, judicial, education service agencies, regional authorities, " +
      "councils of government, transportation authorities",
  },
  {
    id: "county",
    rank: 3,
    title: "County",
    detail:
      "or parish, or borough — the county itself, its clerk, recorder, elections department, assessor, " +
      "treasurer, board of supervisors or commissioners, and every board, commission and authority it publishes",
  },
  {
    id: "special-district",
    rank: 4,
    title: "Local and special districts",
    detail:
      "school, fire, water, sanitation, library, hospital, irrigation, transportation, community college, " +
      "improvement, taxing. These levy on a household's bill and appear on almost nobody's list — the layer " +
      "most likely to be missing and the layer a reader most needs",
  },
  { id: "city", rank: 5, title: "City", detail: "the city, its clerk, its council, its boards and commissions" },
  {
    id: "minor-civil",
    rank: 6,
    title: "Town, township, borough, village, plantation, unincorporated place",
    detail:
      "whatever this state actually calls them — the vocabulary is enumerated from the state's own " +
      "publications and a national one is never imposed",
  },
  {
    id: "other",
    rank: 7,
    title: "Everything else the state names",
    detail:
      "authorities, commissions, tribal governments as their own sovereign category (RULING 119), and " +
      "anything that does not fit above",
  },
] as const;

export type TierId = (typeof TIERS)[number]["id"];

export const TIER_IDS: readonly TierId[] = TIERS.map((t) => t.id);

/** Descent order, asserted rather than assumed by a caller reading the array. */
export function tierRank(id: TierId): number {
  const t = TIERS.find((x) => x.id === id);
  if (!t) throw new Error(`not a tier: ${id}`);
  return t.rank;
}

/**
 * Why a link was NOT followed.
 *
 * RULING 169: a declined link and a followed link that yielded nothing are
 * completely different facts, and a bare `followed` count runs them together.
 * There is deliberately no `OTHER` — a reason nobody can name is a reason
 * nobody can act on.
 */
export type DeclineReason =
  /** `robots.txt` forbids it. NOT a wall (RULING 148) and never re-walked on a clock. */
  | "DISALLOWED"
  /** The permission question could not be answered at all. Fails closed. */
  | "PERMISSION_UNKNOWN"
  /** Off this state, off this tier, or not a government publication. */
  | "OFF_SCOPE"
  /** Already in the catalog. Recording it twice is worse than a gap (RULING 63). */
  | "ALREADY_RECORDED"
  /** A binary or asset the walk has no reader for. */
  | "NOT_A_DOCUMENT"
  /** Reached and refused. A dated measurement (RULING 53), never a property. */
  | "UNREACHABLE"
  /** Deeper than this pass goes. Named so the next pass can pick it up. */
  | "DEPTH_LIMIT";

export interface DeclinedLink {
  readonly url: string;
  readonly reason: DeclineReason;
}

/**
 * One walk, at one tier, in one state.
 *
 * Every field is required. A count that can be omitted is a count that will be,
 * and `undefined` reads as zero everywhere it is added up — which is RULING
 * 100's partial wearing a type signature.
 */
export interface DescentLevel {
  readonly state: string;
  readonly tier: TierId;
  /** The state's OWN word for this tier, from the state's own publication. */
  readonly vocabulary: readonly string[];
  /** Every link the walk saw at this level. */
  readonly found: number;
  /** Every link it actually fetched. */
  readonly followed: number;
  /** Followed links that produced something recordable. */
  readonly yielded: number;
  /** Followed links that produced nothing. `followed - yielded`, asserted. */
  readonly barren: number;
  readonly declined: readonly DeclinedLink[];
  /** Sources written into `states/<state>/sources.md` from this level. */
  readonly catalogued: number;
  /** THE NUMBER THAT SAYS WHETHER THE DESCENT WORKED. Everything else is effort. */
  readonly candidatesNew: number;
  /** Bodies seen that the registry already held. */
  readonly candidatesKnown: number;
  /** Which pass produced this level. Passes are 1-indexed. */
  readonly pass: number;
  /** RULING 107 — a read stamp, minted only by the code that performed the read. */
  readonly walkedOn: string;
}

export interface DescentRun {
  readonly state: string;
  readonly levels: readonly DescentLevel[];
  readonly passes: number;
  /**
   * New links the FINAL pass turned up. **Non-zero means the walk was not
   * finished** and the session says so — following links produces more links,
   * and a walk that stops while its last pass is still producing has stopped
   * rather than finished.
   */
  readonly finalPassNewLinks: number;
  readonly startedOn: string;
}

/** Tiers this run holds no body for at all — the map of what is missing. */
export function darkTiers(run: DescentRun): readonly TierId[] {
  const lit = new Set<TierId>();
  for (const l of run.levels) if (l.candidatesNew + l.candidatesKnown > 0) lit.add(l.tier);
  return TIER_IDS.filter((t) => !lit.has(t));
}

export function totalFound(run: DescentRun): number {
  return run.levels.reduce((n, l) => n + l.found, 0);
}
export function totalFollowed(run: DescentRun): number {
  return run.levels.reduce((n, l) => n + l.followed, 0);
}
export function totalNewCandidates(run: DescentRun): number {
  return run.levels.reduce((n, l) => n + l.candidatesNew, 0);
}

/**
 * Is this walk FINISHED?
 *
 * RULING 169: *if the final pass found anything new, the walk was not finished
 * and the session says so.* Deliberately a function returning a reason rather
 * than a boolean, because *finished* and *stopped* call for completely
 * different responses and a bare `false` cannot tell them apart.
 */
export function walkVerdict(run: DescentRun): { finished: boolean; reason: string } {
  if (run.levels.length === 0) {
    return { finished: false, reason: "no level was walked — this is a walk that did not run (RULING 159)" };
  }
  if (run.finalPassNewLinks > 0) {
    return {
      finished: false,
      reason:
        `pass ${run.passes} was still producing — ${run.finalPassNewLinks} new link(s) — so this walk STOPPED ` +
        "rather than finished, and following them is the next session's resume point",
    };
  }
  return {
    finished: true,
    reason: `pass ${run.passes} produced no link that was not already recorded`,
  };
}

/**
 * FAIL CLOSED on a level (RULING 159, RULING 100).
 *
 * The arithmetic is asserted rather than trusted: `followed` cannot exceed
 * `found`, and `yielded + barren` must equal `followed` EXACTLY. Every followed
 * link has one disposition, and a link with none vanished — RULING 128's
 * conservation contract applied to a site walk.
 *
 * Zero is a result that must be EARNED. A level that followed links and yielded
 * nothing is allowed and is a real finding; a level that followed NOTHING while
 * links were sitting there is a walk that did not happen.
 */
export function assertLevel(level: DescentLevel): void {
  const where = `${level.state.toUpperCase()} tier "${level.tier}" pass ${level.pass}`;

  if (!TIER_IDS.includes(level.tier)) throw new Error(`${where}: not a tier`);

  if (level.found < 0 || level.followed < 0 || level.yielded < 0 || level.barren < 0) {
    throw new Error(`${where}: a negative count is not a measurement`);
  }
  if (level.followed > level.found) {
    throw new Error(
      `${where}: followed ${level.followed} exceeds found ${level.found} — a link cannot be walked before it is seen`,
    );
  }
  if (level.yielded + level.barren !== level.followed) {
    throw new Error(
      `${where}: ${level.yielded} yielded + ${level.barren} barren !== ${level.followed} followed. ` +
        "Every followed link has exactly one disposition; a link with none vanished (RULING 128).",
    );
  }
  /*
   * THIS CHECK COMES FIRST ON PURPOSE, and it was dead code until it did.
   *
   * The conservation check below catches the same input — `found` links with
   * nothing walked and nothing declined fails the sum too — so the more useful
   * diagnosis was never reachable. A walk that did not run and a walk that lost
   * track of a link call for completely different responses, and the arithmetic
   * message sends a reader to look for a bookkeeping slip that is not there.
   */
  if (level.found > 0 && level.followed === 0 && level.declined.length === 0) {
    throw new Error(
      `${where}: ${level.found} link(s) found and none walked or declined — the walk did not run. ` +
        "Zero is a result that must be EARNED (RULING 159).",
    );
  }
  if (level.followed + level.declined.length !== level.found) {
    throw new Error(
      `${where}: ${level.followed} followed + ${level.declined.length} declined !== ${level.found} found. ` +
        "A link that was neither walked nor declined is a link this walk lost track of.",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(level.walkedOn)) {
    throw new Error(
      `${where}: walkedOn "${level.walkedOn}" is not a date. A record that cannot say when it was measured ` +
        "reads as stale (RULING 53), and a stamp is minted only by the code that read (RULING 107).",
    );
  }
}

/**
 * The tiers a US state CERTAINLY has, so a zero there is a broken walk.
 *
 * Deliberately short. Every state has itself, and every state this project
 * touches has counties — Louisiana's parishes and Alaska's boroughs are the
 * same tier under another word, which is why the vocabulary is per state and
 * the TIER is not. Nothing below county is asserted: a state may genuinely have
 * no city at a given moment in a given walk, and asserting otherwise would
 * manufacture a failure.
 */
export const TIERS_A_STATE_MUST_HAVE: readonly TierId[] = ["state", "county"];

export function assertRun(run: DescentRun): void {
  if (run.levels.length === 0) {
    throw new Error(
      `DESCENT REFUSED — ${run.state.toUpperCase()} walked zero levels. A sweep of nothing is a sweep that ` +
        "did not run, not a clean board (RULING 159).",
    );
  }
  for (const l of run.levels) assertLevel(l);

  for (const tier of TIERS_A_STATE_MUST_HAVE) {
    const levels = run.levels.filter((l) => l.tier === tier);
    if (levels.length === 0) {
      throw new Error(
        `DESCENT REFUSED — ${run.state.toUpperCase()} has no walk at tier "${tier}". Every US state has one, ` +
          "so its absence is a broken walk rather than a finding (RULING 159).",
      );
    }
    const bodies = levels.reduce((n, l) => n + l.candidatesNew + l.candidatesKnown, 0);
    if (bodies === 0) {
      throw new Error(
        `DESCENT REFUSED — ${run.state.toUpperCase()} tier "${tier}" returned zero bodies. Zero counties in a ` +
          "US state is a broken walk, not a finding (RULING 159). Earn the zero or fix the walk.",
      );
    }
  }
}
