/**
 * The key votes list — tracker **B15**, the author's locked list (2026-08-15).
 *
 * ## What this is, and the three things it is not
 *
 * It is a fixed set of questions the reader might reasonably want a member's
 * answer to, each rendered as that member's OWN chamber's roll call, with a
 * plain-language explainer anchored to the bill's own contents.
 *
 * It is **not** a scorecard. Nothing here is summed, averaged, graded or
 * ordered by agreement — CLAUDE.md's neutrality rule is stricter than the
 * no-composite-score rule and this file is the place it would be easiest to
 * break. It is **not** a selection made after looking at the votes: the
 * criteria sentence below is published ON the surface, and the entries were
 * fixed before any roll call was fetched. And it is **not** ours: the list
 * is the author's, approved in conversation; code never adds an entry.
 *
 * ## The chamber rule (structural, the author's order)
 *
 * **An entry is a QUESTION. Each chamber answered it with its own roll
 * calls, and a member's card shows only their own chamber's votes.** So
 * every entry maps to `{ house: RollCallRef[], senate: RollCallRef[] }`, and
 * either side may legitimately be empty:
 *
 *  - `[]` with a structural `houseNote` — that chamber does not vote on
 *    this class of question at all (the House does not vote on nominations).
 *    Current chamber or law status is never asserted by reviewed input; it
 *    requires its own official acquisition and durable receipt.
 *  - A member who was not in office, or did not vote, renders "did not
 *    vote" — also first-class.
 *
 * The April 2024 package is four sibling entries because the House voted on
 * four separate bills and a member could vote differently on each; the
 * Senate voted the four as one package, so a senator's card shows one row
 * and says so.
 *
 * ## The last-passage rule — AUTHOR-APPROVED 2026-08-15 (6f3)
 *
 * Where a chamber voted twice on the same bill (passage, then concurrence in
 * the other chamber's amendment), the entry names WHICH roll call is its
 * vote — final passage or concurrence — per entry, in `whichVote`.
 *
 * **The standing rule, in the author's ruling: the card shows the LAST
 * passage or concurrence vote.** The sixteen entries that took this as their
 * default when B17 resolved them stand as approved rather than as
 * unreviewed defaults.
 *
 * The reason it is the right default, recorded so nobody re-argues it: the
 * last vote is the one on the text that became law. B17 found this the hard
 * way — matching the Bipartisan Safer Communities Act on the literal words
 * "final passage" picked the House's May vote on its own unrelated version
 * of the bill, not the June concurrence that is the vote on the gun law. A
 * member who voted differently on the two would have been shown answering a
 * question nobody asked.
 *
 * Any future per-entry override is an explicit author decision, written into
 * that entry's `whichVote`. Code never changes which vote an entry means.
 *
 * ## Roll call ids are fetched, never assumed
 *
 * The reviewed v1 selection binds these questions to the roll identities in
 * `lib/votes/key-vote-selection-v1.ts`. `pnpm key-votes:positions`
 * reacquires each selected roll from the official chamber, and the canonical
 * projection carries its current question, tally, URL verification, and
 * member positions in the canonical projection. An unverified roll is held;
 * no tracked file is changed.
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
   * record — B17, 2026-08-15.
   *
   * The Senate publishes its votes under a bill's official long title
   * ("A bill to provide for reconciliation pursuant to title II of S. Con.
   * Res. 14"), which names nothing a reader would recognise; that is why
   * `senateSearch` alone left every law row empty. congress.gov's own
   * `/titles` endpoint carries the popular and short titles the country
   * actually uses, so the resolution is: find the public law whose titles
   * include THIS phrase, then read that bill's recorded votes.
   *
   * Curated matching data, exactly like `senateSearch` — a phrase to search
   * the official record for, never an asserted bill number. A bill number
   * typed here from memory is the assumption this whole file refuses.
   */
  lawSearch?: string;
  /**
   * The official short title of a PENDING measure, for the route that goes
   * through the chamber's roll-call index rather than the public-law list
   * (B15, 2026-08-18). Matching data, never an asserted bill number.
   */
  pendingSearch?: string;
}

/** The House does not vote on nominations. Stated, never left blank. */
const NO_HOUSE_NOMINATION = "The House doesn't vote on nominations.";

const CONGRESS_GOV = "congress.gov bill text and official summary";
const SENATE_ROLL = "senate.gov roll-call record";

/**
 * A nomination entry. Sixteen of these, all Senate, all single roll calls —
 * which is why the brief ships this group first: there is no chamber
 * mapping to get wrong.
 */
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
 * VOTES ON PEOPLE — sixteen Senate confirmations, the author's list.
 *
 * The tally on each is the author's, recorded as the thing the fetch must
 * AGREE WITH: a resolved roll call whose tally does not match is treated as
 * the wrong roll call and refused, rather than quietly overwriting the
 * author's list with whatever the search returned.
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
 * VOTES ON LAWS — twenty entries, the author's list, including the April
 * 2024 package as FOUR siblings and one additional selected proposal.
 *
 * The count read "seventeen" until 2026-08-18 (g19), when it was checked
 * against the array rather than against the previous comment. A stale count
 * in a docblock is a small thing; a stale count that a report quotes as a
 * denominator is not.
 *
 * Every explainer is drafted in the register the author approved on the
 * three samples he wrote himself (BSCA, Social Security Fairness, Ukraine
 * aid): what the law actually DOES to people, in one sentence, with the
 * status stated where the status is part of the answer. No entry lets its
 * title do the explaining, and the bundles name their biggest real-world
 * effects rather than their branding.
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
    // The author's one edit in his review of all 36 explainer lines
    // (2026-08-15). Every other line is approved as shipped and is not to be
    // reworded, tightened, or improved.
    "The first federal rulebook for stablecoins (cryptocurrency) — digital tokens meant to hold a fixed dollar value — requiring issuers to hold real dollar reserves and submit to federal or state supervision.",
  ),
  law(
    "funding-fight",
    "The shutdown and the 2026 appropriations that ended it",
    "Reopened the federal government after the longest shutdown on record and funded it for the rest of the year, restoring back pay to federal workers and resuming paused federal payments.",
    {
      /*
       * UNPARKED 2026-08-19 (F01 5.6, the author, superseding his own g20
       * ruling): "there are votes recorded for that, there is no doubt of it."
       *
       * He was right, and the two notes that used to sit here are gone rather
       * than reworded, because what they said is no longer true. They said we
       * had not tied the entry to a single vote and that Congress passed more
       * than one appropriations law that year. The roll-call record — the House
       * Clerk's 2025 index and the Senate's 119-1 vote menu, both read this
       * session — shows ONE bill running the whole episode: H.R. 5371, the
       * Continuing Appropriations and Extensions Act, 2026.
       *
       * The vote each chamber gets is the one that ENDED it, which is the same
       * rule `obbba` uses and for the same reason: the House's meaningful act
       * on a Senate-amended bill is the concurrence, not its own earlier
       * passage of a text the Senate then replaced.
       *
       *   House  — roll 285, 12 Nov 2025, concurrence, 222–209
       *   Senate — roll 618, 10 Nov 2025, passage as amended, 60–40
       *
       * Both are pinned in the snapshot with their chamber's own URL, tally and
       * read date. See PARKED_KEY_VOTES below for why the park existed and what
       * the record showed about its premise.
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
 * What to look for in the Senate's OWN published vote title, per law.
 *
 * Curated matching data and nothing more. A bill number typed here from
 * memory would be exactly the assumption this file refuses to make, so
 * these are the laws' own names as the chamber prints them, and the fetch
 * requires a passage-type question and refuses on ambiguity.
 *
 * All four April 2024 siblings share one phrase on purpose: the Senate
 * voted the four bills as a single package, so they resolve to one Senate
 * roll call, which is what APRIL_2024_SENATE_NOTE tells the reader.
 *
 * ## What the first run found, recorded rather than smoothed over
 *
 * **These phrases do not match, and the reason is structural.** The Senate
 * publishes each vote under the bill's OFFICIAL LONG TITLE, never its
 * popular name: the Inflation Reduction Act appears as "A bill to provide
 * for reconciliation pursuant to title II of S. Con. Res. 14", which names
 * nothing a reader would recognise, and the Respect for Marriage Act as "A
 * bill to repeal the Defense of Marriage Act and ensure respect for State
 * regulation of marriage". Sixteen of eighteen searched entries returned
 * zero passage votes and the seventeenth returned sixteen candidates.
 *
 * The route that closes this is the congress.gov API — search the bill by
 * title, take its number from the official record, then take that bill's
 * roll calls — and it is a work item (tracker), not a licence to type a
 * bill number here from memory. Until it runs, the LAWS entries carry no
 * roll calls and render as OUR recorded gap, which is a different sentence
 * from "no vote exists" and must never be shown as one.
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
 * The popular name of each law, for the congress.gov resolution (B17).
 *
 * Every phrase here is a name in ordinary public use — the name the entry's
 * own title already carries, which the author wrote. Nothing is a bill
 * number and nothing is a roll call: the fetch searches the official titles
 * for the phrase and refuses on zero or ambiguous matches.
 */
const LAW_SEARCH: Readonly<Record<string, string>> = {
  // "CARES Act" matches three public laws across two congresses — the
    // relief act, an unrelated 2019 bill, and a 2024 one. The full name the
    // law itself carries is unambiguous. Matching data, never an assertion.
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
 * The phrase that finds a PENDING measure in the chamber's own record.
 *
 * Separate from `LAW_SEARCH` because the route is different: a pending bill
 * is in no public-law list, so it is found through the House's own
 * roll-call index and the titles of the measures it voted on.
 *
 * Curated matching data, exactly like the two above — a phrase to search
 * the official record for, never an asserted bill number. The phrase here
 * is the bill's own official short title, which is what the record prints.
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
 * **Entries the AUTHOR has parked — not a gap in effort, and not something a
 * later run may quietly close.** (2026-08-19, g20, B15 item 1c.)
 *
 * Distinct from a `miss`, and the distinction is the point. A miss is what a
 * resolver could not find; it invites another attempt with a better rung. A
 * PARK is a decision that no attempt should be made, because the answer is
 * the author's to give and guessing it would put named members of Congress
 * against a vote on a bill they may never have voted on.
 *
 * Why this is a list in code rather than a sentence in the tracker: the
 * fill-only rule that mitigated D68 protects a chamber that ALREADY has a
 * roll call. A parked entry has none, so fill-only would happily let the
 * next run write one in — which is exactly the failure the park exists to
 * prevent, arriving through the door the last fix left open.
 * The reviewed selection gate skips these; `tests/key-votes.test.ts` holds
 * both halves.
 */
export const PARKED_KEY_VOTES: Readonly<Record<string, string>> = {
  /*
   * EMPTY, AND DELIBERATELY KEPT.
   *
   * `funding-fight` was the only entry here. The author UNPARKED it in F01 5.6
   * (2026-08-19): *"This is a data gap to close, not a display issue... there
   * are votes recorded for that, there is no doubt of it."*
   *
   * **The park's premise turned out to be wrong, and the roll-call record is
   * what showed it.** The park said this entry names two things at once and
   * the 119th carries five appropriations laws, so picking one risked showing
   * a reader a vote on a different bill. But the record names ONE bill for the
   * whole episode: **H.R. 5371, the Continuing Appropriations and Extensions
   * Act, 2026**. The House Clerk's 2025 roll index carries it from first
   * passage (roll 281, 19 Sep) through concurrence in the Senate amendment
   * (roll 285, 12 Nov, 222–209); the Senate's own 119-1 vote menu carries
   * twenty-three H.R. 5371 votes, from the first failed cloture on 1 Oct to
   * passage as amended (roll 618, 10 Nov, 60–40). There was never an ambiguity
   * to resolve — there was one bill and a six-week fight over it, and the
   * popular-name route could not see that because "Continuing Appropriations"
   * matches several laws by TITLE while only one of them is this episode.
   *
   * Both refs are pinned in the snapshot with their tallies, their chamber's
   * own URL and their read date, which is why the resolver's inability to
   * guess a popular name no longer decides this row.
   *
   * The map stays because the MECHANISM is still right: an entry whose answer
   * cannot be resolved without the author's judgement must block every run
   * rather than let a resolver write a guess in. The reviewed selection gate
   * skips whatever is here; `tests/key-votes.test.ts` holds both halves
   * whether the map is empty or not.
   */
};

/** The whole list, in the author's order: laws first, then people. */
export const KEY_VOTES: KeyVoteEntry[] = [...KEY_VOTES_LAWS, ...KEY_VOTES_PEOPLE];

/**
 * The four April 2024 bills, which the House voted separately and the
 * Senate voted as one package. Rendered as four rows on a House member's
 * card and one on a senator's, with the line below.
 */
export const APRIL_2024_SENATE_NOTE =
  "The Senate voted on the four bills as a single package.";
