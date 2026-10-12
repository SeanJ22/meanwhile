import type { OcdId } from "../sources/types.ts";
import { currentCuratedReaderRecords } from "../civic-data/curated-reader-read-model.ts";
import {
  projectedCommentAccessFor,
  type CommentAccess,
} from "./comment-access-client.ts";

export type { CommentAccess } from "./comment-access-client.ts";

/**
 * How to be heard, per body: usually a standing rule of the body rather than a per-meeting field. Every
 * claim cites the page it was read from. `UNKNOWN` is a real value and the honest one for most bodies: a
 * comment period is never inferred from a meeting being public.
 *
 * Initial adoption/node:test evidence; production reads `comment-access`.
 */
export const COMMENT_ACCESS: CommentAccess[] = [
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

  // Each body carries its own rule, read from that body's own agenda. Where an agenda publishes no
  // per-speaker limit, `timeLimit` stays null; a timed agenda's slot for the public-comment item is not a
  // per-speaker limit.
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
    // The agenda publishes no per-speaker limit.
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

  // No general comment period: the agendas carry noticed public hearings only, so the route to be heard
  // is item-scoped. `verifiedAt` stays null because the records are on a vendor portal.
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
    // The calendar is the reader-facing route to the same record.
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

  // No rule found yet: the body's own page is the next step.
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
    ocdId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district",
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
    // `verifiedAt` stays null: the code is read from a third-party publisher, not the township's own host.
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
    // The rule lets the Chairperson set time limits and publishes no number, so `timeLimit` says who
    // decides.
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
  // No published comment rule found yet. UNKNOWN until one is read.
  {
    bodyId: "ocd-division/country:us/state:nj/county:morris#governing",
    ocdId: "ocd-division/country:us/state:nj/county:morris",
    // Evening meetings carry a public comment portion; work sessions do not unless the Director grants one.
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

export function currentCommentAccess(): readonly CommentAccess[] {
  const seed = COMMENT_ACCESS.map((value) => ({
    id: `comment-access:${value.bodyId}`,
    ...value,
  }));
  return currentCuratedReaderRecords("comment-access", seed)
    .map(({ id: _id, ...value }) => value as unknown as CommentAccess);
}

/**
 * The comment-access record for a meeting, if one is curated.
 *
 * A canonical body identity or unique explicit published-name alias is
 * required. A division with one held policy can still contain other bodies.
 */
export function commentAccessFor(
  ocdId: OcdId | null,
  bodyName?: string,
  bodyId?: string | null,
  projection?: readonly CommentAccess[],
): CommentAccess | undefined {
  let records = projection;
  if (!records) {
    try {
      records = currentCommentAccess();
    } catch {
      // A missing/unreachable comment-rule pointer withholds only this
      // optional family. It must not make the independent meetings corpus or
      // another source's Reader answer fail.
      records = [];
    }
  }
  return projectedCommentAccessFor(ocdId, bodyName, bodyId, records);
}
