import REFERENCES from "../../data/reference/geography/tribal-nations.json" with { type: "json" };

export interface TribalNation {
  /** PROJECT-MINTED. The key is the Census AIANNH code — see the module note. */
  ocdId: string;
  /** The Census AIANNH code, 2020 vintage. The basis for the id above. */
  censusAiannhCode: string;
  /** The ANSI/GNIS code, which is the stabler federal identifier of the two. */
  ansiCode: string;
  /** The nation's own name for itself where this project has read one. */
  name: string;
  /** The Census's name for the AREA, which is not the same thing as the nation. */
  censusAreaName: string;
  /** States the area falls in, per the Census file. */
  states: readonly string[];
  /** Where this row came from, per source. */
  provenance: string;
}

export const TRIBAL_NATIONS: readonly TribalNation[] = REFERENCES;

/** The nations holding territory in or adjacent to a state, by USPS code. */
export function tribalNationsInState(usps: string): readonly TribalNation[] {
  return TRIBAL_NATIONS.filter((n) => n.states.includes(usps.toUpperCase()));
}
