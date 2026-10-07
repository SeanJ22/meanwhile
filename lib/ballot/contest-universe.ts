import {
  nameParts,
  namesAgree,
  namesAgreeLoosely,
  splitDisplayName,
  type ComparableName,
  type Incumbency,
  type IncumbencyDecision,
} from "./incumbency.ts";

/** NOT_INCUMBENT is a claim about the person and needs a complete officeholder universe; absence from our store is UNRESOLVED. Labels are decided per contest. */
export type CandidateIncumbencyState = "INCUMBENT" | "NOT_INCUMBENT" | "UNRESOLVED";

export type HolderSourceShape =
  | "ENUMERATES_THE_SEAT"
  | "COLLECTED_PERSON_BY_PERSON"
  | "PROBED_PER_CANDIDATE"
  | "NOTHING_READ";

export interface UniverseFinding {
  readonly complete: boolean;
  readonly source: string | null;
  readonly reason: string;
  /** True only when a certified list exists and names other people than those shown; no per-person label survives it. */
  readonly contradicted: boolean;
}

export interface IdentityPair {
  readonly certified: string;
  readonly rendered: string;
}

export interface IdentityReconciliation {
  readonly reconciled: boolean;
  readonly pairs: readonly IdentityPair[];
  readonly missingFromRendered: readonly string[];
  readonly absentFromCertified: readonly string[];
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

export function reconcileCandidateIdentities(
  certified: readonly string[],
  rendered: readonly string[],
): IdentityReconciliation {
  const left = parseSide(certified);
  const right = parseSide(rendered);

  const pairs: IdentityPair[] = [];
  const pairedLeft = new Set<number>();
  const pairedRight = new Set<number>();
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
  readonly certified: { readonly source: string; readonly names: readonly string[] } | null;
  readonly rendered: readonly string[];
  readonly renderedSource: string | null;
}

const nameList = (names: readonly string[]): string => names.join(", ");

export function candidateUniverse(input: CandidateUniverseInput): UniverseFinding {
  if (input.certified === null) {
    return {
      complete: false,
      contradicted: false,
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
      contradicted: true,
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
    contradicted: false,
    source: input.certified.source,
    reason:
      `every one of the ${input.certified.names.length} candidate(s) shown here is a candidate the ` +
      "certified nominee list names, and the certified list names nobody we are not showing.",
  };
}

export interface OfficeholderUniverseInput {
  readonly shape: HolderSourceShape;
  readonly source: string | null;
  readonly holders: number;
  readonly seatsThisContestFills: number | null;
}

export function officeholderUniverse(input: OfficeholderUniverseInput): UniverseFinding {
  if (input.shape === "NOTHING_READ" || input.holders === 0) {
    return {
      complete: false,
      contradicted: false,
      source: input.source,
      reason: "we hold no record of who currently sits in this seat.",
    };
  }
  if (input.shape === "COLLECTED_PERSON_BY_PERSON") {
    return {
      complete: false,
      contradicted: false,
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
      contradicted: false,
      source: input.source,
      reason:
        "this seat's holders were confirmed one candidate at a time, so the source can only ever " +
        "return people it was handed. It cannot enumerate who else sits here.",
    };
  }
  if (input.seatsThisContestFills === null) {
    return {
      complete: false,
      contradicted: false,
      source: input.source,
      reason:
        "the contest record does not state how many seats it fills, so the holders we read cannot " +
        "be reconciled against the seat.",
    };
  }
  if (input.holders !== input.seatsThisContestFills) {
    return {
      complete: false,
      contradicted: false,
      source: input.source,
      reason:
        `the body's own roster returned ${input.holders} sitting member(s) for a seat this contest ` +
        `fills ${input.seatsThisContestFills} of. A short slice and a genuine vacancy look the same ` +
        "from here, so this reads as unreconciled rather than as complete.",
    };
  }
  return {
    complete: true,
    contradicted: false,
    source: input.source,
    reason:
      `the body publishes its whole membership and names ${input.holders} sitting member(s) for ` +
      `this seat, which is the ${input.seatsThisContestFills} seat(s) this contest fills.`,
  };
}

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

export interface ContestEligibility {
  readonly eligible: boolean;
  readonly candidateUniverse: UniverseFinding;
  readonly officeholderUniverse: UniverseFinding;
  readonly total: number;
  readonly evaluated: number;
  readonly incumbent: number;
  readonly notIncumbent: number;
  readonly unresolved: number;
  readonly reason: string;
}

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
