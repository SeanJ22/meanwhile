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
  //
  // RE-WALKED 2026-08-18 (g18, D25), rung 2 with an identified User-Agent:
  // `clerksboards.tucsonaz.gov/boards` (HTTP 200, 22,065 bytes) and the
  // per-board page `?board=38` (HTTP 200, 15,043 bytes) BOTH carry no
  // comment-access language at all — not "public comment", not "call to the
  // audience", not a time limit. So there is no shared platform-level rule to
  // find, and one rung cannot close all five; each board needs its own.
  //
  // The rung that WOULD close them, named rather than left for rediscovery:
  // Tucson's Mayor & Council rule (already curated above, YES) comes from a
  // City participation notice, and the boards are creatures of city code —
  // so the target is the Tucson City Code chapter creating each board, and
  // each board's own bylaws where it publishes them. NOT ATTEMPTED. Nothing
  // is inferred from the Mayor & Council rule: a council's speaker-card
  // procedure is not evidence about its Planning Commission.
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
    /*
     * FOUND 2026-08-18 (g18, D25). Policy BEDH, "Public Participation at
     * Board Meetings", revised 12/12/2023, in the district's own policy
     * manual on its own domain.
     *
     * THE RUNGS, so the next hunt starts below this one. Rung 2 on
     * `govboard.tusd1.org/Meetings` returned 200 and matched "public comment"
     * — a FALSE LEAD: the nav item it matched is `/Comments`, which is the
     * district's page for commenting on PROPOSED POLICIES during their
     * reading period, not for speaking at a meeting. Recording that it was
     * checked and rejected, because the next reader will match the same
     * string. The rule is in Section B of the policy manual, reached by
     * scanning the manual's own section index for the NEPN/ASBA code a school
     * board files this under (BEDH). That code is the rung: a school district
     * with a coded policy manual will have its participation rule at BEDH,
     * and looking there directly is faster than reading agendas.
     */
    commentPeriod: "YES",
    commentPeriodDetail:
      "Call to the Audience. The comment period is 45 minutes at regular meetings and 20 minutes at special meetings, and is extended only by the Board's approval. Speakers whose comments relate to an item on the agenda are taken first; the rest are taken in the order their forms arrived.",
    signup:
      "Complete a Request to Address Board form and give it to Board staff — electronically to the Board office by noon on the day of the meeting, or in person at the meeting any time before Call to the Audience closes. The form must name the speaker and the topic, and say whether the comments relate to an agenda item.",
    writtenComment:
      "The same form asks whether you want to speak in person or have your comments read into the record by the Governing Board Clerk. All written comments go to Board members whether or not they are read aloud.",
    attend: null,
    timeLimit:
      "Up to three minutes per speaker, or per written comment read aloud. The presiding officer may shorten it when many people have signed up, and speakers may not give their time to someone else.",
    sourceUrl: "https://govboard.tusd1.org/Policy-Code-BEDH",
    collectedAt: "2026-08-18",
    verifiedAt: "2026-08-18",
  },
  {
    bodyId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing",
    ocdId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    /*
     * STILL UNKNOWN after g18's hunt, and the rungs are recorded so the next
     * session starts below them rather than at the top again (D25's own rule).
     *
     * Walked 2026-08-18, all with an identified User-Agent carrying a contact
     * address:
     *   rung 2, `/157/Township-Council` — HTTP 200, 112,590 bytes, NO
     *     comment-access language of any kind (no "public comment", no
     *     "public portion", no time limit).
     *   rung 2, `/AgendaCenter` — HTTP 200, 203,609 bytes, none.
     *   rung 2, `/158/Council-Meetings` — HTTP 200, 112,326 bytes, none.
     *
     * This is a CivicPlus site (rung 12 is the platform), and the rule for a
     * New Jersey municipality is most often in the council's annual
     * organizational-meeting resolution or its Rules of Procedure — neither
     * of which is on the three pages above. NOT ATTEMPTED yet, and named so
     * the next hunt has a target: the organizational meeting agenda packet in
     * AgendaCenter (January), and the township code's council-procedure
     * chapter on eCode360. Nothing here is inferred from N.J.S.A. 10:4-12(a)
     * requiring a comment period at regular meetings — the statute is real,
     * but a claim about THIS body needs this body's own published rule.
     */
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
    /*
     * STILL UNKNOWN after g18's hunt, and it is a WALL rather than an
     * emptiness — the difference matters and this row states which.
     *
     * Walked 2026-08-18:
     *   rung 2, plain fetch with an identified User-Agent — HTTP 403.
     *   rung 3, the full browser header set (Chrome UA, Accept,
     *     Accept-Language) — HTTP 403.
     *
     * Two rungs, both refused, and the refusal is the finding: nothing here
     * says Newbury publishes no comment rule. The ladder is NOT exhausted and
     * the next rungs are named — rung 4 (a different client whose TLS
     * fingerprint passes; curl beat this exact class of filter in the f
     * session), rung 5 (a different egress), rung 6 (the live browser), and
     * rung 11 (the Internet Archive, which is not blocked by this host's WAF
     * because it is not this host). g3's rule applies: a 403 to a CI-shaped
     * client is an EGRESS or fingerprint wall, not a header problem, so
     * hunting more headers here would be the wrong rung.
     */
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
    /*
     * FOUND 2026-08-18 (g18, D25), and the rung is the point: the rule was
     * never going to be on the VENDOR calendar this row was pointed at.
     * `morriscountynj.iqm2.com/Citizens/Calendar.aspx` returns 200 and
     * contains no comment-access language at all, which is what a vendor
     * calendar is — a list of dates. The rule is on the BODY'S OWN `.gov`
     * page, one fetch away.
     *
     * The distinction it draws is why this is worth having and why a
     * meeting-agnostic row would be wrong: evening meetings carry a public
     * comment portion, and the 5pm WORK SESSIONS do not unless the Director
     * grants one. A reader told "there is a comment period" and sent to a
     * work session would have been sent by us.
     */
    commentPeriod: "YES",
    commentPeriodDetail:
      "There is a public comment portion at every evening meeting. Work sessions, which start at 5:00 p.m., have no public comment portion unless the Commissioner Director grants one.",
    signup: null,
    writtenComment: null,
    attend:
      "Evening meetings begin at 7:00 p.m., most of them in the Public Meeting Room on the 5th floor of the Administration & Records Building, Court Street, Morristown. Work sessions are in the Knox Room on the same floor and the public may attend those too.",
    timeLimit: null,
    sourceUrl:
      "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
    collectedAt: "2026-08-18",
    verifiedAt: "2026-08-18",
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack#governing",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack",
    /*
     * FOUND 2026-08-18 (g18, D25): the county's own Public Comment Policy,
     * adopted by the Board 7/14/25, under RSA 91-A:2.
     *
     * THE RUNG, AND IT IS NEW — it is now in `docs/zip-playbook.md`. The
     * notices page names the policy and links it, and that link 404s from
     * outside. The href is RELATIVE and the CMS serves the page under a
     * section path (`/board_of_commissioners_/…`), so resolving the href
     * against the page URL builds `/board_of_commissioners_/Board%20of%20
     * Commissioners/…` — a path that does not exist. Every document on the
     * page 404s the same way, which is what proved it was the path and not
     * the file. The documents live at the SITE ROOT:
     * `https://www.merrimackcounty.net/Board%20of%20Commissioners/…`. Strip
     * the section prefix and re-resolve from the root.
     *
     * Then rung 9: it is a PDF, and PDFs are data. Text-layer extraction
     * through `extractPdfText` read the whole policy.
     */
    commentPeriod: "YES",
    commentPeriodDetail:
      "A designated public comment period at Board meetings, for matters within the Board's jurisdiction. Comments about individual county employees or private individuals are not taken there — the policy directs those to the Human Resources Director or the County Administrator during business hours.",
    signup: null,
    writtenComment: null,
    attend:
      "Venue alternates per meeting and is stated in each public notice; Zoom links are published for remote attendance (per the Board's notices page).",
    timeLimit:
      "Up to four minutes per speaker. The Chairperson may extend that at their discretion, and a timer may be used.",
    sourceUrl:
      "https://www.merrimackcounty.net/Board%20of%20Commissioners/Public%20Notices,%20Agenda,%20Minutes/Public%20Comment%20Policy.pdf",
    collectedAt: "2026-08-18",
    verifiedAt: "2026-08-18",
  },

  // ── Sunnyside USD Governing Board (item 2, 2026-08-18 session) ──────────
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:sunnyside_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:sunnyside_unified_district",
    commentPeriod: "YES",
    commentPeriodDetail:
      "During regularly scheduled meetings a “Call to the Audience” gives interested individuals in the audience an opportunity to address the Board, per the board's own page.",
    signup: null,
    writtenComment: null,
    attend:
      "Governing Board Room, District Administration Building, 2238 E. Ginter Road; regular meetings the second and fourth Tuesday at 6:30 PM unless otherwise noted.",
    timeLimit: null,
    sourceUrl: "https://www.susd12.org/governing-board-home",
    collectedAt: "2026-08-14",
    verifiedAt: null,
  },

  // ── Amphitheater USD Governing Board (item 2, 2026-08-18 session) ───────
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:amphitheater_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:amphitheater_unified_district",
    commentPeriod: "YES",
    commentPeriodDetail:
      "Two published paths: comments on scheduled agenda items (blue speaker's request form) and a general public comment period (yellow speaker's request form), both submitted to the Executive Assistant at the meeting.",
    signup:
      "Complete the blue (agenda item) or yellow (general comment) speaker's request form at the meeting; state your name, address, and relationship to the District.",
    writtenComment: null,
    attend: null,
    timeLimit: "3 minutes per person, per the district's published procedure.",
    sourceUrl: "https://www.amphi.com/addressing-the-board",
    collectedAt: "2026-08-14",
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
