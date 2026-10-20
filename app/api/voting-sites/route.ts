import { withReaderRoute, withReaderSelection } from "@/lib/db/reader-route";
import { readVotingSitesProjection } from "@/lib/ballot/voting-sites-server";
import { indexedZipDivisionEntry } from "@/lib/geo/zip-division-index";
import { answerVotingSites, type VotingReaderPlace } from "@/lib/ballot/voting-answer";
import { addCensusVotingGeographies, censusVotingAddress, votingInputZip, votingPlaceFromZip } from "@/lib/ballot/voting-answer-geography";
import { recordVotingFailure } from "@/lib/ballot/voting-errors";
import type { VotingSitesFile } from "@/lib/ballot/voting-sites";

/** Address inputs stay in this uncached POST request and the one Census geocode. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" } as const;
const empty = (status = 200, outsideCoverage = true) => Response.json({ match: false, point: null, jurisdictions: [], outsideCoverage, pollingPlaceLinks: [] }, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  return withReaderRoute("/api/voting-sites", async () => {
    const deadline = Date.now() + 2800;
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
      const isZip = /^\d{5}$/.test(address);
      stage = "geocode";
      const located = isZip ? null : await censusVotingAddress(address);
      const zipInput = isZip ? address : !located ? votingInputZip(address) : null;
      let place: VotingReaderPlace;
      if (zipInput) {
        stage = "zip-membership";
        const zip = await indexedZipDivisionEntry(zipInput);
        if (!zip) {
          recordVotingFailure({ stage, precision: "ZIP" }, new Error("ZIP membership is not held"));
          return empty();
        }
        place = votingPlaceFromZip(zip.ids);
      } else {
        if (!located) return empty();
        place = addCensusVotingGeographies({ precision: "ADDRESS", point: located.point, divisionIds: [], states: [], countyFips: [], countyNames: [],
          countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] }, located.payload);
      }
      stage = "held-voting-sites";
      return await withReaderSelection({ states: place.states, keys: new Set(place.divisionIds), ...(place.point ? { point: [place.point.lng, place.point.lat] as const } : {}) }, async () => {
        const files = await Promise.all(place.states.map(async state => {
          const read = await readVotingSitesProjection(state, {}, Math.max(1, deadline - Date.now()));
          if (read.kind === "PROMOTED") return read.value;
          if (read.kind === "NOT_RECORDED") return { generatedAt: "", jurisdictions: [] } satisfies VotingSitesFile;
          const detail = "detail" in read ? read.detail : "No published voting-site value";
          recordVotingFailure({ stage, state, precision: place.precision }, new Error(`${read.kind}: ${detail}`));
          throw new Error(`Voting-site holding could not be read for ${state}: ${read.kind}`);
        }));
        const file: VotingSitesFile = { generatedAt: files.map(row => row.generatedAt).sort().at(-1) ?? "", jurisdictions: files.flatMap(row => row.jurisdictions) };
        stage = "precinct-match";
        const answer = await answerVotingSites(file, place);
        return Response.json(answer, { headers: NO_STORE });
      });
    } catch (error) {
      recordVotingFailure({ stage }, error, address);
      return empty(stage === "input" ? 400 : 503, stage !== "input");
    }
  });
}
