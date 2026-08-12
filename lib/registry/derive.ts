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
 * LSAD codes that mean a polygon has an actual government.
 *
 * Read off the Census place and county-subdivision files rather than assumed,
 * because the failure mode is severe in both directions. 376 of Arizona's 467
 * places are census designated places and all 80 of its county subdivisions are
 * statistical CCDs; a rule without this invents 376 councils in one state.
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

export type SkipReason =
  | "statistical-or-unorganized"
  | "unknown-lsad"
  | "legislative-seat-not-a-meeting-body";

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
      // Supervisors in Arizona, commissioners in New Jersey, and New
      // Hampshire's counties have delegations. One governing body either way;
      // the name is not knowable from the division type.
      return { slots: [{ bodyClass: "GOVERNING", slot: "governing" }], skipped: null };

    case "school_district":
      return { slots: [{ bodyClass: "GOVERNING", slot: "board" }], skipped: null };

    case "place": {
      const lsad = division.lsad ?? "";
      if (GOVERNING_LSAD.has(lsad)) {
        return { slots: [{ bodyClass: "GOVERNING", slot: "governing" }], skipped: null };
      }
      if (NON_GOVERNING_LSAD.has(lsad)) {
        // Vail is a CDP. There is no municipal government to meet, and
        // generating a council for it would be a fabrication.
        return { slots: [], skipped: "statistical-or-unorganized" };
      }
      // An unrecognised code is a gap in this table, not a licence to guess.
      return { slots: [], skipped: "unknown-lsad" };
    }

    case "sldu":
    case "sldl":
    case "cd":
      // A legislative district elects a seat in a body that sits elsewhere. The
      // chamber is not a body *of* this division, and Arizona's legislative
      // districts elect one senator and two representatives, so the district is
      // not even one seat.
      return { slots: [], skipped: "legislative-seat-not-a-meeting-body" };
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
    coverageStatus: "NO_SOURCE_FOUND" as const,
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
