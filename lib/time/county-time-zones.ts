import reference from "../../data/reference/national_county_time_zones.json" with { type: "json" };

export interface CountyTimeZoneReference {
  readonly countyFips: string;
  readonly stateCode: string;
  readonly countyName: string;
  /** More than one clock means the county alone cannot select a meeting's wall clock. */
  readonly timeZones: readonly string[];
}

export const COUNTY_TIME_ZONES: ReadonlyMap<string, CountyTimeZoneReference> = new Map(reference.counties.map(row => {
  const [countyFips, stateCode, countyName, timeZones] = row as [string, string, string, string[]];
  return [countyFips, { countyFips, stateCode, countyName, timeZones }];
}));

export function countyTimeZones(countyFips: string | null | undefined, stateCode?: string): readonly string[] {
  if (!countyFips || !/^\d{5}$/.test(countyFips)) return [];
  const row = COUNTY_TIME_ZONES.get(countyFips);
  return row && (!stateCode || row.stateCode === stateCode.toUpperCase()) ? row.timeZones : [];
}

/** A missing county is resolvable only when the national reference gives every county in that state one same clock. */
const stateZones = new Map<string, Set<string>>();
for (const row of COUNTY_TIME_ZONES.values()) {
  const zones = stateZones.get(row.stateCode) ?? new Set<string>();
  row.timeZones.forEach(zone => zones.add(zone));
  stateZones.set(row.stateCode, zones);
}

export function governmentTimeZone(stateCode: string, countyFips?: string | null): string | null {
  const zones = countyFips ? countyTimeZones(countyFips, stateCode) : [...(stateZones.get(stateCode.toUpperCase()) ?? [])];
  return zones.length === 1 ? zones[0]! : null;
}

/** A statewide display clock: its uniform county clock, or the most common unambiguous county clock. */
export function stateClockZone(stateCode: string): string | null {
  const state = stateCode.toUpperCase();
  const uniform = governmentTimeZone(state);
  if (uniform) return uniform;
  const tally = new Map<string, number>();
  for (const row of COUNTY_TIME_ZONES.values()) if (row.stateCode === state && row.timeZones.length === 1)
    tally.set(row.timeZones[0]!, (tally.get(row.timeZones[0]!) ?? 0) + 1);
  // Stable sort preserves the county reference's first occurrence when counts tie.
  return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
