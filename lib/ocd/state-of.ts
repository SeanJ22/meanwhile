/** The state, DC or territory an OCD division id lies in, across all three prefix classes. */

/** The OCD id segment that names a state, DC or a territory: `/state:oh`, `/district:dc`, `/territory:pr`. */
export const OCD_STATE_SEGMENT = /\/(?:state|district|territory):([a-z]{2})(?=[/#]|$)/;

/** The lower-case two-letter code of the state, DC or territory an OCD division (or body) id lies in, or null. */
export function ocdStateCode(ocdId: string | null | undefined): string | null {
  if (typeof ocdId !== "string") return null;
  return OCD_STATE_SEGMENT.exec(ocdId)?.[1] ?? null;
}
