import { withReaderRoute, withReaderSelection } from "@/lib/db/reader-route";
import { readVotingSitesProjection } from "@/lib/ballot/voting-sites-server";
import { indexedZipDivisionEntry } from "@/lib/geo/zip-division-index";
import { postalArea } from "@/lib/geo/postal";
import { answerVotingSites, type VotingReaderPlace } from "@/lib/ballot/voting-answer";
import { addCensusVotingGeographies, censusVotingAddress, votingInputZip, votingPlaceFromZip } from "@/lib/ballot/voting-answer-geography";
import { recordVotingFailure } from "@/lib/ballot/voting-errors";
import { fillVotingSitesAnswer } from "@/lib/ballot/voting-sites-live";
import { markerFromRequest } from "@/lib/db/run-marker";
import { recordVotingLookupCount } from "@/lib/ballot/voting-sites-counts";
import { votingSitesResponse } from "@/lib/ballot/voting-sites-stream";
import type { VotingSitesAnswer, VotingSitesFile } from "@/lib/ballot/voting-sites";

/** Addresses stay in the uncached request, Census geocode, and live Google fallback. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" } as const;
const empty = (status = 200, outsideCoverage = true) => Response.json({ match: false, point: null, jurisdictions: [], outsideCoverage, pollingPlaceLinks: [] }, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  return withReaderRoute("/api/voting-sites", async () => {
    const deadline = Date.now() + 2500;
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
          stage = "geocode";
          const located = isZip ? null : await censusVotingAddress(address);
          const zipInput = votingInputZip(address);
          let place: VotingReaderPlace;
          if (!located && zipInput) {
            stage = "zip-membership";
            const zip = await indexedZipDivisionEntry(zipInput) ?? await indexedZipDivisionEntry(postalArea(zipInput)?.zcta ?? null);
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
          if (!place.states.length) {
            const state = /(?:^|[,\s])([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i.exec(address)?.[1]?.toUpperCase();
            if (state && (await import("@/lib/sources/google-civic/targets")).GOOGLE_CIVIC_STATES.includes(state)) place.states = [state];
          }
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
            const files = await Promise.all(place.states.map(async state => {
              const read = await readVotingSitesProjection(state, {}, Math.max(1, deadline - Date.now()));
              if (read.kind === "PROMOTED") return read.value;
              if (read.kind !== "NOT_RECORDED") recordVotingFailure({ stage, state, precision: place.precision }, new Error(`Voting-site holding could not be read: ${read.kind}`));
              return { generatedAt: "", jurisdictions: [] } satisfies VotingSitesFile;
            }));
            const file: VotingSitesFile = { generatedAt: files.map(row => row.generatedAt).sort().at(-1) ?? "", jurisdictions: files.flatMap(row => row.jurisdictions) };
            stage = "precinct-match";
            const answer = await answerVotingSites(file, place);
            stage = "google-fallback";
            return fillVotingSitesAnswer(answer, address, place, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]) });
          });
          const [answer] = await Promise.all([result, counted]);
          return answer;
        } catch (error) {
          recordVotingFailure({ stage }, error, address);
          return { match: false, point: null, jurisdictions: [], outsideCoverage: true, pollingPlaceLinks: [] };
        }
      };
      return await votingSitesResponse(lookup(), request.headers.get("accept")?.includes("application/x-ndjson") ?? false);
    } catch (error) {
      recordVotingFailure({ stage }, error, address);
      return empty(stage === "input" ? 400 : 503, stage !== "input");
    }
  });
}
