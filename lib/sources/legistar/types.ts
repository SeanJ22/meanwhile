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
  EventMinutesStatusName: string | null;
  /** Direct link to the published agenda PDF. */
  EventAgendaFile: string | null;
  EventMinutesFile: string | null;
  /** The public InSite permalink for this meeting. Real, and the right `sourceUrl`. */
  EventInSiteURL: string | null;
  EventLastModifiedUtc: string | null;
}

/**
 * One agenda item, from `/v1/{client}/events/{id}/eventitems`.
 *
 * Only read for the 4.6.9 question — whether the host body sat as some other
 * body during the meeting. Not used to build Meeting records.
 */
export interface LegistarEventItem {
  EventItemId: number;
  EventItemAgendaSequence: number | null;
  EventItemTitle: string | null;
  EventItemMatterName: string | null;
  EventItemMatterFile: string | null;
  EventItemPassedFlagName: string | null;
  EventItemRollCallFlag: number | null;
}

/** One public body, from `/v1/{client}/bodies`. */
export interface LegistarBody {
  BodyId: number;
  BodyName: string;
  BodyTypeName: string | null;
  BodyMeetFlag: number;
  BodyActiveFlag: number;
}
