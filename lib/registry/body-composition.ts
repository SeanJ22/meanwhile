import { rosterHoldersForBody, type RosterHolder } from "./body-rosters.ts";

/**
 * **WHO CONSTITUTES THIS BODY — EXPLICITLY, OR NOT AT ALL.**
 * (2026-08-27, the coverage-truth session. Red Controls 2 and 3.)
 *
 * ## The defect
 *
 * A body card resolved its membership like this:
 *
 * ```
 * the body has its own roster?  -> use it
 * otherwise                     -> governingRosterHoldersForDivision(body.ocdId)
 * ```
 *
 * The fallback asks *who governs this GEOGRAPHY* and renders the answer as
 * *who sits on this BODY*. Those are different questions, and the second one is
 * a claim about named people.
 *
 * **74 of the registry's 1,998 bodies rendered named members through that
 * fallback and through nothing else** (measured 2026-08-27 on `main` at
 * `9e75bea`). Among them:
 *
 * - The **Central Arizona Water Conservation District Board** showed the five
 *   Pima County Supervisors, with "Jennifer Allen — Presides". CAWCD's own
 *   board page says it is a *popularly elected, 15-member board* — ten from
 *   Maricopa, four from Pima, one from Pinal — currently Aguilar, Arboleda,
 *   Atkins, Cesare, Fischer, Goddard, Graff, Jacobs, Macre, Manuel, Miller,
 *   Monize, Seago, Taylor and Tornquist, presided over by **Terry Goddard**.
 *   Wrong people, wrong count, wrong presiding officer.
 * - **58 City of Tucson boards and commissions** — the Planning Commission, the
 *   Civil Service Commission, the Design Review Board, the Human Relations
 *   Commission — each showed the Mayor and the six Council Members. These are
 *   appointed citizen bodies. Not one of those rosters was true.
 * - Eight Newbury committees showed the three Selectmen; four Rockaway Township
 *   boards showed the ten-member Council; the Merrimack County Conservation
 *   District showed the county's three commissioners.
 *
 * ## Why deleting the fallback is not the whole answer
 *
 * Some of those bodies genuinely ARE another government sitting as a board, and
 * a repair that rendered them all empty would replace a false claim with a
 * false absence. Verified from primary sources on 2026-08-27:
 *
 * ```
 * Pima County Regional Flood Control District
 *   A.R.S. 48-3602(B)  "The county board of supervisors shall be the board
 *                       of directors of the district."
 * Pima County Free Library District
 *   A.R.S. 48-3901(C)  "The board of supervisors shall be the board of
 *                       directors of the county free library district."
 * Pima County Stadium District
 *   A.R.S. 48-4202(D)  "The county board of supervisors shall be the board of
 *                       directors of a countywide district ... in a county with
 *                       a population of less than one million five hundred
 *                       thousand persons."
 * City of Tucson Public Housing Authority Board of Commissioners
 *   the City's own 2026-02-18 agenda: "The Mayor and Council and a Resident
 *   Appointee will act as the Board of Commissioners of the Public Housing
 *   Authority"
 * ```
 *
 * So three of the four Pima districts inherited the RIGHT people for the WRONG
 * reason, and the Tucson PHA inherited *most* of the right people — it is
 * missing the Resident Appointee, currently **Trystan Hawkins**, a Housing
 * Choice Voucher participant, named by the City's own HCD newsroom.
 *
 * **CAWCD is the control that proves the pattern is not a rule.** It is
 * attached to the same county division as the three statutory districts and its
 * board is nothing like theirs. A fallback cannot tell those apart. A recorded
 * authority can, and must.
 *
 * ## The model
 *
 * Every body reaching a reader resolves through exactly one of these, and the
 * default is the honest one:
 *
 * - `DIRECT_BODY_ROSTER` — the body publishes its own membership.
 * - `EXPLICIT_LEGAL_ALIAS` — another governing body legally sits as this board,
 *   and the authority for that is recorded and cited.
 * - `ALIAS_PLUS_ADDITIONAL_SEATS` — as above, plus seats the aliased roster
 *   does not contain.
 * - `UNKNOWN_COMPOSITION` — the body is verified and its membership is not
 *   sourced. **This is the default, and it renders as a named gap.**
 *
 * A body may never acquire members because it shares an `ocdId` with a
 * government that has some.
 */

export type CompositionKind =
  | "DIRECT_BODY_ROSTER"
  | "EXPLICIT_LEGAL_ALIAS"
  | "ALIAS_PLUS_ADDITIONAL_SEATS"
  | "UNKNOWN_COMPOSITION";

/** The record that proves a composition claim. No claim ships without one. */
export interface CompositionAuthority {
  /** What the source actually says, quoted rather than paraphrased. */
  quote: string;
  sourceUrl: string;
  sourceOrg: string;
  /** The day it was read. */
  collectedAt: string;
}

/** A seat the aliased roster does not contain. */
export interface AdditionalSeat {
  /** The seat's own title, as the source words it. */
  officeTitle: string;
  /**
   * Who holds it, or **null when the seat is proven and the holder is not**.
   * A named seat with an unsourced holder is a real, renderable fact — "this
   * board has a Resident Appointee seat and we have not sourced who fills it"
   * is true and useful. Inventing a name for it is not.
   */
  name: string | null;
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
}

export interface BodyComposition {
  /** Matches `Body.id` exactly. */
  bodyId: string;
  kind: CompositionKind;
  /**
   * The body whose roster legally sits as this board. Required for both alias
   * kinds and forbidden otherwise — it is the join, and it is a BODY id, never
   * a division.
   */
  aliasOfBodyId?: string;
  /** Required for both alias kinds: what makes the alias lawful. */
  authority?: CompositionAuthority;
  /**
   * The seat count the source itself states, where it states one.
   *
   * This is the number a rendered roster is checked against. CAWCD publishes
   * "15-member board"; the app rendered 5. A stated count that disagrees with
   * the rendered count is an integrity defect, and it is only catchable if the
   * stated count is carried.
   */
  expectedSeats?: number;
  additionalSeats?: AdditionalSeat[];
}

const PIMA_BOARD = "ocd-division/country:us/state:az/county:pima#governing";
const TUCSON_COUNCIL = "ocd-division/country:us/state:az/place:tucson#governing";

/**
 * The recorded compositions.
 *
 * **Absence from this list is not a defect** — it means `UNKNOWN_COMPOSITION`,
 * which is the honest state for a body whose membership nobody has sourced, and
 * which is where 70 of the 74 formerly-inheriting bodies now sit. Adding a row
 * here is a claim, and every row carries the document behind it.
 */
export const BODY_COMPOSITIONS: readonly BodyComposition[] = [
  /*
   * ---- Arizona county special districts, aliased BY STATUTE ---------------
   *
   * A REUSABLE ROUTE, not three one-off findings. Arizona declares each
   * special district's governing board in A.R.S. Title 48, so the question
   * "who sits on this district's board?" has a statutory answer for every
   * district in the state, and the statute is a better source than any county
   * page because it says what the board IS rather than who is on it today.
   * Recorded in the method store so the next Arizona county costs nothing.
   */
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#regional-flood-control-district",
    kind: "EXPLICIT_LEGAL_ALIAS",
    aliasOfBodyId: PIMA_BOARD,
    authority: {
      quote: "The county board of supervisors shall be the board of directors of the district.",
      sourceUrl: "https://www.azleg.gov/ars/48/03602.htm",
      sourceOrg: "Arizona Revised Statutes § 48-3602(B)",
      collectedAt: "2026-08-27",
    },
  },
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#free-library-district",
    kind: "EXPLICIT_LEGAL_ALIAS",
    aliasOfBodyId: PIMA_BOARD,
    authority: {
      quote:
        "The board of supervisors shall be the board of directors of the county free library district.",
      sourceUrl: "https://www.azleg.gov/ars/48/03901.htm",
      sourceOrg: "Arizona Revised Statutes § 48-3901(C)",
      collectedAt: "2026-08-27",
    },
  },
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#stadium-district",
    kind: "EXPLICIT_LEGAL_ALIAS",
    aliasOfBodyId: PIMA_BOARD,
    authority: {
      /*
       * The population clause is part of the quote deliberately. It is a
       * CONDITION, and a district in Maricopa — over 1.5 million — has a
       * different board under the same section. Quoting only the first half
       * would make this row look portable to a county where it is false.
       */
      quote:
        "The county board of supervisors shall be the board of directors of a countywide district " +
        "established under subsection A of this section in a county with a population of less than " +
        "one million five hundred thousand persons.",
      sourceUrl: "https://www.azleg.gov/ars/48/04202.htm",
      sourceOrg: "Arizona Revised Statutes § 48-4202(D)",
      collectedAt: "2026-08-27",
    },
  },

  /*
   * ---- Tucson's Public Housing Authority: alias PLUS a seat ---------------
   *
   * The author's visual review flagged this card because it showed the Mayor
   * and Council, and the primary source says the Mayor and Council are RIGHT.
   * What the card could not do was prove it — it reached them through the
   * division fallback, the same way the CAWCD card reached the wrong people —
   * and it dropped the Resident Appointee, so a seven-person roster stood for
   * an eight-seat board.
   */
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#public-housing-authority",
    kind: "ALIAS_PLUS_ADDITIONAL_SEATS",
    aliasOfBodyId: TUCSON_COUNCIL,
    authority: {
      quote:
        "The Mayor and Council and a Resident Appointee will act as the Board of Commissioners of " +
        "the Public Housing Authority for the purpose of the following item(s).",
      sourceUrl:
        "https://www.tucsonaz.gov/files/sharedassets/public/v/1/clerks/documents/agenda-committee/20260218acmtg1.min.pdf",
      sourceOrg: "City of Tucson, Mayor and Council agenda, 2026-02-18",
      collectedAt: "2026-08-27",
    },
    additionalSeats: [
      {
        officeTitle: "Resident Appointee",
        name: "Trystan Hawkins",
        sourceUrl:
          "https://www.tucsonaz.gov/Departments/Housing-and-Community-Development/HCD-News/HCD-Thanks-Property-Managers-for-Supporting-Housing-Voucher-Program",
        sourceOrg: "City of Tucson Housing and Community Development",
        collectedAt: "2026-08-27",
      },
    ],
  },
];

const BY_ID = new Map(BODY_COMPOSITIONS.map((c) => [c.bodyId, c]));

export function compositionFor(bodyId: string | null): BodyComposition | null {
  if (!bodyId) return null;
  return BY_ID.get(bodyId) ?? null;
}

export interface ResolvedComposition {
  kind: CompositionKind;
  members: RosterHolder[];
  /** The authority behind an alias, for the card to cite. Null otherwise. */
  authority: CompositionAuthority | null;
  /** What the source says the seat count is, where it says one. */
  expectedSeats: number | null;
  /**
   * True when the body is verified but its membership is not sourced.
   *
   * The card renders a NAMED GAP on this, never an empty list dressed as a
   * complete one — "we haven't recorded who sits on this body" is a fact about
   * US, and it may never look like a fact about them.
   */
  unknown: boolean;
}

/**
 * **The one place a surface asks who sits on a body.**
 *
 * There is no division fallback in here and there must never be one. A body
 * with no own roster and no recorded composition resolves to
 * `UNKNOWN_COMPOSITION` with an empty member list, and that is the correct
 * answer: the alternative is plausible people from the parent government, which
 * is the defect this module was built to end.
 */
export function membersOfBody(bodyId: string | null): ResolvedComposition {
  const direct = rosterHoldersForBody(bodyId);
  if (direct.length > 0) {
    return {
      kind: "DIRECT_BODY_ROSTER",
      members: direct,
      authority: null,
      expectedSeats: compositionFor(bodyId)?.expectedSeats ?? null,
      unknown: false,
    };
  }

  const composition = compositionFor(bodyId);
  if (
    composition &&
    (composition.kind === "EXPLICIT_LEGAL_ALIAS" ||
      composition.kind === "ALIAS_PLUS_ADDITIONAL_SEATS") &&
    composition.aliasOfBodyId
  ) {
    const aliased = rosterHoldersForBody(composition.aliasOfBodyId);
    /*
     * A RECORDED ALIAS WHOSE ALIASED ROSTER IS EMPTY IS STILL UNKNOWN.
     * The authority proves the RELATIONSHIP; it does not conjure members. If
     * the body we alias to has nobody, this body has nobody to show, and
     * saying so is the honest answer rather than rendering the authority quote
     * over an empty list as though it were a roster.
     */
    if (aliased.length === 0) {
      return {
        kind: "UNKNOWN_COMPOSITION",
        members: [],
        authority: composition.authority ?? null,
        expectedSeats: composition.expectedSeats ?? null,
        unknown: true,
      };
    }

    const extra: RosterHolder[] = (composition.additionalSeats ?? [])
      .filter((s) => s.name !== null)
      .map((s, i) => ({
        id: `composition:${composition.bodyId}#seat-${i}`,
        name: s.name as string,
        officeTitle: s.officeTitle,
        partyLabel: null,
        websiteUrl: null,
        sourceUrl: s.sourceUrl,
        provenance: {
          sourceUrl: s.sourceUrl,
          sourceOrg: s.sourceOrg,
          collectedAt: s.collectedAt,
          verifiedAt: null,
        },
        email: null,
        phone: null,
        contactFormUrl: null,
        photoUrl: null,
        campaignUrl: null,
        termEnd: null,
        birthDate: null,
      }));

    return {
      kind: composition.kind,
      members: [...aliased, ...extra],
      authority: composition.authority ?? null,
      expectedSeats: composition.expectedSeats ?? null,
      unknown: false,
    };
  }

  return {
    kind: "UNKNOWN_COMPOSITION",
    members: [],
    authority: null,
    expectedSeats: composition?.expectedSeats ?? null,
    unknown: true,
  };
}
