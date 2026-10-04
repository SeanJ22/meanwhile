/**
 * The Granicus Legistar Web API response shapes.
 *
 * These mirror what `webapi.legistar.com/v1/{client}/...` actually returns,
 * field names and all, rather than a tidied-up version. The tidying is
 * normalize()'s job and keeping the raw shape honest is what makes the recorded
 * test fixture worth anything.
 *
 * Recorded live from the `pima` client on 2026-08-12. Only the fields the
 * adapter reads are typed; the API returns more (row versions, GUIDs, video
 * paths) and dropping them here is deliberate.
 */

/**
 * One sitting, from `/v1/{client}/events`.
 *
 * The shape worth noticing: **`EventDate` and `EventTime` are separate strings
 * and neither carries a zone.** `EventDate` arrives as a full ISO timestamp
 * whose time component is always midnight and is meaningless; `EventTime` is a
 * 12-hour wall clock. Reassembling them against the client's IANA zone is the
 * only interesting part of the transform, and it is why `lib/time/zoned.ts`
 * exists.
 *
 * **There are no coordinates.** `EventLocation` is a room name — "Board of
 * Supervisors' Hearing Room" — so a pin requires a venue table. See clients.ts.
 */
export interface LegistarEvent {
  EventId: number;
  EventBodyId: number;
  EventBodyName: string;
  /** `YYYY-MM-DDT00:00:00` — the time half is always midnight and carries no meaning. */
  EventDate: string;
  /** `h:mm AM/PM`, local wall clock, no zone. */
  EventTime: string | null;
  /** A room name, not an address, and never coordinates. */
  EventLocation: string | null;
  /** Free text. Observed values on `pima`: null, "Study Session", "Special Meeting", "Joint Meeting". */
  EventComment: string | null;
  /** "Final", "Draft", or null. */
  EventAgendaStatusName: string | null;
  /**
   * The numeric companion to the name above — 10 for "Final", 9 for "Draft" on
   * Pima. Carried because the NAME is a per-tenant label a clerk can rename and
   * the ID is the vendor's enum; keeping both means a tenant that prints
   * "Published" instead of "Final" is still comparable.
   *
   * Neither is read as a claim about the MEETING. An agenda status is a fact
   * about a DOCUMENT's publication state and nothing else.
   */
  EventAgendaStatusId?: number | null;
  EventMinutesStatusId?: number | null;
  /**
   * **When the publisher last put out the agenda document, in UTC.**
   *
   * The correct field for "is the agenda currently published, and how current
   * is it" — and the reason that question never needs to be answered by
   * guessing from a document URL's existence. Observed on Pima event 1825:
   * `2026-08-25T18:04:04.46`, no zone suffix, which is Legistar's habit and is
   * documented as UTC by the field name rather than by the value.
   */
  EventAgendaLastPublishedUTC?: string | null;
  /** The same, for the minutes document. Null when none has been published. */
  EventMinutesLastPublishedUTC?: string | null;
  /** The vendor's stable GUID for this sitting. Needed by the View.ashx routes. */
  EventGuid?: string | null;
  /** "Public", "Not Viewable", null. A MEDIA_RECORD fact, never an outcome. */
  EventVideoStatus?: string | null;
  /** The recording's address on the publisher's video host; only a link while `EventVideoStatus` is "Public" (BX-10). */
  EventVideoPath?: string | null;
  /**
   * "Final", "Draft", or null. **"Draft" on all 20 Pima Board sittings from
   * 2026-05-05 to 2026-08-25**, including sittings four months old — so
   * "Draft" here is the tenant's steady state and never a signal that minutes
   * are still coming.
   */
  EventMinutesStatusName: string | null;
  /** Direct link to the published agenda PDF. */
  EventAgendaFile: string | null;
  /**
   * A URL, and a POINTER rather than a record.
   *
   * It resolves to `legistar.granicus.com`, which answers `User-agent: *` with
   * `Disallow: /` (docs/sources.md, recorded 2026-08-29). Nothing in this
   * adapter fetches it, and `outcomes.ts` models it as a discovery lead with
   * NO record class — precisely so a minutes document we have never read can
   * never be offered as evidence of what a body decided.
   */
  EventMinutesFile: string | null;
  /** The public InSite permalink for this meeting. Real, and the right `sourceUrl`. */
  EventInSiteURL: string | null;
  EventLastModifiedUtc: string | null;
}

/**
 * One agenda item, from `/v1/{client}/events/{id}/eventitems`.
 *
 * **Two records share this row, and they are not the same record.** The
 * sequence, the title and the matter file are what the clerk NOTICED. The
 * action, the pass flag, the mover, the seconder and the action text are what
 * the body DID, entered afterwards. `lib/answerability/record-class.ts` is the
 * rule that keeps them apart; `outcomes.ts` in this directory is the transform
 * that splits one row into the two record classes rather than one wide object.
 *
 * The outcome half was declared here and read NOWHERE until 2026-08-29 — the
 * fields below existed on the wire and `toAgendaItems()` mapped every row down
 * to four notice-class fields, so the repository could say what was on an
 * agenda and could not say what a body decided.
 */
export interface LegistarEventItem {
  EventItemId: number;
  /** The sitting this item belongs to, echoed back on the row. */
  EventItemEventId?: number | null;
  EventItemAgendaSequence: number | null;
  /** The clerk's printed item number — "7.", "18.A." Null on headings. */
  EventItemAgendaNumber?: string | null;
  /**
   * Where the item landed in the MINUTES, which is a different ordering from
   * the agenda and is null on an item the body never reached.
   */
  EventItemMinutesSequence?: number | null;
  EventItemTitle: string | null;
  EventItemMatterName: string | null;
  EventItemMatterFile: string | null;
  EventItemMatterType?: string | null;
  /**
   * The clerk's status for the underlying matter — observed on Pima across 20
   * Board sittings (2026-05-01 .. 2026-08-29): null 823, "Approved" 391,
   * "Public Hearing" 65, "Agenda Ready" 49, "Addendum Ready" 19, "No Action"
   * 10, "Continued" 3.
   */
  EventItemMatterStatus?: string | null;

  /* ---- the outcome half. Present on the wire; unread until 2026-08-29. ---- */

  /**
   * The verb the body applied — "approve", "continue", "adopt", "approve on
   * the Consent Calendar". **Free text authored by a clerk**, never an enum,
   * and carried verbatim for exactly that reason.
   *
   * Null means NO ACTION IS RECORDED for this item, which is not the same fact
   * as the item having failed. 835 of 1360 Pima Board items carry no action.
   */
  EventItemActionName?: string | null;
  /**
   * The clerk's prose account of the motion, and the field that most often
   * carries a TALLY — "unanimously carried by a 5-0 vote". A tally is not a
   * member's recorded position (`record-class.ts`), so this string is carried
   * on the ACTION_SUMMARY record and is deliberately absent from the ROLL_CALL
   * record.
   */
  EventItemActionText?: string | null;
  EventItemActionId?: number | null;
  /** 1 / 0 companion to the name below. Cross-checked, never trusted alone. */
  EventItemPassedFlag?: number | null;
  /**
   * **"Pass" or null on every one of the 465 flagged Pima Board items measured
   * on 2026-08-29. "Fail" was not observed at all.** So a null here is a fact
   * about the clerk's data entry and can never be read as a failure — doing so
   * would have manufactured 895 defeats out of one county's four months.
   */
  EventItemPassedFlagName: string | null;
  /**
   * **NOT a marker that per-person votes exist.** On Pima it is 1 on exactly
   * one item per sitting — the literal "ROLL CALL" attendance item, which has
   * no action and whose votes endpoint returns zero rows — and 0 on every item
   * that does carry a per-person roll call. Measured 20 of 20 sittings.
   */
  EventItemRollCallFlag: number | null;
  /** Who moved it, as the clerk typed the name. Not a person id we join on. */
  EventItemMover?: string | null;
  EventItemMoverId?: number | null;
  EventItemSeconder?: string | null;
  EventItemSeconderId?: number | null;
  /**
   * A vote summary string. Null on all 1360 Pima Board items measured, so this
   * adapter has never seen it populated and asserts nothing about its format.
   */
  EventItemTally?: string | null;
  /** 1 when the item rode the consent calendar. */
  EventItemConsent?: number | null;
}

/**
 * One person's recorded vote, from `/v1/{client}/eventitems/{id}/votes`.
 *
 * **The strongest civic record this product can hold**, and the only class
 * `record-class.ts` lets answer `HOW_DID_THEY_VOTE`. It names a person and the
 * value they cast on one question. Nothing here is a summary and nothing here
 * may be reconstructed from one.
 */
export interface LegistarVote {
  VoteId: number;
  VoteEventItemId: number;
  VotePersonId: number | null;
  /** As the clerk typed it — "Rex Scott", "Andrés Cano". Rendered verbatim. */
  VotePersonName: string | null;
  /**
   * The cast value. Observed on Pima: "Aye", "Not Present". Free text, carried
   * verbatim — mapping it to a yes/no vocabulary would erase "Not Present",
   * "Abstain" and "Recused", which are positions and not missing data.
   */
  VoteValueName: string | null;
  VoteValueId: number | null;
  /** The clerk's display order for the roll. Not a seniority or district order. */
  VoteSort: number | null;
  /** 1 / 0. Cross-checked against the name, never substituted for it. */
  VoteResult: number | null;
}

/** One public body, from `/v1/{client}/bodies`. */
export interface LegistarBody {
  BodyId: number;
  BodyName: string;
  BodyTypeName: string | null;
  BodyMeetFlag: number;
  BodyActiveFlag: number;
}
