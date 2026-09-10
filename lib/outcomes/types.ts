/**
 * **THE DURABLE OUTCOME STORE — WHAT A BODY ACTUALLY DID, PERSISTED.**
 * (WS-LEGI, 2026-08-29.)
 *
 * ## The gap this closes, stated exactly
 *
 * This was never a discovery gap. The route worked, the transform was written,
 * and the data had been harvested: `scripts/legistar-outcomes-probe.mts` pulled
 * 1,360 Pima agenda items, 525 recorded actions and **2,083 per-person vote
 * rows** out of `webapi.legistar.com` — re-measured live on 2026-08-29 and
 * reproducing to the row. Every one of those numbers was printed to a terminal
 * and then discarded, because a probe script writes no repository file.
 *
 * So reader outcome answerability stood at **0 of 30 held Pima Board sittings**
 * while the repository was demonstrably capable of answering all twenty it had
 * walked. That is an INTEGRATION gap: harvested, transformed, and never durable.
 * This file is the shape it becomes durable in.
 *
 * ## Why a committed snapshot rather than a table
 *
 * It is the pattern this repository already serves vote-class records through.
 * The promoted federal vote projection holds the bounded roll-call window and
 * recorded positions; `lib/votes/snapshot.ts` reads it once per process and
 * `lib/ask/votes.ts` answers `HOW_DID_THEY_VOTE` out of it. The `meetings` table
 * in `lib/db/schema.ts` says so in its own doc block — *"the snapshot file
 * remains the serving path for now"*.
 *
 * A Drizzle migration would also have been unverifiable here: `DATABASE_URL`
 * points at a local Neon branch that cannot currently authenticate, so no local
 * run could have proven a write. Shipping an unexercised migration and calling
 * outcomes persisted would have been green standing in for verified.
 *
 * ## THE LINKAGE IS EXACT, AND IT IS THE PART THAT MAKES THIS RETRIEVABLE
 *
 * ```
 *   BODY  ocd-division/country:us/state:az/county:pima#governing
 *     |                      (bodyId, byte-identical to data/meetings-snapshot.json)
 *   MEETING  legistar:pima:1825
 *     |                      (meetingId, the source-namespaced id the adapters emit)
 *   AGENDA ITEM  EventItemId 329170
 *     |
 *   ACTION  "approve", disposition PASSED
 *     |
 *   ROLL CALL  five named people, five verbatim values
 * ```
 *
 * Not a name match anywhere on that chain. `meetingId` is `<adapter>:<tenant>:
 * <upstream id>`, which is the id `data/meetings-snapshot.json` already carries,
 * so an outcome joins to its sitting by string equality on a key the adapter
 * minted. `lib/ask/votes.ts` had to fall back to exact full-name equality for
 * the officeholder leg and documents what that cost; this chain never needs to,
 * and a store that needed a fuzzy join would be the wrong store.
 *
 * ## Every semantic distinction is STRUCTURAL here, not conventional
 *
 * The three record arrays are separate arrays and not one array of wide rows,
 * and that is the whole design:
 *
 * - **agenda item is not action** — `agenda` and `outcomes` are different
 *   arrays with different record classes and different fields. 1,360 items
 *   produced 525 outcome records, not 1,360.
 * - **action is not roll call** — `outcomes` and `rollCalls` are separate.
 *   417 items had a roll call; 108 acted items did not, and those 108 are
 *   present as outcome records carrying `rollCall: "OUTCOME_WITHOUT_ROLL_CALL"`
 *   rather than as absences.
 * - **no roll call is not no action** — the two live in different fields with
 *   different named states and neither can be read off the other.
 * - **attendance roll call is not an item vote** — the one `EventItemRollCallFlag`
 *   item per Pima sitting is the literal "ROLL CALL" attendance item, has no
 *   action, and its votes route returns zero rows. All 20 land in
 *   `failedRollCallExtractions`, never in `rollCalls`.
 * - **Not Present / abstain / recused is not yes-or-no** — `LegistarRecordedVote.value`
 *   is the publisher's word, verbatim, unmapped.
 * - **tally text is not a person-level vote** — `tallyText` lives on the
 *   ACTION_SUMMARY record and the ROLL_CALL record has no field it could occupy.
 *   48 Pima items carry tally prose with no roll call and none of them may be
 *   expanded.
 * - **draft minutes are not final minutes** — {@link PersistedPublicationStatus}
 *   carries the publisher's own status string and the timestamp we observed it.
 * - **an agenda never proves an outcome** — `outcomeEvidenceFor` filters through
 *   `evidenceRecordsFor`, so an AGENDA record cannot reach a `WHAT_WAS_DECIDED`
 *   answer even if a caller passes the whole sitting.
 * - **a zero-row extraction is a FAILED extraction (RULING 100)** — a sitting
 *   whose items route returned nothing is persisted with
 *   `extraction: "ZERO_ROWS_FAILED"` and is NEVER persisted as a sitting with an
 *   empty agenda.
 */

import type {
  LegistarAgendaRecord,
  LegistarOutcomeRecord,
  LegistarRollCallRecord,
  LegistarMinutesPointer,
} from "../sources/legistar/outcomes.ts";
import type { AgendaPublicationObservation } from "./publication.ts";

/**
 * **THE PUBLISHER'S OWN STATE, OBSERVED — never our sentence about it.**
 *
 * Secondary objective, and the reason it is a separate shape from everything
 * else in this file: the fields below are a fact about a DOCUMENT's publication,
 * not about a meeting and never about a decision. A published agenda proves an
 * agenda was published. It proves nothing whatsoever about what the body did,
 * and the moment those two are carried on one record somebody joins them.
 *
 * Each field is the vendor's, carried verbatim, beside `observedAt` — the
 * instant WE read it. WS-PUB is building the reader-facing vocabulary on top of
 * this; nothing here renders a sentence, because a raw publisher observation
 * with its observation time is the thing a vocabulary can be built on and a
 * pre-rendered sentence is not.
 *
 * Verified on the wire in `tests/fixtures/legistar/pima-event-1825.json`.
 */
export interface PersistedPublicationStatus {
  /** "Final", "Draft", null — the tenant's label, which a clerk may rename. */
  readonly agendaStatusName: string | null;
  /** The vendor's enum behind that label. 10 = Final, 9 = Draft on Pima. */
  readonly agendaStatusId: number | null;
  /** The document URL the publisher names. Recorded; see `agendaRetrieval`. */
  readonly agendaFile: string | null;
  /** UTC, from `EventAgendaLastPublishedUTC`. Null when never published. */
  readonly agendaLastPublishedUtc: string | null;
  /**
   * "Final", "Draft", null. **"Draft" on all 20 Pima Board sittings measured,
   * including sittings four months old** — so on this tenant "Draft" is the
   * steady state and is NOT a signal that minutes are still coming. A
   * vocabulary that reads it as "not final yet" would be wrong 20 times out of
   * 20 here, which is why the raw string travels and no verdict does.
   */
  readonly minutesStatusName: string | null;
  readonly minutesStatusId: number | null;
  readonly minutesFile: string | null;
  readonly minutesLastPublishedUtc: string | null;
  /** The public permalink for the sitting. Real, and the right `sourceUrl`. */
  readonly inSiteUrl: string | null;
  /**
   * The publisher's own last-modified stamp for the event row.
   *
   * **The incremental refresh key.** An event whose `EventLastModifiedUtc` has
   * not moved since our last read has not changed, and re-walking its 58 acted
   * items would be 58 requests to be told the same thing. See
   * `scripts/legistar-outcomes-ingest.mts`.
   */
  readonly lastModifiedUtc: string | null;
  /** "Public", "Not Viewable", null. A media fact, never an outcome. */
  readonly videoStatus: string | null;
  /**
   * **The instant WE observed all of the above.** Not the publisher's clock.
   *
   * Without it every field here is undated and a reader is told an agenda "is
   * published" on the strength of a read that might be a month old. It is an
   * ISO instant rather than a day because publication state genuinely moves
   * within a day — Pima published event 1825's minutes at 18:33 UTC on the same
   * date its agenda had stood alone since 18:04 two days earlier.
   */
  readonly observedAt: string;
}

/**
 * How the items retrieval for one sitting actually went.
 *
 * A named state and never a row count alone, because RULING 100's whole point
 * is that zero is ambiguous: a sitting with no outcome records is either a body
 * that acted on nothing or a retrieval that failed, and those must not be the
 * same value in a store.
 */
export type OutcomeExtractionState =
  /** The items route returned rows and they were transformed. */
  | "RETRIEVED"
  /**
   * **The items route returned ZERO rows. A FAILED EXTRACTION** (RULING 100),
   * persisted as a failure so a later reader gets a named gap rather than an
   * empty agenda. It is never "this meeting had no items".
   */
  | "ZERO_ROWS_FAILED"
  /** The request itself failed. Retryable, and it stays open — never absence. */
  | "REQUEST_FAILED";

/** One item whose votes request failed. Open, retryable, never an empty roll. */
export interface PersistedVoteRequestFailure {
  readonly eventItemId: number;
  readonly reason: string;
}

/**
 * Everything one sitting yielded, with its failures counted rather than
 * reconciled away.
 */
export interface PersistedSittingOutcomes {
  /** `legistar:pima:1825`. Byte-identical to `data/meetings-snapshot.json`. */
  readonly meetingId: string;
  /** `ocd-division/...#governing`. Byte-identical to the meetings snapshot. */
  readonly bodyId: string | null;
  readonly ocdId: string | null;
  readonly slug: string;
  readonly eventId: number;
  readonly bodyName: string;
  readonly jurisdiction: string;
  /** ISO instant of the sitting's start, for ordering and for "last meeting". */
  readonly startsAt: string | null;
  readonly sourceOrg: string;
  readonly sourceUrl: string | null;

  readonly extraction: OutcomeExtractionState;
  /** Why, whenever `extraction` is not `RETRIEVED`. Always a sentence. */
  readonly extractionNote: string | null;

  readonly publication: PersistedPublicationStatus;
  /** Known to exist, not read. Has NO record class, deliberately. */
  readonly minutesPointer: LegistarMinutesPointer;

  /** What was NOTICED. Never evidence of an outcome. */
  readonly agenda: readonly LegistarAgendaRecord[];
  /** What the body DID. One per ACTED item, not one per item. */
  readonly outcomes: readonly LegistarOutcomeRecord[];
  /** Per-person rolls. Only ever built from rows the votes route returned. */
  readonly rollCalls: readonly LegistarRollCallRecord[];

  /**
   * Items whose own record asserts a roll call and whose roll came back empty.
   * Reported, never reconciled (RULING 100). 20 of these on Pima — one per
   * sitting, each the attendance "ROLL CALL" item.
   */
  readonly failedRollCallExtractions: readonly number[];
  readonly voteRequestFailures: readonly PersistedVoteRequestFailure[];

  /**
   * The route ids that actually succeeded for this sitting.
   *
   * Ids from `lib/sources/legistar/routes.ts`, so a later session can ask
   * `factClassesOwedAfter(sitting.routesWalked)` and be told — in fact classes,
   * from data, rather than from someone's memory — that this sitting still has
   * no item full text and no narrative minutes however many JSON routes
   * returned 200.
   */
  readonly routesWalked: readonly string[];

  /**
   * **Every publisher surface reading held for this sitting's agenda.**
   *
   * More than one, deliberately: the portal grid cell and the Web API's
   * structured record are two representations of one fact and RULING 207 says
   * one succeeding never retires the other. They are stored side by side and
   * `reconcilePublicationObservations` names their relationship without picking
   * a winner. See `lib/outcomes/publication.ts`.
   */
  readonly publicationObservations: readonly AgendaPublicationObservation[];
}

/** The committed store. One file, every tenant. */
export interface OutcomeSnapshot {
  /** From `pnpm stamp`. Never a plausible date. */
  readonly generatedOn: string;
  /** ISO instant the ingest run finished. */
  readonly generatedAt: string;
  /** Tenant slugs this store holds anything for. */
  readonly tenants: readonly string[];
  readonly sittings: readonly PersistedSittingOutcomes[];
}
