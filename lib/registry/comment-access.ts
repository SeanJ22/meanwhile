import type { OcdId } from "../sources/types.ts";

/**
 * How to actually be heard, per body — tracker **D25**.
 *
 * A meeting record that does not say how to speak is a notification without a
 * next step. This is usually a standing rule of the body rather than a
 * per-meeting field, which makes it cheap to curate once and durable; a
 * per-meeting override belongs on the meeting when an agenda states something
 * different.
 *
 * **Curated by hand for the bodies with a wired source, into the shape a feed
 * fills later (§0a)** — at scale most of these fields fall out of agenda text
 * extraction, which is one reason agenda documents were built first. Every
 * claim cites the page it was read from. **`UNKNOWN` is a real value and the
 * honest one for most bodies**: a comment period must never be inferred from
 * the fact that a meeting is public — many are public to observe and closed
 * to speak.
 */
export interface CommentAccess {
  /** Matches `Body.id`. */
  bodyId: string;
  ocdId: OcdId;
  /** Whether the body holds a public comment period at all. */
  commentPeriod: "YES" | "NO" | "UNKNOWN";
  /** Where in the meeting it falls, as the body describes it. */
  commentPeriodDetail: string | null;
  /** Advance sign-up: how, and by when. */
  signup: string | null;
  /** Deadline and address for written comment. */
  writtenComment: string | null;
  /** How to attend beyond the meeting's own venue — virtual link, streaming. */
  attend: string | null;
  /** Time limit per speaker, as published. */
  timeLimit: string | null;
  /** The rule or page every field above was read from. */
  sourceUrl: string;
  collectedAt: string;
  verifiedAt: string | null;
}

export const COMMENT_ACCESS: CommentAccess[] = [
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    commentPeriod: "YES",
    commentPeriodDetail:
      "Call to the Audience, scheduled for 30 minutes of the meeting.",
    signup:
      "Complete a speaker's card in its entirety and hand it to City Clerk staff, from 5:00 PM until the start of Call to the Audience. Cards are not accepted for someone not present in the Chambers.",
    writtenComment: null,
    attend:
      "Mayor and Council Chambers, 255 W. Alameda St (City Hall); seating first-come, first-served, with security screening. Meetings stream live on the City's YouTube channel.",
    timeLimit: "3 minutes per speaker.",
    sourceUrl:
      "https://www.tucsonaz.gov/files/sharedassets/public/v/1/clerks/documents/agenda-committee/mc-meeting-public-participation_may-2024_final.pdf",
    collectedAt: "2026-08-13",
    verifiedAt: "2026-08-13",
  },
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    commentPeriod: "YES",
    commentPeriodDetail:
      "Call to the Public appears as an item on the Board of Supervisors' own agendas.",
    signup: null,
    writtenComment: null,
    attend:
      "Board of Supervisors Hearing Room, 130 W. Congress St, 1st Floor, Tucson.",
    timeLimit: null,
    // The recorded 2026-08-11 agenda (EventId 1824) carries the item; the
    // calendar is the reader-facing route to the same record.
    sourceUrl: "https://pima.legistar.com/Calendar.aspx",
    collectedAt: "2026-08-13",
    verifiedAt: null,
  },
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:vail_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:vail_unified_district",
    commentPeriod: "YES",
    commentPeriodDetail:
      "The public is welcome at each meeting; comments at a Board Meeting follow the board's published policy and form, both linked from the Governing Board page.",
    signup:
      "Per the board's comment policy and form (linked from the Governing Board page).",
    writtenComment:
      "Comments on any Board agenda item or other issues may be emailed to comments@vailschooldistrict.org.",
    attend:
      "Calvin Baker Leadership Center, 13801 E. Benson Highway, Vail; meetings may be followed on the district's YouTube channel.",
    timeLimit: null,
    sourceUrl: "https://www.vailschooldistrict.org/page/governing-board",
    collectedAt: "2026-08-13",
    verifiedAt: "2026-08-13",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district#board",
    ocdId:
      "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district",
    commentPeriod: "YES",
    commentPeriodDetail:
      "The public portion of the meeting begins at 7:30 PM per the board's annual meeting-dates notice.",
    signup: null,
    writtenComment: null,
    attend: "Copeland Middle School, 100 Lake Shore Dr, Rockaway.",
    timeLimit: null,
    sourceUrl: "https://www.rocktwp.net/page/annual-board-meeting-dates",
    collectedAt: "2026-08-13",
    verifiedAt: null,
  },

  // ── Honest unknowns: the body's own page is the next step ───────────────
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district",
    commentPeriod: "UNKNOWN",
    commentPeriodDetail: null,
    signup: null,
    writtenComment: null,
    attend: null,
    timeLimit: null,
    sourceUrl: "https://govboard.tusd1.org/Meetings",
    collectedAt: "2026-08-13",
    verifiedAt: null,
  },
  {
    bodyId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing",
    ocdId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    commentPeriod: "UNKNOWN",
    commentPeriodDetail: null,
    signup: null,
    writtenComment: null,
    attend: null,
    timeLimit: null,
    sourceUrl: "https://www.rockawaytownship.org/157/Township-Council",
    collectedAt: "2026-08-13",
    verifiedAt: null,
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    commentPeriod: "UNKNOWN",
    commentPeriodDetail: null,
    signup: null,
    writtenComment: null,
    attend: null,
    timeLimit: null,
    sourceUrl:
      "https://www.newbury.nh.gov/administration/links/selectboard-meeting-minutes-agendas",
    collectedAt: "2026-08-13",
    verifiedAt: null,
  },
];

/** The comment-access record for a meeting's division, if one is curated. */
export function commentAccessFor(ocdId: OcdId): CommentAccess | undefined {
  return COMMENT_ACCESS.find((c) => c.ocdId === ocdId);
}
