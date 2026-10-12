/**
 * The key votes list: a fixed, reviewed set of questions a reader might want a
 * member's answer to, each rendered as that member's OWN chamber's roll call,
 * with a plain-language explainer anchored to the bill's own contents.
 *
 * It is not a scorecard: nothing is summed, averaged, graded or ordered by
 * agreement. It is not a selection made after looking at the votes: the
 * criteria sentence is published on the surface. And code never adds an entry.
 *
 * An entry is a QUESTION; each chamber answered it with its own roll calls, so
 * every entry maps to `{ house: RollCallRef[], senate: RollCallRef[] }`, and
 * either side may be empty with a structural note (the House does not vote on
 * nominations). The April 2024 package is four sibling entries because the
 * House voted four bills and the Senate one package.
 *
 * Where a chamber voted twice on a bill, the card shows the LAST passage or
 * concurrence vote — the vote on the text that became law — unless an entry's
 * `whichVote` says otherwise.
 *
 * Roll identities are bound in `lib/votes/key-vote-selection-v1.ts`;
 * `pnpm key-votes:positions` reacquires each roll from the official chamber.
 */

/** The criteria, published verbatim on the surface. Never paraphrased. */
export const KEY_VOTES_CRITERIA =
  "Major legislation that became law (plus one additional selected proposal), and consequential Senate confirmations, since 2020 — chosen before looking at how anyone voted.";

export type KeyVoteGroup = "LAWS" | "PEOPLE";

export interface RollCallRef {
  /** 116-119. */
  congress: number;
  /** 1 or 2. */
  session: number;
  /** The chamber's own roll-call number. */
  rollNumber: number;
  /**
   * What this roll call decided, in the chamber's own words, so a card
   * never implies a member voted on something they did not. Filled by the
   * fetch from the official record.
   */
  question: string | null;
  /** The official page for this roll call. Fetched and verified. */
  url: string | null;
  /** The tally as the chamber recorded it, e.g. "52-48". */
  tally: string | null;
  /** ISO date the fetch verified this against the official source. */
  verifiedAt: string | null;
}

export interface KeyVoteEntry {
  id: string;
  group: KeyVoteGroup;
  /** The question, in plain words. What the reader is asking about. */
  title: string;
  /**
   * One line, LEVEL register, anchored to the bill's own contents or the
   * official summary. Never the title doing the explaining; bundles name
   * their biggest real-world effects rather than their branding.
   */
  explainer: string;
  /** Where the explainer's facts came from, and when it was read. */
  explainerSource: string;
  explainerReadAt: string;
  /**
   * Current official status, when acquired into the canonical projection.
   * Reviewed question input never supplies this mutable claim.
   */
  pending?: boolean;
  /** Which roll call counts as this entry's vote, where a chamber voted twice. */
  whichVote?: { house?: string; senate?: string };
  house: RollCallRef[];
  senate: RollCallRef[];
  /** Renders in place of a House vote when the House does not have one. */
  houseNote?: string;
  /** Renders in place of a Senate vote when the Senate does not have one. */
  senateNote?: string;
  /**
   * The four April 2024 bills. Siblings render grouped, with the Senate's
   * single-package line on a senator's card.
   */
  siblingGroup?: string;
  /**
   * The phrase to look for in the chamber's OWN published vote title when
   * resolving this entry's roll call. Curated matching data, never an
   * asserted roll-call number: the fetch searches the official record for
   * it, requires a passage-type question, and refuses on ambiguity. A bill
   * number typed here from memory would be exactly the assumption this
   * whole file refuses to make.
   */
  senateSearch?: string;
  /**
   * The law's POPULAR NAME, for resolving this entry against the official
   * record. The Senate publishes votes under a bill's long title, so the
   * resolution finds the public law whose congress.gov titles include this
   * phrase. Matching data, never an asserted bill number.
   */
  lawSearch?: string;
  /**
   * The official short title of a PENDING measure, found through the chamber's
   * roll-call index rather than the public-law list. Matching data, never an
   * asserted bill number.
   */
  pendingSearch?: string;
}

/** The House does not vote on nominations. Stated, never left blank. */
const NO_HOUSE_NOMINATION = "The House doesn't vote on nominations.";

const CONGRESS_GOV = "congress.gov bill text and official summary";
const SENATE_ROLL = "senate.gov roll-call record";

/** A nomination entry: Senate only, single roll call. */
function nomination(
  id: string,
  title: string,
  explainer: string,
  tally: string,
): KeyVoteEntry {
  return {
    id,
    group: "PEOPLE",
    title,
    explainer,
    explainerSource: `${SENATE_ROLL}; the office's own statutory description`,
    explainerReadAt: "2026-08-15",
    house: [],
    houseNote: NO_HOUSE_NOMINATION,
    senate: [
      {
        congress: 0,
        session: 0,
        rollNumber: 0,
        question: null,
        url: null,
        tally,
        verifiedAt: null,
      },
    ],
  };
}

/**
 * Votes on people — Senate confirmations, a fixed list. The recorded tally is
 * what the fetch must AGREE WITH: a resolved roll call whose tally differs is
 * refused as the wrong roll call.
 */
export const KEY_VOTES_PEOPLE: KeyVoteEntry[] = [
  nomination(
    "barrett-scotus",
    "Amy Coney Barrett to the Supreme Court",
    "A lifetime seat on the Supreme Court, filled eight days before the 2020 election after Justice Ginsburg's death.",
    "52-48",
  ),
  nomination(
    "becerra-hhs",
    "Xavier Becerra as Secretary of Health and Human Services",
    "The department that runs Medicare, Medicaid and the public-health agencies, confirmed in the middle of the pandemic.",
    "50-49",
  ),
  nomination(
    "haaland-interior",
    "Deb Haaland as Secretary of the Interior",
    "The department that manages federal public land, national parks and relations with tribal nations; she is the first Native American cabinet secretary.",
    "51-40",
  ),
  nomination(
    "mayorkas-dhs",
    "Alejandro Mayorkas as Secretary of Homeland Security",
    "The department that runs border enforcement, immigration services, disaster response and the Coast Guard.",
    "56-43",
  ),
  nomination(
    "garland-ag",
    "Merrick Garland as Attorney General",
    "The head of the Justice Department, which decides which federal crimes are prosecuted and defends federal law in court.",
    "70-30",
  ),
  nomination(
    "yellen-treasury",
    "Janet Yellen as Secretary of the Treasury",
    "The department that manages federal borrowing, tax collection and sanctions policy.",
    "84-15",
  ),
  nomination(
    "buttigieg-dot",
    "Pete Buttigieg as Secretary of Transportation",
    "The department that regulates airlines, railroads and highway safety and distributes federal transport money.",
    "86-13",
  ),
  nomination(
    "powell-fed",
    "Jerome Powell for a second term as Chair of the Federal Reserve",
    "The Federal Reserve sets interest rates, which is the main lever anyone in government has over inflation and unemployment.",
    "80-19",
  ),
  nomination(
    "jackson-scotus",
    "Ketanji Brown Jackson to the Supreme Court",
    "A lifetime seat on the Supreme Court; she is the first Black woman to serve on it.",
    "53-47",
  ),
  nomination(
    "hegseth-defense",
    "Pete Hegseth as Secretary of Defense",
    "The department that commands the armed forces and spends roughly half of all money Congress appropriates each year. The Senate split 50-50 and the Vice President broke the tie.",
    "50-50",
  ),
  nomination(
    "rfk-hhs",
    "Robert F. Kennedy Jr. as Secretary of Health and Human Services",
    "The department that runs Medicare, Medicaid, the FDA and the CDC, including federal vaccine policy.",
    "52-48",
  ),
  nomination(
    "gabbard-dni",
    "Tulsi Gabbard as Director of National Intelligence",
    "The official who oversees all eighteen federal intelligence agencies and decides what the President is told.",
    "52-48",
  ),
  nomination(
    "patel-fbi",
    "Kash Patel as Director of the FBI",
    "A ten-year term running the federal government's main criminal and counter-intelligence investigators.",
    "51-49",
  ),
  nomination(
    "bondi-ag",
    "Pam Bondi as Attorney General",
    "The head of the Justice Department, which decides which federal crimes are prosecuted and defends federal law in court.",
    "54-46",
  ),
  nomination(
    "rubio-state",
    "Marco Rubio as Secretary of State",
    "The department that conducts foreign policy, runs the embassies and issues visas. Confirmed unanimously.",
    "99-0",
  ),
  nomination(
    "blanche-doj",
    "Todd Blanche as Deputy Attorney General",
    "The second-ranking official at the Justice Department, who runs its day-to-day operations and supervises the U.S. Attorneys.",
    "50-49",
  ),
];

/** A law entry with no roll calls placed yet — the fetch fills them. */
function law(
  id: string,
  title: string,
  explainer: string,
  extra: Partial<KeyVoteEntry> = {},
): KeyVoteEntry {
  return {
    id,
    group: "LAWS",
    title,
    explainer,
    explainerSource: CONGRESS_GOV,
    explainerReadAt: "2026-08-15",
    house: [],
    senate: [],
    ...extra,
  };
}

/**
 * Votes on laws — a fixed list, including the April 2024 package as FOUR
 * siblings. Each explainer says what the law actually DOES to people in one
 * sentence; no title does the explaining, and bundles name their biggest
 * real-world effects rather than their branding.
 */
export const KEY_VOTES_LAWS: KeyVoteEntry[] = [
  law(
    "cares-act",
    "The CARES Act (March 2020)",
    "The first pandemic relief law: $1,200 payments to most adults, expanded unemployment benefits, and forgivable loans to keep small businesses paying staff.",
    { houseNote: "The House agreed to the Senate amendment by voice vote on March 27, 2020, so there is no House roll-call position for an individual member." },
  ),
  law(
    "american-rescue-plan",
    "The American Rescue Plan (March 2021)",
    "The second big pandemic package: $1,400 payments, an expanded child tax credit that paid parents monthly for a year, and money for vaccines, schools and state governments.",
  ),
  law(
    "iija",
    "The Infrastructure Investment and Jobs Act (2021)",
    "About $550 billion in new money for roads, bridges, water pipes, rural broadband and the electric grid, spread over five years.",
  ),
  law(
    "bsca",
    "The Bipartisan Safer Communities Act (2022)",
    "The first major federal gun law in about 30 years — tougher checks for buyers under 21, money for state red-flag programs and school mental health. Still in effect; the under-21 provisions expire in 2032 by the law's own terms.",
    { whichVote: { house: "final passage", senate: "final passage" } },
  ),
  law(
    "chips",
    "The CHIPS and Science Act (2022)",
    "About $52 billion to pay companies to build computer-chip factories in the United States, after the pandemic showed how much depends on chips made elsewhere.",
  ),
  law(
    "pact-act",
    "The Honoring our PACT Act (2022)",
    "Extended VA health care and disability benefits to veterans exposed to burn pits and other toxic hazards, and made the government presume certain illnesses were service-related instead of making each veteran prove it.",
  ),
  law(
    "ira",
    "The Inflation Reduction Act (2022)",
    "Let Medicare negotiate the price of some prescription drugs and capped insulin at $35 a month for people on Medicare, alongside tax credits for clean energy, paid for partly by a minimum tax on large corporations.",
  ),
  law(
    "respect-for-marriage",
    "The Respect for Marriage Act (2022)",
    "Requires every state to recognize same-sex and interracial marriages performed in other states, so those marriages stay valid even if the Supreme Court changes course.",
  ),
  law(
    "fiscal-responsibility",
    "The Fiscal Responsibility Act (2023)",
    "Ended the debt-ceiling standoff by suspending the borrowing limit into 2025, in exchange for caps on federal spending and new work requirements for some food-stamp recipients.",
  ),
  law(
    "april-2024-ukraine",
    "April 2024: aid to Ukraine",
    "About $61 billion for Ukraine's defense against Russia's invasion — weapons, ammunition, and economic support.",
    { siblingGroup: "april-2024" },
  ),
  law(
    "april-2024-israel",
    "April 2024: aid to Israel and humanitarian aid for Gaza",
    "About $26 billion for Israel's military and air defenses, including roughly $9 billion for humanitarian relief in Gaza and other conflict zones.",
    { siblingGroup: "april-2024" },
  ),
  law(
    "april-2024-indopacific",
    "April 2024: Indo-Pacific and Taiwan",
    "About $8 billion for military support to Taiwan and other allies in the Indo-Pacific, and for U.S. submarine production.",
    { siblingGroup: "april-2024" },
  ),
  law(
    "april-2024-tiktok",
    "April 2024: TikTok divest-or-ban, and sanctions",
    "Required TikTok's Chinese owner to sell the app or have it blocked in U.S. app stores, and added sanctions on Russia, Iran and their weapons suppliers.",
    { siblingGroup: "april-2024" },
  ),
  law(
    "ssfa",
    "The Social Security Fairness Act (2025)",
    "Repealed two rules that reduced Social Security for millions of retired teachers, police, and other public workers, raising their monthly benefits.",
  ),
  law(
    "laken-riley",
    "The Laken Riley Act (2025)",
    "Requires federal immigration authorities to detain people in the country illegally who are arrested for theft or certain violent crimes, and lets states sue the federal government over immigration enforcement decisions.",
  ),
  law(
    "obbba",
    "The One Big Beautiful Bill Act (2025)",
    "Made the 2017 income-tax rates permanent and added new deductions, while cutting Medicaid and food-stamp spending through tighter eligibility and work rules, and increasing immigration-enforcement funding.",
    { whichVote: { house: "concurrence in the Senate amendment", senate: "final passage" } },
  ),
  law(
    "genius-act",
    "The GENIUS Act (2025)",
    "The first federal rulebook for stablecoins (cryptocurrency) — digital tokens meant to hold a fixed dollar value — requiring issuers to hold real dollar reserves and submit to federal or state supervision.",
  ),
  law(
    "funding-fight",
    "The shutdown and the 2026 appropriations that ended it",
    "Reopened the federal government after the longest shutdown on record and funded it for the rest of the year, restoring back pay to federal workers and resuming paused federal payments.",
    {
      /*
       * One bill ran this whole episode (H.R. 5371, the Continuing
       * Appropriations and Extensions Act, 2026). Each chamber's vote is the one
       * that ENDED it, the same rule `obbba` uses:
       *
       *   House  — roll 285, 12 Nov 2025, concurrence, 222–209
       *   Senate — roll 618, 10 Nov 2025, passage as amended, 60–40
       */
      whichVote: { house: "concurrence in the Senate amendment", senate: "final passage" },
    },
  ),
  law(
    "road-to-housing",
    "The 21st Century ROAD to Housing Act (2025)",
    "The first broad federal housing law in years: money and rule changes aimed at getting more homes built, plus changes to rental assistance and homelessness programs.",
  ),
  law(
    "stock-trading-ban",
    "Banning members of Congress from trading individual stocks",
    "Would bar members of Congress, and in most versions their spouses, from buying and selling individual company shares while in office, requiring blind trusts or divestment instead.",
  ),
];

/**
 * What to look for in the Senate's OWN published vote title, per law. The
 * Senate publishes votes under official long titles, so these rarely match on
 * their own; `LAW_SEARCH` (popular names via congress.gov) is the working
 * route. All four April 2024 siblings share one phrase because the Senate
 * voted them as one package. Matching data, never a bill number.
 */
const SENATE_SEARCH: Readonly<Record<string, string>> = {
  "cares-act": "Coronavirus Aid, Relief, and Economic Security",
  "american-rescue-plan": "American Rescue Plan",
  iija: "Infrastructure Investment and Jobs Act",
  bsca: "Bipartisan Safer Communities",
  chips: "CHIPS",
  "pact-act": "Honoring our PACT",
  ira: "Inflation Reduction Act",
  "respect-for-marriage": "Respect for Marriage",
  "fiscal-responsibility": "Fiscal Responsibility Act",
  "april-2024-ukraine": "Israel Security Supplemental",
  "april-2024-israel": "Israel Security Supplemental",
  "april-2024-indopacific": "Israel Security Supplemental",
  "april-2024-tiktok": "Israel Security Supplemental",
  ssfa: "Social Security Fairness",
  "laken-riley": "Laken Riley",
  obbba: "One Big Beautiful Bill",
  "genius-act": "GENIUS Act",
  "funding-fight": "Continuing Appropriations",
  "road-to-housing": "ROAD to Housing",
};

/**
 * The popular name of each law, for the congress.gov resolution. The fetch
 * searches the official titles and refuses on zero or ambiguous matches.
 */
const LAW_SEARCH: Readonly<Record<string, string>> = {
  // The full name: "CARES Act" alone matches three public laws.
  "cares-act": "Coronavirus Aid, Relief, and Economic Security Act",
  "american-rescue-plan": "American Rescue Plan",
  iija: "Infrastructure Investment and Jobs Act",
  bsca: "Bipartisan Safer Communities Act",
  chips: "CHIPS and Science Act",
  "pact-act": "Honoring our PACT Act",
  ira: "Inflation Reduction Act",
  "respect-for-marriage": "Respect for Marriage Act",
  "fiscal-responsibility": "Fiscal Responsibility Act",
  "april-2024-ukraine": "Ukraine Security Supplemental Appropriations Act",
  "april-2024-israel": "Israel Security Supplemental Appropriations Act",
  "april-2024-indopacific": "Indo-Pacific Security Supplemental Appropriations Act",
  "april-2024-tiktok": "21st Century Peace through Strength Act",
  ssfa: "Social Security Fairness Act",
  "laken-riley": "Laken Riley Act",
  obbba: "One Big Beautiful Bill Act",
  "genius-act": "GENIUS Act",
  "road-to-housing": "21st Century ROAD to Housing Act",
};

/**
 * The phrase that finds a PENDING measure in the chamber's own record, through
 * the House's roll-call index (a pending bill is in no public-law list). The
 * bill's own official short title.
 */
const PENDING_SEARCH: Readonly<Record<string, string>> = {
  "stock-trading-ban": "Stop Insider Trading Act",
};

for (const entry of KEY_VOTES_LAWS) {
  const phrase = SENATE_SEARCH[entry.id];
  if (phrase) entry.senateSearch = phrase;
  const popular = LAW_SEARCH[entry.id];
  if (popular) entry.lawSearch = popular;
  const pending = PENDING_SEARCH[entry.id];
  if (pending) entry.pendingSearch = pending;
}



/**
 * Entries deliberately parked: the answer needs human review, so no resolver
 * attempt may be made (unlike a miss, which invites another attempt). The
 * reviewed selection gate skips these.
 */
export const PARKED_KEY_VOTES: Readonly<Record<string, string>> = {
  /* Empty, and kept: an entry that cannot be resolved without human judgement
     must block every run rather than let a resolver write a guess in. */
};

/** The whole list, in its fixed order: laws first, then people. */
export const KEY_VOTES: KeyVoteEntry[] = [...KEY_VOTES_LAWS, ...KEY_VOTES_PEOPLE];

/**
 * The four April 2024 bills, which the House voted separately and the
 * Senate voted as one package. Rendered as four rows on a House member's
 * card and one on a senator's, with the line below.
 */
export const APRIL_2024_SENATE_NOTE =
  "The Senate voted on the four bills as a single package.";
