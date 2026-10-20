import { lookupCivicAddress, type CivicReadOptions } from "./api-read.ts";
import { GOOGLE_CIVIC_DOCS, GOOGLE_CIVIC_ELECTION_DAY } from "./targets.ts";
import type { CivicJson, CivicLookup } from "./model.ts";
import { GOOGLE_VOTING_DATA_LABEL, type VotingReaderPlace } from "../../ballot/voting-answer.ts";
import type { VotingJurisdiction, VotingSite } from "../../ballot/voting-sites.ts";

const words = (value: unknown): string => typeof value === "string" ? value : "";

/** Adapt the shared source parser's safe projection; no second Google response parser. */
function civicVotingJurisdictions(lookup: CivicLookup, place: VotingReaderPlace): VotingJurisdiction[] {
  if (!lookup.state || !place.states.includes(lookup.state)) return [];
  const sites: VotingSite[] = lookup.rows.flatMap(row => {
    const kind = row.kind === "POLLING_LOCATION" ? "ELECTION_DAY" : row.kind === "EARLY_VOTE_SITE" ? "EARLY_VOTING" : row.kind === "DROP_OFF_LOCATION" ? "DROP_BOX" : null;
    if (!kind) return [];
    const location = row.value.address as CivicJson | undefined;
    const address = [location?.line1, location?.line2, location?.line3, location?.city, location?.state, location?.zip].map(words).filter(Boolean).join(", ");
    if (!address) return [];
    return [{ id: row.id, kind, name: words(location?.locationName) || "Published voting location", address,
      room: null, lat: null, lng: null, election: "November 3, 2026", electionDate: GOOGLE_CIVIC_ELECTION_DAY, serves: null,
      hours: words(row.value.pollingHours) || undefined, days: [row.value.startDate, row.value.endDate].map(words).filter(Boolean).join(" through ") || undefined,
      locationNotes: words(row.value.notes) || undefined,
      sources: row.sources.map(source => ({ publisher: `${source.sourceOrg} — ${GOOGLE_VOTING_DATA_LABEL}`, url: source.sourceUrl, checkedAt: source.collectedAt })) }];
  });
  if (!sites.length) return [];
  return [{ ocdId: `${place.divisionIds.find(id => /\/county:/.test(id)) ?? `ocd-division/country:us/state:${lookup.state.toLowerCase()}`}#vip`,
    name: "Voting locations", state: lookup.state, model: "UNKNOWN", election: "November 3, 2026", electionDate: GOOGLE_CIVIC_ELECTION_DAY,
    sites, sourceOrg: GOOGLE_VOTING_DATA_LABEL, sourceUrl: GOOGLE_CIVIC_DOCS, collectedAt: lookup.checkedAt.slice(0, 10), refusal: null }];
}

/** Only answerVotingSites invokes this after explicit fallback consent and an empty official-source check. */
export async function readGoogleVotingAnswer(address: string, place: VotingReaderPlace, options: CivicReadOptions = {}): Promise<VotingJurisdiction[]> {
  const lookup = await lookupCivicAddress(address, new Set(place.divisionIds), { ...options, signal: options.signal ?? AbortSignal.timeout(2200) });
  return civicVotingJurisdictions(lookup, place);
}
