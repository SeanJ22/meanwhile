import { containsPoint } from "../geo/polygon.ts";
import election from "../../data/reference/voting-election.json" with { type: "json" };
import { votingPhysicalAddress } from "./voting-site-address.ts";
import { modelSentence, narrowingFor, refusalLine, votingSiteHasKind, type Narrowing, type VotingJurisdiction, type VotingSitesAnswer, type VotingSitesFile, type VotingSource, type VotingSite } from "./voting-sites.ts";

/** Shared attribution for Google's separately acquired civic records. */
export const GOOGLE_VOTING_DATA_LABEL = "from Google's election data (Voting Information Project)";

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
  precincts: { name: string; countyFips?: string; ward?: string; kind: "OFFICIAL_PRECINCT" | "CENSUS_2020_VTD"; source?: VotingSource }[];
}

const normalized = (value: string) => value.trim().toLowerCase().replace(/^(?:town|city|township) of /, "").replace(/\s+(?:town|city)$/, "").replace(/\s+/g, " ");
const precinctKey = (value: string) => normalized(value).replace(/^(?:voting district|precinct|district|vtd)\s*/, "").replace(/^0+(?=\d)/, "");
const countyKey = (value: string) => normalized(value).replace(/\s+(?:county|parish|borough|municipio|municipality|census area)$/, "");
const matches = (values: readonly string[], value: string) => values.some(candidate => normalized(candidate) === normalized(value));

function votingScopeCovers(j: Pick<VotingJurisdiction, "state" | "ocdId" | "countyFips" | "countySubdivisionGeoid">, place: VotingReaderPlace): boolean {
  if (!place.states.includes(j.state.toUpperCase())) return false;
  if (j.countyFips && !place.countyFips.includes(j.countyFips)) return false;
  const exact = place.divisionIds.includes(j.ocdId);
  if (j.countySubdivisionGeoid && !place.countySubdivisionGeoids.includes(j.countySubdivisionGeoid) && !exact) return false;
  const town = /\/(?:place|cousub):([^/]+)(?:\/|$)/.exec(j.ocdId)?.[1]?.replaceAll("_", " ");
  if (town) {
    const parentCounty = /\/county:([^/]+)\//.exec(j.ocdId)?.[1]?.replaceAll("_", " ");
    if (!exact && !matches(place.towns, town)) return false;
    if (!j.countyFips && parentCounty && !(place.countyNames ?? []).some(name => countyKey(name) === countyKey(parentCounty))) return false;
  }
  const ward = /\/ward:([^/]+)(?:\/|$)/.exec(j.ocdId)?.[1]?.replaceAll("_", " ");
  if (ward && !exact && !matches(place.wards, ward)) return false;
  const precinct = /\/(?:precinct|voting_district):([^/]+)(?:\/|$)/.exec(j.ocdId)?.[1]?.replaceAll("_", " ");
  if (precinct && !exact && !place.precincts.some(value => precinctKey(value.name) === precinctKey(precinct))) return false;
  if (j.countyFips || j.countySubdivisionGeoid || town || ward || precinct) return true;
  const county = /\/county:([^/]+)$/.exec(j.ocdId)?.[1]?.replaceAll("_", " ");
  if (county) return (place.countyNames ?? []).some(name => countyKey(name) === countyKey(county));
  return exact || /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(j.ocdId);
}

export function votingJurisdictionCovers(j: VotingJurisdiction, place: VotingReaderPlace): boolean {
  return votingScopeCovers(j, place);
}

function siteInPlace(site: VotingSite, place: VotingReaderPlace, jurisdiction: VotingJurisdiction): boolean {
  if (site.countyFips && !place.countyFips.includes(site.countyFips)) return false;
  if (!site.countyFips && site.countyName && !(place.countyNames ?? []).some(name => countyKey(name) === countyKey(site.countyName!))) return false;
  if (site.countySubdivisionGeoid && !place.countySubdivisionGeoids.includes(site.countySubdivisionGeoid) &&
    !(place.precision === "ZIP" && (site.town && matches(place.towns, site.town) || jurisdiction.countySubdivisionGeoid === site.countySubdivisionGeoid && place.divisionIds.includes(jurisdiction.ocdId)))) return false;
  const unit = site.matchingUnit ?? jurisdiction.matchingUnit;
  if (unit === "TOWN") {
    const town = site.town ?? /\/(?:place|cousub):([^/]+)(?:\/|$)/.exec(jurisdiction.ocdId)?.[1]?.replaceAll("_", " ");
    if (!town || !matches(place.towns, town)) return false;
  }
  if (unit === "WARD" && site.ward && !matches(place.wards, site.ward)) return false;
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
    .map(b => ({ name: b.precinct, countyFips: b.countyFips, ward: b.ward, kind: b.kind, source: b.source }));
}

export function projectVotingJurisdiction(j: VotingJurisdiction, place: VotingReaderPlace): VotingSitesAnswer["jurisdictions"][number] {
  const precincts = precinctsFor(j, place);
  const scopedPlace = { ...place, wards: [...new Set([...place.wards, ...precincts.flatMap(precinct => precinct.ward ? [precinct.ward] : [])])] };
  const scoped = j.sites.flatMap(site => {
    const address = votingPhysicalAddress(site.address);
    if (!address) return [];
    const physical = address === site.address ? site : { ...site, address };
    return siteInPlace(physical, scopedPlace, j) ? [physical] : [];
  });
  const uniquePrecinct = precincts.length === 1 ? precincts[0] : null;
  const lookupAssigned = place.precision === "ADDRESS" ? scoped.filter(site => votingSiteHasKind(site, "ELECTION_DAY") && j.assignedSiteIds?.includes(site.id)) : [];
  const precinctAssigned = uniquePrecinct ? scoped.filter(site => votingSiteHasKind(site, "ELECTION_DAY") &&
    (uniquePrecinct.kind === "OFFICIAL_PRECINCT" || site.electionDate === election.electionDate && j.electionDate === election.electionDate) &&
    (site.assignments ?? (site.precincts ?? (site.precinct ? [site.precinct] : [])).map(precinct => ({ precinct, ward: site.ward })))
      .some(assignment => precinctKey(assignment.precinct) === precinctKey(uniquePrecinct.name) &&
        (!assignment.ward || matches(uniquePrecinct.ward ? [uniquePrecinct.ward] : place.wards, assignment.ward)))) : [];
  const matchingAssigned = lookupAssigned.length ? lookupAssigned : precinctAssigned;
  const needsAssignment = j.model !== "VOTE_CENTER" && j.model !== "ALL_MAIL" && !j.allMail;
  const sites = matchingAssigned.length || needsAssignment ? scoped.flatMap(site => {
    if (matchingAssigned.includes(site)) {
      const assignment = !lookupAssigned.length && uniquePrecinct ? site.assignments?.find(item => precinctKey(item.precinct) === precinctKey(uniquePrecinct.name) &&
        (!item.ward || matches(uniquePrecinct.ward ? [uniquePrecinct.ward] : place.wards, item.ward))) : undefined;
      return [{ ...site, name: assignment?.name ?? site.name, room: assignment?.room ?? site.room,
        locationNotes: assignment?.locationNotes ?? site.locationNotes }];
    }
    if (!votingSiteHasKind(site, "ELECTION_DAY")) return [site];
    const kinds = (site.kinds ?? [site.kind]).filter(kind => kind !== "ELECTION_DAY");
    if (!kinds.length) return [];
    const schedules = site.schedules?.filter(schedule => schedule.kind !== "ELECTION_DAY");
    const { precinct: _precinct, precincts: _precincts, assignments: _assignments, ...other } = site;
    return [{ ...other, kind: kinds[0], kinds, serves: null, days: schedules?.[0]?.days, hours: schedules?.[0]?.hours, schedules }];
  }) : scoped;
  const localOffices = sites.flatMap(site => site.office ? [site.office] : []);
  const distinctOffices = [...new Map(localOffices.map(office => [JSON.stringify(office), office])).values()];
  const projected = { ...j, sites, office: distinctOffices.length === 1 ? distinctOffices[0] : j.office,
    blanks: j.blanks?.filter(blank => votingScopeCovers(blank.scope, place)) };
  let narrowing: Narrowing = narrowingFor(projected);
  if (!lookupAssigned.length && matchingAssigned.length === 1) {
    narrowing = { kind: "EXACT", siteId: matchingAssigned[0].id,
      sentence: `${uniquePrecinct!.kind === "CENSUS_2020_VTD" ? "The Census 2020 voting district" : "The official precinct boundary"} matches precinct ${uniquePrecinct!.name}: ${sites.find(site => site.id === matchingAssigned[0].id)!.name}.` };
  } else if (place.precision === "ZIP" && j.model === "ASSIGNED" && j.publication?.status !== "NO_GENERAL_ELECTION") {
    narrowing = { kind: "REFUSED", sentence: "A ZIP can cross precincts. These are the published sites for the places it covers. A street address can narrow the list.", rungs: [] };
  }
  // The browser receives facts, never lookup descriptors, saved linking-page HTML, or full precinct geometry.
  const { addressLookups: _lookups, boundaries: _boundaries, sourceLinkingPage: _linking, ...publicJurisdiction } = projected;
  return { ...publicJurisdiction, sources: [...(j.sources ?? []), ...precincts.flatMap(p => p.source ? [p.source] : [])],
    modelSentence: modelSentence(projected), refusalLine: j.refusal ? refusalLine(j) : null, narrowing };
}

/** All answers come from held records. Only the geocoder receives a reader's address. */
export async function answerVotingSites(file: VotingSitesFile, place: VotingReaderPlace): Promise<VotingSitesAnswer> {
  const covering = file.jurisdictions.filter(j => votingJurisdictionCovers(j, place));
  const projected = covering.map(j => projectVotingJurisdiction(j, place));
  const hasLocations = projected.some(j => j.sites.length > 0 || j.publication?.status === "NO_GENERAL_ELECTION");
  return { match: place.states.length > 0, point: place.precision === "ADDRESS" ? place.point : null,
    precision: place.precision, jurisdictions: projected, outsideCoverage: !hasLocations };
}
