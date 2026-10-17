import { readerRoute } from "@/lib/api/reader-route";
import { parseCensusGeographies } from "@/lib/geo/census-geocoder";
import { currentRepresentationSelection } from "@/lib/census-geography/selection";
import { divisionsForCensusGeographies, divisionsByOcdIds } from "@/lib/registry/server";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { holdReaderAuthorityEdge, ensureReaderAuthorityEdge } from "@/lib/meetings/edge-serving";
import { loadVotingSites, readVotingSitesProjection } from "@/lib/ballot/voting-sites-server";
import { zipDivisionEntry } from "@/lib/geo/zip-division-index";
import { answerVotingSites, votingJurisdictionCovers, type VotingReaderPlace } from "@/lib/ballot/voting-answer";
import { addCensusVotingGeographies, census2020VotingDistricts, censusVotingAddress, censusVotingAddressFields, votingPlaceFromDivisions, votingInputZip } from "@/lib/ballot/voting-answer-geography";
import { readGoogleVotingAnswer } from "@/lib/sources/google-civic/reader-lookup";
import { readVotingSource } from "@/lib/ballot/voting-source-readers";
import type { VotingAddressInput } from "@/lib/ballot/voting-source-types";

/** POST keeps the address out of our URL. No identity fields, storage, logging or request cache. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" } as const;
const empty = (status = 200) => Response.json({ match: false, point: null, jurisdictions: [], outsideCoverage: false, pollingPlaceLinks: [] }, { status, headers: NO_STORE });

export const POST = readerRoute("/api/voting-sites", async function POST(request: Request) {
  const deadline = Date.now() + 2800;
  const requestFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store",
    signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, deadline - Date.now())), ...(init?.signal ? [init.signal] : [])]) });
  let address: string, googleRequested: boolean;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || Object.keys(body).some(key => key !== "address" && key !== "googleFallback")) return empty(400);
    address = typeof body.address === "string" ? body.address.trim() : "";
    googleRequested = body.googleFallback === true;
  } catch { return empty(400); }
  if (address.length < 3 || address.length > 200) return empty(400);

  const isZip = /^\d{5}$/.test(address);
  const geocoded = isZip ? Promise.resolve(null) : censusVotingAddress(address, requestFetch);
  {
    const edge = await ensureReaderAuthorityEdge(null, undefined, ["census-districts", "voting-sites"]).catch(error => holdReaderAuthorityEdge(error, ["census-districts", "voting-sites"]));
    if (edge) enterReaderAuthorityEdge(edge);
  }
  try {
    let place: VotingReaderPlace;
    let readerAddress: VotingAddressInput = { address };
    const located = await geocoded;
    const zipInput = isZip ? address : !located ? votingInputZip(address) : null;
    if (zipInput) {
      const zip = await zipDivisionEntry(zipInput);
      if (!zip) return empty();
      const divisions = await divisionsByOcdIds(zip.ids, { zip: zipInput });
      place = votingPlaceFromDivisions(divisions, "ZIP", null);
      place.divisionIds = [...new Set([...place.divisionIds, ...zip.ids])];
      place.states = [...new Set([...place.states, ...zip.ids.flatMap(id => /\/(?:state|district|territory):([a-z]{2})/.exec(id)?.[1]?.toUpperCase() ?? [])])];
    } else {
      if (!located) return empty();
      readerAddress = censusVotingAddressFields(address, located.payload);
      const geographic = parseCensusGeographies(located.payload);
      const divisions = await divisionsForCensusGeographies(geographic?.geographies ?? {}, currentRepresentationSelection(), "Current_Current", {});
      place = addCensusVotingGeographies(votingPlaceFromDivisions(divisions, "ADDRESS", located.point), located.payload);
    }
    const files = await Promise.all(place.states.map(async state => {
      await readVotingSitesProjection(state);
      return loadVotingSites(state);
    }));
    const file = { generatedAt: files.map(row => row.generatedAt).sort().at(-1) ?? "",
      jurisdictions: files.flatMap(row => row.jurisdictions).filter(row => votingJurisdictionCovers(row, place)) };
    const covering = file.jurisdictions.filter(j => votingJurisdictionCovers(j, place));
    const needsPrecinct = covering.some(j => j.sites.some(site => site.kind === "ELECTION_DAY" && site.precinct));
    if (place.point && needsPrecinct && !covering.some(j => j.boundaries?.some(b => b.kind === "OFFICIAL_PRECINCT"))) {
      place = addCensusVotingGeographies(place, await census2020VotingDistricts(place.point, requestFetch), "CENSUS_2020");
    }
    const answer = await answerVotingSites(file, place, { address, readerRequested: true, googleRequested }, {
      readOfficialAddress: (door) => readVotingSource(door, { fetch: requestFetch, deadlineMs: deadline, readerAddress }),
      readGoogle: (value, resolved) => readGoogleVotingAnswer(value, resolved, { fetchImpl: requestFetch }),
    });
    return Response.json(answer, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Voting-location data is temporarily unavailable. The source work remains open." }, { status: 503, headers: NO_STORE });
  }
});
