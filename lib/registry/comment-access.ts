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
  /** Null for a body with no Census division (D28). */
  ocdId: OcdId | null;
  /**
   * The body names, as published in meeting feeds, this rule applies to.
   *
   * Required routing the moment a division carries more than one body
   * (D29): a Planning Commission meeting must never render the Mayor and
   * Council's speaker-card rules. A row without `bodyNames` applies only
   * while it is the sole row for its division — see `commentAccessFor`.
   * This is display routing scoped to one division's own published names,
   * not the cross-source name join CLAUDE.md forbids.
   */
  bodyNames?: string[];
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
  // ── Pima Community College Governing Board (D28) ────────────────────────
  // All this board's meeting types follow the same published procedure.
  {
    bodyId: "curated:az/pima-community-college#governing",
    ocdId: null,
    commentPeriod: "YES",
    commentPeriodDetail:
      "Public Comment is a standing part of Governing Board meetings, per the board's published procedure.",
    signup:
      "Register via the Public Comment Registration Form (online Zoom link or email to board staff) with name, mailing address, telephone, email and comment topic. Deadline: 5:00 PM the day before the scheduled Board meeting.",
    writtenComment: null,
    attend:
      "District Office, 4905 E. Broadway Blvd., Tucson; regular meetings are live-streamed per the board meetings page.",
    timeLimit: "3 minutes per speaker.",
    sourceUrl:
      "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/public-comment.html",
    collectedAt: "2026-08-14",
    verifiedAt: "2026-08-14",
  },

  // ── Tucson boards newly wired via clerksboards (D29) ────────────────────
  // Honest UNKNOWNs: the Clerk's board pages publish schedule and venue but
  // not a comment procedure, and a comment period must never be inferred
  // from a meeting being public. The hunt continues on each body's page.
  ...(
    [
      ["planning-commission", "Planning Commission", "38"],
      ["board-of-adjustment", "Board of Adjustment", "8"],
      ["citizens-water-advisory-committee", "Citizens' Water Advisory Committee", "23"],
      [
        "tucson-parks-and-recreation-commission",
        "Tucson Parks and Recreation Commission",
        "63",
      ],
      [
        "community-police-advisory-review-board",
        "Community Police Advisory Review Board",
        "19",
      ],
    ] as const
  ).map(
    ([slot, name, boardId]): CommentAccess => ({
      bodyId: `ocd-division/country:us/state:az/place:tucson#${slot}`,
      ocdId: "ocd-division/country:us/state:az/place:tucson",
      bodyNames: [name],
      commentPeriod: "UNKNOWN",
      commentPeriodDetail: null,
      signup: null,
      writtenComment: null,
      attend: null,
      timeLimit: null,
      sourceUrl: `https://clerksboards.tucsonaz.gov/boards/?board=${boardId}`,
      collectedAt: "2026-08-14",
      verifiedAt: null,
    }),
  ),

  // ── Tucson Public Housing Authority Board of Commissioners (D29) ────────
  // Its agendas carry public hearings; whether a general comment period
  // exists beyond noticed hearings is not stated. UNKNOWN until found.
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#public-housing-authority",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    bodyNames: ["Public Housing Authority Board of Commissioners"],
    commentPeriod: "UNKNOWN",
    // Its agendas carry noticed public hearings, but whether a general
    // comment period exists is not stated — so this row states nothing.
    commentPeriodDetail: null,
    signup: null,
    writtenComment: null,
    attend: "Mayor and Council Chambers, City Hall, 255 W. Alameda, Tucson.",
    timeLimit: null,
    sourceUrl:
      "https://tucsonaz.hylandcloud.com/221agendaonline/Documents/ViewDocument/agenda.pdf?meetingId=1981&documentType=1",
    collectedAt: "2026-08-14",
    verifiedAt: "2026-08-14",
  },

  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    // As the OnBase feed publishes them after the name split.
    bodyNames: ["Mayor & Council"],
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
  // Wired 2026-08-13; no published comment rule found on the calendar or the
  // notices read so far. The agenda PDFs are the likely place a rule appears
  // (Morris's carry item lists; the retrieval cap has not reached them yet)
  // — UNKNOWN until one is read, never inferred from the meeting being
  // public.
  {
    bodyId: "ocd-division/country:us/state:nj/county:morris#governing",
    ocdId: "ocd-division/country:us/state:nj/county:morris",
    commentPeriod: "UNKNOWN",
    commentPeriodDetail: null,
    signup: null,
    writtenComment: null,
    attend: null,
    timeLimit: null,
    sourceUrl:
      "https://morriscountynj.iqm2.com/Citizens/Calendar.aspx",
    collectedAt: "2026-08-13",
    verifiedAt: null,
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack#governing",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack",
    commentPeriod: "UNKNOWN",
    commentPeriodDetail: null,
    signup: null,
    // The notices state each meeting "is open to the public for the
    // discussion of any matters that may come before the Board" and publish
    // Zoom access; that is attendance information, not a comment-period rule.
    writtenComment: null,
    attend:
      "Venue alternates per meeting and is stated in each public notice; Zoom links are published for remote attendance (per the Board's notices page).",
    timeLimit: null,
    sourceUrl:
      "https://www.merrimackcounty.net/board_of_commissioners_/public_notices,_agendas,_minutes,_.php",
    collectedAt: "2026-08-13",
    verifiedAt: null,
  },
];

/**
 * The comment-access record for a meeting, if one is curated.
 *
 * Resolution is deliberately conservative: a row naming body names wins on
 * an exact (case-insensitive) match; an unnamed row applies only while it is
 * the *sole* row for its division. Once a division carries several bodies,
 * an unmatched meeting gets no rule rather than the wrong body's rule.
 */
export function commentAccessFor(
  ocdId: OcdId | null,
  bodyName?: string,
): CommentAccess | undefined {
  const rows = COMMENT_ACCESS.filter((c) => c.ocdId === ocdId);
  if (rows.length === 0) return undefined;

  if (bodyName) {
    const wanted = bodyName.trim().toLowerCase();
    const named = rows.find((c) =>
      c.bodyNames?.some((n) => n.trim().toLowerCase() === wanted),
    );
    if (named) return named;
  }

  const generic = rows.filter((c) => !c.bodyNames);
  return rows.length === 1 && generic.length === 1 ? generic[0] : undefined;
}
