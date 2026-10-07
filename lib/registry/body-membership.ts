import HOLDINGS from "../../data/states/az/officials/body-compositions.json" with { type: "json" };

import { rosterHoldersForBody, type RosterHolder } from "./body-rosters.ts";

/**
 * Who constitutes a body: explicitly, or not at all. Every body reaching a reader resolves through
 * exactly one of:
 * - `DIRECT_BODY_ROSTER`: the body publishes its own membership.
 * - `EXPLICIT_LEGAL_ALIAS`: another governing body legally sits as this board, with the authority
 *   recorded and cited.
 * - `ALIAS_PLUS_ADDITIONAL_SEATS`: as above, plus seats the aliased roster does not contain.
 * - `UNKNOWN_COMPOSITION`: the default; membership is not sourced, rendered as a named gap.
 *
 * A body never acquires members because it shares an `ocdId` with a government that has some: who
 * governs a geography is not who sits on a body.
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
  /** Who holds it, or null when the seat is proven and the holder is not. Never an invented name. */
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
   * The seat count the source itself states, where it states one. A rendered roster that disagrees with
   * it is an integrity defect.
   */
  expectedSeats?: number;
  additionalSeats?: AdditionalSeat[];
}

/**
 * The recorded compositions. Absence from this list means `UNKNOWN_COMPOSITION`, not a defect. Every
 * row carries the document behind it.
 */
export const BODY_COMPOSITIONS: readonly BodyComposition[] = HOLDINGS.records.BODY_COMPOSITIONS as readonly BodyComposition[];

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
 * The one place a surface asks who sits on a body. There is no division fallback here: a body with no
 * own roster and no recorded composition resolves to `UNKNOWN_COMPOSITION` with no members.
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
        officeJurisdictionOcdId: composition.bodyId.split("#")[0],
        termNote: null,
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
