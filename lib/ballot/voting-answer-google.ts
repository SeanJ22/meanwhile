import type { VotingReaderPlace } from "./voting-answer.ts";
import { GOOGLE_VOTING_DATA_LABEL } from "./voting-answer.ts";
import type { VotingJurisdiction, VotingSite } from "./voting-sites.ts";

const ENDPOINT = "https://www.googleapis.com/civicinfo/v2/voterinfo";
const text = (value: unknown): string => typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Called only by answerVotingSites after its separate Google consent check. */
export async function readGoogleVotingAnswer(address: string, place: VotingReaderPlace, options: { key?: string; fetchImpl?: typeof fetch; now?: string } = {}): Promise<VotingJurisdiction[]> {
  const key = options.key ?? process.env.GOOGLE_CIVIC_API_KEY;
  if (!key || !place.states.length) return [];
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ address, key }).toString();
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { cache: "no-store", signal: AbortSignal.timeout(2200), headers: { accept: "application/json" } });
    if (!response.ok) return [];
    const payload = record(await response.json());
    const election = record(payload.election);
    if (text(election.electionDay) !== "2026-11-03") return [];
    const source = { publisher: GOOGLE_VOTING_DATA_LABEL, url: "https://developers.google.com/civic-information/docs/v2/elections/voterInfoQuery", checkedAt: options.now ?? new Date().toISOString() };
    const sites: VotingSite[] = [];
    for (const [field, kind] of [["pollingLocations", "ELECTION_DAY"], ["earlyVoteSites", "EARLY_VOTING"], ["dropOffLocations", "DROP_BOX"]] as const) {
      for (const item of rows(payload[field])) {
        const value = record(item), location = record(value.address);
        const siteAddress = ["line1", "line2", "line3", "city", "state", "zip"].map(k => text(location[k])).filter(Boolean).join(", ");
        if (!siteAddress) continue;
        sites.push({ id: `vip-${field}-${sites.length}`, name: text(location.locationName) || "Published voting location", address: siteAddress,
          room: null, lat: null, lng: null, kind, election: text(election.name) || text(election.electionDay), electionDate: text(election.electionDay), serves: null,
          hours: text(value.pollingHours) || undefined, days: [text(value.startDate), text(value.endDate)].filter(Boolean).join(" through ") || undefined,
          locationNotes: text(value.notes) || undefined, sources: [source] });
      }
    }
    if (!sites.length) return [];
    const state = place.states[0];
    return [{ ocdId: `${place.divisionIds.find(id => /\/county:/.test(id)) ?? `ocd-division/country:us/state:${state.toLowerCase()}`}#vip`,
      name: "Voting locations", state, model: "UNKNOWN", election: text(election.name), electionDate: text(election.electionDay), sites,
      sourceOrg: source.publisher, sourceUrl: source.url, collectedAt: source.checkedAt.slice(0, 10), sources: [source], refusal: null }];
  } catch { return []; }
}
