/**
 * WHETHER AN INCUMBENCY LABEL MAY ATTACH TO THIS CONTEST AT ALL.
 * (2026-08-28, the contest-universe session.)
 *
 * ## The defect this exists to close, stated exactly
 *
 * Officeholder acquisition finds INCUMBENTS first. It has to: an officeholder
 * is a person a government publishes a page about, and a challenger is a person
 * who filed a form. So every hour spent acquiring officeholders moves some
 * candidates from *unresolved* to *incumbent* and moves nobody at all to
 * *provably not the incumbent*.
 *
 * On 2026-08-28 that asymmetry was measured: this repository's contests with at
 * least one sourced holder went from 17 to 23 of 126 in a single session, and
 * the resolution rendered **`Incumbent` on the one candidate we had matched and
 * `Challenger` on everybody else in the same contest** — because
 * `resolveContestIncumbency` treats *not among the holders we hold* as *not the
 * incumbent*.
 *
 * **That is an acquisition asymmetry reaching a reader as a claim about
 * people.** `Challenger` is a sentence about a named person: it says they do
 * not currently hold this seat. Our evidence for it was that they were not in a
 * store whose own doc block calls itself *what we have acquired so far*.
 *
 * ## The rule
 *
 * **Absent from our officeholder store is UNRESOLVED, not NOT_INCUMBENT** — a
 * fact about us, never a negative fact about a person — *unless the officeholder
 * universe for that exact office is itself known complete*.
 *
 * And because a per-candidate answer would then put `Incumbent` on the one
 * person we matched while the rest of the contest carried a visible unresolved
 * state, which is the per-card completeness marker RULING 42 deleted, the
 * decision is taken **per contest**: either every label in the contest is
 * earned, or the contest carries none.
 *
 * ## What is DERIVED here, and from which recorded input
 *
 * Nothing below is asserted per contest. Every input is a property of a RECORD:
 *
 * | Input | Read from |
 * |---|---|
 * | is the candidate list the certified nominee list? | whether a certified canvass names this contest's nominees, and whether the rendered list IS that list |
 * | can the holder source enumerate this seat? | which retrieval branch produced the holders — see `HolderSourceShape` |
 * | does the holder count reconcile? | the contest's own `voteFor`, against the number of holders the source returned |
 * | was every candidate evaluated? | the resolution map, against the rendered candidate list |
 *
 * @see lib/ballot/incumbency.ts for the per-candidate matching this sits above.
 */

import {
  nameParts,
  namesAgree,
  namesAgreeLoosely,
  splitDisplayName,
  type ComparableName,
  type Incumbency,
  type IncumbencyDecision,
} from "./incumbency.ts";

/* -------------------------------------------------------------------------- */
/* THE THREE EXPLICIT STATES                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What we have established about ONE candidate, deterministically.
 *
 * `NOT_INCUMBENT` is a claim about the person and is therefore the expensive
 * one: it may only be produced against a COMPLETE officeholder universe.
 * `UNRESOLVED` is a claim about us and is the honest default for everything
 * else — no holder record, an ambiguous match, or a universe we cannot show is
 * complete.
 */
export type CandidateIncumbencyState = "INCUMBENT" | "NOT_INCUMBENT" | "UNRESOLVED";

/* -------------------------------------------------------------------------- */
/* WHAT A HOLDER SOURCE CAN ACTUALLY ANSWER                                    */
/* -------------------------------------------------------------------------- */

/**
 * The SHAPE of the retrieval that produced the holders — which decides whether
 * absence from it means anything.
 *
 * This is the load-bearing distinction and it is a property of the SOURCE, not
 * of the office, so it is recorded once per branch rather than per contest.
 *
 * - `ENUMERATES_THE_SEAT` — the body publishes its whole membership and the
 *   source can be sliced to this exact seat, so a person's absence from it is
 *   the body's statement rather than our gap. New Hampshire's General Court
 *   publishes `Members.txt`, every sitting member of both chambers, keyed to
 *   county and district.
 * - `COLLECTED_PERSON_BY_PERSON` — the store grew as people were acquired, so
 *   absence is OUR gap and can never be read as a fact about a person. This is
 *   the officeholder registry: the curated statewide-executive store says so in
 *   its own words, and the generated rosters measure it — of 90 Arizona rows 66
 *   never attached to a division at all, 325 of 410 in New Hampshire, 99 of 120
 *   in New Jersey. A division's holder list missing somebody is routine.
 * - `PROBED_PER_CANDIDATE` — the source can only confirm the people it was
 *   handed, so it can never enumerate anybody it was not asked about. This is
 *   the FEC candidate/committee join against the congressional roster: it is
 *   reached once per candidate, by key.
 * - `NOTHING_READ` — no branch produced holders.
 */
export type HolderSourceShape =
  | "ENUMERATES_THE_SEAT"
  | "COLLECTED_PERSON_BY_PERSON"
  | "PROBED_PER_CANDIDATE"
  | "NOTHING_READ";

/** One universe, evaluated. `reason` is written to be quotable in a report. */
export interface UniverseFinding {
  readonly complete: boolean;
  /** The authoritative source, named. Null only when nothing was read. */
  readonly source: string | null;
  /** Why it is complete, or precisely what is missing. */
  readonly reason: string;
}

/* -------------------------------------------------------------------------- */
/* THE CANDIDATE UNIVERSE                                                      */
/* -------------------------------------------------------------------------- */

/**
 * ONE CERTIFIED NOMINEE PAIRED WITH THE RENDERED CANDIDATE WHO IS THAT PERSON.
 *
 * Both sides carry the RAW string each record printed, never the normalised
 * form. The normalisation is how the two were matched; it is not a name anybody
 * is called, and putting it on the object invites a later surface to render it.
 */
export interface IdentityPair {
  readonly certified: string;
  readonly rendered: string;
}

/**
 * Whether the people on the page ARE the people the canvass certified.
 *
 * The three failure lists are separate because they are three different facts
 * and only one report is actionable from each:
 * `missingFromRendered` is a candidate the reader never sees, `absentFromCertified`
 * is a person on the page the certified list does not name, and `ambiguous` is a
 * name our comparison could not resolve to exactly one person on the other side.
 */
export interface IdentityReconciliation {
  readonly reconciled: boolean;
  readonly pairs: readonly IdentityPair[];
  /** Certified nominees no rendered candidate could be reconciled to. Raw strings. */
  readonly missingFromRendered: readonly string[];
  /** Rendered candidates no certified nominee could be reconciled to. Raw strings. */
  readonly absentFromCertified: readonly string[];
  /** Names that matched more than one person on the other side. Refused, never chosen between. */
  readonly ambiguous: readonly string[];
}

interface Parsed {
  readonly raw: string;
  readonly parts: ComparableName;
}

const parseSide = (names: readonly string[]): Parsed[] =>
  names.map((raw) => {
    const { givenName, familyName } = splitDisplayName(raw);
    return { raw, parts: nameParts(givenName, familyName) };
  });

/**
 * SET MEMBERSHIP OVER PEOPLE, NOT OVER STRINGS AND NOT OVER A COUNT.
 * (2026-08-28, the candidate-identity repair.)
 *
 * ## The defect this closes, with the instance that was live when it was written
 *
 * `candidateUniverse` decided completeness with `rendered !== certified.count`.
 * A count is not a set, and on 2026-08-28 this repository was shipping the
 * proof. **`ballot-az-pima:us-house-6`**, resolved off the committed
 * filed-candidate list, passed the candidate-universe gate on `4 === 4` and went
 * label-eligible, producing three `NOT_INCUMBENT` labels — while the two lists
 * were different sets of people:
 *
 * ```
 * certified (SoS 2026 primary canvass)  JoAnna Mendoza  Juan Ciscomani  Jereme Lance Peters  Gary Swing
 * rendered  (filed-candidate record)    JoAnna Mendoza  Juan Ciscomani  Jereme Lance Peters  Iman Bah
 * ```
 *
 * **Iman Bah is not a certified nominee of that contest and was carrying a
 * negative claim about himself measured against a universe he is not in; Gary
 * Swing is certified and was not on the page at all.**
 * `ballot-az-pima:state-senate-19` is the same shape — `2 === 2`, with Ryan
 * Slawson rendered where the canvass certifies Bob Karp.
 *
 * **THE COUNT IS A DENOMINATOR AND A DIAGNOSTIC. IT IS NEVER THE PROOF OF
 * MEMBERSHIP EQUALITY.** Two lists of the same length are two lists of the same
 * length. It is reported, because *four certified against eight rendered* tells
 * a reader where to look; it decides nothing.
 *
 * ## The rules, which are explicit and none of which are fuzzy
 *
 * There is no similarity score here and no threshold. Matching goes through the
 * normaliser this repository already has and had already argued for —
 * `splitDisplayName` → `nameParts` → `namesAgree`, then `namesAgreeLoosely` over
 * whatever is left. That is deliberate reuse rather than a second
 * implementation (RULING 63): those functions already carry the suffix handling
 * (`Daniel Francis Butierez Sr.`), the quoted-alias rule the record itself
 * prints (`Walter "Les" Presmyk`), the middle-initial rule (`Karen Elizabeth
 * Ebel` / `Karen E. Ebel`) and the serving-name/filed-name prefix rule
 * (`Gregory M. Sargent` / `Greg Sargent`), each with the measured instance that
 * bought it. A second normaliser here would drift from the one the incumbency
 * matcher uses, and then the universe and the label would disagree about who a
 * person is.
 *
 * **Every pairing must be ONE-TO-ONE, in both directions, or it is refused.** A
 * certified nominee that agrees with two rendered candidates is `ambiguous`, not
 * a coin flip — the same fail-closed the matching layer takes when one sitting
 * member matches two people on a ballot. Ordering is irrelevant by construction:
 * this is set membership, and the pass loops rather than zips.
 *
 * A blank or unusable name fails closed on its own: `nameParts` gives it an
 * empty surname, `namesAgree` refuses an empty surname, and it lands in the
 * leftovers as unmatched. **We never invent an identity to close a set.**
 */
export function reconcileCandidateIdentities(
  certified: readonly string[],
  rendered: readonly string[],
): IdentityReconciliation {
  const left = parseSide(certified);
  const right = parseSide(rendered);

  const pairs: IdentityPair[] = [];
  const pairedLeft = new Set<number>();
  const pairedRight = new Set<number>();
  /** Had at least one plausible counterpart, in either pass — so its failure is
   *  ambiguity rather than absence, and those are different reports. */
  const sawSomebodyLeft = new Set<number>();
  const sawSomebodyRight = new Set<number>();

  const pass = (agree: (a: ComparableName, b: ComparableName) => boolean): void => {
    const hits = new Map<number, number[]>();
    const hitters = new Map<number, number[]>();
    for (let i = 0; i < left.length; i += 1) {
      if (pairedLeft.has(i)) continue;
      for (let j = 0; j < right.length; j += 1) {
        if (pairedRight.has(j)) continue;
        if (!agree(left[i].parts, right[j].parts)) continue;
        hits.set(i, [...(hits.get(i) ?? []), j]);
        hitters.set(j, [...(hitters.get(j) ?? []), i]);
        sawSomebodyLeft.add(i);
        sawSomebodyRight.add(j);
      }
    }
    for (const [i, js] of hits) {
      // Exactly one counterpart, and that counterpart wants only us. Anything
      // else stays unpaired and is reported as ambiguous below.
      if (js.length !== 1) continue;
      const j = js[0];
      if ((hitters.get(j) ?? []).length !== 1) continue;
      pairedLeft.add(i);
      pairedRight.add(j);
      pairs.push({ certified: left[i].raw, rendered: right[j].raw });
    }
  };

  pass(namesAgree);
  // The serving-name / filed-name gap, over the leftovers only. See
  // `namesAgreeLoosely` — an exact surname plus a first-name prefix of three
  // characters or more, inside a two-to-five person contest.
  pass(namesAgreeLoosely);

  const ambiguous: string[] = [];
  const missingFromRendered: string[] = [];
  const absentFromCertified: string[] = [];
  for (let i = 0; i < left.length; i += 1) {
    if (pairedLeft.has(i)) continue;
    (sawSomebodyLeft.has(i) ? ambiguous : missingFromRendered).push(left[i].raw);
  }
  for (let j = 0; j < right.length; j += 1) {
    if (pairedRight.has(j)) continue;
    (sawSomebodyRight.has(j) ? ambiguous : absentFromCertified).push(right[j].raw);
  }

  return {
    reconciled:
      missingFromRendered.length === 0 && absentFromCertified.length === 0 && ambiguous.length === 0,
    pairs,
    missingFromRendered,
    absentFromCertified,
    ambiguous,
  };
}

export interface CandidateUniverseInput {
  /**
   * The certified nominee list for this contest, where one exists — the state's
   * own canvass, naming who is actually on the general-election ballot.
   *
   * **`names` is the whole point and replaced a `count`.** The certified source
   * has to hand over WHO, because *how many* cannot tell a reader whether the
   * people in front of them are the certified ones. Raw strings, exactly as the
   * canvass prints them, so the mismatch report can quote the document. A
   * contest whose corpus record carries no usable name for a nominee fails
   * closed by the ordinary path: the name reconciles to nobody.
   */
  readonly certified: { readonly source: string; readonly names: readonly string[] } | null;
  /** The candidates this contest actually renders, as the page names them. */
  readonly rendered: readonly string[];
  /** The source behind the rendered list, for the finding when it is not certified. */
  readonly renderedSource: string | null;
}

/** The English list, so a `reason` reads as a sentence and not as a dump. */
const nameList = (names: readonly string[]): string => names.join(", ");

/**
 * Is the candidate list the whole of who is in this contest — and IS IT THEM?
 *
 * **A FILING LIST IS NOT A NOMINEE LIST, and this session has the instance.**
 * Arizona's State Mine Inspector contest was built from the Secretary of
 * State's March 30 filing PDF, and that PDF **did not carry the certified
 * Republican nominee** — he was found in the SoS primary canvass and added, and
 * the contest's scopeNote now records the omission. A filing list is who filed
 * by a deadline; people withdraw, people are disqualified, write-ins win, and
 * the document itself says the list narrows when the general-election list
 * publishes.
 *
 * So completeness requires a CERTIFIED nominee list, and it requires the
 * rendered list to BE that list — a certified list that exists somewhere while
 * the reader sees a filing list is not a complete universe on the page.
 *
 * **"BE that list" is decided over IDENTITIES.** It used to be decided over
 * `count`, and `lib/ballot/contest-universe.ts`'s
 * `reconcileCandidateIdentities` doc block carries the two live contests that
 * passed that gate while showing the wrong people. The count survives here as a
 * DIAGNOSTIC inside the reason — it tells a reader where to look — and it is
 * never the proof of membership equality.
 */
export function candidateUniverse(input: CandidateUniverseInput): UniverseFinding {
  if (input.certified === null) {
    return {
      complete: false,
      source: input.renderedSource,
      reason:
        "no certified nominee list names this contest, so the candidates shown are the people who " +
        "FILED. A filing list is not a nominee list — this repository has an instance of one " +
        "omitting a certified nominee — and the record itself says the list narrows once the " +
        "general-election list publishes.",
    };
  }

  const check = reconcileCandidateIdentities(input.certified.names, input.rendered);
  if (!check.reconciled) {
    /*
     * WHOSE GAP: ours. The certified list is the government's statement of who
     * is in this contest; a page showing somebody else is our assembly, not
     * their omission. The specific names are the actionable half — a reader or
     * a later session can act on "Gary Swing is not on this page" and can do
     * nothing at all with "the universe is incomplete".
     */
    const clauses: string[] = [];
    if (check.missingFromRendered.length > 0) {
      clauses.push(
        `the certified list names ${nameList(check.missingFromRendered)}, who we are not showing here`,
      );
    }
    if (check.absentFromCertified.length > 0) {
      clauses.push(
        `we are showing ${nameList(check.absentFromCertified)}, who the certified list does not name`,
      );
    }
    if (check.ambiguous.length > 0) {
      clauses.push(
        `we could not tell which person on the other list ${nameList(check.ambiguous)} is, and ` +
          "guessing would be a claim about somebody by name",
      );
    }
    return {
      complete: false,
      source: input.certified.source,
      reason:
        "the people shown here are not the people the certified nominee list names, so this list " +
        `cannot stand in for the certified one: ${clauses.join("; ")}. ` +
        `(The certified list names ${input.certified.names.length} candidate(s) and this contest ` +
        `renders ${input.rendered.length} — a count that matches would still not make two lists the ` +
        "same people.)",
    };
  }

  return {
    complete: true,
    source: input.certified.source,
    reason:
      `every one of the ${input.certified.names.length} candidate(s) shown here is a candidate the ` +
      "certified nominee list names, and the certified list names nobody we are not showing.",
  };
}

/* -------------------------------------------------------------------------- */
/* THE OFFICEHOLDER UNIVERSE                                                   */
/* -------------------------------------------------------------------------- */

export interface OfficeholderUniverseInput {
  readonly shape: HolderSourceShape;
  readonly source: string | null;
  /** How many current holders the source returned for this exact seat. */
  readonly holders: number;
  /** Seats this contest fills, from the contest's own record (`voteFor`). */
  readonly seatsThisContestFills: number | null;
}

/**
 * Do we hold EVERY current holder of this exact office?
 *
 * Two independent gates, and both must pass. The shape gate carries the weight;
 * the count gate exists because a source that enumerates a body is still being
 * asked for one seat inside it, and a slice that comes back short is a slice
 * that failed.
 *
 * **It fails closed on a vacancy**, deliberately. A district with an unfilled
 * seat returns fewer holders than the contest fills, we cannot tell that from a
 * slice that simply missed somebody, and the safe reading of the two is the one
 * that stays quiet.
 *
 * **It refuses the coincidence, too.** Arizona's Corporation Commission seats
 * five members on staggered terms and two were up in 2026; we hold exactly two
 * holders. `holders === seatsThisContestFills` is TRUE there and the universe is
 * three people short — which is why the count can never be the only gate, and
 * why that contest is stopped by its source shape instead.
 */
export function officeholderUniverse(input: OfficeholderUniverseInput): UniverseFinding {
  if (input.shape === "NOTHING_READ" || input.holders === 0) {
    return {
      complete: false,
      source: input.source,
      reason: "we hold no record of who currently sits in this seat.",
    };
  }
  if (input.shape === "COLLECTED_PERSON_BY_PERSON") {
    return {
      complete: false,
      source: input.source,
      reason:
        `this seat's ${input.holders} holder(s) come from a store assembled person by person, so a ` +
        "candidate's absence from it is our gap and not a fact about them. Nothing here shows the " +
        "store holds everyone who sits in this office.",
    };
  }
  if (input.shape === "PROBED_PER_CANDIDATE") {
    return {
      complete: false,
      source: input.source,
      reason:
        "this seat's holders were confirmed one candidate at a time, so the source can only ever " +
        "return people it was handed. It cannot enumerate who else sits here.",
    };
  }
  if (input.seatsThisContestFills === null) {
    return {
      complete: false,
      source: input.source,
      reason:
        "the contest record does not state how many seats it fills, so the holders we read cannot " +
        "be reconciled against the seat.",
    };
  }
  if (input.holders !== input.seatsThisContestFills) {
    return {
      complete: false,
      source: input.source,
      reason:
        `the body's own roster returned ${input.holders} sitting member(s) for a seat this contest ` +
        `fills ${input.seatsThisContestFills} of. A short slice and a genuine vacancy look the same ` +
        "from here, so this reads as unreconciled rather than as complete.",
    };
  }
  return {
    complete: true,
    source: input.source,
    reason:
      `the body publishes its whole membership and names ${input.holders} sitting member(s) for ` +
      `this seat, which is the ${input.seatsThisContestFills} seat(s) this contest fills.`,
  };
}

/* -------------------------------------------------------------------------- */
/* THE PER-CANDIDATE STATE                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Turn the matching layer's answer into the three explicit states.
 *
 * **This function is the whole prohibition, in one place.** A `CHALLENGER` out
 * of `resolveContestIncumbency` means only *did not match any holder we hold*.
 * It becomes `NOT_INCUMBENT` — a claim about the person — ONLY where the
 * officeholder universe is complete. Everywhere else it is `UNRESOLVED`.
 */
export function statesFromResolution(
  decisions: ReadonlyMap<string, IncumbencyDecision>,
  candidateKeys: readonly string[],
  officeholderUniverseComplete: boolean,
): Map<string, CandidateIncumbencyState> {
  const out = new Map<string, CandidateIncumbencyState>();
  for (const key of candidateKeys) {
    const standing: Incumbency | undefined = decisions.get(key)?.standing;
    if (standing === "INCUMBENT") out.set(key, "INCUMBENT");
    else if (standing === "CHALLENGER") {
      out.set(key, officeholderUniverseComplete ? "NOT_INCUMBENT" : "UNRESOLVED");
    } else out.set(key, "UNRESOLVED");
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* THE ELIGIBILITY DECISION                                                    */
/* -------------------------------------------------------------------------- */

export interface ContestEligibility {
  readonly eligible: boolean;
  readonly candidateUniverse: UniverseFinding;
  readonly officeholderUniverse: UniverseFinding;
  readonly total: number;
  readonly evaluated: number;
  readonly incumbent: number;
  readonly notIncumbent: number;
  readonly unresolved: number;
  /** Plain-language, quotable: why a label may or may not attach here. */
  readonly reason: string;
}

/**
 * The four conditions, evaluated together. All of them, or the contest is
 * silent for every candidate in it — including the one we matched.
 *
 * Returned rather than logged, because a reader-facing decision has to be
 * explainable: the inputs it turned on are on the object.
 */
export function contestLabelEligibility(input: {
  readonly candidateUniverse: UniverseFinding;
  readonly officeholderUniverse: UniverseFinding;
  readonly candidateKeys: readonly string[];
  readonly states: ReadonlyMap<string, CandidateIncumbencyState>;
}): ContestEligibility {
  const total = input.candidateKeys.length;
  let evaluated = 0;
  let incumbent = 0;
  let notIncumbent = 0;
  let unresolved = 0;
  for (const key of input.candidateKeys) {
    const state = input.states.get(key);
    if (state === undefined) continue;
    evaluated += 1;
    if (state === "INCUMBENT") incumbent += 1;
    else if (state === "NOT_INCUMBENT") notIncumbent += 1;
    else unresolved += 1;
  }

  const failures: string[] = [];
  if (total === 0) failures.push("this contest renders no candidates to evaluate");
  if (!input.candidateUniverse.complete) {
    failures.push(`the candidate universe is not complete — ${input.candidateUniverse.reason}`);
  }
  if (!input.officeholderUniverse.complete) {
    failures.push(`the officeholder universe is not complete — ${input.officeholderUniverse.reason}`);
  }
  if (evaluated !== total) {
    failures.push(`${total - evaluated} of ${total} candidate(s) were never evaluated`);
  }
  if (unresolved > 0) {
    failures.push(`${unresolved} of ${total} candidate(s) remain unresolved`);
  }

  return {
    eligible: failures.length === 0,
    candidateUniverse: input.candidateUniverse,
    officeholderUniverse: input.officeholderUniverse,
    total,
    evaluated,
    incumbent,
    notIncumbent,
    unresolved,
    reason:
      failures.length === 0
        ? `every candidate in this contest is established: candidate universe from ${input.candidateUniverse.source}, ` +
          `officeholder universe from ${input.officeholderUniverse.source}.`
        : failures.join("; "),
  };
}
