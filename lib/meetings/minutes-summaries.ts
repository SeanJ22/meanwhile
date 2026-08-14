/**
 * Curated plain-language "what happened" summaries for CONCLUDED meetings
 * (6a, 2026-08-17) — the past-meeting card's dropdown.
 *
 * Rules, same as every curated register:
 * - a summary exists ONLY where the body's published minutes were read;
 *   every entry cites the minutes document it paraphrases and the date it
 *   was read;
 * - the summary is ours and labeled ours; it paraphrases, never evaluates;
 * - a concluded meeting with no entry renders the honest state instead
 *   ("minutes not posted yet" / "not yet summarized"), never a guess.
 *
 * Keyed by the source-namespaced meeting id from the snapshot.
 */

export interface MinutesSummary {
  meetingId: string;
  /** Our paraphrase of the minutes — plain words, no evaluation. */
  summary: string;
  /** The minutes document this paraphrases. */
  minutesUrl: string;
  sourceOrg: string;
  readAt: string;
}

export const MINUTES_SUMMARIES: MinutesSummary[] = [
  // First entries 2026-08-18 (4c). The seed worklist was walked and the
  // hunt recorded: of the concluded window, TWO meetings had published
  // minutes to read — the rest were checked and render the honest not-yet
  // state (TUSD Id=485 and Sunnyside Id=163 portal minutes exist but are
  // unpublished/hidden; Newbury's CivicWeb page hosts the agenda only and
  // the town site 403'd the minutes path this run; OnBase surfaces no
  // minutes document). Minutes lag sittings by design — they are approved
  // at the next meeting — so recency alone is never a defect.
  {
    meetingId: "legistar:pima:1822",
    summary:
      "Per the Board's posted meeting-summary report (full minutes post after approval): the Board appointed Jorge Soto as Pima County Treasurer (4–1, one abstention) after a first motion for a different candidate died without a second. It removed all five members of the county's Industrial Development Authority board without cause, approved a new structure for that authority, and elected new members. It also approved the River Overlook rezoning and comprehensive-plan amendment on West River Road (5–0) and two cell-tower permits, updated the county's air-quality code to match current federal rules, denied a wholesale liquor license on East Cabeza De Vaca Street (zoning there does not allow wholesale), and — sitting as the Library District board — accepted a $7,500 grant for a local-news pilot program (4–1), among other business.",
    minutesUrl:
      "https://legistar.granicus.com/pima/meetings/2026/7/1822_M_Board_of_Supervisors_26-07-28_Meeting_Summary.pdf",
    sourceOrg: "Pima County Clerk of the Board",
    readAt: "2026-08-14",
  },
  {
    meetingId: "iqm2:morriscountynj:2236",
    summary:
      "The Board approved the minutes of its July 8 meetings and three permission requests, including street closings for Boonton's Labor Day parade. It adopted resolutions including an amendment extending the historic-preservation easement on the Pompton Plains Railroad Station to 2056. Two of the seven commissioners were absent. During public comment, residents raised the county's ADA grievance process and asked for updates on a homicide investigation. The Board opened with condolences on the death of longtime Boonton official Cy Wekilsky, among other business.",
    minutesUrl:
      "https://morriscountynj.iqm2.com/Citizens/FileOpen.aspx?Type=12&ID=3201&Inline=True",
    sourceOrg: "Morris County Clerk of the Board",
    readAt: "2026-08-14",
  },
];

export function minutesSummaryForMeeting(
  meetingId: string,
): MinutesSummary | null {
  return MINUTES_SUMMARIES.find((s) => s.meetingId === meetingId) ?? null;
}
