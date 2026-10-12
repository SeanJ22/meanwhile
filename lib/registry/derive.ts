import { isCensusPlaceholderDivision } from "./census-placeholders.ts";
import type { Division, Body, BodyClass } from "./types.ts";

/**
 * Division type → the bodies that must exist inside it.
 *
 * The rule is structural, and it is the only thing that scales: there are
 * 90,837 local governments and nobody is going to type them out. A county has a
 * board. An incorporated municipality has a council. A school district has a
 * governing board. None of that is a guess about a *person* — it is a fact
 * about the shape of the division, and the shape is already in the boundary
 * files.
 *
 * Everything it produces is labelled `DERIVED_FROM_DIVISION_TYPE` and
 * `NO_SOURCE_FOUND`. The claim is "this division has a governing board", never
 * "here is its name, schedule, or membership".
 */

/**
 * LSAD codes that mean a polygon has an actual government. Read off the Census place and
 * county-subdivision files rather than assumed: in many states most places are CDPs and the county
 * subdivisions are statistical CCDs.
 *
 * | Code | Means            | Governs |
 * |------|------------------|---------|
 * | 21   | borough          | yes     |
 * | 25   | city             | yes     |
 * | 43   | town             | yes     |
 * | 44   | township         | yes     |
 * | 47   | village          | yes     |
 * | 00   | Princeton NJ     | yes — a consolidated municipality Census cannot classify |
 * | 22   | CCD              | no — statistical |
 * | 57   | CDP              | no — statistical |
 * | 32/36/42 | grant, location, purchase | no — unorganized NH territory |
 */
const GOVERNING_LSAD = new Set(["00", "21", "25", "43", "44", "47"]);

/** Statistical or unorganized. Named explicitly so an unknown code is not silently treated as either. */
const NON_GOVERNING_LSAD = new Set(["22", "57", "32", "36", "42"]);

/**
 * Census `FUNCSTAT` codes that mean this polygon is a government.
 *
 * `A` active with primary general-purpose functions, `B` active and partially consolidated but with its
 * own officials, `G` active but subordinate to another unit. `C` is consolidated with another unit under
 * a single set of officials (e.g. Nashville-Davidson); it is included because deleting a real city is
 * worse, but a `C` place plus its county currently derives two bodies where there is one council.
 */
const GOVERNING_FUNCSTAT = new Set(["A", "B", "C", "G"]);

/**
 * Codes that mean this polygon is not a government. `F` resolves the place/cousub duplicate: Census
 * writes a fictitious row into one layer when the government is already listed in the other. `N` is a
 * nonfunctioning legal entity, `S` a statistical one, `I` an inactive special-purpose unit.
 */
const NON_GOVERNING_FUNCSTAT = new Set(["F", "N", "S", "I"]);

export type SkipReason =
  | "statistical-or-unorganized"
  | "fictitious-duplicate-of-another-layer"
  | "unknown-lsad"
  | "unknown-funcstat"
  | "legislative-seat-not-a-meeting-body"
  /** TIGER's "no district here" placeholder (LEA 99997): geography, never a board. */
  | "census-placeholder-not-a-government"
  | "body-structure-not-yet-sourced";

export interface DerivedSlot {
  bodyClass: BodyClass;
  /** Appended to the division's ocdId to make a stable body id. */
  slot: string;
}

export interface DerivationOutcome {
  slots: DerivedSlot[];
  skipped: SkipReason | null;
}

/**
 * What bodies a division implies, and when it implies none.
 *
 * Returning a reason rather than an empty array matters: "this division has no
 * governing body" and "we could not tell" are different answers, and only one
 * of them is a data gap worth chasing.
 */
export function slotsFor(division: Division): DerivationOutcome {
  switch (division.divisionType) {
    case "county":
      // One governing body either way; the name is not knowable from the division type.
      return { slots: [{ bodyClass: "GOVERNING", slot: "governing" }], skipped: null };

    case "school_district":
      // The Census's "School District Not Defined" row is land inside no
      // district: a true place, and no board meets for it.
      if (isCensusPlaceholderDivision(division)) return { slots: [], skipped: "census-placeholder-not-a-government" };
      return { slots: [{ bodyClass: "GOVERNING", slot: "board" }], skipped: null };

    case "place": {
      // FUNCSTAT first: it states functional status directly where LSAD only names the legal form, and it
      // is the only field that tells a real municipality from the fictitious row in the other layer.
      const funcstat = division.funcstat ?? "";
      if (funcstat) {
        if (NON_GOVERNING_FUNCSTAT.has(funcstat)) {
          return {
            slots: [],
            skipped:
              funcstat === "F"
                ? "fictitious-duplicate-of-another-layer"
                : "statistical-or-unorganized",
          };
        }
        if (GOVERNING_FUNCSTAT.has(funcstat)) {
          return {
            slots: [{ bodyClass: "GOVERNING", slot: "governing" }],
            skipped: null,
          };
        }
        // A code outside both tables is a gap here, not a licence to guess.
        return { slots: [], skipped: "unknown-funcstat" };
      }

      // No FUNCSTAT: a boundary file built before the TIGER attribute join, or
      // a layer TIGER has no counterpart for. Fall back to LSAD, which answers
      // "does this govern" correctly but cannot see the duplicate.
      const lsad = division.lsad ?? "";
      if (GOVERNING_LSAD.has(lsad)) {
        return { slots: [{ bodyClass: "GOVERNING", slot: "governing" }], skipped: null };
      }
      if (NON_GOVERNING_LSAD.has(lsad)) {
        // A CDP has no municipal government; generating a council for it would be a fabrication.
        return { slots: [], skipped: "statistical-or-unorganized" };
      }
      // An unrecognised code is a gap in this table, not a licence to guess.
      return { slots: [], skipped: "unknown-lsad" };
    }

    case "sldu":
    case "sldl":
    case "cd":
      // A legislative district elects a seat in a chamber that sits elsewhere; the chamber is not a body of
      // this division.
      return { slots: [], skipped: "legislative-seat-not-a-meeting-body" };
    default:
      // An Admin-added kind is admissible geography, not permission to infer
      // its board, powers or territorial relationship. The directory supplies those.
      return { slots: [], skipped: "body-structure-not-yet-sourced" };
  }
}

/** Build the body rows a division implies. */
export function bodiesFor(division: Division, now: string): Body[] {
  const { slots } = slotsFor(division);

  return slots.map((slot) => ({
    id: `${division.ocdId}#${slot.slot}`,
    ocdId: division.ocdId,
    // Structural existence is all that is known. The name is a sourced fact.
    name: null,
    bodyClass: slot.bodyClass,
    bodyOrigin: "DERIVED_FROM_DIVISION_TYPE" as const,
    // NOT_ATTEMPTED, never NO_SOURCE_FOUND. Derivation knows this body exists
    // and nothing else; claiming a search came back empty when no search ran is
    // the same shape of untruth as minting the body's name. A hunt recorded in
    // lib/registry/audit.ts is the only thing that may move this.
    coverageStatus: "NOT_ATTEMPTED" as const,
    agendaSourceType: "NONE" as const,
    agendaSourceRef: null,
    meetingCadence: null,
    homepageUrl: null,
    demandCount: 0,
    sourceDataset: "DERIVED" as const,
    provenance: {
      // Derived from geometry this repo already holds; there is no page to cite.
      sourceUrl: null,
      sourceOrg: "U.S. Census Bureau",
      collectedAt: now,
      verifiedAt: null,
    },
  }));
}
