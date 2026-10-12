/**
 * Curated summaries of concluded meetings, only where the body's published minutes were read; each cites the minutes
 * document. Keyed by the source-namespaced meeting id.
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
