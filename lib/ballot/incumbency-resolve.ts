/**
 * THE ONE PLACE A BALLOT SURFACE ASKS WHO HOLDS THE SEAT.
 * (2026-08-26, the sources-and-incumbency session. Item 10's consolidation.)
 *
 * **Three sites decided incumbency and none of them read the same source.**
 * Enumerated 2026-08-26:
 *
 * | Site | What it read |
 * |---|---|
 * | `components/ballot/candidate-battlecard.tsx` | a boolean prop derived from the FEC funding snapshot, defaulting to `false` |
 * | `components/map/popup/official-modal.tsx` | the literal `"INCUMBENT"`, asserted definitionally on an officeholder card |
 * | `scripts/coverage-matrix.mts` | `candidacy?.incumbent === true` on the ballot record, which is `null` for all 367 candidates in all four zips |
 *
 * They did not agree, they could not agree, and the disagreement was invisible
 * because two of the three never rendered a contradiction on the same page.
 * **That scatter is the root defect**; this module is where it is answered
 * once.
 *
 * The officeholder-card site is left as it is and is correct: `Incumbent` on a
 * card ABOUT a sitting officeholder is definitional, and it is already gated on
 * whether the office is elected at all (`standingChipMayAttach`, BC-26). What
 * consolidates here is the BALLOT question — which of these candidates holds
 * this seat — and the coverage matrix now reads the same answer.
 */

import type { SeatHolder } from "../officials/lookup.ts";
import { seatHoldersForOffice, seatHolderById } from "../registry/server.ts";
import { standingChipMayAttach } from "../officials/elected-role.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import { currentOfficialIdentity } from "../funding/campaign-money.ts";

import {
  candidateUniverse,
  contestLabelEligibility,
  officeholderUniverse,
  statesFromResolution,
  type CandidateIncumbencyState,
  type ContestEligibility,
  type HolderSourceShape,
} from "./contest-universe.ts";
import { getGeneralLineup, lineupForContest } from "./general-lineup.ts";
import {
  nameParts,
  namesAgree,
  namesAgreeLoosely,
  resolveContestIncumbency,
  splitDisplayName,
  type IncumbencyDecision,
  type SeatHolderRef,
} from "./incumbency.ts";
import { nhLegislativeHolders, nhLegislativeRosterAppliesTo } from "./seat-holders.ts";

/**
 * One person on this ballot, as the two ballot branches each know them.
 *
 * **`key` and `targetKey` are deliberately separate.** The certified-lineup
 * branch keys a candidate by display name and builds `${contest.id}|${name}`;
 * the filed-candidate branch keys by a candidacy id and uses that id directly.
 * Collapsing them would have made the federal lookup silently ask for a key
 * that does not exist on one of the two branches — a join failing quietly,
 * which is the shape of the defect this whole module exists to fix.
 */
export interface ContestCandidate {
  /** How the calling surface will look this person's decision back up. */
  readonly key: string;
  /** The display name, for the name comparison. */
  readonly display: string;
  /** The key the FEC/congress join is stored under for this person. */
  readonly targetKey: string;
}

export interface ContestForIncumbency {
  readonly id: string;
  readonly title: string;
  /**
   * The seat's division key. **HALF of the join, and the half that was
   * mistaken for the whole of it.**
   *
   * This comment used to say "This is the join, and it is exact", and it was
   * exact only where a division hosts one elected office — legislative
   * districts, which is what it was verified against on 2026-08-26 and which is
   * why it looked right. It is not exact anywhere else, and the pilot ballots
   * are mostly anywhere else:
   *
   * ```
   * .../state:az            Governor, Secretary of State, Attorney General,
   *                         State Treasurer, Superintendent of Public
   *                         Instruction, State Mine Inspector, Corporation
   *                         Commissioner — and the index holds two U.S. SENATORS
   * .../state:nh            Governor and United States Senator
   * .../place:butler        Mayor and Member of the Borough Council
   * .../county:merrimack    Sheriff, Attorney, Treasurer, Register of Deeds,
   *                         Register of Probate
   * ```
   *
   * Asked for the AZ Governor contest, the division returned Mark Kelly and
   * Ruben Gallego, and the sitting Governor was labelled **Challenger** on the
   * ballot while her own map card said Incumbent.
   *
   * **The join is now `(ocdId, title)`** — see `seatHoldersForOffice`. The
   * division still answers WHERE; `title` answers WHICH OFFICE.
   */
  readonly ocdId: string;
  readonly candidates: readonly ContestCandidate[];
  readonly federal: boolean;
  /**
   * How many seats this contest fills, from the contest's own record.
   *
   * **REQUIRED, and required so that a caller cannot forget it.** It is the
   * only reconciliation available against an enumerating holder source: a body
   * that publishes its whole membership is still being asked for one seat
   * inside it, and a slice that returns fewer people than the contest fills is
   * a slice that failed. A caller that could omit it would silently get the
   * fail-closed answer forever, which is the shape of a join failing quietly.
   */
  readonly voteFor: number;
}

export interface ContestIncumbencyResult {
  /**
   * **THE READER-FACING ANSWER, AND IT IS GATED.** (2026-08-28.)
   *
   * Where `contestLabelEligibility` refuses the contest, every entry here is
   * UNKNOWN — including the candidate the matching layer positively identified
   * as the sitting member. That is the point: a contest showing `Incumbent` on
   * the one person we matched, while everyone else's status is unproven, tells
   * a reader those others are challengers. We had not earned that.
   *
   * It is `decisions` — the name every existing caller already reads — because
   * fail-closed has to be the DEFAULT. A gate that had to be opted into is a
   * gate that some later surface renders around.
   */
  readonly decisions: Map<string, IncumbencyDecision>;
  /**
   * What the MATCHING layer said, ungated: who does the holder record name?
   *
   * Kept because it is a different question from *may a label render*, and
   * conflating them is how the census would come to report a split the page
   * does not show. Anything reader-facing reads `decisions`.
   */
  readonly resolved: Map<string, IncumbencyDecision>;
  /** The explicit deterministic state per candidate. See `CandidateIncumbencyState`. */
  readonly states: Map<string, CandidateIncumbencyState>;
  /** The eligibility decision and the inputs it turned on, so it can be explained. */
  readonly eligibility: ContestEligibility;
  /**
   * Candidate key → the officeholder record they hold the seat under.
   *
   * **This is what Item 14 needed and could not get.** The voting-record panel
   * was gated on the FEC/congress join, so a state legislator with roll calls
   * in the committed snapshot had no door to them. Now the same resolution that
   * decides the chip also hands over the officeholder id the votes are keyed
   * on.
   */
  readonly holderFor: Map<string, SeatHolder>;
}

/** Preserve seat qualifiers that an office key intentionally strips. A town is not one ward. */
export function sameSeatDiscriminators(contestTitle: string, holderTitle: string, ocdId: string): boolean {
  const qualifiers = (title: string) => {
    const found = new Map<string, string>();
    for (const match of title.matchAll(/\b(ward|seat|position|division|district)\s*(?:no\.?\s*)?[:#]?\s*(\d+|[ivxlc]+)\b/gi)) found.set(match[1].toLowerCase(), match[2].toLowerCase());
    for (const match of title.matchAll(/\b(\d+)(?:st|nd|rd|th)?\s+(?:congressional\s+)?district\b/gi)) found.set("district", match[1]);
    if (/\bat[-\s]large\b/i.test(title)) found.set("at-large", "true");
    return found;
  };
  const left = qualifiers(contestTitle), right = qualifiers(holderTitle);
  for (const kind of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(kind), b = right.get(kind);
    if (a && b) { if (a !== b) return false; continue; }
    // Legislative district identity is already the exact OCD division (NH
    // uses composite county/district numbers); a missing title suffix is not
    // a missing seat. Municipal wards on a place division lack that key.
    if (kind === "district" && /\/(?:cd|sldl|sldu):[^/]+$/.test(ocdId)) continue;
    if (kind !== "at-large" && ocdId.endsWith(`/${kind}:${a ?? b}`)) continue;
    return false;
  }
  return true;
}

/** Person identity is necessary but insufficient: incumbency also requires the exact current office and division. */
export async function committedIncumbentHolderFor(
  contest: Pick<ContestForIncumbency, "ocdId" | "title">,
  targetKey: string,
): Promise<SeatHolder | null> {
  const office = officeIdentity(contest.title);
  if (!office || !standingChipMayAttach(contest.title)) return null;
  const matches = readerPersonKeys(targetKey).keys.flatMap(key => {
    const current = currentOfficialIdentity(key);
    return current && current.divisions.includes(contest.ocdId) && officeIdentity(current.officeTitle) === office
      && sameSeatDiscriminators(contest.title, current.officeTitle, contest.ocdId) ? [current.id] : [];
  });
  const ids = [...new Set(matches)];
  return ids.length === 1 ? seatHolderById(ids[0]) : null;
}

/**
 * The federal route, kept behind a declared seam.
 *
 * `incumbentHolderFor` reads the FEC funding snapshot and requires a
 * `congress:` roster id, which is why it can only ever answer for federal
 * offices. That is FINE as one branch among several; what was wrong was it
 * being the ONLY branch while a ternary turned its silence into `Challenger`.
 */
export type FederalHolderLookup = (targetKey: string) => Promise<SeatHolder | null>;

/**
 * THE ONE SOURCE IN THIS REPOSITORY THAT ENUMERATES A LEGISLATIVE SEAT.
 *
 * The New Hampshire General Court publishes `Members.txt` — every sitting
 * member of both chambers, keyed to county and district. Sliced to a district
 * it is the district's WHOLE membership, which is the only thing that makes a
 * candidate's absence from it the body's statement rather than our gap.
 *
 * It was already read here, but only by `anchorAgainstGencourt`, which REPORTS
 * and never decides. Promoting it to the holder source where it answers is not
 * a new claim: RULING 147 already treats the registry as an INTERMEDIARY and
 * this as the body publishing itself, and where two records of the same seat
 * exist the body's own is the one a decision should be taken on.
 *
 * **The state gate is not optional.** `State Senator, District 19` is a title
 * Arizona and New Hampshire both use, and the census proved a title-only parser
 * answers an Arizona contest with New Hampshire members.
 */
export function enumeratedSeatHolders(contest: { title: string; ocdId: string }): SeatHolderRef[] {
  if (!nhLegislativeRosterAppliesTo(contest)) return [];
  return nhLegislativeHolders(contest.title);
}

/**
 * The certified nominee list for a contest, where the state has published one.
 *
 * The canvass is named rather than summarised, because the finding it supports
 * — *this is the complete universe of candidates* — is only as good as the
 * document behind it.
 *
 * **IT HANDS OVER THE NAMES, AND IT USED TO HAND OVER A COUNT.**
 * (2026-08-28, the candidate-identity repair.) `LineupNominee.name` is the only
 * identity material the certified corpus carries — there is no candidate id, no
 * filing number and no state person key in `data/states/az/ballot/az-general-lineup-2026.json`,
 * for any of the twelve contests it names — so the name as the canvass prints it
 * IS the certified identity, quoted marks and generational suffix included
 * (`Walter "Les" Presmyk`, `Daniel Francis Butierez Sr.`). It is passed through
 * RAW: the normalisation belongs to the reconciler, which is the same one the
 * incumbency matcher uses, and a name normalised here would be a second
 * normaliser drifting from that one.
 *
 * Returning a count was the defect. `candidateUniverse` could then only ask
 * *how many*, and two contests in this repository answered that question
 * correctly while showing a different set of people.
 */
export function certifiedNomineesFor(contestId: string): { source: string; names: string[] } | null {
  const entry = lineupForContest(contestId);
  if (entry === null) return null;
  const canvass = getGeneralLineup()?.canvass;
  return {
    source: canvass ? `${canvass.title} (${canvass.issuedBy}, read ${canvass.readAt})` : "the certified canvass",
    names: entry.nominees.map((n) => n.name),
  };
}

/**
 * Which retrieval shape produced these registry holders, and therefore whether
 * their absence means anything. See `HolderSourceShape`.
 *
 * The discriminator is the holder's OWN id namespace, which the registry
 * already carries:
 *
 * | Prefix | Source | Shape |
 * |---|---|---|
 * | `congress:` | `unitedstates/congress-legislators` `legislators-current.json` — every sitting member of Congress, 100 senators and 437 representatives, with 6 unattached rows and all 6 of them territory delegates | enumerates |
 * | `plural:` | Open States, attached division by division — 66 of 90 Arizona rows, 325 of 410 New Hampshire rows and 99 of 120 New Jersey rows never attached at all | collected |
 * | `statewide:` | the curated statewide-executive store, whose own doc block calls it *what we have acquired so far* | collected |
 *
 * **Mixed is collected.** One row from a collection is enough to mean the seat
 * might hold somebody we have never seen.
 */
export function shapeOfRegistryHolders(holders: readonly SeatHolder[]): HolderSourceShape {
  if (holders.length === 0) return "NOTHING_READ";
  return holders.every((h) => (h.id ?? "").startsWith("congress:"))
    ? "ENUMERATES_THE_SEAT"
    : "COLLECTED_PERSON_BY_PERSON";
}

export async function contestIncumbency(
  contest: ContestForIncumbency,
  federalHolderFor: FederalHolderLookup,
  /**
   * Who holds THIS EXACT SEAT — the division AND the office.
   *
   * The parameter used to be `holdersForDivision` and took the ocdId alone.
   * The signature was the defect: it could not express the question, so every
   * caller asked the only question it could ask.
   */
  holdersForSeat: (ocdId: string, officeTitle: string) => Promise<SeatHolder[]> = seatHoldersForOffice,
  /**
   * The two universe inputs, injectable so the eligibility gate can be proved
   * against a FIXTURE rather than against a corpus that moves every time
   * somebody acquires an officeholder. A control that rots is not a control.
   */
  universeSources: {
    enumeratedHolders?: (contest: { title: string; ocdId: string }) => SeatHolderRef[];
    certifiedNominees?: (contestId: string) => { source: string; names: readonly string[] } | null;
    committedHolder?: typeof committedIncumbentHolderFor;
  } = {},
): Promise<ContestIncumbencyResult> {
  const candidates = contest.candidates.map((c) => ({
    id: c.key,
    ...splitDisplayName(c.display),
  }));

  // THE OFFICE GATE IS ASKED ONCE (RULING 118, BC-26, and RULING 103's reason).
  const officeIsElected = standingChipMayAttach(contest.title);

  /*
   * BRANCH ONE, AND IT IS AN EXACT KEY JOIN: the registry, asked by the seat —
   * the division AND the office. No name matching reaches the SEAT at all; the
   * only name question left is which candidate is which sitting member, over a
   * two-to-five-person population.
   *
   * **An office the vocabulary cannot classify returns nobody**, which becomes
   * UNKNOWN below. That is the correct failure: the alternative is the
   * division-wide list, and the division-wide list is what told a reader the
   * Governor of Arizona was challenging for her own seat.
   */
  const registryHolders = officeIsElected ? await holdersForSeat(contest.ocdId, contest.title) : [];
  /*
   * **THE HOLDER'S OWN IDENTIFIER, CARRIED RATHER THAN DISCARDED.**
   * (2026-08-28, the statewide-executive acquisition.)
   *
   * `personKey: null` was written here as a literal, and `resolveContestIncumbency`
   * prefers a key over every name comparison — so hard-coding `null` meant
   * **100% of the matches this repository makes go through name comparison**,
   * including the one Arizona statewide match that existed. That is not a
   * missing feature; it is a working mechanism switched off at the wire.
   *
   * `SeatHolder.id` IS the stable identifier the doc block asks for — a
   * bioguide (`congress:A000370`), a Plural person id, or this project's own
   * curated key. Passing it costs nothing today, because **no ballot candidacy
   * in this repository records one**, so `matchesFor` finds no candidate by key
   * and falls through to the name comparison exactly as before. The value is
   * that the day a ballot corpus records an identifier, the key join is already
   * wired and the name comparison stops being the only door — instead of this
   * line still saying `null` and the join silently continuing to guess.
   *
   * `?? null` rather than the bare id: a holder with an empty id must reach
   * `matchesFor` as "no key", never as the empty-string key that every other
   * keyless record would also carry.
   */
  let holders: SeatHolderRef[] = registryHolders.map((h) => ({
    ...splitDisplayName(h.name),
    personKey: h.id?.trim() || null,
    source: `the officeholder registry for ${h.officeTitle} on ${contest.ocdId}`,
  }));
  let shape: HolderSourceShape = shapeOfRegistryHolders(registryHolders);

  /*
   * BRANCH ZERO, AND IT OUTRANKS THE REGISTRY WHERE IT ANSWERS: the body's own
   * published membership. See `enumeratedSeatHolders`. It is asked FIRST for
   * the universe because it is the only source whose silence about a person is
   * the body's silence rather than ours — and a universe is exactly the thing a
   * `NOT_INCUMBENT` has to be measured against.
   */
  if (officeIsElected) {
    const enumerated = (universeSources.enumeratedHolders ?? enumeratedSeatHolders)(contest);
    if (enumerated.length > 0) {
      holders = enumerated;
      shape = "ENUMERATES_THE_SEAT";
    }
  }

  if (holders.length === 0 && contest.federal) {
    /*
     * For a federal contest the officeholder side is reached per candidate
     * rather than per seat, because that is the shape the FEC join has. A
     * nominee the join resolves IS a sitting member of this seat, so the
     * per-candidate answers assemble into the per-seat list this module wants.
     *
     * **A federal contest where the join resolves NOBODY yields an empty list
     * and therefore UNKNOWN — never a contest of challengers.** An open seat
     * and an unrecorded seat look identical from here, and the honest render
     * for both is that we have not sourced who holds it.
     */
    const resolved = await Promise.all(
      contest.candidates.map(async (c) => {
        const holder = await federalHolderFor(c.targetKey);
        return holder === null ? null : { display: c.display, holder };
      }),
    );
    holders = resolved
      .filter((r): r is { display: string; holder: SeatHolder } => r !== null)
      .map(({ display, holder }) => ({
        ...splitDisplayName(display),
        // The congressional roster id — a bioguide — is the strongest key this
        // repository holds for a person. Same reasoning as the registry branch
        // above: carried, not discarded.
        personKey: holder.id?.trim() || null,
        source: "the FEC candidate/committee join against the congressional roster",
      }));
    if (holders.length > 0) shape = "PROBED_PER_CANDIDATE";
  }

  const resolved = resolveContestIncumbency({ candidates, holders, officeIsElected });

  // The body rosters are reader truth even where the legislative division
  // index contains no row. Reuse the committed person bridge, scoped to this
  // exact office, to recover positive facts without declaring peers absent.
  const committed = new Map<string, SeatHolder>();
  for (const candidate of contest.candidates) {
    const holder = await (universeSources.committedHolder ?? committedIncumbentHolderFor)(contest, candidate.targetKey);
    if (holder) committed.set(candidate.key, holder);
  }
  for (const [key, holder] of committed) {
    if ([...committed.values()].filter(other => other.id === holder.id).length !== 1) continue;
    resolved.set(key, { standing: "INCUMBENT", basis: "The committed candidacy/person identity and current sourced officeholder agree on this exact division and office.", source: holder.sourceUrl ?? holder.provenance?.sourceOrg ?? holder.id });
    if (shape !== "ENUMERATES_THE_SEAT" && !holders.some(row => row.personKey === holder.id)) {
      holders.push({ ...splitDisplayName(holder.name), personKey: holder.id, source: holder.sourceUrl ?? holder.provenance?.sourceOrg ?? holder.id });
      shape = "COLLECTED_PERSON_BY_PERSON";
    }
  }

  /*
   * THE OFFICEHOLDER BEHIND EACH INCUMBENT, so the voting-record panel can be
   * gated on whether records EXIST rather than on a federal-only join.
   *
   * Matched the same way the decision was — by name, over the one contest — so
   * the panel and the chip cannot disagree about who this person is.
   */
  const holderFor = new Map<string, SeatHolder>();
  for (const c of contest.candidates) {
    if (resolved.get(c.key)?.standing !== "INCUMBENT") continue;
    const exact = committed.get(c.key);
    if (exact && [...committed.values()].filter(other => other.id === exact.id).length === 1) {
      holderFor.set(c.key, exact);
      continue;
    }
    const cand = nameParts(splitDisplayName(c.display).givenName, splitDisplayName(c.display).familyName);
    const hit = registryHolders.find((h) => {
      const parts = splitDisplayName(h.name);
      const hp = nameParts(parts.givenName, parts.familyName);
      return namesAgree(cand, hp) || namesAgreeLoosely(cand, hp);
    });
    if (hit) holderFor.set(c.key, hit);
  }

  /*
   * THE CONTEST-LEVEL GATE. (2026-08-28.)
   *
   * **The voting-record door above is deliberately OUTSIDE it.** Whether this
   * person's roll calls exist is data we found, and RULING 26 says collection
   * state never governs display. Whether we may call somebody a `Challenger` is
   * a claim we have to earn. Two different questions, and only the second is
   * gated.
   */
  const candidateKeys = contest.candidates.map((c) => c.key);
  const holderSourceName = holders[0]?.source ?? null;

  /*
   * An office nobody is elected to never reaches the gate. It already carries
   * the right answer and the right REASON — RULING 118's, that incumbency does
   * not attach to an appointed role — and overwriting that with a sourcing
   * explanation would replace a true statement about the office with a false
   * one about our records.
   */
  if (!officeIsElected) {
    const states = statesFromResolution(resolved, candidateKeys, false);
    return {
      decisions: resolved,
      resolved,
      states,
      eligibility: contestLabelEligibility({
        candidateUniverse: {
          complete: false,
          contradicted: false,
          source: null,
          reason: "incumbency does not attach to an office that is not filled by election (RULING 118).",
        },
        officeholderUniverse: {
          complete: false,
          contradicted: false,
          source: null,
          reason: "incumbency does not attach to an office that is not filled by election (RULING 118).",
        },
        candidateKeys,
        states,
      }),
      holderFor,
    };
  }

  const officeholders = officeholderUniverse({
    shape,
    source: holderSourceName,
    holders: holders.length,
    seatsThisContestFills: contest.voteFor,
  });
  const certified = (universeSources.certifiedNominees ?? certifiedNomineesFor)(contest.id);
  /*
   * THE RENDERED SIDE IS NAMES, NOT A LENGTH. (2026-08-28.)
   *
   * `c.display` is the string the calling surface puts on the card, which is
   * exactly the right thing to reconcile: the question the gate asks is whether
   * THE PEOPLE A READER IS LOOKING AT are the certified ones, and the only
   * honest witness to who a reader is looking at is the name printed on the
   * card. Handing over `contest.candidates.length` let a contest built from the
   * filed-candidate record pass while showing somebody the canvass never
   * certified — see `reconcileCandidateIdentities`.
   */
  const candidatesUniverse = candidateUniverse({
    certified,
    rendered: contest.candidates.map((c) => c.display),
    renderedSource: contest.candidates.length > 0 ? "the contest's own filed-candidate record" : null,
  });
  const states = statesFromResolution(resolved, candidateKeys, officeholders.complete);
  const eligibility = contestLabelEligibility({
    candidateUniverse: candidatesUniverse,
    officeholderUniverse: officeholders,
    candidateKeys,
    states,
  });

  if (eligibility.eligible) return { decisions: resolved, resolved, states, eligibility, holderFor };

  /*
   * NOT ELIGIBLE — SO THE WHOLE CONTEST GOES QUIET, the matched incumbent
   * included. Every card carries the SAME sentence, which is what keeps it a
   * statement about our sourcing rather than a badge worn by whichever
   * candidate we happen to know less about (RULING 42).
   *
   * The gap says which of the two true sentences to write. We hold holders and
   * still cannot label anybody? Then "we haven't sourced who holds this seat"
   * would be false about US, and there is a second sentence for that.
   */
  const gap = holders.length > 0 ? ("CONTEST_NOT_ESTABLISHED" as const) : ("HOLDER_NOT_SOURCED" as const);
  const decisions = new Map<string, IncumbencyDecision>();
  for (const key of candidateKeys) {
    /*
     * **BAL-32 (2026-08-30) — A POSITIVE SOURCED FACT IS NOT WITHHELD BECAUSE
     * A NEGATIVE ONE CANNOT BE MADE.**
     *
     * This loop used to quiet EVERY card, the matched incumbent included, and
     * cited RULING 42 for it. The owner reported the result twice: on 8/28 as
     * BAL-27 and on 8/30 as BAL-32, both times as Katie Hobbs — the sitting
     * Governor of Arizona — carrying *"We haven't confirmed this for everyone
     * in this contest"* on the ballot while carrying **Incumbent** on the map
     * battlecard for the same person, from the same registry, on the same day.
     *
     * RULING 42's amended text is what settles it, and it settles it against
     * the old behaviour:
     *
     * > **BANNED — suppression.** Removing or withholding data about a
     * > candidate because something else about them is missing.
     *
     * The marker that ruling deleted was a badge naming *the candidate we know
     * LEAST about* — the information asymmetry pointed at the least-resourced
     * person. "Incumbent" is the opposite of that badge: it is a positive fact
     * about one person, sourced from the officeholder registry, asserting
     * nothing whatever about anybody else in the contest.
     *
     * **The two labels are different claims and only one of them needs the
     * universe.**
     *
     * ```
     *   INCUMBENT    "this person holds this office"
     *                positive · per-person · the registry sources it
     *                needs NO universe — it makes no claim about the others
     *
     *   CHALLENGER   "this person does NOT hold this office"
     *                an ASSERTED ABSENCE about a named person
     *                needs the officeholder universe COMPLETE, or it is
     *                absence asserted, which this product never does
     * ```
     *
     * So the gate survives exactly where it was load-bearing — nobody is
     * called a challenger on an incomplete universe — and stops suppressing
     * the one thing we can actually source. Every card still carries a chip
     * (BAL-20), and the others still carry the same sentence as each other,
     * which is the RULING 42 property that mattered: no card wears a mark
     * naming it as the thin one.
     */
    /*
     * **AND THE ONE CASE WHERE EVEN THE POSITIVE FACT STAYS QUIET.**
     *
     * `contradicted` means a certified nominee list EXISTS and the people
     * rendered are not the people it names. That is different in kind from not
     * holding the list at all: it is positive evidence that this page's
     * identities are wrong, so the person we matched to the officeholder
     * record may not be the person on the card. Labelling them would be a
     * claim about somebody by name that we hold evidence against — and the
     * whole contest goes quiet, exactly as before.
     *
     * `tests/incumbency-eligibility.test.ts` holds this: the Testville mayor
     * stays unlabelled because one rendered name could not be reconciled to
     * the certified list, and that behaviour is unchanged.
     */
    const identityContradicted = eligibility.candidateUniverse.contradicted;
    const resolvedHere = resolved.get(key);
    if (!identityContradicted && resolvedHere?.standing === "INCUMBENT") {
      decisions.set(key, resolvedHere);
      continue;
    }
    decisions.set(key, {
      standing: "UNKNOWN",
      basis: eligibility.reason,
      source: holderSourceName,
      gap,
    });
  }
  return { decisions, resolved, states, eligibility, holderFor };
}

/**
 * WHAT THE BODY'S OWN ROSTER SAYS ABOUT THE SAME SEAT.
 *
 * RULING 147 — no reconciliation may compare a parser to itself. The registry
 * above is Plural/Open States, an INTERMEDIARY. `gc.nh.gov/downloads/Members.txt`
 * is the New Hampshire General Court publishing its own membership. Comparing
 * the two is a real external anchor; re-deriving the registry from the registry
 * would agree with itself on every seat, every day, forever.
 *
 * It REPORTS and never overrides. A disagreement is a finding (RULING 57 and
 * RULING 114), closed by walking a third branch, never by editing the
 * expectation.
 */
export function anchorAgainstGencourt(
  contestTitle: string,
  registryHolderNames: readonly string[],
  ocdId: string,
): {
  anchor: "AGREES" | "DISAGREES" | "COULD_NOT_ANCHOR";
  detail: string;
} {
  /*
   * THE STATE GATE, and it is here because the first run of pnpm incumbency:census
   * proved it was needed. "State Senator, District 19" is a title ARIZONA and NEW
   * HAMPSHIRE both use, and a parser that reads only the title answered an AZ
   * contest with New Hampshire members. The resolution itself was never at risk —
   * it joins on the OCD-ID — but the ANCHOR was, and an anchor that compares the
   * wrong two things is worse than no anchor.
   */
  if (!ocdId.includes("/state:nh/")) {
    return {
      anchor: "COULD_NOT_ANCHOR",
      detail: `${ocdId} is not a New Hampshire division, and the General Court's roster only answers for New Hampshire seats.`,
    };
  }
  const body = nhLegislativeHolders(contestTitle);
  if (body.length === 0) {
    return {
      anchor: "COULD_NOT_ANCHOR",
      detail:
        "the General Court's own roster does not answer for this contest — either it is not a New " +
        "Hampshire legislative seat, or the title did not parse into the county-and-district pair the " +
        "roster is keyed on. NOT the same as agreeing (RULING 147).",
    };
  }
  const surname = (s: string) => splitDisplayName(s).familyName.toLowerCase();
  const bodySurnames = new Set(body.map((h) => h.familyName.toLowerCase()));
  const regSurnames = new Set(registryHolderNames.map(surname));
  const onlyBody = [...bodySurnames].filter((s) => !regSurnames.has(s));
  const onlyReg = [...regSurnames].filter((s) => !bodySurnames.has(s));
  if (onlyBody.length === 0 && onlyReg.length === 0) {
    return { anchor: "AGREES", detail: `${body.length} sitting member(s), same surnames on both sides` };
  }
  return {
    anchor: "DISAGREES",
    detail:
      `the General Court's roster carries ${bodySurnames.size} sitting member(s) and the registry ` +
      `carries ${regSurnames.size}. Only in the body's roster: ${onlyBody.join(", ") || "none"}. ` +
      `Only in the registry: ${onlyReg.join(", ") || "none"}. Two official enumerations disagreeing ` +
      "is a FINDING, not an error.",
  };
}
