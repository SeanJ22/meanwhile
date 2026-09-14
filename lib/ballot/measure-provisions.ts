/**
 * Ballot measures, decomposed into their CONTESTED PROVISIONS (P01).
 *
 * ## Why a measure is not one question
 *
 * CLAUDE.md: "Measures are decomposed into contested provisions — funding
 * mechanism, spending program, oversight, sunset — and reactions attach to
 * provisions, not to the measure as a whole." A reader can want the classroom
 * spending floor and not want the penalty that enforces it; asking "do you
 * support Proposition 320?" throws that away and returns a number that means
 * nothing to a buyer and nothing to the reader. Proposition 212 alone carries
 * eleven separately-contested provisions in the Legislative Council's own
 * enumeration.
 *
 * ## Where every word here comes from
 *
 * The same rules as `measure-summaries.ts`, because these are the same kind of
 * claim about a real measure:
 *
 * - **Written ONLY from the official analysis each row cites** — the adopted
 *   impartial analysis of the Arizona Legislative Council, verbatim on the
 *   page below. Nothing here came from news coverage, advocacy material, or
 *   general knowledge.
 * - **What it does, never whether it is good.** No advocacy vocabulary, held
 *   mechanically in `tests/measure-provisions.test.ts`.
 * - **The analysis's OWN enumeration is the decomposition.** Where the
 *   Legislative Council numbered the parts, those numbers are the provisions.
 *   Nothing is split finer than the official text splits it, and nothing is
 *   merged that the official text kept apart — a provision boundary this
 *   product invented would be this product editorialising with a scalpel.
 * - **An unenumerated catch-all is NOT made into a provision.** Proposition
 *   142's analysis ends "would provide for specified exceptions to these
 *   prohibitions" without listing them. A provision reading "there are
 *   exceptions, and we do not know what they are" would be a reaction target
 *   attached to nothing. It stays in the verbatim text on the page, where the
 *   reader can see exactly as much as the state published.
 *
 * ## FIVE kinds — the author's ruling 7C, 2026-08-18
 *
 * P01 shipped with the four CLAUDE.md names and SUNSET widened to mean THE
 * MEASURE'S WHOLE CLOCK — start, end and renewal — because a strict reading
 * left provisions with no kind at all. That widening is now reversed on the
 * author's ruling, and the reason is not tidiness. **Kinds are the reaction
 * bucketing.** A bucket meaning both "does this expire" and "when does this
 * start" collects answers to two different questions and reports them as one
 * number, which is unreadable to a buyer; and a provision with no kind
 * captures no reaction at all, which is signal deleted rather than deferred.
 *
 * SUNSET now means EXPIRY AND RENEWAL ONLY. The fifth kind, `START`, means the
 * date a measure's rules begin to apply.
 *
 * **The name is derived from the two provisions, not chosen and then fitted.**
 * Re-deriving all four SUNSET assignments against the narrowed definition
 * leaves exactly two with no kind:
 *
 * - `prop-143#starts-2028` — "The measure would apply beginning January 1,
 *   2028."
 * - `prop-144#starts-2028` — "It would apply to all elections taking place on
 *   or after January 1, 2028."
 *
 * Both say the same thing in the analysis's own words: WHEN THE MEASURE STARTS
 * APPLYING. Nothing expires and nothing is renewed in either. `START`, reader
 * label "When it starts", is what those two sentences say and nothing more.
 * It encodes no stance — a start date is neither good nor bad, and a kind
 * whose name implied otherwise would tilt every reaction it collected, which
 * is the vote-recommendation ban arriving through a taxonomy's back door.
 *
 * The other two stay SUNSET, and the reasoning is written down because the
 * pre-narrowing header named a different pair as the orphans:
 *
 * - `prop-316#freeze-window` — the freeze runs "between June 30, 2025 and June
 *   30, 2027". It ENDS on a stated date; a rule that stops is exactly what a
 *   sunset is, whatever the measure around it does.
 * - `prop-319#ten-year-renewal` — ten years, then another vote. Renewal, in
 *   the strict sense.
 *
 * Every non-SUNSET provision was re-read for the same shape. Three carry dates
 * and none of them moves, because in each the date QUALIFIES a substantive
 * rule rather than being the provision's subject: `prop-145#later-laws-void`
 * (the subject is voiding later laws), `prop-320#half-percent-a-year` (the
 * subject is the catch-up requirement) and `prop-316`'s two food-tax
 * provisions (the date says which jurisdictions are covered).
 *
 * ## Not every measure has all four, and that is the finding
 *
 * Proposition 141 has no oversight provision and no clock. Proposition 317 has
 * three provisions in total. Manufacturing a funding provision for a measure
 * that funds nothing would be inventing a claim about a real measure, which is
 * the one thing this product cannot do. The count per kind is asserted in the
 * test as measured, never as expected.
 *
 * **Proposition 141 gains nothing from the fifth kind, and that is checked
 * rather than assumed.** Its three provisions are the mileage-tax
 * prohibition, the monitoring prohibition and two exceptions; none of them
 * carries a date, so it still has no clock of any sort. A new kind that
 * quietly filled a measured absence would be manufacturing a claim, and
 * `tests/measure-provisions.test.ts` asserts 141 has neither OVERSIGHT, SUNSET
 * nor START.
 */

import { analysisForContest } from "./analyses.ts";

export type ProvisionKind =
  | "FUNDING"
  | "PROGRAM"
  | "OVERSIGHT"
  | "SUNSET"
  | "START";

/** The reader-facing name of each kind. No identifier reaches a reader. */
export const PROVISION_KIND_LABEL: Readonly<Record<ProvisionKind, string>> = {
  FUNDING: "Money",
  PROGRAM: "What it does",
  OVERSIGHT: "Who checks it",
  SUNSET: "When it ends or must be renewed",
  START: "When it starts",
};

export interface MeasureProvision {
  /**
   * The reaction target key, and the reason this file exists at all.
   *
   * Shaped `<contestId>#<slug>` so a reaction row names the measure and the
   * provision in one column, and so a provision that is later re-worded keeps
   * its identity. NEVER renumber one: a changed id silently orphans every
   * reaction already collected against it.
   */
  id: string;
  contestId: string;
  kind: ProvisionKind;
  /** A short plain-language name for the provision. The 15-year-old test. */
  label: string;
  /** What this provision would do. Plain language, from the cited analysis. */
  what: string;
  /** The official analysis this was written from — the citation. */
  citesUrl: string;
  writtenAt: string;
}

const WRITTEN_AT = "2026-08-18";

const AZ = "ballot-az-pima:";

/**
 * The citation for a provision is READ OFF THE ANALYSIS RECORD, never typed.
 *
 * The first draft of this file hand-copied eleven analysis URLs and got SIX of
 * them wrong. A plausible URL is not a URL, and a citation that does not
 * resolve is the same failure as a generated position wearing a footnote. The
 * record the page already renders verbatim is the only place the address can
 * honestly come from, so it is the only place this reads it from. A contest
 * with no analysis record gets no provisions rather than an invented link, and
 * tests/measure-provisions.test.ts refuses that state loudly.
 */
function citationFor(prop: string): string {
  const record = analysisForContest(AZ + prop);
  if (record === null) {
    throw new Error(
      "measure-provisions: no analysis record for " +
        AZ +
        prop +
        ", so its provisions have nothing to cite. Fix the data or remove the " +
        "provisions - never invent the URL.",
    );
  }
  return record.analysisUrl;
}

function p(
  prop: string,
  slug: string,
  kind: ProvisionKind,
  label: string,
  what: string,
): MeasureProvision {
  return {
    id: `${AZ}${prop}#${slug}`,
    contestId: `${AZ}${prop}`,
    kind,
    label,
    what,
    // Citation authority belongs to the promoted ballot projection. Resolve it
    // only when a Reader actually renders/serializes this provision, after that
    // request has initialized the canonical projection. Resolving here would
    // make importing the route depend on a live runtime store during `next
    // build`; copying a bootstrap URL here would instead reopen tracked data as
    // an implicit production authority.
    get citesUrl(): string {
      return citationFor(prop);
    },
    writtenAt: WRITTEN_AT,
  };
}

export const MEASURE_PROVISIONS: MeasureProvision[] = [
  /* ── Proposition 141 · prohibit tax; monitoring; vehicle mileage ───────── */
  p(
    "prop-141",
    "no-mileage-tax",
    "FUNDING",
    "No tax or fee based on miles driven",
    "The state, and any county, city, town or other local government, could not charge a tax or fee based on the number of miles a person drives.",
  ),
  p(
    "prop-141",
    "no-mileage-monitoring",
    "PROGRAM",
    "No tracking your miles without your consent",
    "Those same governments could not monitor or limit how many miles a person drives unless that person voluntarily agrees to it.",
  ),
  p(
    "prop-141",
    "exceptions",
    "PROGRAM",
    "Two exceptions",
    "It would not cover commercial vehicles that operate in more than one state where an interstate agreement exists for reporting fuel taxes or registration fees, and it would not cover vehicles owned and operated by the state or a local government.",
  ),

  /* ── Proposition 142 · preferential treatment; discrimination ──────────── */
  p(
    "prop-142",
    "no-preference-or-discrimination",
    "PROGRAM",
    "No preferences and no discrimination by race, sex or national origin",
    "The state, cities, towns, counties, public universities, community colleges, school districts and other local governments could not give preferential treatment to, or discriminate against, people or groups based on race, sex, color, ethnicity or national origin in public employment, education or contracting — even where it is part of a federal program.",
  ),
  p(
    "prop-142",
    "no-required-endorsement",
    "PROGRAM",
    "No required statements of support",
    "They could not require applicants, employees, students or contractors to endorse or support race-based preferential treatment as a condition of admission, graduation, hiring, promotion, certification, contracting or a scholarship. That includes asking someone for a written or spoken statement supporting the race-based diversity, equity and inclusion ideas the measure identifies, asking them to confess race-based privilege or discuss their own or others' race, preferring someone for opinions they expressed if those opinions are based on race or ethnicity, and requiring a training or course that promotes those ideas.",
  ),
  p(
    "prop-142",
    "no-public-money-for-offices",
    "FUNDING",
    "No public money for offices that promote preferences",
    "They could not spend public money to run or contract for an office or position at a public school, college or university whose job is promoting preferential treatment or discrimination based on race or ethnicity — including spending to influence who is on the faculty or in the student body, or on trainings, programs, activities and policies designed with reference to race, ethnicity, intersectionality, gender identity or sexual orientation, except as the measure otherwise provides.",
  ),
  p(
    "prop-142",
    "no-race-based-discipline",
    "PROGRAM",
    "No discipline policies that differ by race",
    "They could not use any disciplinary policy or practice that treats students or employees differently on the basis of race or ethnicity.",
  ),

  /* ── Proposition 143 · school districts; labor organizations ───────────── */
  p(
    "prop-143",
    "no-public-resources-for-unions",
    "FUNDING",
    "No public money or resources for union operations",
    "A school district could not use public money or public resources to support a labor organization's operations, and could not use them to carry out labor organization activities during working hours.",
  ),
  p(
    "prop-143",
    "no-dues-deduction",
    "FUNDING",
    "No union dues taken out of a paycheck",
    "A school district could not deduct any payment for labor organization membership dues from an employee's paycheck.",
  ),
  p(
    "prop-143",
    "no-district-communications",
    "PROGRAM",
    "No district communication systems for union material",
    "A school district could not give access to its internal communications systems to distribute labor organization recruiting information or political materials, and district employees could not distribute written, printed or digital communications on a labor organization's behalf in a way that uses public resources.",
  ),
  p(
    "prop-143",
    "individual-negotiation",
    "PROGRAM",
    "Each employee negotiates for themselves",
    "Every school district employee would have the right to negotiate their own pay, benefits and working conditions, and the state and its local governments could not negotiate an agreement with a labor organization about school district employees' terms and conditions of employment.",
  ),
  p(
    "prop-143",
    "supersedes-agreements",
    "PROGRAM",
    "Existing agreements would be overridden",
    "It would supersede any school district contract, memorandum of understanding, meet-and-confer agreement, policy, ordinance or other written or spoken agreement.",
  ),
  p(
    "prop-143",
    "starts-2028",
    "START",
    "Starts January 1, 2028",
    "The measure would apply beginning January 1, 2028.",
  ),

  /* ── Proposition 144 · citizenship; identification; early voting ───────── */
  p(
    "prop-144",
    "citizens-only",
    "PROGRAM",
    "Only U.S. citizens may register and vote",
    "It would reaffirm that only United States citizens may register to vote and vote in Arizona elections, and that Arizona elections are decided solely by the votes of eligible citizen voters.",
  ),
  p(
    "prop-144",
    "id-at-every-election",
    "PROGRAM",
    "Government-issued ID before casting a ballot",
    "Voters would have to present valid government-issued proof of identity before casting a ballot in every election, as prescribed by law.",
  ),
  p(
    "prop-144",
    "count-at-the-polls",
    "PROGRAM",
    "The option to have your ballot counted where you vote",
    "Voters would have to be given the option to have their ballot tabulated at their voting location on election day.",
  ),
  p(
    "prop-144",
    "no-foreign-money",
    "PROGRAM",
    "No foreign money in Arizona elections",
    "Foreign nationals could not contribute or spend money or anything of value to influence an Arizona election, and no person could accept such a contribution.",
  ),
  p(
    "prop-144",
    "standard-for-election-laws",
    "OVERSIGHT",
    "A standard future election laws would have to meet",
    "The people and the legislature could pass laws governing elections, including early voting and mail voting, if those laws are rationally connected to a legitimate state interest — the measure names timely and accurate results, efficient election administration, election security, and preserving public confidence in election integrity.",
  ),
  p(
    "prop-144",
    "legislature-funds-it",
    "FUNDING",
    "The legislature would have to pay for it",
    "The legislature would be required to appropriate any money necessary to carry the measure out.",
  ),
  p(
    "prop-144",
    "starts-2028",
    "START",
    "Applies to elections from January 1, 2028",
    "It would apply to all elections taking place on or after January 1, 2028.",
  ),

  /* ── Proposition 145 · military families; scholarship accounts ─────────── */
  p(
    "prop-145",
    "no-confiscation",
    "PROGRAM",
    "The state could not take back the money",
    "The state could not seize, transfer or otherwise take money from the scholarship account of a child of a military family — a child of someone serving or who has served on active duty, or who was killed in the line of duty — where the program is run by the state, treats such children who meet enrollment requirements as eligible, and lets the money be used for tuition or fees at state universities, community colleges, or private accredited colleges.",
  ),
  p(
    "prop-145",
    "later-laws-void",
    "OVERSIGHT",
    "A later law that breaks this would be void",
    "If the legislature passes a bill, or voters pass a ballot measure, on or after November 1, 2026 that violates those protections, the entire bill or measure would be void.",
  ),
  p(
    "prop-145",
    "not-confiscation",
    "PROGRAM",
    "What would not count as taking the money",
    "Closing an account because of illegal activity, closing it voluntarily, not renewing it, graduating from a college, or not enrolling in one for at least four years after finishing high school would not count as taking the money.",
  ),

  /* ── Proposition 212 · Protect Education Act ───────────────────────────── */
  p(
    "prop-212",
    "income-limit",
    "PROGRAM",
    "A $150,000 family income limit",
    "From the 2027-2028 school year, children who would otherwise qualify but whose annual family income is over $150,000 — adjusted each year, or a lower figure set by the legislature — could not enrol in the empowerment scholarship account program. The limit would apply no matter how many children are in a family, and would not apply to children who would have been eligible before 2022, including children with disabilities.",
  ),
  p(
    "prop-212",
    "one-year-if-unrenewed",
    "PROGRAM",
    "An unrenewed account closes after one year",
    "An account would stay open for one school year rather than three if the parent does not renew the contract.",
  ),
  p(
    "prop-212",
    "sweep-to-classroom-site-fund",
    "FUNDING",
    "Leftover account money moves to the classroom site fund",
    "Each July 1 the Arizona Department of Education would take whatever money is left in a student's account and transfer 90 percent of it to the classroom site fund — every two years rather than yearly for a student with a disability — with a portion going to the Department or the State Board of Education to carry out and enforce the measure.",
  ),
  p(
    "prop-212",
    "sponsor-may-sue",
    "OVERSIGHT",
    "The sponsoring committee could sue families and schools",
    "The political action committee that sponsored the measure would have the power to sue the families and private schools taking part in the program over any violations of it.",
  ),
  p(
    "prop-212",
    "permanent-disqualification",
    "OVERSIGHT",
    "Permanent disqualification for intentional misspending",
    "A parent, student or account holder found to have intentionally misspent account money would be permanently barred from the program, the account would be closed, and any money left in it returned to the state.",
  ),
  p(
    "prop-212",
    "quarterly-reports-and-ag",
    "OVERSIGHT",
    "Quarterly public reports and Attorney General enforcement",
    "The Department of Education would file quarterly reports with the attorney general and post each one on its website. The attorney general would enforce the rules for the money, and anything recovered as restitution would go into the classroom site fund.",
  ),
  p(
    "prop-212",
    "repeal-burden-of-proof",
    "OVERSIGHT",
    "Removes a court protection for participating schools",
    "It would repeal today's requirement that, when a state law about the program is challenged in court, the state must prove the challenged law is necessary and does not put an undue burden on qualified schools.",
  ),
  p(
    "prop-212",
    "what-money-can-buy",
    "PROGRAM",
    "New limits on what the money can be spent on",
    "Tuition and fees could only go to schools that register with the Department and meet requirements including fingerprinting staff who have unsupervised contact with students and disclosing testing. Tutoring and teaching could only be bought from a registered qualified tutor, or through a school, business or accredited facility at a registered location. The supplemental materials that can be bought would change; items designated non-educational or luxury goods could not be bought at all; and unless the student has a disability, the money could not be paid to a member of the student's family.",
  ),
  p(
    "prop-212",
    "annual-registration",
    "OVERSIGHT",
    "Annual registration for schools, providers and tutors",
    "From July 1, 2027, schools, tutoring providers and individual tutors would register each campus or location with the Department every year, pay an annual registration fee, and show they meet safety, location, non-discrimination, accreditation and fingerprint requirements. They would be subject to the same laws on investigating and disciplining misconduct that apply to public school employees. Families could not be reimbursed for payments to anyone unregistered, and registration forms and supporting documents would be public records.",
  ),
  p(
    "prop-212",
    "medical-marijuana-transfer",
    "FUNDING",
    "$1,750,000 moved from the medical marijuana fund",
    "On the day the measure takes effect, $1,750,000 would move from the medical marijuana fund — which has paid for clinical research, the Arizona teachers academy, public health initiatives, substance abuse prevention and administrative costs — to the Department of Education, the State Board of Education, the Department of Public Safety and the attorney general, for the administrative spending the measure requires.",
  ),
  p(
    "prop-212",
    "severability",
    "OVERSIGHT",
    "The rest survives if part is struck down",
    "If any part of the measure is found invalid, the rest would be unaffected, and the invalid parts would be interpreted as far as the law allows.",
  ),

  /* ── Proposition 316 · food; municipal tax; exemption ──────────────────── */
  p(
    "prop-316",
    "existing-tax-capped",
    "FUNDING",
    "Existing food taxes capped, and some frozen outright",
    "A city, town or other taxing jurisdiction that approved a tax or fee on food and certain ready-to-drink non-alcoholic beverages in closed containers for home consumption on or before January 1, 2025 could only raise the rate with voter approval, and never above two percent of the tax base. If the rate on that date was already two percent or more, it could not be raised at all.",
  ),
  p(
    "prop-316",
    "new-tax-needs-a-vote",
    "FUNDING",
    "A new food tax would need a vote",
    "A city, town or other taxing jurisdiction that had not approved such a tax or fee on or before January 1, 2025 would need voter approval to adopt one and to raise it afterwards, and it could not be more than two percent of the tax base.",
  ),
  p(
    "prop-316",
    "freeze-window",
    "SUNSET",
    "A freeze from June 30, 2025 to June 30, 2027",
    "No new tax or fee could be adopted and no rate could be increased between June 30, 2025 and June 30, 2027.",
  ),

  /* ── Proposition 317 · drug cartels; terrorist organizations ───────────── */
  p(
    "prop-317",
    "declaration",
    "PROGRAM",
    "Declares drug cartels terrorist organizations",
    "It would declare that drug cartels — associations of people engaged in human smuggling, drug trafficking for profit, or any act of terrorism — are terrorist organizations.",
  ),
  p(
    "prop-317",
    "homeland-security-duty",
    "OVERSIGHT",
    "The state homeland security department would have to act",
    "It would require the Arizona Department of Homeland Security to use all lawful means available within its authority to address the threats drug cartels pose.",
  ),
  p(
    "prop-317",
    "not-an-asylum-basis",
    "PROGRAM",
    "Not a basis for an asylum claim",
    "It would declare that the measure does not support a person's claim for asylum under federal law.",
  ),

  /* ── Proposition 318 · interscholastic athletics; biological sex ───────── */
  p(
    "prop-318",
    "female-sports",
    "PROGRAM",
    "Female sports limited by sex recorded at birth",
    "Males could not play in female interscholastic and intramural sports, decided by the biological sex of the athletes as recorded at birth on their original birth certificates.",
  ),
  p(
    "prop-318",
    "team-designations",
    "PROGRAM",
    "Every team would have to be labeled",
    "Public and private schools and athletic associations that sponsor an interscholastic or intramural team or sport would have to expressly designate it as “males”, “men”, “boys”, “females”, “women”, “girls”, “coeducational” or “mixed”.",
  ),
  p(
    "prop-318",
    "private-spaces",
    "PROGRAM",
    "Locker rooms and restrooms by sex recorded at birth",
    "Public schools, private schools, higher education institutions and athletic associations that provide private spaces integral to athletics — restrooms, locker rooms and shower rooms — could not authorise anyone to use a space not designated for their biological sex as recorded at birth on their original birth certificate.",
  ),
  p(
    "prop-318",
    "who-may-sue",
    "OVERSIGHT",
    "More people could sue and be sued",
    "It would expand who may sue and be sued over alleged violations of the law.",
  ),
  p(
    "prop-318",
    "matching-and-coed-unaffected",
    "PROGRAM",
    "Matching and coed teams unaffected",
    "It would not restrict any athlete's eligibility to play on a team or in a sport that matches their sex, or one designated coeducational or mixed. “Athlete” would cover students and any individual who takes part in a team or sport.",
  ),

  /* ── Proposition 319 · photo enforcement systems; voter approval ───────── */
  p(
    "prop-319",
    "no-new-systems",
    "PROGRAM",
    "No photo enforcement without an existing contract",
    "A local authority or state agency could not use a photo enforcement system for speeding or traffic control device violations unless it had a contract in place before December 31, 2026 to operate one.",
  ),
  p(
    "prop-319",
    "voters-decide-existing",
    "OVERSIGHT",
    "Existing systems would go to the voters",
    "A local authority with a contract in place before that date would have to ask voters at the next general election whether it may keep operating the system. If voters say no, it would have to stop within 90 days of the election.",
  ),
  p(
    "prop-319",
    "ten-year-renewal",
    "SUNSET",
    "Ten years, then another vote",
    "If voters approve, the system could keep running for ten years. At the end of each ten-year period the local authority would have to go back to the voters for another ten.",
  ),

  /* ── Proposition 320 · instructional expenses; enforcement ─────────────── */
  p(
    "prop-320",
    "sixty-percent-floor",
    "PROGRAM",
    "At least 60 percent spent on classroom instruction",
    "Every school district with at least 7,500 students, or that runs a school in a county of at least 500,000 people, would have to spend at least 60 percent of its operational spending on direct instructional expenses.",
  ),
  p(
    "prop-320",
    "auditor-general-defines",
    "OVERSIGHT",
    "The auditor general would write the definitions",
    "The auditor general would define what “direct instructional expenses” and “operational spending” mean for this requirement.",
  ),
  p(
    "prop-320",
    "half-percent-a-year",
    "PROGRAM",
    "Half a percent a year to catch up",
    "From the 2027-2028 fiscal year, a district spending less than 60 percent would have to raise the share it spends on direct instruction by at least half of one percent a year until it complies.",
  ),
  p(
    "prop-320",
    "withheld-classroom-site-fund",
    "FUNDING",
    "Classroom site fund money withheld for non-compliance",
    "A district that does not comply would lose 25 percent of its classroom site fund allocation for each year it did not comply, up to the whole allocation after four or more years, unless a waiver is granted. The money not distributed would go to complying districts the following school year.",
  ),
];

/** Every provision of one measure, in the order the analysis enumerates them. */
export function provisionsForContest(contestId: string): MeasureProvision[] {
  return MEASURE_PROVISIONS.filter((provision) => provision.contestId === contestId);
}

/** One provision by its reaction-target id, or null. Never a guess. */
export function provisionById(id: string): MeasureProvision | null {
  return MEASURE_PROVISIONS.find((provision) => provision.id === id) ?? null;
}

/**
 * The set of provision ids a MEASURE_PROVISION reaction may target (P03).
 *
 * The write path checks against this the way vote reactions check the votes
 * snapshot: the surface only renders the control on real provisions, so
 * anything else is a client bug or a probe, and it fails closed. Derived
 * from the committed provisions rather than kept as a second list, because
 * two lists that must agree are the shape D29 just caught in the registry.
 */
export function getProvisionTargetIds(): Set<string> {
  return new Set(MEASURE_PROVISIONS.map((p) => p.id));
}
