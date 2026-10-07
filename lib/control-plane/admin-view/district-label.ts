/** `XX-06`, or `XX-AL` for a single seat (Census `00`, and the delegate code `98`). */
export function districtLabelOf(state: string, geoid: string): string {
  const st = state.toUpperCase();
  const digits = /^\d{4}$/.exec(geoid) ? geoid.slice(2) : null;
  if (digits === null) return `${st}-${geoid}`;
  return `${st}-${digits === "00" || digits === "98" ? "AL" : digits}`;
}
