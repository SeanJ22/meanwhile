/**
 * **A CONGRESSIONAL DISTRICT'S NAME AS SEAN READS IT.** `AZ-06` for Arizona's
 * sixth, `WY-AL` for a state with one seat (Census's `00`, and the delegate
 * code `98` DC and the territories carry). The Census GEOID is the state FIPS
 * plus two digits, so the name needs nothing but the state and that GEOID.
 *
 * PURE.
 */
export function districtLabelOf(state: string, geoid: string): string {
  const st = state.toUpperCase();
  const digits = /^\d{4}$/.exec(geoid) ? geoid.slice(2) : null;
  if (digits === null) return `${st}-${geoid}`;
  return `${st}-${digits === "00" || digits === "98" ? "AL" : digits}`;
}
