export interface DatedStep {
  label: string;
  /** ISO date, or a short official phrase where no single date exists. */
  date: string;
  detail: string | null;
}

export interface ElectionDates {
  state: string;
  electionDay: string;
  steps: DatedStep[];
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
  verifiedAt: string | null;
}

export const ELECTION_DATES: ElectionDates[] = [
  {
    state: "NJ",
    electionDay: "2026-11-03",
    steps: [
      {
        label: "Mail ballots begin going out",
        date: "2026-09-19",
        detail: "County clerks begin mailing vote-by-mail ballots 45 days out (N.J.S.A. 19:63-5).",
      },
      {
        label: "Voter registration deadline",
        date: "2026-10-13",
        detail: "21 days before the election; evening registration 4–9 p.m. that day.",
      },
      {
        label: "Sample ballots mailed by",
        date: "2026-10-21",
        detail: "Mailed to registered voters on or before this date (N.J.S.A. 19:14-25).",
      },
      {
        label: "In-person early voting",
        date: "2026-10-24 – 2026-11-01",
        detail: null,
      },
      {
        label: "Vote-by-mail application deadline (by mail)",
        date: "2026-10-27",
        detail: "In person at the county clerk's office until 3:00 p.m. November 2.",
      },
      {
        label: "Election Day",
        date: "2026-11-03",
        detail: null,
      },
    ],
    sourceUrl:
      "https://www.nj.gov/state/elections/assets/pdf/chrons/2026-chron-general-election-0109.pdf",
    sourceOrg: "New Jersey Division of Elections",
    collectedAt: "2026-08-13",
    verifiedAt: "2026-08-13",
  },
  {
    state: "AZ",
    electionDay: "2026-11-03",
    steps: [
      {
        label: "Primary election (held)",
        date: "2026-07-21",
        detail:
          "Canvassed August 6, 2026. The general-election candidate list narrows to the primary winners when the Secretary of State publishes it.",
      },
      {
        label: "Voter registration deadline",
        date: "2026-10-05",
        detail: "11:59 p.m.",
      },
      {
        label: "Early voting begins",
        date: "2026-10-07",
        detail: null,
      },
      {
        label: "Election Day",
        date: "2026-11-03",
        detail: null,
      },
    ],
    sourceUrl: "https://azsos.gov/elections/ballot-measures",
    sourceOrg: "Arizona Secretary of State",
    collectedAt: "2026-08-14",
    verifiedAt: "2026-08-14",
  },
  {
    state: "NH",
    electionDay: "2026-11-03",
    steps: [
      {
        label: "Town Election (town and school matters)",
        date: "2026-03-10",
        detail:
          "New Hampshire's town-meeting system decides town offices and school-district matters in March, not November.",
      },
      {
        label: "State primary",
        date: "2026-09-08",
        detail: "Decides which filed candidates reach the November ballot.",
      },
      {
        label: "Election Day",
        date: "2026-11-03",
        detail: null,
      },
    ],
    sourceUrl:
      "https://www.sos.nh.gov/sites/g/files/ehbemt561/files/inline-documents/sonh/political-calendar-2026-2027-tops-pages-of-calendar-landscape_0.pdf",
    sourceOrg: "New Hampshire Secretary of State (2026–2027 political calendar)",
    collectedAt: "2026-08-14",
    verifiedAt: "2026-08-14",
  },
];

export function electionDatesFor(state: string): ElectionDates | null {
  return ELECTION_DATES.find((d) => d.state === state) ?? null;
}
