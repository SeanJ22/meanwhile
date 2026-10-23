import { lookupCivicAddress, type CivicReadOptions } from "./acquisition.ts";
import { GOOGLE_CIVIC_DOCS, GOOGLE_CIVIC_ELECTION_DAY } from "./targets.ts";
import type { CivicJson, CivicLookup } from "./model.ts";
import { GOOGLE_VOTING_DATA_LABEL, type VotingReaderPlace } from "../../ballot/voting-answer.ts";
import type { VotingFallbackReason, VotingJurisdiction, VotingSite } from "../../ballot/voting-sites.ts";
import { recordVotingFailure } from "../../ballot/voting-errors.ts";
import { censusBatchPoints, type BatchAddress } from "../../geo/census-batch.ts";
import { plausibleUsPoint } from "../../geo/census-geocoder.ts";

const words = (value: unknown): string => typeof value === "string" ? value : "";
export const GOOGLE_CIVIC_ATTRIBUTION = "Voting information powered by the Civic Information API";

/** The location Google sent with a site, or null when it sent none or one outside the United States. */
function googlePoint(value: CivicJson): { lat: number; lng: number } | null {
  const { latitude: lat, longitude: lng } = value;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && plausibleUsPoint(lat, lng) ? { lat, lng } : null;
}

/** Adapt the shared source parser's safe projection; no second Google response parser. Sites Google did not place are recorded in `unplaced`. */
function civicVotingJurisdictions(lookup: CivicLookup, place: VotingReaderPlace, unplaced: Map<string, BatchAddress>): VotingJurisdiction[] {
  if (!lookup.state || place.states.length > 0 && !place.states.includes(lookup.state)) return [];
  const sites: VotingSite[] = lookup.rows.flatMap(row => {
    const kind = row.kind === "POLLING_LOCATION" ? "ELECTION_DAY" : row.kind === "EARLY_VOTE_SITE" ? "EARLY_VOTING" : row.kind === "DROP_OFF_LOCATION" ? "DROP_BOX" : null;
    if (!kind) return [];
    const location = row.value.address as CivicJson | undefined;
    const address = [location?.line1, location?.line2, location?.line3, location?.city, location?.state, location?.zip].map(words).filter(Boolean).join(", ");
    if (!address) return [];
    const point = googlePoint(row.value);
    const street = [location?.line1, location?.line2, location?.line3].map(words).filter(Boolean).join(" ");
    if (!point && street) unplaced.set(row.id, { street, city: words(location?.city), state: words(location?.state) || lookup.state!, zip: words(location?.zip) });
    return [{ id: row.id, kind, name: words(location?.locationName) || "Published voting location", address,
      room: null, lat: point?.lat ?? null, lng: point?.lng ?? null, ...(point ? { geocodeSource: "PUBLISHER" as const } : {}), election: "November 3, 2026", electionDate: GOOGLE_CIVIC_ELECTION_DAY, serves: null,
      hours: words(row.value.pollingHours) || undefined, days: [row.value.startDate, row.value.endDate].map(words).filter(Boolean).join(" through ") || undefined,
      locationNotes: words(row.value.notes) || undefined,
      sources: row.sources.map(source => ({ publisher: `${source.sourceOrg} — ${GOOGLE_VOTING_DATA_LABEL}`, url: source.sourceUrl, checkedAt: source.collectedAt })) }];
  });
  if (!sites.length && !lookup.electionOffices?.length) return [];
  return [{ ocdId: `${place.divisionIds.find(id => /\/county:/.test(id)) ?? `ocd-division/country:us/state:${lookup.state.toLowerCase()}`}#vip`,
    name: "Voting locations", state: lookup.state, model: "UNKNOWN", election: "November 3, 2026", electionDate: GOOGLE_CIVIC_ELECTION_DAY,
    sites, assignedSiteIds: place.precision === "ADDRESS" ? sites.filter(site => site.kind === "ELECTION_DAY").map(site => site.id) : [],
    sources: [{ publisher: "Google", title: GOOGLE_CIVIC_ATTRIBUTION, url: GOOGLE_CIVIC_DOCS, checkedAt: lookup.checkedAt },
      ...(lookup.electionOffices ?? []).map(office => ({ publisher: office.name, title: "Election office", url: office.url, checkedAt: lookup.checkedAt }))],
    sourceOrg: GOOGLE_CIVIC_ATTRIBUTION, sourceUrl: GOOGLE_CIVIC_DOCS, collectedAt: lookup.checkedAt, refusal: null }];
}

/** Google left these sites without a location, so Census places their published street addresses in one request. A miss leaves the site listed without a pin. */
async function placeWithCensus(jurisdictions: VotingJurisdiction[], unplaced: Map<string, BatchAddress>, place: VotingReaderPlace, fetchImpl: typeof fetch | undefined, signal: AbortSignal): Promise<void> {
  const ids = [...unplaced.keys()];
  try {
    const points = await censusBatchPoints(ids.map(id => unplaced.get(id)!), { fetchImpl, signal });
    for (const site of jurisdictions.flatMap(j => j.sites)) {
      const point = points.get(ids.indexOf(site.id));
      if (point) { site.lat = point.lat; site.lng = point.lng; site.geocodeSource = "CENSUS"; }
    }
  } catch (error) { recordVotingFailure({ stage: "google-site-geocode", precision: place.precision, state: place.states[0] }, error); }
}

/** Request-only fallback after the held-source check. No cache, publication, or address retention. */
export async function readGoogleVotingAnswer(address: string, place: VotingReaderPlace, options: CivicReadOptions = {}): Promise<{ jurisdictions: VotingJurisdiction[]; reason?: VotingFallbackReason }> {
  const signal = options.signal ?? AbortSignal.timeout(2200);
  const lookup = await lookupCivicAddress(address, new Set(place.divisionIds), { ...options, signal });
  if (lookup.status === "OUTAGE") recordVotingFailure({ stage: "google-fallback", precision: place.precision, state: place.states[0] },
    new Error(lookup.reason ?? "Google voting information could not be read."));
  const unplaced = new Map<string, BatchAddress>();
  const jurisdictions = civicVotingJurisdictions(lookup, place, unplaced);
  if (unplaced.size) await placeWithCensus(jurisdictions, unplaced, place, options.censusFetchImpl, signal);
  return { jurisdictions, ...(jurisdictions.some(j => j.sites.length) ? {} : { reason: lookup.failureReason ?? "NO_DATA" }) };
}
