export type VotingModel =
  | "VOTE_CENTER"
  | "ASSIGNED";

export type SiteKind = "ELECTION_DAY" | "EARLY_VOTING" | "MOBILE";

export interface VotingSite {
  id: string;
  name: string;
  address: string;
  room: string | null;
  /** Null when the published address could not be placed; the site stays listed. */
  lat: number | null;
  lng: number | null;
  kind: SiteKind;
  /** In the authority's own words, or null; never filled in with the jurisdiction's current election. */
  election: string | null;
  /** Assigned wards or districts in the authority's own words; null where it does not say, never inferred. */
  serves: string | null;
}

export interface SiteRung {
  /** Ladder rung number, `ladder vH-start`. */
  rung: number;
  what: string;
  result: string;
  attemptedAt: string;
}

export interface VotingJurisdiction {
  ocdId: string;
  name: string;
  /** Two-letter postal code, upper case. */
  state: string;
  model: VotingModel;
  election: string | null;
  sites: VotingSite[];
  sourceOrg: string;
  sourceUrl: string;
  sourceLinkingPage?: import("../civic-data/source-authority.ts").OfficialLinkingPage;
  sourceRawSha256?: string;
  collectedAt: string;
  refusal: {
    wall: string;
    rungs: SiteRung[];
  } | null;
}

export interface VotingSitesFile {
  generatedAt: string;
  jurisdictions: VotingJurisdiction[];
}

export const votingSiteAddressKey = (address: string): string => address.toLowerCase().replace(/\s+/g, " ").trim();

export function heldVotingSiteCoordinates(file: VotingSitesFile | null): Map<string, { lat: number; lng: number }> {
  const points = new Map<string, { lat: number; lng: number }>();
  const ambiguous = new Set<string>();
  for (const jurisdiction of file?.jurisdictions ?? []) for (const site of jurisdiction.sites) {
    if (site.lat === null || site.lng === null || !Number.isFinite(site.lat) || !Number.isFinite(site.lng)) continue;
    const key = votingSiteAddressKey(site.address);
    if (!key || ambiguous.has(key)) continue;
    const prior = points.get(key);
    if (prior && (prior.lat !== site.lat || prior.lng !== site.lng)) { points.delete(key); ambiguous.add(key); }
    else points.set(key, { lat: site.lat, lng: site.lng });
  }
  return points;
}

export interface VotingSitesCensus {
  jurisdictions: number;
  withSites: number;
  withRefusal: number;
  sites: number;
  sitesWithoutPoint: number;
}

export function isPinnable(
  site: VotingSite,
): site is VotingSite & { lat: number; lng: number } {
  return site.lat !== null && site.lng !== null;
}

export function censusOf(file: VotingSitesFile): VotingSitesCensus {
  return {
    jurisdictions: file.jurisdictions.length,
    withSites: file.jurisdictions.filter((j) => j.sites.length > 0).length,
    withRefusal: file.jurisdictions.filter((j) => j.refusal !== null).length,
    sites: file.jurisdictions.reduce((n, j) => n + j.sites.length, 0),
    sitesWithoutPoint: file.jurisdictions.reduce(
      (n, j) => n + j.sites.filter((s) => !isPinnable(s)).length,
      0,
    ),
  };
}

export interface VotingSitesAnswer {
  match: boolean;
  /** Only ever the resolved POINT, never the address that produced it. */
  point: { lat: number; lng: number } | null;
  jurisdictions: (Omit<VotingJurisdiction, "refusal"> & {
    modelSentence: string;
    refusal: VotingJurisdiction["refusal"];
    refusalLine: string | null;
    narrowing: Narrowing;
  })[];
  outsideCoverage: boolean;
  pollingPlaceLinks: readonly import("./polling-place-links.ts").PollingPlaceLink[];
  ballotNavigationDataState?: "PROMOTED" | "FIRST_SEED" | "STORE_UNREACHABLE";
}

export const UNPLACED_SITE_LINE =
  "We could not place this address on the map, so it has no pin. The address above is what the county published.";

export function modelSentence(j: VotingJurisdiction): string {
  if (j.sites.length === 0) {
    return j.model === "VOTE_CENTER"
      ? `${j.name} runs vote centers: any registered voter may use any site the county opens.`
      : `${j.name} assigns each voter to one location, decided by where they live.`;
  }
  return j.model === "VOTE_CENTER"
    ? `${j.name} lets any registered voter vote at any of these locations. There is no one place you are assigned to.`
    : `${j.name} assigns you to one of these locations. Which one depends on where you live, so check the location that names your ward or district.`;
}

export function refusalLine(j: VotingJurisdiction): string {
  return `We could not retrieve ${j.name}'s voting locations from ${j.sourceOrg}. `;
}

export type Narrowing =
  | { kind: "NOT_NEEDED"; sentence: string }
  | { kind: "EXACT"; sentence: string; siteId: string }
  | { kind: "REFUSED"; sentence: string; rungs: SiteRung[] };

export const NJ_DISTRICT_RUNGS: SiteRung[] = [
  {
    rung: 12,
    what: "The state's own GIS organisation (NJOGIS) on ArcGIS Online",
    result:
      "HIT — 'Election Districts for New Jersey' and 'Ward Boundaries for New Jersey', statewide polygons with county, municipality, ward and district codes",
    attemptedAt: "2026-08-19",
  },
  {
    rung: 7,
    what: "The layer's own metadata: when was this data last edited",
    result:
      "2021-11-24, and the publisher labels it MATURE SUPPORT. Five years older than the election these polling places are for",
    attemptedAt: "2026-08-19",
  },
  {
    rung: 12,
    what: "Morris County's own GIS for current voting-district geometry",
    result: "No published election-district layer found under the county",
    attemptedAt: "2026-08-19",
  },
  {
    rung: 13,
    what: "The county Board of Elections' public-records request path",
    result:
      "NOT YET WALKED — named so the next session starts here rather than at rung 2",
    attemptedAt: "2026-08-19",
  },
];

export function narrowingFor(j: VotingJurisdiction): Narrowing {
  if (j.model === "VOTE_CENTER") {
    return {
      kind: "NOT_NEEDED",
      sentence:
        "There is no one location assigned to you here, so there is nothing to narrow down. Any of these will do.",
    };
  }
  if (j.sites.length === 0) {
    return {
      kind: "REFUSED",
      sentence: `We have not retrieved any voting location for ${j.name} yet, so there is nothing here to narrow down. What we tried is below.`,
      rungs: [],
    };
  }
  if (j.sites.length === 1) {
    return {
      kind: "EXACT",
      sentence: `${j.name} has one voting location, so this is yours.`,
      siteId: j.sites[0].id,
    };
  }
  return {
    kind: "REFUSED",
    sentence:
      "We cannot yet tell you which of these is yours. The boundaries we would need are older than this election, and a polling place that is wrong by one street is worse than none — so we are showing you all of them instead of guessing. Your sample ballot names your ward and district.",
    rungs: j.state === "NJ" ? NJ_DISTRICT_RUNGS : [],
  };
}

export function directionsUrl(site: VotingSite): string {
  const query = `${site.name}, ${site.address}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

export function milesBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.7613; // mean Earth radius, statute miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** A rough map ring around the entered address, not a legal threshold. */
export const NEARBY_RADIUS_MILES = 10;

export interface SiteWithDistance {
  site: VotingSite;
  miles: number | null;
}

/** A sort, never a filter: every site comes back. Unplaced sites keep their published order after the placed ones. */
export function sitesNearestFirst(
  sites: readonly VotingSite[],
  point: { lat: number; lng: number } | null,
): SiteWithDistance[] {
  const measured = sites.map((site) => ({
    site,
    miles:
      point && typeof site.lat === "number" && typeof site.lng === "number"
        ? milesBetween(point, { lat: site.lat, lng: site.lng })
        : null,
  }));

  if (!point) return measured;

  const placed = measured
    .filter((m) => m.miles !== null)
    .sort((a, b) => (a.miles as number) - (b.miles as number));
  const unplaced = measured.filter((m) => m.miles === null);
  return [...placed, ...unplaced];
}

export function milesLabel(miles: number): string {
  const rounded = miles < 10 ? Math.round(miles * 10) / 10 : Math.round(miles);
  return `${rounded} ${rounded === 1 ? "mile" : "miles"} away`;
}
