/**
 * **WHAT THE BODY DID**, split from what the clerk noticed.
 *
 * Until 2026-08-29 this repository could tell a reader what was ON a Pima
 * County agenda and could not tell them what the Board DECIDED. The cause was
 * not a wall and not a missing source: `fetchEventItems()` already asked for
 * `/events/{id}/eventitems`, the reply already carried `EventItemActionName`,
 * `EventItemPassedFlagName`, `EventItemMover`, `EventItemSeconder` and
 * `EventItemActionText`, and `toAgendaItems()` mapped every row down to
 * `{ id, sequence, title, matterFile }` — a DISCARD, one line wide. The votes
 * route, which returns each named member's cast value, had never been asked
 * for at all.
 *
 * This module is the transform that stops the discard. It does not produce a
 * richer agenda item, and that refusal is the whole design.
 *
 * ---
 *
 * ## Why one API row becomes up to three records
 *
 * `lib/answerability/record-class.ts` (read here, never edited) says an
 * `AGENDA` answers `WHAT_WAS_NOTICED`, an `ACTION_SUMMARY` answers
 * `WHAT_WAS_DECIDED`, and only a `ROLL_CALL` answers `HOW_DID_THEY_VOTE`. One
 * wide object carrying a title AND an action AND a tally would satisfy all
 * three by construction, because whatever class you stamped on it would be a
 * claim about the WHOLE object. So the row is split, and the split is
 * mechanical rather than disciplinary:
 *
 * ```
 * LegistarEventItem  ->  LegistarAgendaRecord   AGENDA         always
 *                    ->  LegistarOutcomeRecord  ACTION_SUMMARY only if an action is recorded
 *                    ->  LegistarRollCallRecord ROLL_CALL      only if per-person rows came back
 * ```
 *
 * **The field sets are disjoint on purpose.**
 *
 * - The agenda record has no `action` and no `disposition`, so nothing that
 *   renders a decision can read one off it.
 * - The outcome record has no `title` and no `sequence`, so it cannot be
 *   printed as a docket.
 * - The roll-call record has no `tallyText` and no `disposition`. `"carried by
 *   a 5-0 vote"` is physically absent from the only class allowed to answer
 *   "how did Supervisor X vote", so the tempting inference has no field to
 *   read from. Measured on 2026-08-29 across 20 Pima Board sittings: **42
 *   items say "carried by a N-N vote" and return ZERO per-person rows.**
 *   Expanding those sentences would have published roughly two hundred member
 *   positions that no government ever recorded.
 * - The three arrays have different lengths (135 / 58 / 1 on event 1825), so
 *   there is no index correspondence for a caller to zip by mistake.
 *
 * Every transform here is pure and offline — no clock, no disk, no network.
 * Retrieval is `client.ts`, sequenced by `collectEventOutcomes` at the bottom,
 * which is the one function that touches a clock and does so only to date a
 * read that has already returned rows (RULING 107).
 */

import type { RecordClass } from "../../answerability/record-class.ts";
import {
  runStamp,
  stampFromRead,
  type NeverRead,
  type ReadStamp,
} from "../../ops/freshness.ts";
import { fetchEventItemVotes, fetchEventItems } from "./client.ts";
import type {
  LegistarEvent,
  LegistarEventItem,
  LegistarVote,
} from "./types.ts";

/* ------------------------------------------------------------------ *
 * Dispositions
 * ------------------------------------------------------------------ */

/**
 * What the body's own record says happened to the question.
 *
 * **`NOT_RECORDED` is not a third kind of defeat.** It is the named gap, and
 * `dispositionGap()` below says whose gap it is. Measured on the Pima Board
 * over 2026-05-01 .. 2026-08-29: 1360 items, 525 with a recorded action, 465
 * with a pass flag, and the flag reads `"Pass"` on all 465 — `"Fail"` was not
 * observed once. Reading the 895 unflagged items as failures would have
 * invented 895 defeats out of one county's four months.
 */
export type OutcomeDisposition = "PASSED" | "FAILED" | "NOT_RECORDED";

/**
 * The strings this adapter is willing to READ as a disposition.
 *
 * Deliberately tiny and deliberately not a normalizer. A publisher string this
 * list does not know becomes `NOT_RECORDED` with the raw text carried, because
 * guessing at an unfamiliar clerk's vocabulary is how "Held" becomes "Failed".
 */
const PASSED_WORDS = new Set(["pass", "passed"]);
const FAILED_WORDS = new Set(["fail", "failed"]);

/**
 * Read `EventItemPassedFlagName` without inventing anything.
 *
 * The numeric `EventItemPassedFlag` is a CROSS-CHECK, never a substitute: when
 * the two disagree the record contradicts itself and the honest answer is that
 * we do not know, not whichever field we happened to read first.
 */
export function readDisposition(item: LegistarEventItem): {
  disposition: OutcomeDisposition;
  raw: string | null;
  conflict: string | null;
} {
  const raw = item.EventItemPassedFlagName?.trim() || null;
  const word = raw?.toLowerCase() ?? null;
  const numeric = item.EventItemPassedFlag ?? null;

  if (word !== null && PASSED_WORDS.has(word)) {
    if (numeric === 0) {
      return {
        disposition: "NOT_RECORDED",
        raw,
        conflict:
          `the published record says "${raw}" and its own numeric flag says 0. ` +
          "A record that contradicts itself is not evidence of either answer.",
      };
    }
    return { disposition: "PASSED", raw, conflict: null };
  }

  if (word !== null && FAILED_WORDS.has(word)) {
    if (numeric === 1) {
      return {
        disposition: "NOT_RECORDED",
        raw,
        conflict:
          `the published record says "${raw}" and its own numeric flag says 1. ` +
          "A record that contradicts itself is not evidence of either answer.",
      };
    }
    return { disposition: "FAILED", raw, conflict: null };
  }

  // Includes raw === null, and includes any word this adapter has not been
  // taught. Both are NOT_RECORDED, and the raw text rides along so a later
  // session can see what it would have had to guess at.
  return { disposition: "NOT_RECORDED", raw, conflict: null };
}

/**
 * The named gap for a disposition we do not hold — and WHOSE gap it is.
 *
 * Two different sentences, because they are two different facts. An item with
 * no recorded action is the publisher not having entered one; an item with an
 * action and no flag is the publisher having entered half of one. Neither is
 * "it did not pass", and neither is our failure to look.
 */
export function dispositionGap(item: LegistarEventItem): string | null {
  const action = item.EventItemActionName?.trim() || null;
  const flag = item.EventItemPassedFlagName?.trim() || null;
  if (action !== null && flag !== null) return null;
  if (action === null) {
    return (
      "The published record for this item carries no action at all — the clerk " +
      "recorded nothing about what the body did with it. That is not a record of " +
      "it failing."
    );
  }
  return (
    `The published record says the body moved to ${action.toLowerCase()} this item ` +
    "and carries no pass or fail result for the motion. The result is missing from " +
    "their record, not decided against."
  );
}

/* ------------------------------------------------------------------ *
 * Roll-call state
 * ------------------------------------------------------------------ */

/**
 * What a votes retrieval actually established.
 *
 * A zero-row reply is FOUR different facts and they must never share a value:
 *
 * - `NO_QUESTION_PUT` — the item carries no recorded action. Nobody voted
 *   because nothing was put. A legitimate empty. (Pima item 329177.)
 * - `OUTCOME_WITHOUT_ROLL_CALL` — an action IS recorded, and the publisher
 *   published no per-person roll for it. **Their gap, not ours, and not an
 *   absence of a vote.** This is the common case: Pima's clerk writes
 *   "unanimously carried by a 5-0 vote" into `EventItemActionText` and enters
 *   no roll. Measured across 20 Board sittings, 465 pass-flagged items produce
 *   416 rolls and 49 of these. (Pima item 323718.)
 * - `ROLL_CALL_ASSERTED_BUT_ABSENT` — the item's own `EventItemRollCallFlag`
 *   says a roll call was taken and the roll came back empty. **A FAILED
 *   EXTRACTION**, reported as one. It is not licence to say no roll call
 *   exists; the record says one does and we did not get it. (Pima item
 *   329170 — and see the measured note on this state below.)
 * - `NOT_RETRIEVED` — nobody asked, or the ask failed. Same discipline as
 *   `items: null` on `LegistarEventWithClient`: absent is not empty.
 */
export type RollCallState =
  | "RECORDED"
  | "NO_QUESTION_PUT"
  | "OUTCOME_WITHOUT_ROLL_CALL"
  | "ROLL_CALL_ASSERTED_BUT_ABSENT"
  | "NOT_RETRIEVED";

/**
 * Classify a votes reply against the item that produced it.
 *
 * `votes === null` means the retrieval did not happen or did not complete.
 *
 * **A measured caution on `ROLL_CALL_ASSERTED_BUT_ABSENT`, stated rather than
 * tuned away.** On the Pima tenant `EventItemRollCallFlag` is 1 on exactly one
 * item per sitting — the literal "ROLL CALL" attendance item, which carries no
 * action — and 0 on every item that DOES have a per-person roll. So this state
 * fires once per Pima sitting, 20 of 20, and each firing is a true statement:
 * the record says a roll call happened at that point in the meeting and the
 * votes route returns nothing for it. Narrowing the rule so those twenty stop
 * appearing would mean deciding, on our own authority, that the publisher's
 * roll-call flag means nothing — which is asserting an absence about a
 * government to make our own report look clean.
 */
export function classifyRollCall(
  item: LegistarEventItem,
  votes: readonly LegistarVote[] | null,
): RollCallState {
  if (votes === null) return "NOT_RETRIEVED";
  if (votes.length > 0) return "RECORDED";
  if (item.EventItemRollCallFlag === 1) return "ROLL_CALL_ASSERTED_BUT_ABSENT";
  if ((item.EventItemActionName?.trim() || null) === null) return "NO_QUESTION_PUT";
  return "OUTCOME_WITHOUT_ROLL_CALL";
}

/** Is this state a failed extraction — asked, told there is a record, got none? */
export function isFailedExtraction(state: RollCallState): boolean {
  return state === "ROLL_CALL_ASSERTED_BUT_ABSENT";
}

/** The named gap for a roll call we do not hold. Null when we hold one. */
export function rollCallGap(state: RollCallState): string | null {
  if (state === "RECORDED") return null;
  if (state === "NO_QUESTION_PUT") {
    return "No question was put to the body on this item, so there is no roll to publish.";
  }
  if (state === "OUTCOME_WITHOUT_ROLL_CALL") {
    return (
      "The publisher recorded the action and no per-person roll call for it. How each " +
      "member voted is missing from their record."
    );
  }
  if (state === "ROLL_CALL_ASSERTED_BUT_ABSENT") {
    return (
      "The published record says a roll call was taken here and the roll-call route " +
      "returned no rows. We could not retrieve it — this is our failed retrieval, not " +
      "a record that no roll call happened."
    );
  }
  return "We have not read the roll call for this item yet.";
}

/* ------------------------------------------------------------------ *
 * The three record classes
 * ------------------------------------------------------------------ */

export interface LegistarRecordProvenance {
  /** The exact endpoint this record was read from. Observed, never built. */
  readonly endpoint: string;
  /** The public body that published it. Never Granicus. */
  readonly sourceOrg: string;
  /**
   * **The day the endpoint above was READ — RULING 107.**
   *
   * A {@link ReadStamp}, minted only by `stampFromRead` from a receipt that
   * evidences a read returning something, or {@link NEVER_READ} when no such
   * read is evidenced. It is deliberately not a clock reading: a run date in
   * this field would tell a reader the roll call is current when the retrieval
   * behind it might be a month old, and RULING 96 then uses that date to
   * decide whether to re-walk — so a confident wrong date SUPPRESSES the
   * re-walk that would have caught it.
   *
   * The two rules meet here. `stampFromRead` refuses a receipt with `bytes: 0`
   * because a fetch that returned nothing is not a read; this adapter's own
   * rule is that a zero-row extraction is a FAILED extraction. So a sitting
   * whose `eventitems` reply came back empty mints `NEVER_READ` and reads as
   * stale, rather than carrying today's date on a document nobody got.
   */
  readonly readOn: ReadStamp | NeverRead;
}

/**
 * What the clerk NOTICED. Nothing on this record says anything happened.
 *
 * No `action`, no `disposition`, no `mover`. `record-class.ts` refuses AGENDA
 * for `WHAT_WAS_DECIDED` and for `HOW_DID_THEY_VOTE`; the missing fields mean
 * a caller who climbs over that refusal still has nothing to render.
 */
export interface LegistarAgendaRecord {
  /**
   * The discriminant, as a LITERAL rather than as `RecordClass`.
   *
   * It was widened by an `as RecordClass` cast at the construction site, which
   * made the union structurally undiscriminable while its own doc comment said
   * it was discriminated by this field. A consumer narrowing on it got
   * `Property 'votes' does not exist on type 'LegistarAgendaRecord'` and the
   * only ways out were a cast or a bespoke type guard — both of which undo the
   * class filter at exactly the boundary that exists to enforce it.
   */
  readonly recordClass: "AGENDA";
  readonly eventItemId: number;
  readonly eventId: number | null;
  readonly sequence: number | null;
  readonly agendaNumber: string | null;
  readonly title: string;
  readonly matterFile: string | null;
  readonly matterType: string | null;
  readonly provenance: LegistarRecordProvenance;
}

/**
 * What the body DID. A clerk's post-meeting record of the action taken.
 *
 * Classed `ACTION_SUMMARY`, which `record-class.ts` admits for
 * `WHAT_WAS_DECIDED` and REFUSES for `HOW_DID_THEY_VOTE` — "an action summary
 * carries the result, not each member's recorded position." `tallyText` lives
 * here and only here for exactly that reason.
 */
export interface LegistarOutcomeRecord {
  /**
   * The discriminant, as a LITERAL rather than as `RecordClass`.
   *
   * It was widened by an `as RecordClass` cast at the construction site, which
   * made the union structurally undiscriminable while its own doc comment said
   * it was discriminated by this field. A consumer narrowing on it got
   * `Property 'votes' does not exist on type 'LegistarAgendaRecord'` and the
   * only ways out were a cast or a bespoke type guard — both of which undo the
   * class filter at exactly the boundary that exists to enforce it.
   */
  readonly recordClass: "ACTION_SUMMARY";
  readonly eventItemId: number;
  readonly eventId: number | null;
  /** How the reader gets back to the matter. Not the item's printed title. */
  readonly matterFile: string | null;
  /** The clerk's verb, verbatim. Never mapped to a vocabulary of ours. */
  readonly action: string | null;
  readonly disposition: OutcomeDisposition;
  /** The publisher's own flag string, carried even when unreadable. */
  readonly dispositionRaw: string | null;
  /** Set when the record's own two disposition fields disagree. */
  readonly dispositionConflict: string | null;
  /** Whose gap, in a sentence, when `disposition` is `NOT_RECORDED`. */
  readonly dispositionGap: string | null;
  readonly mover: string | null;
  readonly seconder: string | null;
  /**
   * The clerk's prose, which usually contains a TALLY. Carried verbatim as a
   * quotation of their record; never parsed, never split into members.
   */
  readonly tallyText: string | null;
  readonly matterStatus: string | null;
  readonly onConsentCalendar: boolean;
  /** What the per-person roll call retrieval established for this item. */
  readonly rollCall: RollCallState;
  readonly rollCallGap: string | null;
  readonly provenance: LegistarRecordProvenance;
  /*
   * The fields below are set only on records read off a sitting's MINUTES
   * (lib/sources/legistar-insite/minutes.ts, NH332), where there is no
   * EventItemId and the record's authority is a passage of the document.
   * `eventItemId` is then the record's 1-based position among the actions the
   * minutes record, and `provenance.endpoint` is the minutes document itself.
   */
  /** The minutes' own item number(s): "5-c", "7-a, 7-b". */
  readonly itemReference?: string | null;
  /** The item as the minutes print it, verbatim (bounded, elision marked "…"). */
  readonly itemQuote?: string | null;
  /**
   * The section header a sub-item sits under, verbatim: "6. Introduction of the
   * following ordinances and setting July 27, 2026 as the date of the public
   * hearing…" — what approving the sub-item did (introduce, not adopt).
   */
  readonly sectionQuote?: string | null;
  /** The exact passage the record was read from: "It was moved by … Carried unanimously." */
  readonly quote?: string | null;
  /** The page of the minutes the passage starts on. */
  readonly page?: number | null;
}

/** One named member's cast value. Verbatim, and never derived. */
export interface LegistarRecordedVote {
  readonly personName: string | null;
  readonly personId: number | null;
  /** "Aye", "Not Present", "Abstain" — the publisher's word, unmapped. */
  readonly value: string | null;
  readonly sort: number | null;
}

/**
 * A per-person roll call. The only class that answers `HOW_DID_THEY_VOTE`.
 *
 * **It carries no tally and no disposition.** That is not an omission — a
 * tally on this record is one join away from being rendered as five members'
 * positions, and this record class is the one thing standing between a reader
 * and that inference.
 *
 * It is only ever built from rows the votes route actually returned:
 * `rollCallRecordFrom` returns null on zero rows, so there is no path from an
 * item alone to a roll call.
 */
export interface LegistarRollCallRecord {
  /**
   * The discriminant, as a LITERAL rather than as `RecordClass`.
   *
   * It was widened by an `as RecordClass` cast at the construction site, which
   * made the union structurally undiscriminable while its own doc comment said
   * it was discriminated by this field. A consumer narrowing on it got
   * `Property 'votes' does not exist on type 'LegistarAgendaRecord'` and the
   * only ways out were a cast or a bespoke type guard — both of which undo the
   * class filter at exactly the boundary that exists to enforce it.
   */
  readonly recordClass: "ROLL_CALL";
  readonly eventItemId: number;
  readonly votes: readonly LegistarRecordedVote[];
  readonly provenance: LegistarRecordProvenance;
}

/**
 * A minutes document we know EXISTS and have never read.
 *
 * **It has no `recordClass`, and that is the mechanism.** `evidenceRecordsFor`
 * and `assertAnswerable` take `ClassedRecord`, so a pointer cannot be handed to
 * them — it fails to typecheck rather than being caught by review. A minutes
 * PDF nobody has opened is not a MINUTES record, and stamping it as one would
 * let "there is a minutes file" answer "what did they decide".
 *
 * It is also unreadable by us: every Pima and Mesa `EventMinutesFile` resolves
 * to `legistar.granicus.com`, which answers `User-agent: *` with `Disallow: /`
 * (docs/sources.md, 2026-08-29). This is a discovery LEAD, recorded so the
 * route is known, and it is not walked.
 */
export interface LegistarMinutesPointer {
  readonly url: string | null;
  /** "Final", "Draft", null. "Draft" on all 20 Pima Board sittings measured. */
  readonly status: string | null;
  readonly host: string | null;
  /** Why nothing here fetched it. Always stated, never blank. */
  readonly retrievalNote: string;
}

/* ------------------------------------------------------------------ *
 * The transform
 * ------------------------------------------------------------------ */

const itemsEndpoint = (slug: string, eventId: number) =>
  `https://webapi.legistar.com/v1/${slug}/events/${eventId}/eventitems`;

const votesEndpoint = (slug: string, eventItemId: number) =>
  `https://webapi.legistar.com/v1/${slug}/eventitems/${eventItemId}/votes`;

export interface OutcomeContext {
  readonly slug: string;
  readonly eventId: number;
  readonly sourceOrg: string;
  /**
   * The stamp for the `eventitems` read these records came out of.
   *
   * Passed IN rather than taken from a clock here, because this module is pure
   * and a pure transform has not read anything — the only place that can
   * evidence a read is the place that performed it. `collectEventOutcomes`
   * mints it; `receiptFor` below is how.
   */
  readonly readOn: ReadStamp | NeverRead;
}

/**
 * Turn a completed retrieval into a freshness stamp, or into `NEVER_READ`.
 *
 * `bytes` is forced to zero on a zero-row reply rather than measured, because
 * `JSON.stringify([]).length` is 2 and a two-byte "read" would mint a
 * confident date for a document nobody received. That is the zero-row rule and
 * RULING 107 agreeing: a fetch that returned nothing is not a read.
 */
export function receiptFor(
  endpoint: string,
  rows: readonly unknown[],
  now: Date,
): ReadStamp | NeverRead {
  return stampFromRead({
    source: endpoint,
    ok: true,
    bytes: rows.length === 0 ? 0 : JSON.stringify(rows).length,
    on: runStamp(now),
  });
}

/** Every item, as the notice-class record it always is. */
export function toAgendaRecords(
  items: readonly LegistarEventItem[],
  context: OutcomeContext,
): LegistarAgendaRecord[] {
  const provenance: LegistarRecordProvenance = {
    endpoint: itemsEndpoint(context.slug, context.eventId),
    sourceOrg: context.sourceOrg,
    readOn: context.readOn,
  };
  return items.map((item) => ({
    recordClass: "AGENDA",
    eventItemId: item.EventItemId,
    eventId: item.EventItemEventId ?? context.eventId,
    sequence: item.EventItemAgendaSequence,
    agendaNumber: item.EventItemAgendaNumber?.trim() || null,
    title: (item.EventItemTitle ?? item.EventItemMatterName ?? "").trim(),
    matterFile: item.EventItemMatterFile,
    matterType: item.EventItemMatterType ?? null,
    provenance,
  }));
}

/**
 * Does this row record that the body did something?
 *
 * The gate for producing an outcome record at all, and the reason the outcome
 * array is shorter than the agenda array. An action name is the publisher
 * asserting an act; a pass flag without one is a half-entered row and is
 * handled by `dispositionGap`, not by inventing an action.
 */
export function hasRecordedAction(item: LegistarEventItem): boolean {
  return (
    (item.EventItemActionName?.trim() || null) !== null ||
    (item.EventItemPassedFlagName?.trim() || null) !== null
  );
}

/**
 * The outcome records for one sitting.
 *
 * `votesByItemId` is a map from event item id to the rows the votes route
 * returned. **A missing key is `NOT_RETRIEVED`, an empty array is a zero-row
 * reply** — the same distinction `items: null` draws one layer up, and the
 * reason this takes a Map rather than an object of arrays.
 */
export function toOutcomeRecords(
  items: readonly LegistarEventItem[],
  context: OutcomeContext,
  votesByItemId: ReadonlyMap<number, readonly LegistarVote[]> = new Map(),
): LegistarOutcomeRecord[] {
  const records: LegistarOutcomeRecord[] = [];

  for (const item of items) {
    if (!hasRecordedAction(item)) continue;

    const read = readDisposition(item);
    const votes = votesByItemId.has(item.EventItemId)
      ? votesByItemId.get(item.EventItemId) ?? null
      : null;
    const rollCall = classifyRollCall(item, votes);

    records.push({
      recordClass: "ACTION_SUMMARY",
      eventItemId: item.EventItemId,
      eventId: item.EventItemEventId ?? context.eventId,
      matterFile: item.EventItemMatterFile,
      action: item.EventItemActionName?.trim() || null,
      disposition: read.disposition,
      dispositionRaw: read.raw,
      dispositionConflict: read.conflict,
      dispositionGap: dispositionGap(item),
      mover: item.EventItemMover?.trim() || null,
      seconder: item.EventItemSeconder?.trim() || null,
      tallyText: item.EventItemActionText?.trim() || null,
      matterStatus: item.EventItemMatterStatus?.trim() || null,
      onConsentCalendar: item.EventItemConsent === 1,
      rollCall,
      rollCallGap: rollCallGap(rollCall),
      provenance: {
        endpoint: itemsEndpoint(context.slug, context.eventId),
        sourceOrg: context.sourceOrg,
        readOn: context.readOn,
      },
    });
  }

  return records;
}

/**
 * A roll-call record, or null when there is no roll call to hold.
 *
 * Null on zero rows, always — including when the item's flag SAYS there should
 * be one. A `ROLL_CALL_ASSERTED_BUT_ABSENT` failure is reported on the outcome
 * record's `rollCall` field, where it can be read as the failed retrieval it
 * is; minting an empty ROLL_CALL record instead would put an admitted-class
 * record with no votes in front of `HOW_DID_THEY_VOTE`.
 */
export function rollCallRecordFrom(
  eventItemId: number,
  votes: readonly LegistarVote[] | null,
  context: OutcomeContext,
  /**
   * The stamp for the VOTES read, which is a different read from the
   * `eventitems` read the context describes — a different endpoint, a
   * different reply, its own chance to come back empty. `collectEventOutcomes`
   * mints one per item. It falls back to the context's stamp only for a caller
   * transforming rows it already holds, where there is no second read to date.
   */
  votesReadOn: ReadStamp | NeverRead = context.readOn,
): LegistarRollCallRecord | null {
  if (votes === null || votes.length === 0) return null;
  return {
    recordClass: "ROLL_CALL",
    eventItemId,
    votes: votes.map((vote) => ({
      personName: vote.VotePersonName?.trim() || null,
      personId: vote.VotePersonId ?? null,
      value: vote.VoteValueName?.trim() || null,
      sort: vote.VoteSort ?? null,
    })),
    provenance: {
      endpoint: votesEndpoint(context.slug, eventItemId),
      sourceOrg: context.sourceOrg,
      readOn: votesReadOn,
    },
  };
}

const DISALLOWED_DOCUMENT_HOSTS = new Set([
  "legistar.granicus.com",
  "pima.granicus.com",
]);

/** The minutes lead for one sitting. Recorded, never walked. */
export function minutesPointerFor(event: LegistarEvent): LegistarMinutesPointer {
  const url = event.EventMinutesFile?.trim() || null;
  let host: string | null = null;
  if (url !== null) {
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      host = null;
    }
  }

  const retrievalNote =
    url === null
      ? "The publisher names no minutes document for this sitting."
      : host !== null && DISALLOWED_DOCUMENT_HOSTS.has(host)
        ? `Not retrieved. ${host} answers "User-agent: *" with "Disallow: /" ` +
          "(docs/sources.md, 2026-08-29), so this route is not walked. The document " +
          "is known to exist and its contents are not held."
        : "Not retrieved. This adapter records the pointer and does not fetch documents.";

  return {
    url,
    status: event.EventMinutesStatusName?.trim() || null,
    host,
    retrievalNote,
  };
}

/* ------------------------------------------------------------------ *
 * Retrieval
 * ------------------------------------------------------------------ */

/** Everything one sitting yielded, with the failures counted rather than hidden. */
export interface EventOutcomes {
  readonly slug: string;
  readonly eventId: number;
  readonly agenda: readonly LegistarAgendaRecord[];
  readonly outcomes: readonly LegistarOutcomeRecord[];
  readonly rollCalls: readonly LegistarRollCallRecord[];
  /**
   * Items whose own record asserts a roll call and whose roll came back empty.
   * A count that must be REPORTED, never reconciled away (RULING 100).
   */
  readonly failedRollCallExtractions: readonly number[];
  /** Items we never asked about, because the votes request itself failed. */
  readonly voteRequestFailures: readonly { eventItemId: number; reason: string }[];
}

export interface CollectOptions {
  readonly sourceOrg: string;
  /** Overridden in tests so the suite never touches the network. */
  readonly fetchItems?: (
    slug: string,
    eventId: number,
  ) => Promise<LegistarEventItem[]>;
  readonly fetchVotes?: (
    slug: string,
    eventItemId: number,
  ) => Promise<LegistarVote[]>;
  readonly now?: () => Date;
}

/**
 * One sitting's agenda, outcomes and roll calls.
 *
 * Serialized, one item at a time, behind the same spacing the rest of this
 * adapter uses — `fetchEventItemVotes` goes through `client.ts`, which paces
 * itself. The fan-out is one request per ACTED item, not per item: 58 of 135
 * on Pima event 1825.
 *
 * A votes request that throws is recorded in `voteRequestFailures` and leaves
 * that item at `NOT_RETRIEVED`. It is never recorded as an empty roll.
 */
export async function collectEventOutcomes(
  slug: string,
  eventId: number,
  options: CollectOptions,
): Promise<EventOutcomes> {
  const fetchItemsImpl =
    options.fetchItems ??
    ((s: string, id: number) => fetchEventItems<LegistarEventItem>(s, id));
  const fetchVotesImpl =
    options.fetchVotes ??
    ((s: string, id: number) => fetchEventItemVotes<LegistarVote>(s, id));
  const clock = options.now ?? (() => new Date());

  const items = await fetchItemsImpl(slug, eventId);
  /*
   * RULING 107 — the freshness date is MINTED FROM THE READ, not from the
   * clock. `receiptFor` hands `stampFromRead` a receipt built out of the reply
   * that just arrived, so a sitting whose `eventitems` route came back with
   * zero rows carries NEVER_READ and reads as stale rather than carrying
   * today's date on a document nobody received.
   *
   * `clock()` supplies only the DAY the read happened, which is what a receipt
   * asks for. It cannot become the stamp on its own: `stampFromRead` refuses a
   * receipt that does not evidence a read, and the value it returns is a
   * branded `ReadStamp` that a clock call cannot be substituted for.
   */
  const itemsReadStamp = receiptFor(
    itemsEndpoint(slug, eventId),
    items,
    clock(),
  );
  const context: OutcomeContext = {
    slug,
    eventId,
    sourceOrg: options.sourceOrg,
    readOn: itemsReadStamp,
  };

  const votesByItemId = new Map<number, readonly LegistarVote[]>();
  const voteRequestFailures: { eventItemId: number; reason: string }[] = [];
  const rollCalls: LegistarRollCallRecord[] = [];

  // Ask about every item the publisher says it acted on, and every item whose
  // own flag claims a roll call. Both are places a per-person record can be,
  // and asking only one of them is how the other becomes an asserted absence.
  const worth = items.filter(
    (item) => hasRecordedAction(item) || item.EventItemRollCallFlag === 1,
  );

  for (const item of worth) {
    try {
      const votes = await fetchVotesImpl(slug, item.EventItemId);
      votesByItemId.set(item.EventItemId, votes);
      // Its own read, so its own stamp. A roll call dated by the agenda fetch
      // would claim currency for a retrieval that had not happened yet.
      const record = rollCallRecordFrom(
        item.EventItemId,
        votes,
        context,
        receiptFor(votesEndpoint(slug, item.EventItemId), votes, clock()),
      );
      if (record) rollCalls.push(record);
    } catch (error) {
      voteRequestFailures.push({
        eventItemId: item.EventItemId,
        reason: String(error),
      });
    }
  }

  const outcomes = toOutcomeRecords(items, context, votesByItemId);

  return {
    slug,
    eventId,
    agenda: toAgendaRecords(items, context),
    outcomes,
    rollCalls,
    failedRollCallExtractions: outcomes
      .filter((outcome) => isFailedExtraction(outcome.rollCall))
      .map((outcome) => outcome.eventItemId)
      .concat(
        // An item flagged roll-call with no recorded action produces no outcome
        // record, so its failed extraction has nowhere else to be counted.
        items
          .filter(
            (item) =>
              item.EventItemRollCallFlag === 1 &&
              !hasRecordedAction(item) &&
              classifyRollCall(item, votesByItemId.get(item.EventItemId) ?? null) ===
                "ROLL_CALL_ASSERTED_BUT_ABSENT",
          )
          .map((item) => item.EventItemId),
      ),
    voteRequestFailures,
  };
}
