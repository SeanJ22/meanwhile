import { containsPoint } from "../geo/polygon.ts";
import { modelSentence, narrowingFor, refusalLine, type Narrowing, type VotingJurisdiction, type VotingSitesAnswer, type VotingSitesFile, type VotingSource, type VotingSite } from "./voting-sites.ts";
import type { VotingSourceDoor, VotingSourceRead } from "./voting-source-types.ts";

/** Request-local geography. A ZIP is an area, and never an assigned precinct. */
export interface VotingReaderPlace {
  precision: "ADDRESS" | "ZIP";
  point: { lat: number; lng: number } | null;
  divisionIds: string[];
  states: string[];
  countyFips: string[];
  countyNames?: string[];
  countySubdivisionGeoids: string[];
  towns: string[];
  wards: string[];
  aiannhGeoids: string[];
  precincts: { name: string; countyFips?: string; kind: "OFFICIAL_PRECINCT" | "CENSUS_2020_VTD"; source?: VotingSource }[];
}

const normalized = (value: string) => value.trim().toLowerCase().replace(/^(?:town|city|township) of /, "").replace(/\s+(?:town|city|township)$/, "").replace(/\s+/g, " ");
const precinctKey = (value: string) => normalized(value).replace(/^(?:voting district|precinct|vtd)\s*/, "").replace(/^0+(?=\d)/, "");
const countyKey = (value: string) => normalized(value).replace(/\s+(?:county|parish|borough|municipio|municipality|census area)$/, "");
const matches = (values: readonly string[], value: string) => values.some(candidate => normalized(candidate) === normalized(value));

function votingScopeCovers(j: Pick<VotingJurisdiction, "state" | "ocdId" | "countyFips" | "countySubdivisionGeoid">, place: VotingReaderPlace): boolean {
  if (!place.states.includes(j.state.toUpperCase())) return false;
  if (j.countySubdivisionGeoid) return place.countySubdivisionGeoids.includes(j.countySubdivisionGeoid);
  if (j.countyFips) return place.countyFips.includes(j.countyFips);
  return place.divisionIds.includes(j.ocdId) || /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(j.ocdId);
}

export function votingJurisdictionCovers(j: VotingJurisdiction, place: VotingReaderPlace): boolean {
  return votingScopeCovers(j, place);
}

function siteInPlace(site: VotingSite, place: VotingReaderPlace, jurisdiction: VotingJurisdiction): boolean {
  if (site.countyFips && !place.countyFips.includes(site.countyFips)) return false;
  if (!site.countyFips && site.countyName && !(place.countyNames ?? []).some(name => countyKey(name) === countyKey(site.countyName!))) return false;
  if (site.countySubdivisionGeoid && !place.countySubdivisionGeoids.includes(site.countySubdivisionGeoid)) return false;
  const unit = site.matchingUnit ?? jurisdiction.matchingUnit;
  if (unit === "TOWN" && site.town && place.towns.length && !matches(place.towns, site.town)) return false;
  if (unit === "WARD" && site.ward && place.wards.length && !matches(place.wards, site.ward)) return false;
  if (site.districtOcdIds?.length && !site.districtOcdIds.some(id => place.divisionIds.includes(id))) return false;
  const statewide = /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(jurisdiction.ocdId);
  if (statewide && !jurisdiction.countyFips && !jurisdiction.countySubdivisionGeoid &&
      !site.countyFips && !site.countyName && !site.countySubdivisionGeoid &&
      !(unit === "TOWN" && site.town && matches(place.towns, site.town)) &&
      !site.districtOcdIds?.length && !jurisdiction.assignedSiteIds?.includes(site.id) &&
      !(site.aiannhGeoid && place.aiannhGeoids.includes(site.aiannhGeoid))) return false;
  return true;
}

/** Official precinct polygons supersede the Census fallback, including an unresolved official boundary. */
function precinctsFor(j: VotingJurisdiction, place: VotingReaderPlace): VotingReaderPlace["precincts"] {
  if (place.precision !== "ADDRESS" || !place.point) return [];
  const relevant = (j.boundaries ?? []).filter(b => !b.countyFips || place.countyFips.includes(b.countyFips));
  const official = relevant.filter(b => b.kind === "OFFICIAL_PRECINCT");
  const chosen = official.length ? official : relevant.filter(b => b.kind === "CENSUS_2020_VTD");
  if (!chosen.length) return place.precincts;
  const point = place.point;
  return chosen.filter(b => containsPoint([point.lng, point.lat], b.geometry))
    .map(b => ({ name: b.precinct, countyFips: b.countyFips, kind: b.kind, source: b.source }));
}

export function projectVotingJurisdiction(j: VotingJurisdiction, place: VotingReaderPlace): VotingSitesAnswer["jurisdictions"][number] {
  const scoped = j.sites.filter(site => siteInPlace(site, place, j));
  const precincts = precinctsFor(j, place);
  const uniquePrecinct = precincts.length === 1 ? precincts[0] : null;
  const matchingAssigned = uniquePrecinct ? scoped.filter(site => site.kind === "ELECTION_DAY" && site.precinct &&
    precinctKey(site.precinct) === precinctKey(uniquePrecinct.name) && (!site.ward || matches(place.wards, site.ward))) : [];
  const sites = matchingAssigned.length ? scoped.filter(site => site.kind !== "ELECTION_DAY" || !site.precinct || matchingAssigned.includes(site)) : scoped;
  const localOffices = sites.flatMap(site => site.office ? [site.office] : []);
  const distinctOffices = [...new Map(localOffices.map(office => [JSON.stringify(office), office])).values()];
  const projected = { ...j, sites, office: distinctOffices.length === 1 ? distinctOffices[0] : j.office,
    blanks: j.blanks?.filter(blank => votingScopeCovers(blank.scope, place)) };
  let narrowing: Narrowing = narrowingFor(projected);
  if (matchingAssigned.length === 1) {
    narrowing = { kind: "EXACT", siteId: matchingAssigned[0].id,
      sentence: `${uniquePrecinct!.kind === "CENSUS_2020_VTD" ? "The Census 2020 voting district" : "The official precinct boundary"} matches precinct ${uniquePrecinct!.name}: ${matchingAssigned[0].name}.` };
  } else if (place.precision === "ZIP" && j.model === "ASSIGNED" && j.publication?.status !== "NO_GENERAL_ELECTION") {
    narrowing = { kind: "REFUSED", sentence: "A ZIP can cross precincts. These are the published sites for the places it covers. Your precinct is on your voter card; a street address can narrow the list.", rungs: [] };
  }
  // The browser receives facts, never lookup descriptors, saved linking-page HTML, or full precinct geometry.
  const { addressLookups: _lookups, boundaries: _boundaries, sourceLinkingPage: _linking, ...publicJurisdiction } = projected;
  return { ...publicJurisdiction, sources: [...(j.sources ?? []), ...precincts.flatMap(p => p.source ? [p.source] : [])],
    modelSentence: modelSentence(projected), refusalLine: j.refusal ? refusalLine(j) : null, narrowing };
}

export const GOOGLE_VOTING_DATA_LABEL = "from Google's election data (Voting Information Project)";

interface VotingAnswerDependencies {
  readOfficialAddress?: (door: VotingSourceDoor, address: string) => Promise<VotingSourceRead>;
  readGoogle?: (address: string, place: VotingReaderPlace) => Promise<VotingJurisdiction[]>;
}

/** No request means no address leaves this function. Google is a distinct explicit action. */
export async function answerVotingSites(file: VotingSitesFile, place: VotingReaderPlace, request: {
  address?: string;
  readerRequested: boolean;
  googleRequested?: boolean;
}, dependencies: VotingAnswerDependencies = {}): Promise<VotingSitesAnswer> {
  const covering = file.jurisdictions.filter(j => votingJurisdictionCovers(j, place));
  const jurisdictions = await Promise.all(covering.map(async j => {
    if (!request.readerRequested || !request.address || place.precision !== "ADDRESS" || !dependencies.readOfficialAddress) return j;
    const lookups = (j.addressLookups ?? []).filter(door => door.shape === "address-lookup" &&
      (!door.access || door.access.status === "open") && door.extraction?.addressFields &&
      (!door.scope.countyFips || place.countyFips.includes(door.scope.countyFips)) &&
      (!door.scope.countySubdivisionGeoid || place.countySubdivisionGeoids.includes(door.scope.countySubdivisionGeoid)));
    const results = await Promise.allSettled(lookups.map(door => dependencies.readOfficialAddress!(door, request.address!)));
    const reads = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    const found = reads.flatMap(read => read.sites);
    return found.length ? { ...j, sites: [...j.sites.filter(site => !found.some(result => result.id === site.id)), ...found],
      assignedSiteIds: found.filter(site => site.kind === "ELECTION_DAY").map(site => site.id),
      office: reads.find(read => read.office)?.office ?? j.office,
      sources: [...(j.sources ?? []), ...reads.flatMap(read => read.sources)], rules: [...(j.rules ?? []), ...reads.flatMap(read => read.rules)] } : j;
  }));
  let projected = jurisdictions.map(j => projectVotingJurisdiction(j, place));
  const officialLoaded = projected.some(j => j.sites.length > 0 || !!j.publication || !!j.rules?.length);
  const googleAllowed = !officialLoaded && request.readerRequested && request.googleRequested === true && !!request.address;
  let googleMessage: string | undefined;
  if (googleAllowed) {
    const google = await dependencies.readGoogle?.(request.address!, place).catch(() => []) ?? [];
    projected = [...projected, ...google.map(j => projectVotingJurisdiction(j, place))];
    if (!google.length) googleMessage = "Google’s election data did not return voting locations for this request. The official-source work remains open.";
  }
  return { match: place.states.length > 0, point: place.precision === "ADDRESS" ? place.point : null,
    precision: place.precision, jurisdictions: projected, outsideCoverage: projected.length === 0,
    pollingPlaceLinks: [], googleFallback: { available: !officialLoaded, requested: googleAllowed,
      ...(googleAllowed ? { label: GOOGLE_VOTING_DATA_LABEL } : {}), ...(googleMessage ? { message: googleMessage } : {}) } };
}
