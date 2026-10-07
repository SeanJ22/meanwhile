/** Which places a new deploy warms: one ZIP per published county, from the reader edge manifest. Pure. */

export interface WarmPlace {
  readonly zip: string;
  readonly lat: number;
  readonly lng: number;
}

/** A county division is `.../state:xx/county:name`, with no place, district or fragment below it. */
const COUNTY_DIVISION = /^ocd-division\/country:us\/state:([a-z]{2})\/county:[^/#]+$/;

/** The county divisions a manifest publishes, sorted and without repeats. */
export function publishedCountyDivisions(scopes: readonly { readonly ocdId?: string }[]): string[] {
  const out = new Set<string>();
  for (const scope of scopes) {
    const division = scope.ocdId?.split("#")[0];
    if (division && COUNTY_DIVISION.test(division)) out.add(division);
  }
  return [...out].sort();
}

/**
 * One place per published county: that county's lowest ZIP and the centroid the
 * map sends for it. Two counties reaching the same ZIP warm it once. A county
 * with no indexed ZIP or no centroid is skipped (and counted by the caller).
 */
export function warmPlacesForCounties(input: {
  readonly counties: readonly string[];
  readonly zipFor: (division: string) => string | null | undefined;
  readonly centroidFor: (zip: string) => { readonly lat: number; readonly lng: number } | null | undefined;
}): { readonly places: readonly WarmPlace[]; readonly skipped: number } {
  const seen = new Set<string>();
  const places: WarmPlace[] = [];
  let skipped = 0;
  for (const county of input.counties) {
    const zip = input.zipFor(county);
    const centroid = zip ? input.centroidFor(zip) : null;
    if (!zip || !centroid) { skipped += 1; continue; }
    if (seen.has(zip)) continue;
    seen.add(zip);
    places.push({ zip, lat: centroid.lat, lng: centroid.lng });
  }
  return { places, skipped };
}
