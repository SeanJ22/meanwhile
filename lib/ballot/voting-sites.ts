export type VotingModel =
  | "VOTE_CENTER"
  | "ASSIGNED"
  | "UNKNOWN"
  | "ALL_MAIL";

export type SiteKind = "ELECTION_DAY" | "EARLY_VOTING" | "MOBILE" | "DROP_BOX" | "VOTE_CENTER" | "SATELLITE";

export interface VotingSource {
  publisher: string;
  url: string;
  title?: string;
  lastUpdated?: string;
  checkedAt?: string;
  official?: boolean;
  documentHash?: string;
  documentUrl?: string;
}

export interface VotingRule {
  text: string;
  source: VotingSource;
  /** Kinds explicitly stated not to be offered; never inferred from missing rows. */
  absenceOf?: SiteKind[];
}
export interface VotingOfficeContact {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  url?: string;
}

/** Geometry is supplied by a published boundary source, never by a site coordinate. */
export interface VotingBoundary {
  precinct: string;
  countyFips?: string;
  ward?: string;
  kind: "OFFICIAL_PRECINCT" | "CENSUS_2020_VTD";
  geometry: { type: string; coordinates: unknown };
  source: VotingSource;
}

export interface VotingPublication {
  status: "PUBLISHED" | "POSTED_LATER" | "NO_GENERAL_ELECTION";
  /** The publisher's own words; no invented publication date. */
  text: string;
  source: VotingSource;
  specialElections?: string[];
}


export interface VotingSite {
  id: string;
  name: string;
  address: string;
  room: string | null;
  /** Null when the published address could not be placed; the site stays listed. */
  lat: number | null;
  lng: number | null;
  kind: SiteKind;
  kinds?: SiteKind[];
  precincts?: string[];
  assignments?: { precinct: string; ward?: string; name?: string; room?: string | null; locationNotes?: string; source: VotingSource }[];
  /** `date` is this schedule row's published calendar day, separate from its election date. */
  schedules?: { kind: SiteKind; date?: string; days?: string; hours?: string; electionDate?: string; source: VotingSource }[];
  /** In the authority's own words, or null; never filled in with the jurisdiction's current election. */
  election: string | null;
  /** Assigned wards or districts in the authority's own words; null where it does not say, never inferred. */
  serves: string | null;
  days?: string;
  hours?: string;
  precinct?: string;
  town?: string;
  countyFips?: string;
  countyName?: string;
  countySubdivisionGeoid?: string;
  matchingUnit?: "COUNTY" | "TOWN" | "WARD" | "PRECINCT";
  ward?: string;
  districtOcdIds?: string[];
  aiannhGeoid?: string;
  tribalNation?: string;
  reservation?: string;
  locationNotes?: string;
  accessibilityNotes?: string;
  rules?: VotingRule[];
  sources?: VotingSource[];
  lastUpdated?: string;
  electionDate?: string;
  office?: VotingOfficeContact;
  geocodeSource?: "CENSUS" | "PUBLISHER";

}

/** One physical location can serve several precincts and voting methods. */
export function mergeVotingSiteRows(earlier: VotingSite, later: VotingSite): VotingSite {
  const unique = <T>(values: T[], key: (value: T) => string): T[] => [...new Map(values.map(value => [key(value), value])).values()];
  const sourceTime = (source: VotingSource) => Date.parse(source.lastUpdated ?? "") || Date.parse(source.checkedAt ?? "") || 0;
  const sourceOfficial = (source: VotingSource) => source.official ?? /\.gov(?:\/|$)/i.test(source.url);
  const sourceWins = (before: VotingSource, after: VotingSource) => sourceOfficial(before) !== sourceOfficial(after)
    ? sourceOfficial(after) : sourceTime(after) >= sourceTime(before);
  const byUrl = new Map<string, VotingSource>();
  for (const source of [...(earlier.sources ?? []), ...(later.sources ?? [])]) {
    const prior = byUrl.get(source.url);
    if (!prior || sourceWins(prior, source)) byUrl.set(source.url, source);
  }
  const sources = [...byUrl.values()];
  const checked = (site: VotingSite) => Math.max(0, ...(site.sources ?? []).map(sourceTime));
  const official = (site: VotingSite) => (site.sources ?? []).some(sourceOfficial);
  const incomingWins = official(later) !== official(earlier) ? official(later) : checked(later) >= checked(earlier);
  const winning = incomingWins ? later : earlier;
  const other = incomingWins ? earlier : later;
  const point = [winning, other].find(site => site.geocodeSource === "PUBLISHER" && isPinnable(site))
    ?? [winning, other].find(isPinnable);
  for (const field of ["name", "room", "town", "countyName", "countyFips", "countySubdivisionGeoid", "election", "electionDate"] as const) {
    if ((field !== "name" || earlier.assignments?.some(before => later.assignments?.some(after => before.precinct === after.precinct && before.ward === after.ward))) &&
        earlier[field] != null && later[field] != null && earlier[field] !== later[field])
      console.info(JSON.stringify({ event: "voting_site_conflict", site: winning.id, field,
        kept: { value: winning[field], sources: [...new Set(winning.sources?.map(source => source.url))] },
        replaced: { value: other[field], sources: [...new Set(other.sources?.map(source => source.url))] } }));
  }
  const assignments = new Map<string, NonNullable<VotingSite["assignments"]>[number]>();
  for (const assignment of [...(earlier.assignments ?? []), ...(later.assignments ?? [])]) {
    const key = `${assignment.ward ?? ""}:${assignment.precinct}`, prior = assignments.get(key);
    if (!prior || sourceWins(prior.source, assignment.source)) assignments.set(key, assignment);
  }
  const schedules = new Map<string, NonNullable<VotingSite["schedules"]>[number]>();
  for (const schedule of [...(earlier.schedules ?? []), ...(later.schedules ?? [])]) {
    const key = JSON.stringify([schedule.kind, schedule.date, schedule.days, schedule.electionDate]), prior = schedules.get(key);
    if (!prior || sourceWins(prior.source, schedule.source)) schedules.set(key, schedule);
    if (prior && prior.hours !== schedule.hours && prior.source.url !== schedule.source.url) {
      const kept = schedules.get(key)!;
      console.info(JSON.stringify({ event: "voting_hours_conflict", site: winning.id, kind: kept.kind, days: kept.days,
        kept: { hours: kept.hours, source: kept.source.url }, replaced: { hours: kept === prior ? schedule.hours : prior.hours,
          source: kept === prior ? schedule.source.url : prior.source.url } }));
    }
  }
  return { ...other, ...winning, ...(point ? { lat: point.lat, lng: point.lng, geocodeSource: point.geocodeSource } : {}), sources,
    kinds: unique([...(earlier.kinds ?? [earlier.kind]), ...(later.kinds ?? [later.kind])], value => value),
    assignments: [...assignments.values()],
    precincts: unique([...(earlier.precincts ?? (earlier.precinct ? [earlier.precinct] : [])), ...(later.precincts ?? (later.precinct ? [later.precinct] : []))], value => value),
    schedules: [...schedules.values()] };
}

export function votingSiteHasKind(site: VotingSite, kind: SiteKind): boolean {
  return (site.kinds ?? [site.kind]).includes(kind);
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
  electionDate?: string;
  countyFips?: string;
  countySubdivisionGeoid?: string;
  matchingUnit?: "COUNTY" | "TOWN" | "WARD" | "PRECINCT";
  office?: VotingOfficeContact;
  rules?: VotingRule[];
  sources?: VotingSource[];
  allMail?: boolean;
  publication?: VotingPublication;
  boundaries?: VotingBoundary[];
  addressLookups?: import("./voting-source-types.ts").VotingSourceDoor[];
  blanks?: import("./voting-source-types.ts").VotingSourceBlank[];
  /** Official lookup results can explicitly assign a site for this one request. Never persisted. */
  assignedSiteIds?: string[];
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

/** Response diagnostics only; the reader panel never renders these reasons. */
export type VotingFallbackReason = "KEY_MISSING" | "GOOGLE_UNAVAILABLE" | "NO_DATA";

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
  precision?: "ADDRESS" | "ZIP";
  googleFallback?: { available: boolean; requested: boolean; reason?: VotingFallbackReason; label?: string; message?: string };
  /** Transient Google results must disappear from an open panel within 24 hours. */
  expiresAt?: string;

  pollingPlaceLinks: readonly import("./polling-place-links.ts").PollingPlaceLink[];
  ballotNavigationDataState?: "PROMOTED" | "FIRST_SEED" | "STORE_UNREACHABLE";
}

export const UNPLACED_SITE_LINE =
  "We could not place this address on the map, so it has no pin. The address above is what the county published.";

export function modelSentence(j: VotingJurisdiction): string {
  if (j.publication?.status === "NO_GENERAL_ELECTION") return j.publication.text;
  if (j.model === "UNKNOWN") return "Published voting locations and their eligibility rules are listed below as the election office provides them.";
  if (j.model === "ALL_MAIL" || j.allMail) return "Voting is by mail here. Ballot drop boxes and vote centers are listed first, with the publisher’s return rules.";
  if (j.model === "VOTE_CENTER") return j.sites.length
    ? `${j.name} lets eligible registered voters vote at any of these locations within the published service area.`
    : `${j.name} runs vote centers. Follow each center’s published service area and hours.`;
  return j.sites.length
    ? `${j.name} assigns you an election-day polling place by precinct. Early-voting and ballot-return rules are listed separately.`
    : `${j.name} assigns each voter a polling place by precinct.`;
}

export function refusalLine(j: VotingJurisdiction): string {
  return `We could not retrieve ${j.name}'s voting locations from ${j.sourceOrg}. `;
}

export type Narrowing =
  | { kind: "NOT_NEEDED"; sentence: string }
  | { kind: "EXACT"; sentence: string; siteId: string }
  | { kind: "REFUSED"; sentence: string; rungs: SiteRung[] };

export function narrowingFor(j: VotingJurisdiction): Narrowing {
  if (j.publication?.status === "NO_GENERAL_ELECTION") return {
    kind: "NOT_NEEDED", sentence: (j.publication.specialElections ?? []).join(" "),
  };
  if (j.model === "VOTE_CENTER" || j.model === "ALL_MAIL" || j.allMail) return {
    kind: "NOT_NEEDED", sentence: "Use the published dates, hours and eligibility rules for each location.",
  };
  const assigned = j.sites.filter(site => j.assignedSiteIds?.includes(site.id));
  if (assigned.length === 1) return { kind: "EXACT", siteId: assigned[0].id,
    sentence: `The official address lookup assigns you to ${assigned[0].name}.` };
  return {
    kind: "REFUSED",
    sentence: "We have not fixed your precinct. These are the published locations for your county and legislative districts, with each precinct named where published.",
    rungs: j.refusal?.rungs ?? [],
  };
}

/** All-mail jurisdictions lead with ballot returns; distance never changes eligibility. */
export function votingSitesForDisplay(j: VotingJurisdiction, point: { lat: number; lng: number } | null): SiteWithDistance[] {
  const measured = sitesNearestFirst(j.sites, point);
  if (!(j.allMail || j.model === "ALL_MAIL")) return measured;
  const rank = (site: VotingSite) => site.kind === "DROP_BOX" ? 0 : site.kind === "VOTE_CENTER" ? 1 : 2;
  return measured.sort((a, b) => rank(a.site) - rank(b.site));
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
