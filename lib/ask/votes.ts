import { readFileSync } from "node:fs";
import { stateForRosterFile } from "../holdings/runtime-paths.ts";
import { join } from "node:path";

import { nameParts, splitDisplayName } from "../ballot/incumbency.ts";
import { heldRosterStates } from "../holdings/discovery.ts";
import { mayReadRetiredPluralRoster } from "../officials/roster-authority.ts";
import { getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import { formatDateLong } from "../text/format-date.ts";
import {
  getStateVotesSnapshot,
  type OfficialStateVoteScope,
} from "../sources/legiscan/snapshot.ts";
import { stateRollPublisher } from "../sources/legiscan/types.ts";
import type { StateRollCall, StateVotesSnapshot } from "../sources/legiscan/types.ts";
import {
  officialStateVoteScopeForOfficeholderId,
} from "../state-rollcalls/authority.ts";
import { getVotesSnapshot, readFederalRollCallsProjection } from "../votes/snapshot.ts";
import { readHistoricalFederalVotesForMember } from "../votes/history.ts";
import type { RollCallVote, VotesSnapshot } from "../votes/types.ts";

import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";

/**
 * **HOW A PERSON ACTUALLY VOTED, REACHED THROUGH EXACT IDENTITY.**
 * (ASK-06, 2026-08-28.)
 *
 * ## The record class did not exist
 *
 * Canonical roll-call records have been committed in this repository for
 * weeks — the promoted federal projection holds the bounded roll-call window and
 * 10,674 recorded positions across the then-current 537-member snapshot; `data/votes/state-votes-snapshot.json`
 * holds 72 Arizona, New Hampshire and New Jersey roll calls and 1,560
 * positions across 130 members — and **the grounded Ask engine could not reach
 * one of them.** Grepping the sixteen files of `lib/ask/` for `VOTE`,
 * `ROLL_CALL`, `rollCall` or `votes` returned nothing at all. `EvidenceRecord`
 * had sixteen kinds and none was a vote. So a reader asking what their
 * representative had actually done got the honest gap sentence over a store
 * that held twenty of his roll calls.
 *
 * ## The identity chain, and each leg is exact
 *
 * ```
 *   ROLL CALL  --officeholderId-->  OFFICEHOLDER  --officeTitle-->  OFFICE
 *                                        ^
 *                                        | EXACT FULL NAME, UNIQUE
 *                                        |
 *                              the subject the reader asked about
 * ```
 *
 * 1. **VOTE to OFFICEHOLDER is a stable published identifier.**
 *    `congress:<bioguide>` for the chambers, `plural:<uuid>` for the state
 *    legislatures. String equality on a key the publisher minted. No name is
 *    involved anywhere on this leg, and 100% of the vote rows in both
 *    snapshots resolve to a roster row (measured 2026-08-28: 0 of 667 voting
 *    officeholder ids missing from the four rosters).
 *
 * 2. **OFFICEHOLDER to OFFICE is READ, never inferred.** The office is the
 *    roster row's own `officeTitle`, with the division links
 *    (`OfficeholderDivision`) as the many-to-many join they are. It is
 *    emphatically NOT the office the person is running for. Andy Biggs is a
 *    candidate for Governor of Arizona and a sitting U.S. Representative with
 *    twenty recorded federal votes; the record says *U.S. Representative*,
 *    because that is the seat he cast them in. Printing the sought office
 *    beside a held office's votes would be a false claim in a small font.
 *
 * 3. **SUBJECT to OFFICEHOLDER is the only leg with no stable identifier, and
 *    it FAILS CLOSED.** A `Candidacy` in `lib/ballot/types.ts` carries no
 *    `personKey`. There is no published crosswalk between a county clerk's
 *    filing table and a legislature's member roster. So the join is EXACT
 *    normalized full-name equality, and it must resolve to EXACTLY ONE roster
 *    row. Anything else produces no records and a named gap.
 *
 * ## Why exact, when exact is measurably expensive
 *
 * Measured across all four rosters, 1,157 officeholders: **zero exact
 * full-name collisions.** The risk is not two people sharing a name — it is
 * NAME-FORM VARIANCE across the join, and there are four live cases in one
 * Arizona ballot alone:
 *
 * | On the ballot | In the roster | Cost of refusing |
 * |---|---|---|
 * | Sally Ann Gonzales (State Rep, D20) | Sally Gonzales (State **Senator**) | 12 votes |
 * | Adelita Grijalva | Adelita S. Grijalva (U.S. Rep) | 20 votes |
 * | Rachel "Jones" Keshel | Rachel Keshel (State Rep) | 12 votes |
 * | Alexander Kolodin | Alex Kolodin (State Rep) | 0 votes |
 *
 * Every one of those refusals costs real, public, correctly-recorded votes,
 * and every one of them is still right, because the first row is the reason:
 * **the roster says a different chamber.** Joining Sally Ann Gonzales's House
 * candidacy to Sally Gonzales's Senate record would attach twelve roll calls
 * cast in one chamber to a person seeking a seat in another. That is a FALSE
 * CLAIM about a named person's voting record. Not joining loses twelve real
 * votes, which is an HONEST GAP. The constitution decides between those two
 * without ambiguity, and it is the same posture `lib/ballot/incumbency.ts`
 * already takes for the same reason.
 *
 * And the loosening that would fix Grijalva breaks worse things. A
 * surname-and-first-initial rule merges **Lupe Diaz / Genoveva Diaz / Eva
 * Diaz** and **Alma / Consuelo / Lydia Hernandez** — six distinct sitting
 * Arizona legislators, three of whom hold twelve recorded votes each. A wrong
 * merge does not read as a gap; it reads as a confident, sourced, completely
 * false statement about how somebody voted.
 *
 * **The fix for a blocked name is a stable identifier, not a looser match.**
 * When a filing source starts publishing a person key, or a crosswalk is
 * collected, these join and the gap disappears. Until then the gap is named
 * and it says whose it is.
 *
 * ## What it never does
 *
 * No rate, no score, no rank, no total, no "voted with their party N% of the
 * time", no characterisation of what a vote meant. Every string below is the
 * chamber's own words — bill title, question, tally, date — or the roster's
 * own office title. The reader is told how the chamber recorded it and where
 * to read it, and nothing else.
 */

/* -------------------------------------------------------------------------- */
/* THE ROSTER, AS THIS MODULE NEEDS TO SEE IT                                  */
/* -------------------------------------------------------------------------- */

/**
 * The registered roster authorities, and which vote store each one's people vote in.
 *
 * **DERIVED FROM THE COVERAGE MANIFEST, never typed out.** The first cut of
 * this listed each covered state's FIPS code against its postal code by hand
 * and `tests/coverage-manifest.test.ts` caught it inside one run — correctly,
 * and for the reason AUD-06 exists: fourteen hand-kept state lists across
 * thirteen files was not an annoyance at three states, it was the omission a
 * session makes at fifty while believing the state is fully onboarded.
 * A recorded state roster is discovered from held data; adding one needs
 * no state-specific code branch.
 *
 * The federal roster is the promoted FEDERAL_DIRECTORY authority because it
 * is not a covered STATE — it is national, keyed on `congress:` ids, and its
 * members carry their own `state` on the row. Retired state files can enter
 * only through the explicit node:test fixture gate.
 */
type VoteRosterAuthority =
  | { readonly kind: "FEDERAL_DIRECTORY"; readonly state: null }
  | { readonly kind: "RETIRED_STATE_TEST_FIXTURE"; readonly file: string; readonly state: string };

const ROSTER_SCOPES: Readonly<Record<string, VoteRosterAuthority>> = {
  us: { kind: "FEDERAL_DIRECTORY", state: null },
  ...(mayReadRetiredPluralRoster()
    ? Object.fromEntries(
        heldRosterStates(process.cwd()).map((s) => [s.fips, { kind: "RETIRED_STATE_TEST_FIXTURE" as const, file: `officeholders-${s.fips}.json`, state: s.usps }]),
      )
    : {}),
};

interface RosterRow {
  id: string;
  name: string;
  officeTitle: string;
  /** Present on the FEDERAL roster only — the state the member serves. */
  state?: string | null;
  chamber?: string | null;
  provenance?: { sourceUrl?: string | null; sourceOrg?: string | null; collectedAt?: string | null } | null;
}

interface RosterSet {
  scope: string;
  officeholders: RosterRow[];
  divisions: { officeholderId: string; ocdId: string }[];
}

/** One roster row, plus the two things only its FILE knows. */
export interface VoteSubjectSeat {
  officeholderId: string;
  name: string;
  officeTitle: string;
  /** `us`, or the state FIPS the roster file covers. Picks the vote store. */
  rosterScope: string;
  /**
   * The state this seat serves — from the roster FILE for a state legislature,
   * from the member's own row for the federal roster. It scopes the join, so a
   * name typed on an Arizona ballot cannot reach a New Hampshire member.
   */
  state: string | null;
  chamber: string | null;
  /** The divisions this seat serves — the many-to-many join, read not assumed. */
  ocdIds: string[];
  sourceUrl: string | null;
  sourceOrg: string | null;
  retrievedAt: string | null;
}

let rosterCache: { readonly federal: RosterSet; readonly rows: VoteSubjectSeat[] } | null = null;

function loadRoster(): VoteSubjectSeat[] {
  const federal = getFederalOfficeholderSet() as RosterSet;
  if (rosterCache?.federal === federal) return rosterCache.rows;
  const out: VoteSubjectSeat[] = [];
  for (const [scope, authority] of Object.entries(ROSTER_SCOPES)) {
    const state = authority.state;
    let set: RosterSet | null = null;
    try {
      set = authority.kind === "FEDERAL_DIRECTORY"
        ? federal
        : JSON.parse(readFileSync(join(process.cwd(), "data", "states", stateForRosterFile(authority.file)!, "officials", authority.file), "utf8")) as RosterSet;
    } catch (error) {
      if (authority.kind === "FEDERAL_DIRECTORY") throw error;
      /* A committed file that will not read is a real state. It contributes
         nothing and the caller reports an honest gap — never a 500, and never
         a claim that the person cast no votes. */
      set = null;
    }
    if (!set) continue;
    const divisions = new Map<string, string[]>();
    for (const link of set.divisions ?? []) {
      const arr = divisions.get(link.officeholderId) ?? [];
      arr.push(link.ocdId);
      divisions.set(link.officeholderId, arr);
    }
    for (const row of set.officeholders ?? []) {
      out.push({
        officeholderId: row.id,
        name: row.name,
        officeTitle: row.officeTitle,
        rosterScope: scope,
        state: state ?? (row.state ? row.state.toUpperCase() : null),
        chamber: row.chamber ?? null,
        ocdIds: divisions.get(row.id) ?? [],
        sourceUrl: row.provenance?.sourceUrl ?? null,
        sourceOrg: row.provenance?.sourceOrg ?? null,
        retrievedAt: row.provenance?.collectedAt ?? null,
      });
    }
  }
  rosterCache = { federal, rows: out };
  return out;
}

/** Test seam. Production federal rows are rematerialized when the GOOD pointer changes. */
export function resetVoteRosterCache(): void {
  rosterCache = null;
}

/* -------------------------------------------------------------------------- */
/* THE NAME RULE                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A name reduced to the parts two records could agree on **without any
 * judgement being made.**
 *
 * Case, accents, punctuation and generational suffixes come off, because none
 * of them is identity: *José* and *Jose*, *Ebel* and *Ebel,* and *Butierez Sr.*
 * and *Butierez* are the same person under any reading, and the suffix
 * treatment is `lib/ballot/incumbency.ts`'s, imported rather than written a
 * second time (RULING 103's lesson: three copies of an initials function got
 * *Thomas J. Haynes III* wrong three ways).
 *
 * **Nothing else comes off.** A middle name stays. A middle initial stays. A
 * quoted alias stays, as its own token. A given-name variant stays. Every one
 * of those is a judgement about whether two records name one human, and this
 * function refuses to make it silently — which is the whole difference between
 * a join and a guess.
 */
export function identityKey(display: string): string {
  const { givenName, familyName } = splitDisplayName(display);
  const parts = nameParts(givenName, familyName);
  const all = [parts.first, ...parts.middles, parts.last].filter(Boolean).join(" ");
  return all
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'"`‘’“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The surname alone — used ONLY to tell a near miss from a total absence. */
function surnameKey(display: string): string {
  const { givenName, familyName } = splitDisplayName(display);
  return nameParts(givenName, familyName)
    .last.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'"`‘’“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What happened when we tried to reach this person's voting record.
 *
 * Four states, and three of them are refusals with different reasons. They are
 * distinct because the reader's sentence is different in each, and collapsing
 * them would put "we hold nothing" over a case where we hold something we
 * could not safely attach.
 */
export type VoteIdentity =
  /** Exactly one roster row carries this exact name. Retrieval may proceed. */
  | { kind: "JOINED"; seat: VoteSubjectSeat }
  /** No roster row carries this name, and no roster row shares the surname. */
  | { kind: "NO_ROSTER_ROW" }
  /**
   * No roster row carries this exact name, and at least one shares the
   * surname. We hold something we cannot safely attach — Sally Ann Gonzales.
   */
  | { kind: "NAME_FORM_UNCONFIRMED"; sharedSurnames: number }
  /** More than one roster row carries this exact name. Nothing is chosen. */
  | { kind: "AMBIGUOUS_NAME"; count: number }
  /** The exact state authority was identified, but its holding could not be read. */
  | { kind: "HOLDING_UNAVAILABLE"; scope: OfficialStateVoteScope };

function officialStateVoteSeat(
  personName: string,
  officeholderId: string,
  scope: OfficialStateVoteScope,
): VoteIdentity {
  const state = scope.slice(-2);
  const snapshot = stateSnapshot(state);
  if (!snapshot) return { kind: "HOLDING_UNAVAILABLE", scope };
  const position = snapshot.positions.find((row) => row.officeholderId === officeholderId);
  if (!position) return { kind: "NO_ROSTER_ROW" };
  const roll = snapshot.rollCalls.find((row) => row.id === position.rollCallId);
  if (!roll) return { kind: "HOLDING_UNAVAILABLE", scope };
  const chamber = roll.chamber ?? null;
  const officeTitle = chamber === "Senate"
    ? "State Senator"
    : chamber === "Assembly"
      ? "Assemblymember"
      : "State Representative";
  return {
    kind: "JOINED",
    seat: {
      officeholderId,
      name: personName,
      officeTitle,
      rosterScope: scope,
      state,
      chamber,
      ocdIds: [],
      sourceUrl: roll.rollCallUrl,
      sourceOrg: stateRollPublisher(roll),
      retrievedAt: roll.retrievedAt,
    },
  };
}

/**
 * Resolve a person to the seat whose voting record is theirs.
 *
 * `withinStates` scopes the roster to the states the reader's question can
 * honestly be about — their own divisions' state, plus the federal roster,
 * which is national. Without it a name typed on an Arizona ballot could bind
 * to a New Hampshire representative, which is the substitution defect with a
 * roll call attached.
 */
export function resolveVoteIdentity(
  personName: string,
  options: { withinStates?: readonly string[]; officeholderId?: string } = {},
): VoteIdentity {
  if (options.officeholderId) {
    const stateScope = officialStateVoteScopeForOfficeholderId(options.officeholderId);
    if (stateScope) return officialStateVoteSeat(personName, options.officeholderId, stateScope);
    const seat = loadRoster().find((row) => row.officeholderId === options.officeholderId);
    return seat ? { kind: "JOINED", seat } : { kind: "NO_ROSTER_ROW" };
  }
  const key = identityKey(personName);
  if (!key) return { kind: "NO_ROSTER_ROW" };

  const states = options.withinStates?.length ? new Set(options.withinStates) : null;
  const inScope = loadRoster().filter(
    (seat) => !states || seat.state === null || states.has(seat.state),
  );

  const exact = inScope.filter((seat) => identityKey(seat.name) === key);
  if (exact.length === 1) return { kind: "JOINED", seat: exact[0] };
  if (exact.length > 1) return { kind: "AMBIGUOUS_NAME", count: exact.length };

  const surname = surnameKey(personName);
  const shared = surname
    ? inScope.filter((seat) => surnameKey(seat.name) === surname).length
    : 0;
  return shared > 0
    ? { kind: "NAME_FORM_UNCONFIRMED", sharedSurnames: shared }
    : { kind: "NO_ROSTER_ROW" };
}

/* -------------------------------------------------------------------------- */
/* THE STORES                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * **THE SANCTIONED READERS, WRAPPED — NOT A THIRD COPY OF THE READ.**
 *
 * `lib/votes/snapshot.ts` and `lib/sources/legiscan/snapshot.ts` already own
 * these files, already cache them per process, and already say why they THROW
 * rather than returning null: *"callers choose their honest fallback."* This
 * is that choice, made once, for one caller.
 *
 * Re-reading the JSON here would have been a second definition of where the
 * roll-call corpus lives, and the day one of them moved the two would disagree
 * silently — with the disagreement rendering as an honest gap, which is the
 * one failure shape nothing in this product can see.
 */
function federalSnapshot(): VotesSnapshot | null {
  try {
    return getVotesSnapshot();
  } catch {
    return null;
  }
}

function stateSnapshot(state: string | null): StateVotesSnapshot | null {
  const scope = state ? `US-${state}` : null;
  if (scope !== "US-AZ" && scope !== "US-NH" && scope !== "US-NJ") return null;
  try {
    return getStateVotesSnapshot(scope as OfficialStateVoteScope);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* THE RECORD                                                                  */
/* -------------------------------------------------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The chambers publish two date shapes and neither is guessed at.
 *
 * `2026-06-13` (LegiScan) and `21-Jul-2026` (the House clerk). Both are
 * unambiguous and both parse mechanically; anything else returns null rather
 * than a plausible date, because a misdated roll call is a wrong fact about
 * when a government acted.
 */
export function isoDateOf(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmy = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!dmy) return null;
  const month = MONTHS.findIndex((m) => m.toLowerCase() === dmy[2].toLowerCase());
  if (month < 0) return null;
  return `${dmy[3]}-${String(month + 1).padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
}

/** The chamber that published a federal roll call. Its own name, not a label. */
function federalPublisher(chamber: string): string {
  return chamber === "senate" ? "U.S. Senate" : "U.S. House of Representatives";
}

/**
 * The date, spelled out for a reader — `21-Jul-2026` and `2026-06-13` both
 * become *July 21st, 2026*.
 *
 * Reader surfaces speak plain language, and neither of the two stored shapes
 * is plain language. Where the stamp will not parse, the chamber's OWN string
 * travels unchanged rather than being dropped: a record with no date is worse
 * than one carrying the publisher's own formatting.
 */
function readableDate(raw: string): string {
  return formatDateLong(isoDateOf(raw)) ?? raw;
}

/** The roll call's own fields, in the words its sentence uses. */
function federalRollCall(vote: RollCallVote, position: string): NonNullable<EvidenceRecord["rollCall"]> {
  return { position, what: `${vote.title}${vote.legisNum ? ` (${vote.legisNum})` : ""}`, when: readableDate(vote.date), result: String(vote.result) };
}

function federalVoteText(seat: VoteSubjectSeat, vote: RollCallVote, position: string): string {
  /* Person AND office, always — identity is never either alone. The office is
     the one they HOLD, read off the roster, never the one they seek. */
  const designation = vote.legisNum ? ` (${vote.legisNum})` : "";
  return `${seat.name}, ${seat.officeTitle}: voted ${position} on ${vote.title}${designation} — ${vote.question}, ${readableDate(vote.date)}. ${vote.result}.`;
}

function stateVoteText(seat: VoteSubjectSeat, roll: StateRollCall, position: string): string {
  return `${seat.name}, ${seat.officeTitle}: voted ${position} on ${roll.billNumber} — ${roll.billTitle} (${roll.motion}), ${readableDate(roll.date)}. ${roll.result}.`;
}

export interface VoteEvidence {
  identity: VoteIdentity;
  records: EvidenceRecord[];
  gaps: EvidenceGap[];
  denominators: Record<string, number>;
}

/** Keep the recent-window denominator explicit once earlier votes join the answer. */
export function federalVoteDenominatorsWithHistory(
  recent: Record<string, number>, earlierCount: number,
): Record<string, number> {
  const { rollCallsHeldForTheirChamber, ...rest } = recent;
  const recentRecorded = recent.rollCallVotesRecorded ?? 0;
  return { ...rest,
    ...(rollCallsHeldForTheirChamber === undefined ? {} :
      { recentRollCallsHeldForTheirChamber: rollCallsHeldForTheirChamber }),
    recentRollCallVotesRecorded: recentRecorded,
    rollCallVotesRecorded: recentRecorded + earlierCount,
    rollCallVotesShown: (recent.rollCallVotesShown ?? 0) + earlierCount,
    earlierRollCallVotesShown: earlierCount };
}

/**
 * Everything the pack should carry about how this person voted.
 *
 * **Every outcome produces something.** A person who resolved and holds no
 * recorded position gets a NAMED GAP with the store's own denominator beside
 * it — never silence, which reads as "they did not vote", and never "no votes
 * cast", which is a claim about a person built out of our collection state.
 */
/**
 * Would `voteEvidenceFor` read a STATE legislature's roll calls for this
 * person? (2026-09-25, the Ask three-second repair.) The route reads a state's
 * roll-call holding — New Jersey's is 9.4 MB, 5.7-6.7 s cold — only when this
 * says so. Decided from the rosters alone, which never read a roll call.
 */
export function voteEvidenceReadsStateRollCalls(
  personName: string,
  options: { withinStates?: readonly string[]; officeholderId?: string } = {},
): boolean {
  if (options.officeholderId) {
    if (officialStateVoteScopeForOfficeholderId(options.officeholderId)) return true;
    const seat = loadRoster().find((row) => row.officeholderId === options.officeholderId);
    return Boolean(seat && seat.rosterScope !== "us");
  }
  const identity = resolveVoteIdentity(personName, options);
  return identity.kind === "JOINED" && identity.seat.rosterScope !== "us";
}

export function voteEvidenceFor(
  personName: string,
  options: { withinStates?: readonly string[]; officeholderId?: string } = {},
): VoteEvidence {
  const identity = resolveVoteIdentity(personName, options);
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};

  if (identity.kind === "AMBIGUOUS_NAME") {
    gaps.push({
      whose: "OURS",
      statement: `${identity.count} people we hold go by exactly that name, so we cannot say which voting record belongs to ${personName}. We have not attached one.`,
    });
    return { identity, records, gaps, denominators };
  }

  if (identity.kind === "HOLDING_UNAVAILABLE") {
    gaps.push({
      whose: "OURS",
      statement: `We identified ${personName}'s ${identity.scope} voting-record authority, but could not read its current proof-validated holding just now, so no votes are shown.`,
    });
    return { identity, records, gaps, denominators };
  }

  if (identity.kind === "NAME_FORM_UNCONFIRMED") {
    /*
     * **THE ADVERSARIAL CASE, ANSWERED HONESTLY AND NOT RESOLVED.**
     *
     * We hold a similarly-named officeholder. We do not say who, we do not say
     * how many votes they have, and we do not say they are or are not the same
     * person — every one of those would be the claim we cannot source. What we
     * say is that we could not confirm it, which is a fact about us.
     */
    gaps.push({
      whose: "OURS",
      statement: `We have not recorded a voting record for ${personName}. Our roster holds a similarly-named officeholder and we could not confirm from the records we hold that it is the same person, so we have not attached that record here.`,
    });
    return { identity, records, gaps, denominators };
  }

  if (identity.kind === "NO_ROSTER_ROW") {
    gaps.push({
      whose: "OURS",
      statement: `We have not recorded a voting record for ${personName}. A voting record exists only for a seat we hold in one of the chambers we cover.`,
    });
    return { identity, records, gaps, denominators };
  }

  const seat = identity.seat;
  denominators.officeholderSeatsMatched = 1;

  if (seat.rosterScope === "us") {
    const snapshot = federalSnapshot();
    if (!snapshot) {
      gaps.push({
        whose: "OURS",
        statement: `We hold ${seat.name} as ${seat.officeTitle}, but could not read our roll-call records just now, so no votes are shown.`,
      });
      return { identity, records, gaps, denominators };
    }
    const byId = new Map(snapshot.votes.map((v) => [v.id, v]));
    /* Their OWN chamber's roll calls are the only ones they could appear in.
       Stating the whole store as the denominator would imply a member had the
       chance to vote on the other chamber's business. */
    const chamberRolls = seat.chamber
      ? snapshot.votes.filter((v) => v.chamber === seat.chamber)
      : snapshot.votes;
    denominators.rollCallsHeldForTheirChamber = chamberRolls.length;

    const mine = snapshot.positions.filter((p) => p.officeholderId === seat.officeholderId);
    denominators.rollCallVotesRecorded = mine.length;

    const ordered = mine
      .map((p) => ({ position: p.position, vote: byId.get(p.voteId) }))
      .flatMap((x) => (x.vote ? [{ position: x.position as string, vote: x.vote }] : []))
      .sort((a, b) => ((isoDateOf(a.vote.date) ?? "") < (isoDateOf(b.vote.date) ?? "") ? 1 : -1));

    for (const { position, vote } of ordered) {
      records.push({
        kind: "ROLL_CALL_VOTE",
        id: `${seat.officeholderId}#${vote.id}`,
        text: federalVoteText(seat, vote, position),
        rollCall: federalRollCall(vote, position),
        occurredAt: isoDateOf(vote.date),
        sourceUrl: vote.rollCallUrl,
        sourceOrg: federalPublisher(vote.chamber),
        retrievedAt: vote.retrievedAt,
      });
    }
    denominators.rollCallVotesShown = records.length;

    if (ordered.length === 0) {
      /*
       * **THE PERSON RESOLVED, THE OFFICE RESOLVED, AND THE STORE HOLDS
       * NOTHING FOR THEM.** That is OUR gap and the denominator makes it
       * legible: a reader can tell "we hold N roll calls and none records a
       * vote by them" from "we hold no roll calls at all". It is never "they
       * did not vote", which is a claim about a person.
       */
      gaps.push({
        whose: "OURS",
        statement: `We hold ${seat.name} as ${seat.officeTitle}. None of the ${chamberRolls.length} roll call${chamberRolls.length === 1 ? "" : "s"} we have recorded for that chamber carries a vote by them, so we have no voting record to show yet.`,
      });
    }
    return { identity, records, gaps, denominators };
  }

  /* ── A STATE LEGISLATURE ── */
  const snapshot = stateSnapshot(seat.state);
  if (!snapshot) {
    gaps.push({
      whose: "OURS",
      statement: `We hold ${seat.name} as ${seat.officeTitle}, but could not read our roll-call records just now, so no votes are shown.`,
    });
    return { identity, records, gaps, denominators };
  }
  const byId = new Map(snapshot.rollCalls.map((r) => [r.id, r]));
  const stateRolls = seat.state
    ? snapshot.rollCalls.filter((r) => r.state === seat.state)
    : snapshot.rollCalls;
  denominators.rollCallsHeldForTheirLegislature = stateRolls.length;

  const mine = snapshot.positions.filter((p) => p.officeholderId === seat.officeholderId);
  denominators.rollCallVotesRecorded = mine.length;

  const ordered = mine
    .map((p) => ({ position: p.position, roll: byId.get(p.rollCallId) }))
    .flatMap((x) => (x.roll ? [{ position: x.position as string, roll: x.roll }] : []))
    .sort((a, b) => (a.roll.date < b.roll.date ? 1 : -1));

  for (const { position, roll } of ordered) {
    records.push({
      kind: "ROLL_CALL_VOTE",
      id: `${seat.officeholderId}#${roll.id}`,
      text: stateVoteText(seat, roll, position),
      rollCall: { position, what: `${roll.billNumber} — ${roll.billTitle}`, when: readableDate(roll.date), result: String(roll.result) },
      occurredAt: isoDateOf(roll.date),
      sourceUrl: roll.rollCallUrl,
      // Official promoted rows retain their actual publisher. Legacy vendor
      // rows retain the one CC BY attribution constant through this helper.
      sourceOrg: stateRollPublisher(roll),
      retrievedAt: roll.retrievedAt,
    });
  }
  denominators.rollCallVotesShown = records.length;

  if (ordered.length === 0) {
    gaps.push({
      whose: "OURS",
      statement: `We hold ${seat.name} as ${seat.officeTitle}. None of the ${stateRolls.length} roll call${stateRolls.length === 1 ? "" : "s"} we have recorded for that legislature carries a vote by them, so we have no voting record to show yet.`,
    });
  }
  return { identity, records, gaps, denominators };
}

/**
 * The normal Ask door includes older roll calls only after the same anchored,
 * GOOD-receipt predecessor proof used by the public Earlier records view.
 * A store failure preserves the current answer and states the missing scope.
 */
export async function voteEvidenceForIncludingHistory(
  personName: string,
  options: { withinStates?: readonly string[]; officeholderId?: string } = {},
): Promise<VoteEvidence> {
  const current = voteEvidenceFor(personName, options);
  if (current.identity.kind !== "JOINED" || current.identity.seat.rosterScope !== "us") return current;
  const seat = current.identity.seat;
  const promoted = await readFederalRollCallsProjection();
  if (promoted.kind !== "PROMOTED") return { ...current, gaps: [...current.gaps, {
    whose: "OURS", statement: `Earlier voting records for ${seat.name} could not be checked against a durable approved source just now. The recent records above remain available.`,
  }] };
  const records = [...current.records];
  const gaps = [...current.gaps];
  const seenVoteIds = new Set(records.filter((record) => record.kind === "ROLL_CALL_VOTE")
    .map((record) => record.id));
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = await readHistoricalFederalVotesForMember(seat.officeholderId, promoted,
      { cursor, pageSize: 16 });
    for (const vote of page.votes) {
      const id = `${seat.officeholderId}#${vote.id}`;
      if (seenVoteIds.has(id)) continue;
      seenVoteIds.add(id);
      records.push({ kind: "ROLL_CALL_VOTE", id,
        text: `${federalVoteText(seat, vote, vote.position)} Earlier recorded vote.`,
        rollCall: federalRollCall(vote, vote.position),
        occurredAt: isoDateOf(vote.date), sourceUrl: vote.rollCallUrl,
        sourceOrg: federalPublisher(vote.chamber), retrievedAt: vote.retrievedAt });
    }
    if (page.status === "COMPLETE") break;
    if (page.status !== "MORE" || !page.nextVersionId || seenCursors.has(page.nextVersionId)) {
      gaps.push({ whose: "OURS", statement: `More earlier voting records for ${seat.name} could not be checked just now; the proven records above remain available.` });
      break;
    }
    cursor = page.nextVersionId;
    seenCursors.add(cursor);
  }
  const earlierCount = records.length - current.records.length;
  const accurateGaps = earlierCount > 0
    ? gaps.filter((gap) => !gap.statement.includes("so we have no voting record to show yet.")) : gaps;
  return { identity: current.identity, records, gaps: accurateGaps,
    denominators: federalVoteDenominatorsWithHistory(current.denominators, earlierCount) };
}

/** The states a reader's divisions are in — the honest roster scope. */
export function statesOf(ocdIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ocdIds) {
    const match = /\/state:([a-z]{2})\b/.exec(id);
    if (match) out.add(match[1].toUpperCase());
  }
  return [...out];
}
