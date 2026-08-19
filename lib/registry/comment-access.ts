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

  // ── Tucson boards wired via clerksboards (D29) ──────────────────────────
  //
  // CLOSED 2026-08-18 (g19, D25). All five were honest UNKNOWNs for four
  // sessions because every hunt stopped at the Clerk's board PAGE, which
  // publishes schedule and venue and no comment procedure. g18 re-walked
  // those pages, confirmed there is no shared platform-level rule, and named
  // the Tucson City Code as the next rung.
  //
  // The rung that actually closed them was one rung lower and cheaper: the
  // board page links its own AGENDA (`?run=currentagenda&board=N` and
  // `?run=pastagenda&board=N`), and the agenda PDF carries the rule in its
  // standing header — ladder rung 9, linked documents in every format. The
  // City Code was never needed. **The playbook entry: for a body whose page
  // is silent, read the body's own agenda before reading the law that made
  // the body.** A published agenda is the body describing its own meeting.
  //
  // Each of the five carries a DIFFERENT rule, which is why one shared row
  // could never have closed them and why the earlier shared `.map` shape is
  // gone. Nothing below is inferred from Mayor & Council's speaker-card
  // procedure; each field is read from that board's own agenda.
  //
  // Where an agenda publishes no per-speaker limit, `timeLimit` stays null.
  // Two of these agendas allot minutes to the Call to the Audience ITEM on a
  // timed agenda; an item duration is not a per-speaker limit and is never
  // rendered as one.
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#planning-commission",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    bodyNames: ["Planning Commission"],
    commentPeriod: "YES",
    commentPeriodDetail:
      "Call to the Audience is a standing item on the Commission's agenda, and cases set for Public Hearing take comment on the item.",
    signup:
      "Attending virtually and want to speak, at a Public Hearing item or at Call to the Audience: email PlanningCommission@tucsonaz.gov by 5:00 PM the day of the meeting.",
    writtenComment: "Written comments may be sent to PlanningCommission@tucsonaz.gov.",
    attend:
      "In person, or by the hybrid link and dial-in published on each meeting's agenda.",
    // The agenda publishes no per-speaker limit. Not inferred from any other
    // Tucson body's limit.
    timeLimit: null,
    sourceUrl: "https://assets.tucsonaz.gov/share/bcc/42308.pdf",
    collectedAt: "2026-08-18",
    verifiedAt: "2026-08-18",
  },
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#board-of-adjustment",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    bodyNames: ["Board of Adjustment"],
    commentPeriod: "YES",
    commentPeriodDetail:
      "This board hears variance cases, and comment is taken on each case at its public hearing. Its agendas carry no general Call to the Audience item.",
    signup:
      "Notify staff of your intention to present information at the public hearing by emailing DSD_Zoning_Administration@tucsonaz.gov with your name, address and phone number.",
    writtenComment: null,
    attend:
      "In person, or by the hybrid link at tucsonaz.gov/BOA and the dial-in published on each agenda.",
    timeLimit: null,
    sourceUrl: "https://assets.tucsonaz.gov/share/bcc/42516.pdf",
    collectedAt: "2026-08-18",
    verifiedAt: "2026-08-18",
  },
  {
    bodyId:
      "ocd-division/country:us/state:az/place:tucson#citizens-water-advisory-committee",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    bodyNames: ["Citizens' Water Advisory Committee"],
    commentPeriod: "YES",
    commentPeriodDetail:
      "Call to the Audience appears twice on this committee's timed agenda — once near the start and once before adjournment.",
    signup:
      "Meetings are held virtually. Contact the committee's staff liaison (Jessica Rodriguez, jessica.rodriguez@tucsonaz.gov) to participate, by the deadline published on the meeting's agenda.",
    writtenComment: null,
    attend:
      "Virtually, by the Microsoft Teams link published on each meeting's agenda.",
    // The agenda allots 2 minutes to the Call to the Audience ITEM. That is
    // the item's slot on a timed agenda, not a per-speaker limit, so it is
    // not rendered as one.
    timeLimit: null,
    sourceUrl: "https://assets.tucsonaz.gov/share/bcc/42287.pdf",
    collectedAt: "2026-08-18",
    verifiedAt: "2026-08-18",
  },
  {
    bodyId:
      "ocd-division/country:us/state:az/place:tucson#tucson-parks-and-recreation-commission",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    bodyNames: ["Tucson Parks and Recreation Commission"],
    commentPeriod: "YES",
    commentPeriodDetail:
      "Call to the Audience, early on the agenda: any member of the public may address the Commission. The Commission may not discuss or act on what is raised there, but may put it on a future agenda.",
    signup:
      "Email TPRC@tucsonaz.gov or call 520-837-8162 with your full name, mailing address, phone number and topic, by 5:00 PM the day before the meeting. Attending virtually, you may instead use the chat or Raise your hand during the meeting.",
    writtenComment: null,
    attend:
      "In person, or by the hybrid link and dial-in published on each meeting's agenda.",
    timeLimit: "Three minutes per speaker.",
    sourceUrl: "https://assets.tucsonaz.gov/share/bcc/42521.pdf",
    collectedAt: "2026-08-18",
    verifiedAt: "2026-08-18",
  },
  {
    bodyId:
      "ocd-division/country:us/state:az/place:tucson#community-police-advisory-review-board",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    bodyNames: ["Community Police Advisory Review Board"],
    commentPeriod: "YES",
    commentPeriodDetail:
      "Call to the Audience, early on the agenda: the community may address the board with their concerns. The board may not address a specific concern at that meeting, but may make it a future agenda item.",
    signup: null,
    writtenComment: null,
    attend:
      "In person — doors open 15 minutes before the start — or by the Microsoft Teams link and dial-in published on each meeting's agenda.",
    timeLimit: "Three minutes per person.",
    sourceUrl: "https://assets.tucsonaz.gov/share/bcc/42766.pdf",
    collectedAt: "2026-08-18",
    verifiedAt: "2026-08-18",
  },

  // ── Tucson Public Housing Authority Board of Commissioners (D29) ────────
  //
  // RESOLVED 2026-08-18 (g19, D25), and the scope of the answer is the whole
  // point of the row. FOUR of the Board's own agendas were read on the
  // Clerk's tenant — meetingIds 1981, 1903, 1894 and the 2026-08-18 notice —
  // and NONE carries a Call to the Audience item. Two of the four carry a
  // noticed PUBLIC HEARING (the PHA Annual Plan amendment, and one other).
  //
  // So the route to be heard is real and published, and it is item-scoped
  // rather than general. `commentPeriodDetail` leads with that scope, because
  // a reader who arrives expecting a general comment period would be wrong.
  //
  // NOTHING here is inferred from Mayor & Council's Call to the Audience,
  // even though the Board IS the Mayor and Council sitting as commissioners:
  // the Board's own agenda closes by saying the Mayor and Council REGULAR
  // meeting commences after this one adjourns, so that Call to the Audience
  // belongs to the meeting that follows, not to this one. Stating otherwise
  // would send a reader to speak at the wrong meeting.
  //
  // NOT a standing rule: no published PHA participation policy was found.
  // The rungs still open, named so the next hunt starts below them — the
  // Board's own bylaws, HUD's resident-participation requirements as the PHA
  // publishes them locally, and the City Clerk's records path.
  //
  // `verifiedAt` stays null on purpose: hylandcloud.com is a VENDOR portal,
  // and CLAUDE.md types a vendor portal as not-official however authentic the
  // records on it are.
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#public-housing-authority",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    bodyNames: ["Public Housing Authority Board of Commissioners"],
    commentPeriod: "YES",
    commentPeriodDetail:
      "Comment is taken on the items this board sets for public hearing — its annual and five-year housing plans, for instance. Its agendas carry no general call-to-the-audience item, so check the agenda for a hearing on what you came to speak about.",
    signup: null,
    writtenComment: null,
    attend:
      "Mayor and Council Chambers, City Hall, 255 W. Alameda, Tucson; doors open 30 minutes before the start. Meetings stream live on the City's YouTube channel.",
    timeLimit: null,
    sourceUrl:
      "https://tucsonaz.hylandcloud.com/221agendaonline/Documents/ViewDocument/agenda.pdf?meetingId=1981&documentType=1",
    collectedAt: "2026-08-18",
    verifiedAt: null,
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
     * CLOSED 2026-08-18 (g19, D25), on exactly the rung g18 named and did not
     * walk: the township code's council-procedure chapter, on eCode360.
     *
     * The rule is Township Code § 2-5.14, "Addressing the Council" (1971 Code
     * § 3-4N; Ord. No. 2-7-84; Ord. No. O-22-01), and the order of business at
     * § 2-5.7 puts "Open to the public" fifth and takes comment on ordinances
     * up for adoption separately. Both limits below are the code's own words.
     *
     * The three township-website pages g18 fetched (200 each, no comment
     * language) were not a wall and not an emptiness — the rule was simply
     * somewhere else. Recorded because it is the general lesson: a New Jersey
     * municipality's comment rule lives in its CODE far more reliably than on
     * its CivicPlus pages.
     *
     * `verifiedAt` stays null: ecode360.com is a third-party publisher, not
     * the township's own host, so it is a second-rung read under CLAUDE.md's
     * verification rule however faithful the text is.
     */
    commentPeriod: "YES",
    commentPeriodDetail:
      "A portion of every regular and special meeting is open for public comment — it sits fifth on the order of business, after the ordinances up for adoption. Ordinances being adopted take their own comment before that.",
    signup:
      "No advance sign-up. Ask the presiding officer to recognize you, then give your name and address out loud.",
    writtenComment: null,
    attend: null,
    timeLimit:
      "Three minutes during the regular public portion; two minutes when speaking on an ordinance outside it. The presiding officer may grant more.",
    sourceUrl: "https://ecode360.com/33531816",
    collectedAt: "2026-08-18",
    verifiedAt: null,
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    ocdId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    /*
     * THE WALL FELL 2026-08-18 (g19, D25). g18 recorded a 403 at rung 2 and
     * rung 3 and named rungs 4, 5, 6 and 11 as next. Rung 4 was enough:
     * **curl, with the same identified User-Agent that got the 403, is served
     * HTTP 200** — so it was a TLS-fingerprint filter, exactly the class curl
     * beat in the f session, and not an egress or header problem.
     *
     * The walk, all with an identified User-Agent carrying a contact address:
     *   rung 4, `/` — HTTP 200, 80,561 bytes. The wall is fingerprint-only.
     *   rung 4, `/selectboard` — HTTP 200, 90,511 bytes. Carries a link
     *     titled "Selecboard Public Input Rules of Participation" (the
     *     town's own typo), which is the rule.
     *   rung 9, the PDF behind it — HTTP 200, 115,680 bytes, one page, dated
     *     May 12, 2025. Every field below is read from it.
     *   rung 9, the request form — HTTP 200, 95,965 bytes; it confirms the
     *     Wednesday 10 a.m. deadline in its own footer.
     *
     * STILL WALLED, recorded rather than smoothed over: the deep paths
     * `/administration/...` and `/minutes-and-agendas` return 403 even to
     * curl, so the filter is path-scoped as well as fingerprint-scoped. That
     * cost nothing here because the rule was reachable another way, and it is
     * written down so the next session does not rediscover it.
     *
     * FOUND ON THE WAY, and it is worth more than this row: the walled
     * agendas path 302-redirects to `newburynh.civicweb.net`, a CivicWeb
     * portal (ladder rung 12) that answers HTTP 200. Newbury's meetings have
     * a vendor platform underneath and nothing in this repo knew it.
     *
     * The time limit is the honest gap: the rule says the Chairperson HAS THE
     * RIGHT to set time limits and publishes no number, so `timeLimit` is
     * null and the detail says who decides. A plausible number here would be
     * a fabrication about a real town.
     */
    commentPeriod: "YES",
    commentPeriodDetail:
      "There is a Public Input section on the agenda, and the Selectboard may keep comment to it. On an agenda item, you may speak when the Chair invites comment on it. On anything else, speak during public comment time — give your name and your topic first; the Chair may put the issue on a future agenda or send it to the Town Administrator rather than take it up on the spot. Newbury is direct about the limit: the public does not have a right to speak at Selectboard meetings unless the Selectboard opens Public Input.",
    signup:
      "To be put on the agenda, send the Request for Appointment with Selectboard form to the Selectboard's office — by mail, by email or in person — no later than 10:00 a.m. on the Wednesday before the meeting. Submitting it does not guarantee a slot on the next agenda.",
    writtenComment:
      "Attach any background material to the appointment request form.",
    attend: null,
    // The rule states the Chairperson may set limits and publishes no
    // number, so none is stated here. Never inferred from a neighbouring
    // town's rule.
    timeLimit: "No published limit — the Chairperson sets time limits for public comment.",
    sourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/uploads/pubic_input_rules_of_participation.pdf",
    collectedAt: "2026-08-18",
    verifiedAt: "2026-08-18",
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
