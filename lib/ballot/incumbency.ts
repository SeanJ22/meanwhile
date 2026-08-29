/**
 * WHO HOLDS THIS SEAT, AND THE THREE ANSWERS.
 * (2026-08-26, the sources-and-incumbency session. Items 10 through 15.)
 *
 * **Incumbency is a fact about HOLDING THE OFFICE.** It lives with the
 * officeholder record, keyed on the seat — body, district, term — and it is
 * never inferred from the filing record. A filing table has no incumbency
 * column; reading one off it is a lookup for a fact that lives on one side of a
 * join, which is RULING 111's failure in different clothes.
 *
 * ---
 *
 * ## What was actually wrong, because it was not what anyone thought
 *
 * The reported instance was **Karen Ebel** — the sitting incumbent and Deputy
 * Speaker of the New Hampshire House — rendering as `Challenger` on the `03255`
 * ballot. The hypothesis on the table was a NAME JOIN failing: our card reads
 * *Karen Elizabeth Ebel*, the General Court carries her as *Karen E. Ebel*,
 * candidates file under legal names and serve under working names.
 *
 * **That hypothesis is REFUTED, and the truth is simpler and much worse.**
 *
 * 1. **No ballot record in this repository carries an incumbency value at
 *    all.** Measured 2026-08-26 across all four pilot zips: `incumbent: true`
 *    **0 times**, `incumbent: false` **0 times**, `incumbent: null` **367
 *    times**. There was no join to fail.
 * 2. **`app/ballot/page.tsx` derived the flag from `incumbentHolderFor`**,
 *    which reads the FEC FUNDING SNAPSHOT and requires a `congress:` roster id.
 *    That function's own doc block says it: *"Federal only by construction."*
 * 3. **`components/ballot/candidate-battlecard.tsx` then rendered
 *    `incumbent ? "Incumbent" : "Challenger"`** off a prop defaulting to
 *    `false`.
 *
 * So every candidate for every non-federal office in this product rendered as
 * `Challenger`, including every actual incumbent, because a lookup that
 * structurally cannot answer for a state house seat returned null and a ternary
 * turned null into a confident sentence about a named person. **That is the
 * render-default rule verbatim** — no component default may convert absence
 * into an assertion — committed by the one component whose label is a claim
 * about whether a reader has ever been able to vote against someone.
 *
 * ---
 *
 * ## Why the unit is the CONTEST and not the candidate
 *
 * RULING 42 forbids any per-card marker of how complete one candidate's record
 * is relative to another's. A third state rendered per candidate would be
 * exactly that: in a contest where we know one person and not the other, one
 * card would read `Challenger` and the other `Not yet determined`, and the
 * second is a badge worn by the candidate we know less about.
 *
 * **Resolving per CONTEST removes the asymmetry by construction.** Either the
 * seat's holder is known, in which case exactly one candidate is the incumbent
 * and every other candidate in that contest is a challenger — one determination,
 * symmetric — or the holder is not known, in which case EVERY candidate in the
 * contest reads *not yet determined*. The sourcing state attaches to the
 * contest, and it singles nobody out.
 *
 * **FAIL CLOSED.** A holder we know but cannot match to exactly one candidate
 * makes the whole contest UNKNOWN. Guessing which of two similarly-named people
 * is the sitting member is how a fourteen-year incumbent gets publicly
 * described as having never held the office, pointed the other way.
 */

/** The three states, and the third is a fact about US, not about them. */
export type Incumbency = "INCUMBENT" | "CHALLENGER" | "UNKNOWN";

export interface IncumbencyDecision {
  readonly standing: Incumbency;
  /**
   * How it was decided, in words. Carried so a surface can explain itself and
   * so a report can state a denominator per basis rather than a bare count.
   */
  readonly basis: string;
  /** What was read. A stable identifier where one exists, else the roster. */
  readonly source: string | null;
  /**
   * For UNKNOWN only: WHICH gap it is, so the reader-facing sentence is the
   * true one. Absent means the original and commonest cause — we hold no record
   * of who sits here. See `IncumbencyGap`.
   */
  readonly gap?: IncumbencyGap;
}

/** A candidate as this decision needs to see them. */
export interface CandidateRef {
  readonly id: string;
  readonly familyName: string;
  readonly givenName: string;
  /**
   * A stable identifier for the PERSON, where the body publishes one — New
   * Hampshire's `EmployeeNo`, a bioguide id, an FEC candidate id. Preferred
   * over every name comparison, always.
   */
  readonly personKey?: string | null;
}

/** Who holds the seat, as the body that holds it publishes them. */
export interface SeatHolderRef {
  readonly familyName: string;
  readonly givenName: string;
  readonly personKey?: string | null;
  /** Where this came from — a URL or a source name. Never invented. */
  readonly source: string;
}

/* -------------------------------------------------------------------------- */
/* NAME COMPARISON, AND IT IS THE LAST RESORT RATHER THAN THE METHOD           */
/* -------------------------------------------------------------------------- */

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** The shape both name comparisons take. `aliases` is optional for callers
 * that build one by hand; `nameParts` always fills it. */
export interface ComparableName {
  first: string;
  middles: string[];
  last: string;
  /** Names the record itself PUBLISHES as alternatives. See `nameParts`. */
  aliases?: string[];
}

/**
 * Reduce a name to the parts two records could plausibly agree on.
 *
 * Drops case, punctuation, and generational suffixes. It does NOT drop middle
 * names — it returns them separately, so the caller can decide, because
 * *Karen Elizabeth Ebel* and *Karen E. Ebel* agreeing is a judgement and
 * silently making it inside a normaliser is how a wrong match gets made
 * invisibly.
 *
 * ## THE QUOTED NAME IS AN ALIAS THE RECORD ITSELF PUBLISHES
 * (2026-08-28, the statewide-executive acquisition.)
 *
 * A certified filing writes the name the candidate filed under, and where that
 * differs from the name they are known by, **the filing prints both**:
 *
 * ```
 * Nicholas "Nick" Myers      Arizona Corporation Commissioner, 2026 filing
 * Leonard "Len" Rosenblum    Arizona legislative candidate, 2024 canvass
 * Thomas "T.J." Shope Jr.    Arizona State Senator, 2024 canvass
 * Jennifer "Jen" Allen       Pima County Supervisor, 2024 canvass
 * ```
 *
 * The Corporation Commission publishes its sitting Chair as **Nick Myers**.
 * Before this, `nicholas` was the first name and `nick` was swallowed as a
 * middle name, so the strict test failed, the loose test failed (`nicholas`
 * is not a prefix of `nick`, nor the reverse), and the surname-collision
 * guard then took the WHOLE Corporation Commissioner contest to UNKNOWN —
 * losing Kevin Thompson's true incumbency alongside Myers's.
 *
 * **This is not a guess and not a fuzzy match.** The alias is not inferred
 * from similarity; it is printed, in quotation marks, by the record being
 * read. Reading it is reading the source. Only DOUBLE quotes and parentheses
 * delimit one — an apostrophe is part of *O'Brien*, and treating it as a
 * delimiter would shred real surnames.
 *
 * The surname must still agree exactly, and the caller still fails the contest
 * closed when one sitting member matches two candidates.
 */
export function nameParts(given: string, family: string): Required<ComparableName> {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,'"`]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const aliases: string[] = [];
  const givenWithoutAliases = String(given ?? "")
    .replace(/[“"]([^”"]+)[”"]/g, (_match, inner: string) => {
      aliases.push(inner);
      return " ";
    })
    .replace(/\(([^)]+)\)/g, (_match, inner: string) => {
      aliases.push(inner);
      return " ";
    });

  const givenTokens = clean(givenWithoutAliases).split(" ").filter(Boolean);
  const familyTokens = clean(family)
    .split(" ")
    .filter((t) => t.length > 0 && !SUFFIXES.has(t));

  return {
    first: givenTokens[0] ?? "",
    middles: givenTokens.slice(1),
    last: familyTokens.join(" "),
    aliases: aliases.map(clean).filter(Boolean),
  };
}

/** Every name this record offers as the person's FIRST name — the parsed
 * first name, plus any alias the record printed alongside it. */
function firstNames(n: ComparableName): string[] {
  return [n.first, ...(n.aliases ?? [])].filter((s) => s.length > 0);
}

/**
 * Do these two names plausibly name the same person?
 *
 * Surname must match exactly. First name must match exactly. A middle name
 * matches an INITIAL of itself, in either direction, which is the whole of what
 * *Karen Elizabeth Ebel* versus *Karen E. Ebel* needs — and a record carrying no
 * middle name at all does not disqualify a match, because most rosters omit it.
 *
 * **This is deliberately narrow.** It will miss a married name, a hyphenation
 * change and a nickname, and every one of those misses becomes UNKNOWN rather
 * than a wrong label. That is the correct direction: an unmatched incumbent
 * reads as *not yet determined*, which is true, where a mismatched one reads as
 * a false claim about two people at once.
 */
export function namesAgree(a: ComparableName, b: ComparableName): boolean {
  if (a.last.length === 0 || b.last.length === 0) return false;
  if (a.last !== b.last) return false;
  const firstsA = firstNames(a);
  const firstsB = firstNames(b);
  if (firstsA.length === 0 || firstsB.length === 0) return false;
  // The published alias counts as a first name on the side that published it.
  const agreedFirst = firstsA.some((x) => firstsB.includes(x));
  if (!agreedFirst) return false;

  if (a.middles.length === 0 || b.middles.length === 0) return true;
  const initials = (m: string[]) => m.map((x) => x[0]).join("");
  const full = (m: string[]) => m.join(" ");
  if (full(a.middles) === full(b.middles)) return true;
  return initials(a.middles) === initials(b.middles);
}

/**
 * The same surname, and a first name one is a prefix of the other.
 *
 * **This exists because the strict test produced two FALSE `Challenger` labels
 * in the very contest the defect was found in**, and finding that before
 * shipping is the whole of RULING 157. The registry serves SERVING names and a
 * ballot serves FILED names:
 *
 * | On the ballot | In the roster | Strict test |
 * |---|---|---|
 * | Karen Elizabeth Ebel | Karen Ebel | agrees |
 * | Gregory M. Sargent | Greg Sargent | **disagrees** |
 * | Daniel E. Innis | Dan Innis | **disagrees** |
 *
 * Sargent and Innis both sit. Labelling them `Challenger` would have been the
 * reported defect committed a second time, by the fix for it.
 *
 * **Why a prefix is safe HERE and would not be in general.** The population is
 * one contest — two to five people — and the surname must already match
 * exactly. `Greg`/`Gregory` and `Dan`/`Daniel` inside a two-person race carry
 * almost all their evidence in the surname. The caller still refuses the
 * contest when this produces more than one candidate for one sitting member.
 *
 * Three characters minimum, so `J.`/`James` is not a match — an initial is not
 * a nickname, and treating it as one would match any first name starting with
 * that letter.
 */
export function namesAgreeLoosely(a: ComparableName, b: ComparableName): boolean {
  if (a.last.length === 0 || a.last !== b.last) return false;
  for (const x of firstNames(a)) {
    for (const y of firstNames(b)) {
      if (x.length < 3 || y.length < 3) continue;
      if (x.startsWith(y) || y.startsWith(x)) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* THE DECISION                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Split a display name into given and family parts.
 *
 * **Generational suffixes are the trap here** and this repo has already been
 * bitten by them: three copies of an initials function rendered *Thomas J.
 * Haynes III* as "TI", because each took the first letter of the LAST token and
 * the last token was `III` (RULING 103). A splitter that made the same mistake
 * would put the suffix in the surname and fail every match.
 */
export function splitDisplayName(display: string): { givenName: string; familyName: string } {
  const tokens = display.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (tokens.length === 0) return { givenName: "", familyName: "" };
  if (tokens.length === 1) return { givenName: "", familyName: tokens[0] };

  let end = tokens.length - 1;
  while (end > 0 && SUFFIXES.has(tokens[end].toLowerCase().replace(/[.,]/g, ""))) end -= 1;
  return { givenName: tokens.slice(0, end).join(" "), familyName: tokens[end] };
}

export interface ContestIncumbencyInput {
  readonly candidates: readonly CandidateRef[];
  /**
   * Everyone who currently sits in this seat, as the body publishes them.
   *
   * **A LIST, because New Hampshire House districts are MULTI-MEMBER** and
   * treating a seat as singular would have been correct for 100 of that state's
   * 199 House districts and wrong for the other 99 — including Merrimack 7,
   * which is the district the reported defect was found in. Measured
   * 2026-08-26 from the General Court's own roster: 100 single-member
   * districts, 50 with two members, 34 with three, 9 with four, and one with
   * ten.
   *
   * **EMPTY means we have not recorded who sits here.** It is never a signal
   * that everybody is a challenger.
   */
  readonly holders: readonly SeatHolderRef[];
  /**
   * Does an `Incumbent`/`Challenger` label attach to this office at all?
   *
   * `false` for an appointed role (RULING 118) and for anything not filled by
   * election. The caller answers it, because the caller knows the office and
   * this module knows only the people — and asking it here from a title string
   * would be a second implementation of `standingChipMayAttach` (RULING 103).
   */
  readonly officeIsElected: boolean;
}

export const NOT_ELECTED: IncumbencyDecision = {
  standing: "UNKNOWN",
  basis: "this office is not filled by election, so incumbency does not attach to it (RULING 118)",
  source: null,
};

/**
 * Resolve every candidate in one contest, together.
 *
 * Returns a map keyed by candidate id. **Every candidate handed in gets an
 * entry** — a candidate with no decision would be a candidate whose card asks
 * the question again somewhere else and gets a different answer.
 */
export function resolveContestIncumbency(input: ContestIncumbencyInput): Map<string, IncumbencyDecision> {
  const out = new Map<string, IncumbencyDecision>();

  if (!input.officeIsElected) {
    for (const c of input.candidates) out.set(c.id, NOT_ELECTED);
    return out;
  }

  const source = input.holders[0]?.source ?? null;
  const unknown = (basis: string): Map<string, IncumbencyDecision> => {
    for (const c of input.candidates) out.set(c.id, { standing: "UNKNOWN", basis, source });
    return out;
  };

  if (input.holders.length === 0) {
    return unknown(
      "we haven't sourced who currently holds this seat, so we cannot say which of these people " +
        "holds it and which are running against them",
    );
  }

  /** Which candidates does one sitting member correspond to? */
  const matchesFor = (h: SeatHolderRef): { candidates: CandidateRef[]; byKey: boolean } => {
    const key = h.personKey?.trim() || null;
    if (key) {
      const byKey = input.candidates.filter((c) => (c.personKey?.trim() || null) === key);
      if (byKey.length > 0) return { candidates: byKey, byKey: true };
    }
    const parts = nameParts(h.givenName, h.familyName);
    const strict = input.candidates.filter((c) => namesAgree(nameParts(c.givenName, c.familyName), parts));
    if (strict.length > 0) return { candidates: strict, byKey: false };
    // The serving-name / filed-name gap. See `namesAgreeLoosely`.
    return {
      candidates: input.candidates.filter((c) => namesAgreeLoosely(nameParts(c.givenName, c.familyName), parts)),
      byKey: false,
    };
  };

  const incumbentIds = new Set<string>();
  let anyByKey = false;
  for (const h of input.holders) {
    const { candidates: hit, byKey } = matchesFor(h);

    if (hit.length === 0) {
      /*
       * A sitting member who matches nobody is NORMAL — they are not seeking
       * re-election, and the seat is open.
       *
       * **Unless a candidate shares their surname exactly.** Then the far more
       * likely explanation is that our name comparison is not up to this
       * contest, and labelling that person `Challenger` would repeat the
       * defect this module exists to fix. Fail closed.
       */
      const sameSurname = input.candidates.filter(
        (c) => nameParts(c.givenName, c.familyName).last === nameParts(h.givenName, h.familyName).last,
      );
      if (sameSurname.length > 0) {
        return unknown(
          `a sitting member of this seat (${h.givenName} ${h.familyName}) shares a surname with a ` +
            "candidate here and our name comparison could not decide whether they are the same " +
            "person. Guessing either way would be a claim about somebody by name, so the contest " +
            "reads as not yet sourced.",
        );
      }
      continue;
    }

    if (hit.length > 1) {
      // FAIL CLOSED. One sitting member matching two people on the same ballot
      // is ambiguous, and choosing between them would be a guess about a named
      // person — the exact shape that produced the defect this module fixes,
      // pointed the other way.
      return unknown(
        `${hit.length} candidates in this contest could be the same sitting member on the record we ` +
          "hold. Choosing between them would be a guess about a named person, so the whole contest " +
          "reads as not yet sourced.",
      );
    }
    if (hit.length === 1) {
      incumbentIds.add(hit[0].id);
      anyByKey ||= byKey;
    }
    // hit.length === 0 is NORMAL and is not a failure: a sitting member who is
    // not seeking re-election is simply not on this ballot.
  }

  const basisKind = anyByKey
    ? "a stable identifier published by the body"
    : "a name match against the body's own roster";

  for (const c of input.candidates) {
    out.set(
      c.id,
      incumbentIds.has(c.id)
        ? { standing: "INCUMBENT", basis: `holds this seat, by ${basisKind}`, source }
        : {
            standing: "CHALLENGER",
            basis: `does not appear among the people currently holding this seat, by ${basisKind}`,
            source,
          },
    );
  }
  return out;
}

/**
 * WHICH GAP the third state is, because there is more than one and they are
 * not the same fact about us. (2026-08-28, the contest-universe session.)
 *
 * Until the contest-level eligibility gate existed, UNKNOWN had exactly one
 * cause — no holder record — and one sentence said it. The gate adds a second
 * cause: **we know who holds the seat and still cannot label anybody**, because
 * the contest's candidate universe or its officeholder universe is not shown
 * complete, and labelling only the person we matched is the acquisition
 * asymmetry reaching a reader.
 *
 * Saying *we haven't sourced who holds this seat* in that second case would be
 * a FALSE statement about us — we have sourced it. Both sentences are about US
 * either way, which is the rule; this is about them also being true.
 */
export type IncumbencyGap = "HOLDER_NOT_SOURCED" | "CONTEST_NOT_ESTABLISHED";

/**
 * The reader-facing word for each state. The third is deliberately about us.
 *
 * Plain language, no internal vocabulary, and — for the third state — the same
 * sentence on EVERY card in the contest, so it can never read as a remark about
 * whichever candidate we happen to know less about (RULING 42).
 */
export function incumbencyLabel(
  standing: Incumbency,
  gap: IncumbencyGap = "HOLDER_NOT_SOURCED",
): string | null {
  switch (standing) {
    case "INCUMBENT":
      return "Incumbent";
    case "CHALLENGER":
      return "Challenger";
    case "UNKNOWN":
      return gap === "CONTEST_NOT_ESTABLISHED"
        ? "We haven't confirmed this for everyone in this contest"
        : "We haven't sourced who holds this seat yet";
  }
}
