import { loadWebsiteSavedKeys } from "../../../lib/core/keys-entry.ts";
import { withReaderRoute, withReaderSelection } from "@/lib/db/reader-route";
import { readVotingSitesProjection } from "@/lib/ballot/voting-sites-server";
import { readZipPlace, withPlaceMapReads } from "@/lib/place-map/reader";
import { readZipArea } from "@/lib/place-map/locations";
import { readStateVotingLookups } from "@/lib/ballot/state-voting-lookups";
import { answerVotingSites, type VotingReaderPlace } from "@/lib/ballot/voting-answer";
import { addCensusVotingGeographies, censusVotingAddress, votingInputZip, votingPlaceFromZip } from "@/lib/ballot/voting-answer-geography";
import { recordVotingFailure } from "@/lib/ballot/voting-errors";
import { markerFromRequest } from "@/lib/db/run-marker";
import { recordVotingLookupCount } from "@/lib/ballot/voting-sites-counts";
import { votingSitesResponse } from "@/lib/ballot/voting-sites-stream";
import { GOOGLE_CIVIC_STATES } from "@/lib/sources/google-civic/targets";
import { afterResponse } from "@/lib/log/after-response";
import type { VotingSitesAnswer, VotingSitesFile } from "@/lib/ballot/voting-sites";

/** Addresses stay in the uncached request, Census geocode, and live Google fallback. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" } as const;
const empty = (status = 200, outsideCoverage = true) => Response.json({ match: false, point: null, jurisdictions: [], outsideCoverage }, { status, headers: NO_STORE });

async function pollingLookups(states: readonly string[], deadline: number) {
  try { return await readStateVotingLookups(states, Math.max(1, deadline - Date.now())); }
  catch (error) { recordVotingFailure({ stage: "state-lookup-links", state: states.join(",") }, error); return []; }
}

function countLookup(request: Request, zip: string, districts: string[]) {
  if (markerFromRequest(request).runClass !== "ORGANIC") return Promise.resolve();
  return afterResponse(async () => {
    try { await recordVotingLookupCount({ day: new Date().toISOString().slice(0, 10), zip, districts }); }
    catch { recordVotingFailure({ stage: "anonymous-count" }, new Error("Anonymous voting count could not be saved")); }
  });
}

/** The current map's state link is available before a reader enters an address. */
export async function GET(request: Request): Promise<Response> {
  await loadWebsiteSavedKeys();
  return withReaderRoute("/api/voting-sites", async () => {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "state") || params.getAll("state").length !== 1) return empty(400, false);
    const state = params.get("state")?.toUpperCase();
    if (!state || !GOOGLE_CIVIC_STATES.includes(state)) return empty(400, false);
    return Response.json({ match: true, point: null, jurisdictions: [], outsideCoverage: true,
      pollingLookups: await pollingLookups([state], Date.now() + 2400) }, { headers: NO_STORE });
  });
}

async function heldVotingFile(state: string, place: VotingReaderPlace, deadline: number): Promise<VotingSitesFile> {
  try {
    const read = await readVotingSitesProjection(state, {}, Math.max(1, deadline - Date.now()), place);
    if (read.kind === "PROMOTED") return read.value;
    if (read.kind !== "NOT_RECORDED") recordVotingFailure({ stage: "held-voting-sites", state, precision: place.precision }, new Error(`Voting-site holding could not be read: ${read.kind}`));
  } catch (error) { recordVotingFailure({ stage: "held-voting-sites", state, precision: place.precision }, error); }
  return { generatedAt: "", jurisdictions: [] };
}

export async function POST(request: Request): Promise<Response> {
  await loadWebsiteSavedKeys();
  return withReaderRoute("/api/voting-sites", () => withPlaceMapReads(async () => {
    const started = Date.now();
    const deadline = started + 2400;
    let address = "";
    let stage = "input";
    try {
      let body: unknown;
      try { body = await request.json(); }
      catch { throw new Error("Voting lookup body is not valid JSON"); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "address")) {
        recordVotingFailure({ stage }, new Error("Voting lookup accepts only an address field"));
        return empty(400, false);
      }
      address = typeof (body as { address?: unknown }).address === "string" ? (body as { address: string }).address.trim() : "";
      if (address.length < 3 || address.length > 200) {
        recordVotingFailure({ stage }, new Error("Voting lookup address length is outside 3 to 200 characters"));
        return empty(400, false);
      }
      const lookup = async (): Promise<VotingSitesAnswer> => {
        const zipInput = votingInputZip(address);
        // One indexed place-map row gives the ZIP's display point and postal state.
        const area = zipInput ? await readZipArea(zipInput).catch(error => { recordVotingFailure({ stage: "zip-location" }, error); return null; }) : null;
        const suppliedState = /(?:^|[,\s])([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i.exec(address)?.[1]?.toUpperCase();
        const state = suppliedState && GOOGLE_CIVIC_STATES.includes(suppliedState) ? suppliedState : area?.postal?.state ?? null;
        const links = state ? pollingLookups([state], deadline) : null;
        const linksFor = async (states: readonly string[]) => [...(links ? await links : []),
          ...await pollingLookups(states.filter(value => value !== state), deadline)];
        let place: VotingReaderPlace | null = null;
        try {
          const isZip = /^\d{5}$/.test(address);
          const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
          if (isZip) {
            stage = "zip-membership";
            const zip = await readZipPlace(address);
            place = votingPlaceFromZip(zip?.ids ?? []);
            if (!place.states.length && state) place.states = [state];
            await countLookup(request, address, place.divisionIds);
            return { match: !!place.states.length, point: area?.point ?? null, precision: "ZIP", jurisdictions: [], outsideCoverage: true,
              pollingLookups: await linksFor(place.states) };
          }
          // Start loading the optional live provider while Census resolves the address.
          const live = import("@/lib/ballot/voting-sites-live");
          void live.catch(() => {});
          stage = "geocode";
          const located = await censusVotingAddress(address);
          if (!located && zipInput) {
            stage = "zip-membership";
            const zip = await readZipPlace(zipInput);
            place = votingPlaceFromZip(zip?.ids ?? []);
            if (!place.states.length && state) place.states = [state];
            await countLookup(request, zipInput, place.divisionIds);
            return { match: !!place.states.length, point: area?.point ?? null, precision: "ZIP", jurisdictions: [], outsideCoverage: true,
              pollingLookups: await linksFor(place.states) };
          } else if (located) {
            place = addCensusVotingGeographies({ precision: "ADDRESS", point: located.point, divisionIds: [], states: [], countyFips: [], countyNames: [],
              countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] }, located.payload);
          } else {
            place = votingPlaceFromZip([]);
            place.precision = "ADDRESS";
          }
          // A supplied state remains useful if Census is down and the address has no ZIP.
          if (!place.states.length && state) place.states = [state];
          // Census and our ZIP membership supply count dimensions; Google never does.
          const match = (located?.payload as { result?: { addressMatches?: { addressComponents?: { zip?: string }; geographies?: Record<string, Record<string, string>[]> }[] } })?.result?.addressMatches?.[0];
          const zip = zipInput ?? (/^\d{5}$/.test(match?.addressComponents?.zip ?? "") ? match!.addressComponents!.zip! : "");
          const districtIds = [...place.divisionIds];
          for (const state of place.states) districtIds.push(`ocd-division/country:us/state:${state.toLowerCase()}`);
          for (const [layer, rows] of Object.entries(match?.geographies ?? {})) {
            if (!/congressional districts/i.test(layer)) continue;
            for (const row of rows) {
              const district = row.CD119 ?? row.GEOID?.slice(2);
              if (district && /^\d+$/.test(district) && place.states.length === 1)
                districtIds.push(`ocd-division/country:us/state:${place.states[0].toLowerCase()}/cd:${Number(district)}`);
            }
          }
          const counted = countLookup(request, zip, districtIds);
          stage = "held-voting-sites";
          const selectedPlace = place;
          const result = withReaderSelection({ states: selectedPlace.states, keys: new Set(selectedPlace.divisionIds), ...(selectedPlace.point ? { point: [selectedPlace.point.lng, selectedPlace.point.lat] as const } : {}) }, async () => {
            const files = await Promise.all(selectedPlace.states.map(selected => heldVotingFile(selected, selectedPlace, deadline)));
            const file: VotingSitesFile = { generatedAt: files.map(row => row.generatedAt).sort().at(-1) ?? "", jurisdictions: files.flatMap(row => row.jurisdictions) };
            stage = "precinct-match";
            const answer = await answerVotingSites(file, selectedPlace);
            stage = "google-fallback";
            return (await live).fillVotingSitesAnswer(answer, address, selectedPlace, { signal });
          });
          const [answer] = await Promise.all([result, counted]);
          const states = [...new Set([...place.states, ...answer.jurisdictions.map(j => j.state)])];
          return { ...answer, pollingLookups: await linksFor(states) };
        } catch (error) {
          recordVotingFailure({ stage }, error, address);
          return { match: !!state, point: place?.point ?? null, precision: /^\d{5}$/.test(address) ? "ZIP" : "ADDRESS",
            jurisdictions: [], outsideCoverage: true, pollingLookups: links ? await links : [] };
        }
      };
      return await votingSitesResponse(lookup(), request.headers.get("accept")?.includes("application/x-ndjson") ?? false);
    } catch (error) {
      recordVotingFailure({ stage }, error, address);
      return empty(stage === "input" ? 400 : 503, stage !== "input");
    }
  }));
}
