/**
 * The dates a voter plans around, per state — S2 §4b.
 *
 * Every row cites the official page it was read from, and a state with no
 * verified entry simply has none — the strip renders what exists and never
 * approximates. AZ and NH land here next session in the same shape; their
 * dates are already verified in `docs/state.md` §9 but are not entered until
 * their ballot surfaces ship, so the strip can never outrun the ballot.
 */

export interface DatedStep {
  /** What the reader can do or must do by then. */
  label: string;
  /** ISO date, or a short official phrase where no single date exists. */
  date: string;
  /** Detail worth one line, in the authority's terms. */
  detail: string | null;
}

export interface ElectionDates {
  state: string;
  electionDay: string;
  steps: DatedStep[];
  /** The official source every step above was read from. */
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
];

export function electionDatesFor(state: string): ElectionDates | null {
  return ELECTION_DATES.find((d) => d.state === state) ?? null;
}
