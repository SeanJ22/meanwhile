import type { SeatHolder } from "./lookup.ts";
import { stateOcdIdFrom } from "./lookup.ts";

/**
 * Statewide elected executives, curated from each state's own site
 * (session item 2b, wall clock 2026-08-14 second session).
 *
 * Why this module exists: the who-governs card is built from division
 * rows — legislators attach via districts — and a statewide executive is
 * elected by no district on the map, so no row ever claimed them. The
 * registry's shape became the card's blind spot, and the most prominent
 * officer in every state was missing from every zip. Statewide
 * executives are a first-class attachment, exactly the shape `senators`
 * already takes: keyed to the state division id, derived from the OCD
 * prefix of the divisions the geometry resolved.
 *
 * **Governor only, until 2026-08-28.** That sentence stood here as a
 * promise for a fortnight and the ballot surface paid for it: measured on
 * `a44559e`, the Arizona ballot ran **seven statewide contests and 29
 * candidates**, and only the Governor's race could name who holds the seat.
 * Secretary of State, Attorney General, State Treasurer, Superintendent of
 * Public Instruction, State Mine Inspector and Corporation Commissioner each
 * returned ZERO holders, so 21 named people read *we haven't sourced who
 * holds this seat* — including Adrian Fontes and Kris Mayes, who hold the
 * seats they were running for.
 *
 * **The gap was never the join. It was the corpus.** `seatHoldersForOffice`
 * has been exact since Red Control 1; there was simply nobody on the other
 * side of it. So this store is now the ACQUISITION target rather than a
 * governor list, and the route it was acquired by is the one `azgovernor.gov`
 * already proved: **an executive office publishes its own officeholder on its
 * own site.** Every row below was read off that office's own page, on the
 * date the row states, with the URL it was read from.
 *
 * **The method was proved on a second jurisdiction before it was trusted**
 * (RULING 60: a branch proven in one place is proven for that SHAPE). New
 * Jersey's Lieutenant Governor is the control — a different state, a
 * different office, the same route — and the Corporation Commission is the
 * second SHAPE: a five-member elected body rather than a single officer,
 * which the store carries as five rows on one office key exactly as a
 * multi-member legislative district does.
 *
 * **It is still not complete, and the honest name for what it is now is WHAT
 * WE HAVE ACQUIRED SO FAR.** Arizona's statewide executives are covered
 * because Arizona's ballot asked for them; New Hampshire's and New Jersey's
 * other statewide officers are NOT here, and the reason is stated rather than
 * hidden: in both states those offices are filled by the legislature or by
 * appointment rather than by the public, and putting them in this store would
 * hand an `Incumbent` chip — a word that means *the person you can vote
 * against* — to an office no reader has ever voted in. That is a finding to
 * work, not a row to guess.
 *
 * Officeholder discipline: every name and contact below was read off the
 * cited state page. Photos follow the photo rule — hunted in the dedicated
 * photo session (2026-08-14): each governor's portrait was matched on
 * Wikimedia Commons by attribute-verified identity, judged a clean solo
 * portrait, committed metadata-stripped under public/officials/, and its
 * license recorded in lib/registry/official-photos.json (the manifest row
 * carries the Commons file page and the license).
 *
 * **Party (M61, 2026-08-15).** These rows shipped with `partyLabel: null`
 * on the reasoning that a governor's own office page styles itself
 * officeholder-first, so party was left to the ballot surfaces. The author
 * caught the consequence in production: Kelly Ayotte read "Republican" on
 * the ballot and carried nothing at all on the who-governs card, two
 * surfaces disagreeing about the same person. The standing rule is that
 * party renders wherever it is held, so the fix is to hold it — from the
 * same class of record the ballot cites, the election authority's own
 * certified filing, one per row and named on the row. Not from the office
 * page, which genuinely does not state it, and not from anybody's
 * knowledge.
 *
 * `partySourceUrl` is the record, and `tests/party.test.ts` will not let a
 * party ship without one.
 *
 * Verification states follow the everyday.ts precedent: a
 * PENDING_BROWSER row must be verified in a real browser before ship —
 * all three sites wall plain clients (403 / empty shell to WebFetch,
 * rungs recorded in docs/source-ladder.md).
 */

export type StatewideVerification = "PAGE_FETCHED" | "PENDING_BROWSER";

export interface StatewideExecutive {
  /** The state division this office serves — the attachment key. */
  stateOcdId: string;
  /**
   * Everything about the person EXCEPT their provenance, which this entry
   * already states below and `statewideExecutivesFor` attaches (item 1,
   * 2026-08-16). Writing it twice is how two records of the same fact come
   * to disagree.
   */
  holder: Omit<SeatHolder, "provenance">;
  /** The state's own page the row was read from. */
  sourceUrl: string;
  /**
   * The election authority record the holder's party was read from (M61).
   * Required whenever the holder carries a party: the office page does not
   * state it, so the claim has to cite the filing that does.
   */
  partySourceUrl?: string;
  partySourceOrg?: string;
  /**
   * Why this row carries NO party — required whenever `partyLabel` is null.
   *
   * (2026-08-28.) M61 shipped with three governors, all three of them recent
   * candidates in elections this repository holds the certified filing for, so
   * "every row has a party" and "every party has a record" were the same
   * sentence. They stop being the same sentence the moment the store holds an
   * officeholder who is not a recent candidate — an appointee filling a
   * vacancy, or a Lieutenant Governor who ran on somebody else's line and is
   * therefore not named on the certified list for the office they now hold.
   *
   * The rule that survives is the one that was always the point: **a party
   * never ships without the record it was read from.** The rule that is
   * replaced is the head-count. A null party is now a NAMED GAP — it says
   * whose gap it is and what was looked at — rather than a silent blank, and
   * `tests/party.test.ts` refuses a null that does not name one.
   */
  partyAbsence?: string;
  sourceOrg: string;
  collectedAt: string;
  verification: StatewideVerification;
}

export const STATEWIDE_EXECUTIVES: readonly StatewideExecutive[] = [
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/governor",
      name: "Katie Hobbs",
      officeTitle: "Governor",
      // Read off the Secretary of State's own certified nomination list
      // (2026 Candidate Nominations), the same filing the ballot surface
      // already cites for this candidacy.
      partyLabel: "Democratic",
      websiteUrl: "https://azgovernor.gov/",
      sourceUrl: "https://azgovernor.gov/",
      // Read off azgovernor.gov/constituent-services in a real browser
      // 2026-08-14: "602-542-4331 · engage@az.gov", office titled
      // "Office of the Arizona Governor Katie Hobbs".
      email: "engage@az.gov",
      phone: "(602) 542-4331",
      contactFormUrl: "https://azgovernor.gov/constituent-services",
      photoUrl: "/officials/statewide-az-governor.jpg",
      campaignUrl: null,
      // 6d: no sourced term end or birth date on a governor's own page.
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://azgovernor.gov/",
    sourceOrg: "Office of the Arizona Governor",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:nj",
    holder: {
      id: "statewide:nj/governor",
      name: "Mikie Sherrill",
      officeTitle: "Governor",
      // Read off the Division of Elections' certified tally, "Official List
      // Candidates for Governor", dated 12/03/2025: MIKIE SHERRILL (w) …
      // Democratic. Fetched and text-extracted 2026-08-15.
      partyLabel: "Democratic",
      websiteUrl: "https://www.nj.gov/governor/",
      sourceUrl: "https://www.nj.gov/governor/",
      email: null,
      // The office's own site (read in a real browser 2026-08-14,
      // titled "Office of New Jersey Governor Mikie Sherrill") publishes
      // NO phone number — the contact form is the published channel.
      // An absence is an absence; the draft's 609 number was removed
      // because the page doesn't state it.
      phone: null,
      contactFormUrl: "https://www.nj.gov/governor/contact/",
      photoUrl: "/officials/statewide-nj-governor.jpg",
      campaignUrl: null,
      // 6d: no sourced term end or birth date on a governor's own page.
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.nj.gov/governor/",
    sourceOrg: "Office of the Governor of New Jersey",
    partySourceUrl:
      "https://nj.gov/state/elections/assets/pdf/election-results/2025/2025-official-general-results-governor.pdf",
    partySourceOrg: "New Jersey Division of Elections (official general election results)",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:nh",
    holder: {
      id: "statewide:nh/governor",
      name: "Kelly Ayotte",
      officeTitle: "Governor",
      // Read off the Secretary of State's cumulative candidate filings
      // (7.16.26), the same filing the NH ballot surface already cites.
      partyLabel: "Republican",
      websiteUrl: "https://www.governor.nh.gov/",
      sourceUrl: "https://www.governor.nh.gov/",
      email: null,
      // Read off governor.nh.gov in a real browser 2026-08-14: page
      // titled "Welcome | Governor Kelly Ayotte", phone 603-271-2121
      // published on the page.
      phone: "(603) 271-2121",
      contactFormUrl: "https://www.governor.nh.gov/contact-governor-ayotte",
      photoUrl: "/officials/statewide-nh-governor.png",
      campaignUrl: null,
      // 6d: no sourced term end or birth date on a governor's own page.
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.governor.nh.gov/",
    sourceOrg: "Office of the Governor of New Hampshire",
    partySourceUrl:
      "https://www.sos.nh.gov/sites/g/files/ehbemt561/files/docs/cumulative-filings-7.16.26.pdf",
    partySourceOrg: "New Hampshire Secretary of State (cumulative candidate filings)",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },

  /* ==================================================================== */
  /* ARIZONA'S OTHER STATEWIDE EXECUTIVES — acquired 2026-08-28.          */
  /*                                                                      */
  /* Permission first, per host, before a byte was read (RULING 148):     */
  /*   azsos.gov        ALLOWED  robots 200, no rule covers the path      */
  /*   azag.gov         NO_ROBOTS robots 404 — nothing forbids the path   */
  /*   aztreasury.gov   ALLOWED  robots 200, `Allow: /`                   */
  /*   azed.gov         ALLOWED  robots 200 (read at rung 4)              */
  /*   asmi.az.gov      ALLOWED  robots 200 (read at rung 4)              */
  /*   azcc.gov         NO_ROBOTS robots 404 — nothing forbids the path   */
  /*                                                                      */
  /* `azmineinspector.gov` — the host this hunt started at — DOES NOT     */
  /* EXIST. NXDOMAIN from two resolvers and two clients, which is not a   */
  /* wall and not an absence of the office: the Arizona State Mine        */
  /* Inspector publishes at `asmi.az.gov`, found by walking the state's   */
  /* own `az.gov` namespace rather than by guessing a second `.gov`.      */
  /* ==================================================================== */

  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/secretary-of-state",
      name: "Adrian Fontes",
      officeTitle: "Secretary of State",
      // The office page does not print a party. This is the same certified
      // filing the AZ ballot surface cites for this same man's 2026 candidacy,
      // so the two surfaces read ONE record rather than two that agree today.
      partyLabel: "Democratic",
      websiteUrl: "https://azsos.gov/about/about-secretary",
      sourceUrl: "https://azsos.gov/about/about-secretary",
      email: null,
      // "Main: 602-542-4285", published in the page's own contact block.
      phone: "(602) 542-4285",
      contactFormUrl: "https://azsos.gov/about/contact-us",
      // A portrait is PROPOSED, never shipped by a session (RULING 55). The
      // office publishes one at
      // /sites/default/files/photo/AZ-SOS-Adrian-Fontes-Official-Photo-2025-sml.jpg
      // and it is staged for the author's review; until he approves it this
      // row renders initials, which blocks nothing.
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://azsos.gov/about/about-secretary",
    sourceOrg: "Arizona Secretary of State",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/attorney-general",
      name: "Kris Mayes",
      officeTitle: "Attorney General",
      partyLabel: "Democratic",
      websiteUrl: "https://www.azag.gov/kris-mayes",
      sourceUrl: "https://www.azag.gov/kris-mayes",
      email: null,
      // "(602) 542-5025", published in the page's own footer contact block.
      phone: "(602) 542-5025",
      contactFormUrl: null,
      // Proposed for review: /sites/default/files/2024-10/KrisMayesHeadshot.png,
      // alt text "Headshot of Kris Mayes wearing a grey suit."
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azag.gov/kris-mayes",
    sourceOrg: "Arizona Attorney General's Office",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/state-treasurer",
      name: "Kimberly Yee",
      officeTitle: "State Treasurer",
      // The 2026 filing lists Kimberly Yee as a REPUBLICAN candidate — for
      // Superintendent of Public Instruction, not for the office she holds.
      // The filing is a record of HER PARTY either way; it is emphatically
      // NOT a record that she is running for Treasurer, and the office join
      // is what keeps those two facts apart: her holder row sits on
      // `state_treasurer` and never enters the Superintendent contest.
      partyLabel: "Republican",
      websiteUrl: "https://www.aztreasury.gov/treasurer-kimberly-yee",
      sourceUrl: "https://www.aztreasury.gov/treasurer-kimberly-yee",
      email: null,
      // "Main: (602) 542-7800", published on the page.
      phone: "(602) 542-7800",
      contactFormUrl: "https://www.aztreasury.gov/contact",
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.aztreasury.gov/treasurer-kimberly-yee",
    sourceOrg: "Office of the Arizona State Treasurer",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/superintendent-of-public-instruction",
      name: "Tom Horne",
      officeTitle: "Superintendent of Public Instruction",
      partyLabel: "Republican",
      websiteUrl: "https://www.azed.gov/adeinfo/about-state-superintendent",
      sourceUrl: "https://www.azed.gov/adeinfo/about-state-superintendent",
      email: null,
      // "(602) 542-5393", published in the page's own footer contact block.
      phone: "(602) 542-5393",
      contactFormUrl: null,
      // The page's portrait is /sites/default/files/media/Tom Headshot 60px_0.jpg —
      // the filename states 60px and MIN_PORTRAIT_EDGE is 96, so it is
      // recorded and NOT proposed. A too-small portrait is a measured miss,
      // not an absence of one.
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azed.gov/adeinfo/about-state-superintendent",
    sourceOrg: "Arizona Department of Education",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/state-mine-inspector",
      // As the OFFICE publishes him, on its own team page. The Secretary of
      // State's 2026 primary canvass carries the filed form — `PRESMYK,
      // WALTER "LES"` — and the two are reconciled by the quoted alias the
      // filing itself prints, never by a session deciding they look alike.
      name: "Les Presmyk",
      officeTitle: "State Mine Inspector",
      // The 2026 Pima primary canvass, read 2026-08-28: `REP State Mine
      // Inspector — PRESMYK, WALTER "LES" — 63,830`. The party is the
      // election authority's, printed as the primary he stood in.
      partyLabel: "Republican",
      websiteUrl: "https://asmi.az.gov/about/team",
      sourceUrl: "https://asmi.az.gov/about/team",
      email: null,
      // "(602)-542-5971", published in the page's own contact block.
      phone: "(602) 542-5971",
      contactFormUrl: "https://asmi.az.gov/contact-us",
      // The team page's image for this row carries alt "Lpres" and the file
      // 2025-11/Pres06_141R.jpeg — neither is the person's NAME, so
      // `pickPortrait` refuses it and so does this row. A photo that needs a
      // human to say "that's probably him" fails at every door.
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://asmi.az.gov/about/team",
    sourceOrg: "Arizona State Mine Inspector",
    partySourceUrl: "https://apps.azsos.gov/election/2026/canvass/2026_Primary_Canvass_Pima.pdf",
    partySourceOrg: "Arizona Secretary of State (2026 primary canvass, Pima County)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },

  /* -------------------------------------------------------------------- */
  /* THE CORPORATION COMMISSION — the second SHAPE, not a second state.    */
  /*                                                                       */
  /* Five people are elected to ONE office on ONE division, so five rows   */
  /* carry the same `officeTitle` and `seatHoldersForOffice` returns all   */
  /* five for the ballot's `Corporation Commissioner` contest — the same   */
  /* multi-member handling a New Hampshire House district already gets,    */
  /* reached without a special case because the office key never carried   */
  /* the seat. Chair and Vice Chair are ROLES INSIDE the body and are not  */
  /* written into `officeTitle`: a title that drifted to "Chair" would     */
  /* stop matching the office the ballot elects.                           */
  /* -------------------------------------------------------------------- */

  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/myers",
      name: "Nick Myers",
      officeTitle: "Corporation Commissioner",
      // The 2026 Pima primary canvass — the SAME filing the AZ ballot cites
      // for this contest — carries `Nicholas "Nick" Myers` as a Republican.
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/nick-myers/biography",
      sourceUrl: "https://www.azcc.gov/nick-myers/biography",
      email: "Myers-Web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/nick-myers/biography",
    sourceOrg: "Arizona Corporation Commission",
    partySourceUrl: "https://apps.azsos.gov/election/2026/canvass/2026_Primary_Canvass_Pima.pdf",
    partySourceOrg: "Arizona Secretary of State (2026 primary canvass, Pima County)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/walden",
      name: "Rachel Walden",
      officeTitle: "Corporation Commissioner",
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/Rachel-Walden/biography",
      sourceUrl: "https://www.azcc.gov/Rachel-Walden/biography",
      email: "Walden-Web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/Rachel-Walden/biography",
    sourceOrg: "Arizona Corporation Commission",
    // Not a 2026 candidate, so the 2026 filing does not describe her. The
    // Secretary of State's certified list for the election she WON does:
    // "Walden, Rachel — Corporation Commissioner — 3 — REP".
    partySourceUrl: "https://apps.azsos.gov/election/2024/ge_cand/2024_General_Candidates_Web.pdf",
    partySourceOrg: "Arizona Secretary of State (2024 general election candidate listing)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/thompson",
      name: "Kevin Thompson",
      officeTitle: "Corporation Commissioner",
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/kevin-thompson/biography",
      sourceUrl: "https://www.azcc.gov/kevin-thompson/biography",
      email: "Thompson-Web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/kevin-thompson/biography",
    sourceOrg: "Arizona Corporation Commission",
    partySourceUrl: "https://apps.azsos.gov/election/2026/canvass/2026_Primary_Canvass_Pima.pdf",
    partySourceOrg: "Arizona Secretary of State (2026 primary canvass, Pima County)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/marquez-peterson",
      name: "Lea Márquez Peterson",
      officeTitle: "Corporation Commissioner",
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/lmarquezpeterson/biography",
      sourceUrl: "https://www.azcc.gov/lmarquezpeterson/biography",
      email: "lmarquezpeterson-web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/lmarquezpeterson/biography",
    sourceOrg: "Arizona Corporation Commission",
    // "Marquez Peterson, Lea — Corporation Commissioner — 3 — REP".
    partySourceUrl: "https://apps.azsos.gov/election/2024/ge_cand/2024_General_Candidates_Web.pdf",
    partySourceOrg: "Arizona Secretary of State (2024 general election candidate listing)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/lopez",
      name: "René Lopez",
      officeTitle: "Corporation Commissioner",
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/Rene-Lopez/biography",
      sourceUrl: "https://www.azcc.gov/Rene-Lopez/biography",
      email: "Lopez-Web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/Rene-Lopez/biography",
    sourceOrg: "Arizona Corporation Commission",
    // "Lopez, Rene — Corporation Commissioner — 3 — REP".
    partySourceUrl: "https://apps.azsos.gov/election/2024/ge_cand/2024_General_Candidates_Web.pdf",
    partySourceOrg: "Arizona Secretary of State (2024 general election candidate listing)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },

  /* ==================================================================== */
  /* THE SECOND-JURISDICTION CONTROL — New Jersey's Lieutenant Governor.   */
  /*                                                                      */
  /* A method proved in one state is proved for that SHAPE, not for       */
  /* everywhere (RULING 60). The Arizona rows above all came from the     */
  /* same route — an executive office publishing its own officeholder —   */
  /* and a route that only ever worked in Arizona would look identical    */
  /* from inside Arizona. So it was run once more, cold, in a different   */
  /* state, against an office nobody had asked for: `nj.gov/governor`     */
  /* names both officers in its own masthead and gives the Lieutenant     */
  /* Governor her own page. Same route, different jurisdiction, one more  */
  /* officeholder this product could not previously name.                 */
  /*                                                                      */
  /* And the route's TRANSPORT differed, which is the finding worth       */
  /* keeping: `nj.gov` is behind Imperva, and this project's own ladder   */
  /* refuses it at rungs 2 through 4 — `challengeIn` fires on the         */
  /* injected interstitial script even when the full document is present. */
  /* Bare `curl` returns the whole page. VARY THE CLIENT BEFORE CALLING   */
  /* A HOST WALLED.                                                       */
  /* ==================================================================== */

  {
    stateOcdId: "ocd-division/country:us/state:nj",
    holder: {
      id: "statewide:nj/lieutenant-governor",
      name: "Dale G. Caldwell",
      officeTitle: "Lieutenant Governor",
      partyLabel: null,
      websiteUrl: "https://www.nj.gov/governor/admin/ltgovernor/",
      sourceUrl: "https://www.nj.gov/governor/admin/ltgovernor/",
      email: null,
      phone: null,
      contactFormUrl: "https://www.nj.gov/governor/contact/",
      // The office publishes a headshot at
      // /governor/library/secondary/ltgov_LGDaleCaldwell_new.jpg, alt
      // "Caldwell Dr. Dale Official Headshot" — proposed for review, not
      // shipped by this session.
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.nj.gov/governor/admin/ltgovernor/",
    sourceOrg: "Office of the Governor of New Jersey",
    partyAbsence:
      "New Jersey elects the Lieutenant Governor on the gubernatorial TICKET, so the Division " +
      "of Elections' certified record for the 2025 general election is titled 'Official List " +
      "Candidates for Governor' and names only Mikie Sherrill — read in full 2026-08-28, five " +
      "pages, no mention of a running mate. The office's own page states the officeholder and " +
      "no party. Inheriting the Governor's party would be inferring one person's affiliation " +
      "from another's, which is the exact inference this product forbids.",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
];

/**
 * The statewide executives for whichever state these divisions sit in —
 * the `senatorsFor` shape: identifiers in, holders out, the state read
 * off the OCD prefix the geometry already resolved.
 */
export function statewideExecutivesFor(ocdIds: string[]): SeatHolder[] {
  const states = new Set<string>();
  for (const ocdId of ocdIds) {
    const state = stateOcdIdFrom(ocdId);
    if (state) states.add(state);
  }

  const holders: SeatHolder[] = [];
  for (const executive of STATEWIDE_EXECUTIVES) {
    if (!states.has(executive.stateOcdId)) continue;
    // Item 1 (2026-08-16): the entry already recorded the publisher and the
    // read date; the holder handed to the surfaces did not carry them, so a
    // card listing a governor could not say who published the claim. Attached
    // here rather than duplicated into each literal above — one place, and it
    // cannot drift from the `sourceOrg`/`collectedAt` the tests already hold.
    holders.push({
      ...executive.holder,
      provenance: {
        sourceUrl: executive.sourceUrl,
        sourceOrg: executive.sourceOrg,
        collectedAt: executive.collectedAt,
        verifiedAt: null,
      },
    });
  }
  return holders;
}
