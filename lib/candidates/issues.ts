/**
 * **Stated positions, mapped to candidates, per issue** — tracker **P02**.
 *
 * P02's whole sentence is four words long and every one of them is load-
 * bearing: *stated* positions (their words, not our reading), *mapped* to
 * candidates (never scored), *sourced* (a quote and a link, always), *per
 * issue* (never totalled).
 *
 * ## NO COMPOSITE SCORE, and why that is structural rather than a preference
 *
 * There is no function in this file that takes a candidate and returns a
 * number. There is no ordering of candidates anywhere. A per-issue answer is
 * the whole output shape, and it is a shape that CANNOT be summed: the
 * answers are `MATCHED` / `SEARCHED_NOTHING_MATCHED` / `NOTHING_COLLECTED`,
 * and there is no arithmetic over those three that means anything.
 *
 * That is deliberate. A composite ranks candidates, and ranking candidates
 * is a vote recommendation with extra steps — which this product does not
 * make even when it would be well-sourced, transparent and explainable,
 * because the transparency of the method was never the issue.
 *
 * ## Equal effort, in code
 *
 * `positionsFor` runs the identical issue list over every candidate it is
 * given. There is no path by which one candidate gets more issues searched
 * than another, and `SEARCHED_NOTHING_MATCHED` is a first-class answer that
 * renders — so a candidate with fewer matched issues renders as a candidate
 * who has published less on their own site, with the pages and dates we
 * searched named. A thin card tracks incumbency and campaign professionalism
 * rather than merit, and the surface says which of the three things happened
 * rather than leaving a blank to be read as absence.
 *
 * ## The vocabulary is curated, and phrases are multi-word by preference
 *
 * The same discipline the agenda topics use: "housing" alone matches "public
 * housing authority" in a boilerplate footer, and one loose word turns a
 * search into noise a reader has to filter for us. A phrase that produces
 * junk is removed here, in one author-reviewable table, and nothing outside
 * this file may add one.
 */

export interface CandidateIssue {
  id: string;
  /** What the reader called it, for the answer's own sentence. */
  label: string;
  /** Phrases to look for in the candidate's own published text, lowercased. */
  phrases: readonly string[];
}

export const CANDIDATE_ISSUES: readonly CandidateIssue[] = [
  {
    id: "housing",
    label: "housing costs and homebuilding",
    phrases: [
      "affordable housing",
      "housing costs",
      "cost of housing",
      "homeownership",
      "rent is too",
      "housing supply",
      "build more homes",
      "zoning reform",
    ],
  },
  {
    id: "health-care",
    label: "health care and prescription costs",
    phrases: [
      "health care costs",
      "healthcare costs",
      "prescription drug",
      "medicaid",
      "medicare",
      "affordable care act",
      "health insurance",
    ],
  },
  {
    id: "schools",
    label: "schools and education funding",
    phrases: [
      "public schools",
      "school funding",
      "teacher pay",
      "student debt",
      "school choice",
      "early childhood education",
    ],
  },
  {
    id: "taxes",
    label: "taxes",
    phrases: [
      "tax cuts",
      "tax increase",
      "property taxes",
      "income tax",
      "tax code",
      "tax relief",
    ],
  },
  {
    id: "immigration",
    label: "immigration and the border",
    phrases: [
      "immigration",
      "border security",
      "the border",
      "asylum",
      "deportation",
      "path to citizenship",
    ],
  },
  {
    id: "abortion",
    label: "abortion and reproductive rights",
    phrases: [
      "reproductive rights",
      "reproductive freedom",
      "abortion",
      "roe v. wade",
      "roe v wade",
    ],
  },
  {
    id: "guns",
    label: "guns",
    phrases: [
      "gun violence",
      "second amendment",
      "gun safety",
      "assault weapon",
      "background check",
      "concealed carry",
    ],
  },
  {
    id: "energy",
    label: "energy and the climate",
    phrases: [
      "clean energy",
      "renewable energy",
      "climate change",
      "climate crisis",
      "energy costs",
      "fossil fuel",
      "energy independence",
    ],
  },
  {
    id: "water",
    label: "water",
    phrases: [
      "water supply",
      "drought",
      "colorado river",
      "groundwater",
      "water rights",
      "drinking water",
    ],
  },
  {
    id: "veterans",
    label: "veterans",
    phrases: ["veterans", "the v.a.", "veterans affairs", "servicemembers"],
  },
  {
    id: "seniors",
    label: "Social Security and retirement",
    phrases: [
      "social security",
      "retirement security",
      // "seniors" alone was here and came out: a high school has seniors
      // too, and one loose word makes the reader filter our noise for us.
      "senior citizens",
      "older americans",
    ],
  },
  {
    id: "jobs",
    label: "jobs and wages",
    phrases: [
      "good-paying jobs",
      "good paying jobs",
      "minimum wage",
      "small businesses",
      "manufacturing jobs",
      "workers' rights",
      "right to organize",
    ],
  },
] as const;

export function issueById(id: string): CandidateIssue | null {
  return CANDIDATE_ISSUES.find((i) => i.id === id) ?? null;
}
