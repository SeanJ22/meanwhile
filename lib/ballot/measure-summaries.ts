/**
 * Hand-curated plain-language summaries of ballot measures (4d).
 *
 * The rules, each of them load-bearing:
 * - **Written ONLY from the official source text on the page** — the
 *   Legislative Council analysis each row cites. Nothing here came from
 *   news coverage, advocacy material, or general knowledge.
 * - **What it does, never whether it's good.** No advocacy vocabulary; a
 *   test holds this mechanically (tests/measure-summaries.test.ts).
 * - **Rendered ABOVE the official text, clearly labeled, never replacing
 *   it.** The label on the surface says "read the official text below".
 * - **Every row cites the text it summarizes** — `summarizesUrl` must
 *   match the analysis record for the same contest, asserted in tests.
 *
 * The generated-at-runtime version of this belongs to the natural-language
 * track and its A07 gates; these are curated data, reviewed like any other
 * curated row.
 */

export interface MeasureSummary {
  contestId: string;
  /** The 15-year-old register: what the measure would do. */
  summary: string;
  /** The official text this was written from — the citation. */
  summarizesUrl: string;
  writtenAt: string;
  /**
   * WHICH store the citation resolves against (BAL-46, 2026-09-02).
   *
   * The eleven statewide propositions are written from the Arizona Legislative
   * Council's adopted analysis, and `az-analyses-2026.json` is where that text
   * lives — the default. The LOCAL measures — a county expenditure-base
   * adjustment, three school-district budget overrides — have no Legislative
   * Council analysis and never will; their authority is a county board and
   * three school boards. Their summary is written from the measure's OWN held
   * authority text (the ballot question and the authority's published
   * statement, in `data/ballot/az-pima-2026.json`), so its citation resolves
   * against the measure's provenance, not the analyses store. The neutrality
   * rules are identical for both — describe, never advocate; write only from
   * the cited text — which is why this is one store with two citation sources
   * rather than two stores.
   */
  citation?: "azleg-analysis" | "measure-source";
}

const WRITTEN_AT = "2026-08-13";

export const MEASURE_SUMMARIES: MeasureSummary[] = [
  {
    contestId: "ballot-az-pima:prop-141",
    summary:
      "Would change the Arizona Constitution so the state and its cities, towns, and counties can't charge a tax or fee based on how many miles you drive, and can't track or limit your driving miles unless you agree to it. It wouldn't cover government vehicles, or commercial trucks that cross state lines under an interstate fuel-tax agreement.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/adopted%20analysis%20SCR1004%20-%202025.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-142",
    summary:
      "Would change the Arizona Constitution so state and local governments — including public schools, universities, and community colleges — can't favor or disadvantage anyone based on race, sex, color, ethnicity, or national origin in public jobs, education, or contracting. It would also bar them from making people state support for race-based diversity, equity, and inclusion ideas to get a job, admission, or a scholarship; bar spending public money on offices at public schools whose role is promoting race-based preferential treatment; and bar discipline policies that treat students or employees differently by race or ethnicity. The proposition lists specific exceptions.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/Adopted%20analysis%20HCR%202044%20-%202026.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-143",
    summary:
      "Would change the Arizona Constitution so school districts can't use public money, staff time, or district communication systems to support unions, and can't take union dues out of employees' paychecks. Each school district employee would negotiate their own pay, benefits, and working conditions — the state and school districts would be barred from negotiating with a union on employees' behalf. It would override existing agreements and take effect January 1, 2028.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/Adopted%20analysis%20HCR2040%20-%202026.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-144",
    summary:
      "Would change the Arizona Constitution on elections: only U.S. citizens could register and vote; voters would show valid government-issued ID before casting a ballot in every election; voters would get the option to have their ballot counted at their voting place on election day; and foreign nationals couldn't spend money to influence Arizona elections. It would let the legislature and the voters pass election laws — including on early and mail voting — if the laws are rationally connected to a legitimate state interest, and would apply to elections from January 1, 2028.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/Adopted%20analysis%20HCR%202001%20-%202026.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-145",
    summary:
      "Would change the Arizona Constitution so the state can't take money out of a state-run scholarship account belonging to the child of a military family — someone serving on active duty, or killed in the line of duty — where the account can pay tuition at universities, community colleges, or accredited private colleges. Any later law violating this rule would be entirely void. Closing an account for reasons like illegal activity, choosing to close it, graduating, or not enrolling for four years after high school wouldn't count as taking the money.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/Adopted%20analysis%20HCR2048%20-%202026.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-212",
    summary:
      "Would change Arizona's school-voucher (ESA) program. Starting in the 2027–2028 school year, families making over $150,000 a year couldn't join (children with disabilities, and children eligible before 2022, excepted). Unspent account money would be transferred out each year, mostly to a classroom fund. Schools, tutoring businesses, and individual tutors would have to register with the state, pay annual fees, and fingerprint staff who are alone with students before being paid with ESA money — and ESA money couldn't buy items designated noneducational or luxury goods. The Attorney General would enforce the rules, and the committee that sponsored the proposition could sue participating families and schools over violations.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/Adopted%20analysis%20I-09-2026.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-316",
    summary:
      "Would limit city and town taxes on groceries — food and sealed nonalcoholic drinks meant for home use. New grocery taxes and any rate increases would need voter approval and couldn't go above two percent; a city already at two percent or more couldn't raise its rate at all; and no new grocery tax or increase could happen between June 30, 2025 and June 30, 2027.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/Adopted%20analysis%20HCR2021%20-%202025.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-317",
    summary:
      "Would declare that drug cartels — groups engaged in human smuggling, drug trafficking for profit, or terrorism — are terrorist organizations, and would require the Arizona Department of Homeland Security to use all lawful means within its authority to address threats they pose. It states that it does not support an asylum claim under federal law.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/Adopted%20analysis%20HCR%202055%20-%202025.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-318",
    summary:
      "Would require school and college sports teams in Arizona to be designated male, female, coeducational, or mixed, and would prohibit athletes whose original birth certificate records them as male from playing on female teams. Restrooms, locker rooms, and shower rooms tied to athletics could only be used according to the sex recorded on the athlete's original birth certificate. It would also expand who can sue over alleged violations.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/Adopted%20analysis%20HCR2003%20-%202026.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-319",
    summary:
      "Would ban speed and red-light cameras (photo enforcement) unless a local government already has a camera contract in place before December 31, 2026. A local government with an existing contract would have to ask its voters at the next general election whether to keep the cameras: a no vote shuts them down within 90 days; a yes vote keeps them for 10 years, with a fresh vote every 10 years after that.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/ballot%20analysis%20SCR1004%20-%202026.pdf",
    writtenAt: WRITTEN_AT,
  },
  {
    contestId: "ballot-az-pima:prop-320",
    summary:
      "Would require large Arizona school districts — 7,500 or more students, or any district with a school in a county of 500,000 or more people — to spend at least 60 percent of their operating money on direct classroom instruction, with the state auditor general defining the terms. Districts below that line would have to raise the share each year, and districts that don't comply would lose part, and eventually all, of their classroom site fund allocation unless granted a waiver.",
    summarizesUrl:
      "https://www.azleg.gov/alispdfs/Council/2026BallotMeasures/Adopted%20analysis%20SCR1032%20-%202026.pdf",
    writtenAt: WRITTEN_AT,
  },

  /*
   * BAL-46 (2026-09-02): the LOCAL measures get the same plain-language layer
   * the statewide ones have. Each is written ONLY from the measure's own held
   * authority text — the ballot question and, where held, the authority's
   * published statement — in `data/ballot/az-pima-2026.json`, and cites that
   * source (`citation: "measure-source"`). What it does, never whether it is
   * good; every figure is the authority's own.
   */
  {
    contestId: "ballot-az-pima:prop-425",
    summary:
      "Would let Pima County permanently raise the state-set limit on how much money it is allowed to spend — its “expenditure base” — by $70 million, with that amount adjusted every year afterward for population growth and inflation. The county says that if voters approve it, the spending limit for 2027–28 would rise by about $610 million, from about $817 million to about $1.43 billion. A YES vote lets the county raise its 1979–80 base limit; a NO vote does not. The Pima County Board of Supervisors put it on the ballot.",
    summarizesUrl:
      "https://content.civicplus.com/api/assets/az-pimacounty/55aa379c-bc22-47fe-8b7c-d10dab0ade8c/permanent-base-adjustment-proposition-pdf.pdf",
    writtenAt: WRITTEN_AT,
    citation: "measure-source",
  },
  {
    contestId: "ballot-az-pima:prop-423",
    summary:
      "Would let the Vail Unified School District keep spending up to 12.5% more than the state's revenue control limit each year, for 2027/2028 and the next six years. The district says this continues about $5.1 million above the alternate budget for 2027/2028, at an estimated $1.61 per $100 of a property's secondary assessed value. A YES vote continues the override; a NO vote ends it.",
    summarizesUrl: "https://www.schools.pima.gov/",
    writtenAt: WRITTEN_AT,
    citation: "measure-source",
  },
  {
    contestId: "ballot-az-pima:prop-428",
    summary:
      "Would let the Sahuarita Unified School District keep spending up to 15% more than its normal day-to-day “maintenance and operations” budget. Only voters who live in the district decide it, at the November 3, 2026 election. A YES vote continues that extra spending; a NO vote ends it.",
    summarizesUrl: "https://www.schools.pima.gov/",
    writtenAt: WRITTEN_AT,
    citation: "measure-source",
  },
  {
    contestId: "ballot-az-pima:prop-429",
    summary:
      "Would let the Tanque Verde Unified School District keep spending up to 15% more than its normal day-to-day “maintenance and operations” budget. Only voters who live in the district decide it, at the November 3, 2026 election. A YES vote continues that extra spending; a NO vote ends it.",
    summarizesUrl: "https://www.schools.pima.gov/",
    writtenAt: WRITTEN_AT,
    citation: "measure-source",
  },
];

export function summaryForContest(contestId: string): MeasureSummary | null {
  return MEASURE_SUMMARIES.find((s) => s.contestId === contestId) ?? null;
}
