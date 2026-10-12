/**
 * The Granicus Legistar Web API response shapes, mirroring what `webapi.legistar.com/v1/{client}/...`
 * returns, field names and all. Only the fields the adapter reads are typed.
 */

/**
 * One sitting, from `/v1/{client}/events`. `EventDate` and `EventTime` are separate strings and neither
 * carries a zone: `EventDate` is a full ISO timestamp whose time is always midnight; `EventTime` is a
 * 12-hour wall clock. They are reassembled against the client's IANA zone (`lib/time/zoned.ts`). There are
 * no coordinates: `EventLocation` is a room name, so a pin requires a venue table.
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
  /** Free text, e.g. null, "Study Session", "Special Meeting", "Joint Meeting". */
  EventComment: string | null;
  /** "Final", "Draft", or null. */
  EventAgendaStatusName: string | null;
  /**
   * The numeric companion to the name above: the vendor's enum, kept because the name is a per-tenant label
   * a clerk can rename. Neither is a claim about the meeting, only about a document's publication state.
   */
  EventAgendaStatusId?: number | null;
  EventMinutesStatusId?: number | null;
  /** When the publisher last put out the agenda document, in UTC (no zone suffix; the field name says UTC). */
  EventAgendaLastPublishedUTC?: string | null;
  /** The same, for the minutes document. Null when none has been published. */
  EventMinutesLastPublishedUTC?: string | null;
  /** The vendor's stable GUID for this sitting. Needed by the View.ashx routes. */
  EventGuid?: string | null;
  /** "Public", "Not Viewable", null. A MEDIA_RECORD fact, never an outcome. */
  EventVideoStatus?: string | null;
  /** The recording's address on the publisher's video host; only a link while `EventVideoStatus` is "Public". */
  EventVideoPath?: string | null;
  /** A clip id on the publisher's video host when the recording has no direct path. */
  EventMedia?: string | null;
  /**
   * "Final", "Draft", or null. Some tenants leave every sitting at "Draft", so it is never a signal that
   * minutes are still coming.
   */
  EventMinutesStatusName: string | null;
  /** Direct link to the published agenda PDF. */
  EventAgendaFile: string | null;
  /**
   * A URL, and a pointer rather than a record. Nothing in this adapter fetches it; `outcomes.ts` models it
   * as a discovery lead with no record class, so an unread minutes document is never evidence of what a
   * body decided.
   */
  EventMinutesFile: string | null;
  /** The public InSite permalink for this meeting. Real, and the right `sourceUrl`. */
  EventInSiteURL: string | null;
  EventLastModifiedUtc: string | null;
}

/**
 * One agenda item, from `/v1/{client}/events/{id}/eventitems`. Two records share this row: the sequence,
 * title and matter file are what the clerk noticed; the action, pass flag, mover, seconder and action
 * text are what the body did. `outcomes.ts` splits the row into the two record classes
 * (`lib/answerability/record-class.ts`).
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
   * The clerk's status for the underlying matter (e.g. "Approved", "Public Hearing", "Agenda Ready",
   * "Continued").
   */
  EventItemMatterStatus?: string | null;

  // ---- the outcome half ----

  /**
   * The verb the body applied ("approve", "continue", "adopt"). Free text authored by a clerk, never an enum,
   * carried verbatim. Null means no action is recorded, which is not the same fact as the item having failed.
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
  /** "Pass" or null in practice. A null is a fact about the clerk's data entry and is never read as a failure. */
  EventItemPassedFlagName: string | null;
  /**
   * Not a marker that per-person votes exist: it can be 1 only on an attendance "ROLL CALL" item with no
   * action, and 0 on items that do carry a per-person roll call.
   */
  EventItemRollCallFlag: number | null;
  /** Who moved it, as the clerk typed the name. Not a person id we join on. */
  EventItemMover?: string | null;
  EventItemMoverId?: number | null;
  EventItemSeconder?: string | null;
  EventItemSeconderId?: number | null;
  /** A vote summary string. Not seen populated; nothing is asserted about its format. */
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
   * The cast value (e.g. "Aye", "Not Present"). Free text, carried verbatim: "Not Present", "Abstain" and
   * "Recused" are positions, not missing data.
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
