/**
 * What the body did, split from what the clerk noticed. One `eventitems` row becomes up to three records
 * of different classes (`lib/answerability/record-class.ts`):
 *
 * ```
 * LegistarEventItem  ->  LegistarAgendaRecord   AGENDA         always
 *                    ->  LegistarOutcomeRecord  ACTION_SUMMARY only if an action is recorded
 *                    ->  LegistarRollCallRecord ROLL_CALL      only if per-person rows came back
 * ```
 *
 * The field sets are disjoint on purpose:
 * - The agenda record has no `action` and no `disposition`, so nothing that renders a decision can read
 *   one off it.
 * - The outcome record has no `title` and no `sequence`, so it cannot be printed as a docket.
 * - The roll-call record has no `tallyText` and no `disposition`, so "carried by a 5-0 vote" can never be
 *   expanded into member positions no government recorded.
 * - The three arrays have different lengths, so there is no index correspondence to zip by mistake.
 *
 * Every transform here is pure and offline. Retrieval is `client.ts`, sequenced by `collectEventOutcomes`,
 * which only dates a read that has already returned rows.
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
 * What the body's own record says happened to the question. `NOT_RECORDED` is the named gap (see
 * `dispositionGap()`), never a defeat: an unflagged item is not a failed one.
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

  // Includes raw === null and any word this adapter has not been taught; the raw text rides along.
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
 * What a votes retrieval established. A zero-row reply is four different facts:
 * - `NO_QUESTION_PUT`: no recorded action; nothing was put. A legitimate empty.
 * - `OUTCOME_WITHOUT_ROLL_CALL`: an action is recorded and the publisher published no per-person roll
 *   for it (e.g. the tally only in `EventItemActionText`). Their gap, not an absence of a vote.
 * - `ROLL_CALL_ASSERTED_BUT_ABSENT`: the item's own `EventItemRollCallFlag` says a roll call was taken and
 *   the roll came back empty. A failed extraction, reported as one.
 * - `NOT_RETRIEVED`: nobody asked, or the ask failed. Absent is not empty.
 */
export type RollCallState =
  | "RECORDED"
  | "NO_QUESTION_PUT"
  | "OUTCOME_WITHOUT_ROLL_CALL"
  | "ROLL_CALL_ASSERTED_BUT_ABSENT"
  | "NOT_RETRIEVED";

/**
 * Classify a votes reply against the item that produced it. `votes === null` means the retrieval did not
 * happen or did not complete. `ROLL_CALL_ASSERTED_BUT_ABSENT` can fire on an attendance roll-call item
 * that carries no action; that is still a true statement about the record and is not tuned away.
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
   * The day the endpoint above was read: a `ReadStamp` minted only by `stampFromRead` from a receipt that
   * evidences a read returning something, or `NEVER_READ`. Never a clock reading. An empty `eventitems`
   * reply mints `NEVER_READ` and reads as stale.
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
  /** The discriminant, as a literal rather than `RecordClass`, so the union narrows on it. */
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
  /** The discriminant, as a literal rather than `RecordClass`, so the union narrows on it. */
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
  // The fields below are set only on records read off a sitting's minutes
  // (lib/sources/legistar-insite/minutes.ts), where there is no EventItemId: `eventItemId` is then the
  // record's 1-based position among the minutes' actions, and `provenance.endpoint` is the minutes document.
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
  /** The discriminant, as a literal rather than `RecordClass`, so the union narrows on it. */
  readonly recordClass: "ROLL_CALL";
  readonly eventItemId: number;
  readonly votes: readonly LegistarRecordedVote[];
  readonly provenance: LegistarRecordProvenance;
}

/**
 * A minutes document we know exists and have never read. It has no `recordClass`, so it cannot be handed
 * to `evidenceRecordsFor` or `assertAnswerable`: an unopened minutes file never answers "what did they
 * decide". A discovery lead (GRANICUS_MINUTES_PDF, routes.ts); no adapter reads it yet.
 */
export interface LegistarMinutesPointer {
  readonly url: string | null;
  /** "Final", "Draft", null: the publisher's label, verbatim. */
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
 * Turn a completed retrieval into a freshness stamp, or into `NEVER_READ`. `bytes` is forced to zero on a
 * zero-row reply (`JSON.stringify([]).length` is 2), because a fetch that returned nothing is not a read.
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

/**
 * The minutes lead for one sitting. Recorded; this adapter does not read it. Sittings stored earlier keep
 * the note they were written with.
 */
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
      : `Not retrieved. No minutes adapter reads the file on ${host ?? "this host"} yet: this ` +
        "adapter records the pointer and does not fetch documents. The document is known to " +
        "exist and its contents are not held.";

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
  /** Items whose own record asserts a roll call and whose roll came back empty. Reported, never reconciled. */
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
  // The freshness date is minted from the read, not the clock: `receiptFor` builds the receipt from the reply
  // that just arrived. `clock()` supplies only the day; `stampFromRead` refuses a receipt that does not
  // evidence a read.
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
