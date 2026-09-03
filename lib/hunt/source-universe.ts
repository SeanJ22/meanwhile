/**
 * **ACQUIRE TO THE AUTHORITATIVE SOURCE UNIVERSE; PROJECT TO THE READER.**
 * (Session C3, lane C, 2026-09-01. RULING 229.)
 *
 * ## The defect this module names, measured rather than described
 *
 * Three state-money collectors took their ACQUISITION DENOMINATOR from a pilot
 * ballot:
 *
 * ```
 *   scripts/state-money-az.mts   "FOR THE 85701 AND 85641 BALLOT"
 *                                loads data/states/az/ballot/az-pima-2026.json
 *   scripts/state-money-nh.mts   "FOR THE 03255 BALLOT"
 *                                hardcodes COUNTY = "Merrimack", and asks the
 *                                statewide registry one SURNAME at a time —
 *                                the surnames on one ballot
 *   scripts/state-money-nj.mts   "FOR THE WHOLE 07866 BALLOT"
 *                                asks ELEC only for the location codes that
 *                                one county's ballot happens to need
 * ```
 *
 * Candidate enrichment did the same thing in a different vocabulary: the
 * position corpus is keyed `ballot-az-pima:*`, and campaign sites, bios,
 * photos and contact were hunted for the VISIBLE candidate universe only.
 *
 * The cost is not that the numbers are small. It is that **activating a new ZIP
 * creates a fresh external hunt for information the state authority already
 * owed us**. A reader in a second Arizona ZIP does not wait on applicability
 * work; they wait on a network walk of a government that published the record
 * months ago, because nobody asked for the whole thing.
 *
 * ## The distinction this module makes checkable
 *
 * ```
 *      ACQUISITION DENOMINATOR            READER PROJECTION
 *      -------------------------          -------------------------
 *      what the AUTHORITY governs         what THIS reader may see
 *      fixed by the source, not by us     fixed by ZIP/address/ballot
 *      grows only when the authority's    grows when a reader arrives
 *        universe grows
 *      a gap here is an OPEN OBLIGATION   a gap here is an APPLICABILITY
 *                                           question, answered from the corpus
 * ```
 *
 * A collector states BOTH, in one value, and the pair is what a report quotes.
 * `projectionNarrowedFrom` is the load-bearing field: it is the acquisition
 * denominator this projection was cut out of, so a reader-facing count can
 * never be printed without the universe it came from — which is the
 * "no percentage without its NAMED denominator" rule expressed as a type
 * rather than as a habit.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not fetch, schedule, or decide what is due. It is the vocabulary and
 * the arithmetic. The obligations that come out of an unacquired remainder are
 * registered by `lib/control-plane/scheduler/providers/*`, because a denominator
 * that only appears in a report is a denominator nothing works.
 */

/** Which half of RULING 229 a count belongs to. Never both. */
export type UniverseRole = "ACQUISITION_DENOMINATOR" | "READER_PROJECTION";

/**
 * ONE AUTHORITY'S COMPLETE APPLICABLE UNIVERSE, as the authority defines it.
 *
 * `statedBy` is the publisher's own count where the publisher states one — the
 * NH CFS `totalItems`, ELEC's `recordsTotal`, the Arizona SOS's own
 * `Jurisdictions.txt`. Where it is null, `countedBy` says how WE counted, and
 * the difference between the two is the difference between a checkable
 * denominator and one we computed from what we happened to receive.
 */
export interface AcquisitionUniverse {
  /** The authority whose universe this is. Never a vendor, never a URL. */
  readonly authority: string;
  /** What kind of thing is counted: "filers", "candidacies", "jurisdictions". */
  readonly unit: string;
  /** The publisher's OWN count, when the publisher states one. */
  readonly statedBy: number | null;
  /** How many we hold. Never presented as the universe when `statedBy` differs. */
  readonly held: number;
  /** How `held` was arrived at — a file, a walk, a committed corpus. */
  readonly countedBy: string;
  /** The committed evidence for both numbers. A citation, never a claim. */
  readonly citation: string;
}

/**
 * WHAT ONE READER LOCATION MAY SEE, and the universe it was cut from.
 *
 * The type has no constructor that lets a caller state a projection without its
 * denominator, because that is the exact shape of the defect: `272 candidacies`
 * printed with no statement of what it is 272 OUT OF.
 */
export interface ReaderProjection {
  /** The reader scope this projection answers — a ZIP, an address, a ballot. */
  readonly scope: string;
  /** How many of the acquired universe are applicable to that scope. */
  readonly applicable: number;
  /** The universe this was narrowed out of. Required. */
  readonly projectionNarrowedFrom: AcquisitionUniverse;
  /**
   * How many of the applicable rows were answered ENTIRELY from the held
   * corpus, with no outbound request. RULING 229's invariant is that this
   * equals `applicable` for any record already held at authority scope.
   */
  readonly answeredFromCorpus: number;
  /**
   * Rows that required an outbound acquisition during this projection.
   *
   * NOT a failure field. It is the measurement RULING 229 is about, and a
   * non-empty list on a record class the authority already owed us is the
   * defect itself, named row by row rather than summarised away.
   */
  readonly requiredFreshAcquisition: readonly string[];
}

/**
 * The remainder that is OWED — what the authority governs and we do not hold.
 *
 * Never a percentage on its own. `of` carries the denominator so the number
 * cannot be quoted without it.
 */
export interface UnacquiredRemainder {
  readonly of: AcquisitionUniverse;
  readonly outstanding: number;
  /** Named, never summarised. The first N are enough for a digest; all of them
   *  are enough for a worker, and the worker gets all of them. */
  readonly names: readonly string[];
}

export function remainderOf(
  universe: AcquisitionUniverse,
  heldNames: Iterable<string>,
  allNames: Iterable<string>,
): UnacquiredRemainder {
  const held = new Set(heldNames);
  const names = [...allNames].filter((n) => !held.has(n));
  return { of: universe, outstanding: names.length, names };
}

/**
 * The one sentence a report may print about a projection.
 *
 * It is a function rather than a convention because the convention is what
 * failed: three collectors each printed a ballot-scoped count as though it were
 * a state's coverage, and no instrument could tell.
 */
export function projectionLine(p: ReaderProjection): string {
  const u = p.projectionNarrowedFrom;
  const stated = u.statedBy === null ? `${u.held} held (publisher states no count)` : `${u.held} of ${u.statedBy} stated`;
  return (
    `${p.applicable} ${u.unit} applicable to ${p.scope}, projected from ${u.authority}'s universe of ` +
    `${stated} — ${p.answeredFromCorpus} answered from the held corpus, ` +
    `${p.requiredFreshAcquisition.length} required a fresh outbound acquisition`
  );
}

/**
 * **THE NEW-ZIP READINESS INVARIANT** (RULING 229), as a checkable predicate.
 *
 * A ZIP activation may create applicability and linkage work. It may NOT create
 * a fresh source hunt for a record the authority already owed at state scope
 * and that we already hold. So: every applicable row was answered from the
 * corpus, and nothing went out.
 *
 * Returns the REASON it fails rather than a boolean, because "false" is not a
 * finding a session can act on and a named row is.
 */
export function newZipReadiness(p: ReaderProjection): { ready: boolean; why: string } {
  if (p.requiredFreshAcquisition.length > 0) {
    return {
      ready: false,
      why:
        `activating ${p.scope} caused ${p.requiredFreshAcquisition.length} outbound acquisition(s) for ` +
        `records already owed by ${p.projectionNarrowedFrom.authority}: ` +
        `${p.requiredFreshAcquisition.slice(0, 10).join(", ")}` +
        (p.requiredFreshAcquisition.length > 10 ? ", …" : ""),
    };
  }
  if (p.answeredFromCorpus < p.applicable) {
    return {
      ready: false,
      why:
        `${p.applicable - p.answeredFromCorpus} of ${p.applicable} applicable ${p.projectionNarrowedFrom.unit} ` +
        `for ${p.scope} were neither answered from the corpus nor acquired — they were dropped, which is ` +
        "the failure mode that reads as an absence",
    };
  }
  return {
    ready: true,
    why:
      `${p.applicable} of ${p.applicable} applicable ${p.projectionNarrowedFrom.unit} for ${p.scope} answered ` +
      `from the held corpus of ${p.projectionNarrowedFrom.held}; zero outbound acquisitions`,
  };
}
