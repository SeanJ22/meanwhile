/**
 * **THE STATE, DC OR TERRITORY AN OCD DIVISION ID LIES IN.** (2026-09-25.)
 *
 * The OCD prefix differs by entity class (`lib/ocd/fips.ts`): `state:oh`, `district:dc`, `territory:pr`. A
 * reading that matched `state:` alone put every DC and territory division in no state at all, so a Send in Puerto
 * Rico could create work that no crosswalk row, wiring row, derived family or reader scope would ever carry. Every
 * step of the meetings chain reads the code through this one function. PURE.
 */

/** The OCD id segment that names a state, DC or a territory: `/state:oh`, `/district:dc`, `/territory:pr`. */
export const OCD_STATE_SEGMENT = /\/(?:state|district|territory):([a-z]{2})(?=[/#]|$)/;

/** The lower-case two-letter code of the state, DC or territory an OCD division (or body) id lies in, or null. */
export function ocdStateCode(ocdId: string | null | undefined): string | null {
  if (typeof ocdId !== "string") return null;
  return OCD_STATE_SEGMENT.exec(ocdId)?.[1] ?? null;
}
