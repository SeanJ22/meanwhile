import type { BodyRoster } from "./body-rosters.ts";

/**
 * **THE CENTRAL ARIZONA WATER CONSERVATION DISTRICT BOARD, WIRED**
 * (2026-08-27, the ask-entity session.)
 *
 * Fifteen directly elected directors, read from the district's own board pages
 * on 2026-08-27. This is the body that taxes every parcel in Pima County —
 * Resolution 2026-43 levies its ad valorem secondary at 0.1000 and its water
 * storage secondary at 0.0400 — and until this file it rendered NO members to
 * a reader at all.
 *
 * ## Why it rendered nobody, and why that was the right failure
 *
 * It used to render the FIVE PIMA COUNTY SUPERVISORS, taken by a geographic
 * fallback from the division this body hangs off (`county:pima`). That was a
 * false claim about who governs a reader, and it was corrected by removing the
 * fallback — which left an honest emptiness in its place. `lib/registry/
 * body-composition.ts` holds that story.
 *
 * ## Why it stayed empty afterwards, and why that was NOT right
 *
 * The roster was verified once before and not wired, because the board's
 * PARTISANSHIP had not been sourced from an election authority. That coupled
 * two independent facts: **who sits on the body** (verified, from the body's
 * own current publication) and **whether its seats carry a party** (genuinely
 * unknown). CLAUDE.md is explicit that collection state never governs display
 * and that there is no completeness bar — so fifteen sourced people were held
 * back from a reader by an orthogonal unknown.
 *
 * They are separated here. Membership is integrated with its provenance;
 * partisanship stays `UNDETERMINED`, renders nothing, and remains an open
 * work item. **No party is invented, and silence is not read as nonpartisan.**
 *
 * ## Provenance, and what is read rather than inferred
 *
 * Each member has their own page under `/board/board-members/<name>/`, and
 * each page states the member's ROLE and COUNTY in its own heading — "PRESIDENT
 * - MARICOPA", "Secretary - PIMA", "Board Member - Pima". Both are read off
 * that heading. Nothing here is derived from a name, a photograph or a search
 * result.
 *
 * The county split the pages produce is **Maricopa 10, Pima 4, Pinal 1**, which
 * is exactly the statutory composition of this board — an independent check
 * that the fifteen pages were read correctly and that none was missed.
 *
 * This also CORRECTS a note in `curated-bodies.ts` written from an earlier
 * read, which recorded that only three members were confirmed Pima and that
 * "four members' pages do not state a county". Every one of the fifteen pages
 * states a county today. The fourth Pima member is Justin Manuel.
 *
 * ## The four Pima seats
 *
 * All four Pima directors trace to the 3 November 2020 election and six-year
 * terms — Mark Taylor's page says so outright ("His term expires December 31,
 * 2026") — with Justin Manuel appointed by Governor Hobbs in May 2023 to fill
 * that term. So four Pima seats fall vacant on 2026-12-31. Whether, and how,
 * they appear on the 2026 ballot is an ELECTION AUTHORITY question and is
 * tracked separately (NH244); nothing about the ballot is asserted from this
 * roster, and a sitting director is never treated as a candidate.
 */

const SOURCE_ORG = "Central Arizona Water Conservation District";
const BOARD_PAGE = "https://www.cap-az.com/board/board-members/";
const COLLECTED = "2026-08-27";

/** One member's own page — the record each row's role and county is read from. */
const page = (slug: string) => `${BOARD_PAGE}${slug}/`;

export const AZ_CAWCD_ROSTERS: BodyRoster[] = [
  {
    bodyId:
      "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district",
    bodyName: "Central Arizona Water Conservation District Board of Directors",
    sourceUrl: BOARD_PAGE,
    sourceOrg: SOURCE_ORG,
    collectedAt: COLLECTED,
    /*
     * **UNDETERMINED, and deliberately so.**
     *
     * Rung 1 is walked and answered: the district's own pages state role and
     * county for every member and state no party for any of them. That is a
     * finding about the PAGES and settles nothing about the SEATS — CAWCD
     * director is a state-law office and the question of whether it is
     * contested on party lines has to come from an election authority's own
     * record (the certified partisan primary canvass, or the county's
     * nomination paperwork), exactly as M62 established for the twelve rosters
     * before this one.
     *
     * That record has not been read yet, so this stays UNDETERMINED, cites
     * nothing, and renders no party for anybody. It is an open work item, not
     * a reason to withhold fifteen sourced people from a reader.
     */
    partisanship: "UNDETERMINED",
    members: [
      {
        id: "roster:cawcd#goddard",
        name: "Terry Goddard",
        officeTitle: "Board President",
        termNote: "Represents Maricopa County. Term expires December 31, 2030",
        email: null,
        phone: null,
        websiteUrl: page("terry-goddard"),
      },
      {
        id: "roster:cawcd#arboleda",
        name: "Alexandra Arboleda",
        officeTitle: "Board Vice President",
        termNote: "Represents Maricopa County",
        email: null,
        phone: null,
        websiteUrl: page("alexandra-arboleda"),
      },
      {
        id: "roster:cawcd#cesare",
        name: "Karen Cesare",
        officeTitle: "Board Secretary",
        termNote: "Represents Pima County. Term expires December 31, 2026",
        email: null,
        phone: null,
        websiteUrl: page("karen-cesare"),
      },
      {
        id: "roster:cawcd#aguilar",
        name: "Ylenia Aguilar",
        officeTitle: "Board Member",
        termNote: "Represents Maricopa County",
        email: null,
        phone: null,
        websiteUrl: page("ylenia-aguilar"),
      },
      {
        id: "roster:cawcd#atkins",
        name: "Lisa A. Atkins",
        officeTitle: "Board Member",
        termNote: "Represents Maricopa County. Term expires December 31, 2030",
        email: null,
        phone: null,
        websiteUrl: page("lisa-a-atkins"),
      },
      {
        id: "roster:cawcd#fischer",
        name: "Rudy Fischer",
        officeTitle: "Board Member",
        termNote: "Represents Maricopa County",
        email: null,
        phone: null,
        websiteUrl: page("rudy-fischer"),
      },
      {
        id: "roster:cawcd#graff",
        name: "Benjamin Graff",
        officeTitle: "Board Member",
        termNote: "Represents Maricopa County",
        email: null,
        phone: null,
        websiteUrl: page("benjamin-graff"),
      },
      {
        id: "roster:cawcd#jacobs",
        name: "Pat Jacobs",
        officeTitle: "Board Member",
        termNote: "Represents Pima County. Term expires December 31, 2026",
        email: null,
        phone: null,
        websiteUrl: page("pat-jacobs"),
      },
      {
        id: "roster:cawcd#macre",
        name: "Heather Macre",
        officeTitle: "Board Member",
        termNote: "Represents Maricopa County",
        email: null,
        phone: null,
        websiteUrl: page("heather-macre"),
      },
      {
        id: "roster:cawcd#manuel",
        name: "Justin Manuel",
        officeTitle: "Board Member",
        termNote:
          "Represents Pima County. Appointed by Governor Katie Hobbs in May 2023",
        email: null,
        phone: null,
        websiteUrl: page("justin-manuel"),
      },
      {
        id: "roster:cawcd#miller",
        name: "Stephen Miller",
        officeTitle: "Board Member",
        termNote: "Represents Pinal County",
        email: null,
        phone: null,
        websiteUrl: page("stephen-miller"),
      },
      {
        id: "roster:cawcd#monize",
        name: "Amanda Monize",
        officeTitle: "Board Member",
        termNote: "Represents Maricopa County",
        email: null,
        phone: null,
        websiteUrl: page("amanda-monize"),
      },
      {
        id: "roster:cawcd#seago",
        name: "Barbara Seago",
        officeTitle: "Board Member",
        termNote: "Represents Maricopa County",
        email: null,
        phone: null,
        websiteUrl: page("barbara-seago"),
      },
      {
        id: "roster:cawcd#taylor",
        name: "Mark Taylor",
        officeTitle: "Board Member",
        termNote: "Represents Pima County. Term expires December 31, 2026",
        email: null,
        phone: null,
        websiteUrl: page("mark-taylor"),
      },
      {
        id: "roster:cawcd#tornquist",
        name: "April Tornquist",
        officeTitle: "Board Member",
        termNote: "Represents Maricopa County",
        email: null,
        phone: null,
        websiteUrl: page("april-tornquist"),
      },
    ],
  },
];
