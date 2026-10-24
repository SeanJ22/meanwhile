import { withReaderRoute, withReaderSelection } from "@/lib/db/reader-route";
import { readVotingSitesProjection } from "@/lib/ballot/voting-sites-server";
import { readZipPlace, withPlaceMapReads } from "@/lib/place-map/reader";
import { answerVotingSites, type VotingReaderPlace } from "@/lib/ballot/voting-answer";
import { addCensusVotingGeographies, censusVotingAddress, votingInputZip, votingPlaceFromZip } from "@/lib/ballot/voting-answer-geography";
import { recordVotingFailure } from "@/lib/ballot/voting-errors";
import { fillVotingSitesAnswer } from "@/lib/ballot/voting-sites-live";
import { markerFromRequest } from "@/lib/db/run-marker";
import { recordVotingLookupCount } from "@/lib/ballot/voting-sites-counts";
import { votingSitesResponse } from "@/lib/ballot/voting-sites-stream";
import { GOOGLE_CIVIC_STATES } from "@/lib/sources/google-civic/targets";
import { readCivicApi } from "@/lib/sources/google-civic/acquisition";
import type { VotingSitesAnswer, VotingSitesFile } from "@/lib/ballot/voting-sites";

/** Addresses stay in the uncached request, Census geocode, and live Google fallback. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" } as const;
const empty = (status = 200, outsideCoverage = true) => Response.json({ match: false, point: null, jurisdictions: [], outsideCoverage }, { status, headers: NO_STORE });

async function heldVotingFile(state: string, precision: VotingReaderPlace["precision"], deadline: number): Promise<VotingSitesFile> {
  try {
    const read = await readVotingSitesProjection(state, {}, Math.max(1, deadline - Date.now()));
    if (read.kind === "PROMOTED") return read.value;
    if (read.kind !== "NOT_RECORDED") recordVotingFailure({ stage: "held-voting-sites", state, precision }, new Error(`Voting-site holding could not be read: ${read.kind}`));
  } catch (error) { recordVotingFailure({ stage: "held-voting-sites", state, precision }, error); }
  return { generatedAt: "", jurisdictions: [] };
}

export async function POST(request: Request): Promise<Response> {
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
        try {
          const isZip = /^\d{5}$/.test(address);
          const suppliedState = /(?:^|[,\s])([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i.exec(address)?.[1]?.toUpperCase();
          const state = suppliedState && GOOGLE_CIVIC_STATES.includes(suppliedState) ? suppliedState : null;
          const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
          // The state holding is the same before and after Census resolves the
          // precinct. Start that read now; project its sites only once located.
          const prefetched = state ? withReaderSelection({ states: [state], keys: new Set() }, () => heldVotingFile(state, "ADDRESS", deadline)) : null;
          const electionCatalog = prefetched?.then(file => file.jurisdictions.length ? null : readCivicApi("elections", {}, { signal }));
          // Observe an early rejection until the fallback consumes it. Held
          // sites never send the address to Google or start a catalog request.
          void electionCatalog?.catch(() => {});
          stage = "geocode";
          const located = isZip ? null : await censusVotingAddress(address);
          const zipInput = votingInputZip(address);
          let place: VotingReaderPlace;
          if (!located && zipInput) {
            stage = "zip-membership";
            const zip = await readZipPlace(zipInput);
            place = votingPlaceFromZip(zip?.ids ?? []);
            if (!isZip) place.precision = "ADDRESS";
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
          const count = { day: new Date().toISOString().slice(0, 10), zip, districts: districtIds };
          const counted = (markerFromRequest(request).runClass === "ORGANIC" ? recordVotingLookupCount(count) : Promise.resolve()).catch(() => {
            recordVotingFailure({ stage: "anonymous-count" }, new Error("Anonymous voting count could not be saved"));
          });
          stage = "held-voting-sites";
          const result = withReaderSelection({ states: place.states, keys: new Set(place.divisionIds), ...(place.point ? { point: [place.point.lng, place.point.lat] as const } : {}) }, async () => {
            const files = await Promise.all(place.states.map(selected => selected === state && prefetched
              ? prefetched : heldVotingFile(selected, place.precision, deadline)));
            const file: VotingSitesFile = { generatedAt: files.map(row => row.generatedAt).sort().at(-1) ?? "", jurisdictions: files.flatMap(row => row.jurisdictions) };
            stage = "precinct-match";
            const answer = await answerVotingSites(file, place);
            stage = "google-fallback";
            return fillVotingSitesAnswer(answer, address, place, { signal, electionCatalog });
          });
          const [answer] = await Promise.all([result, counted]);
          return answer;
        } catch (error) {
          recordVotingFailure({ stage }, error, address);
          return { match: false, point: null, jurisdictions: [], outsideCoverage: true };
        }
      };
      return await votingSitesResponse(lookup(), request.headers.get("accept")?.includes("application/x-ndjson") ?? false);
    } catch (error) {
      recordVotingFailure({ stage }, error, address);
      return empty(stage === "input" ? 400 : 503, stage !== "input");
    }
  }));
}
