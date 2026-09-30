import { OUTBOUND_USER_AGENT } from "@/lib/geo/outbound-agent";
import {
  CENSUS_BENCHMARK,
  CENSUS_GEOCODER_URL,
  parseCensusPoint,
} from "@/lib/geo/census-geocoder";
import { divisionsAt } from "@/lib/registry/server";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { readReaderManifest, ensureReaderAuthorityEdge } from "@/lib/meetings/edge-serving";
import {
  loadVotingSites,
  readVotingSitesProjection,
} from "@/lib/ballot/voting-sites-server";
import { currentPollingPlaceLinks } from "@/lib/ballot/polling-place-links";
import { refreshBallotNavigationFromPromoted } from "@/lib/civic-data/curated-reader-read-model";
import {
  modelSentence,
  narrowingFor,
  refusalLine,
  type VotingJurisdiction,
  type VotingSitesAnswer,
} from "@/lib/ballot/voting-sites";

/**
 * `POST /api/voting-sites` — where the reader can actually vote (B19).
 *
 * ## Address in, sites out, and NOTHING in between is kept
 *
 * This route is `/api/geocode`'s sibling and inherits its whole design. It
 * writes no log row, no database row, no cache entry; it echoes no header; it
 * prints nothing. The address exists in this function's memory for the length
 * of one request and is gone. `tests/voting-sites.test.ts` asserts it the same
 * way the geocoder's guard does — a source scan for every write primitive, so
 * a future edit that adds one fails the suite rather than quietly retracting
 * the promise the input's own copy makes.
 *
 * **POST, not GET**, for the same reason: a GET would put a home address in a
 * URL, and URLs reach access logs, referrers and proxy caches that are not
 * ours to promise about. `no-store` on the way back, because this response is
 * per-reader by construction and must never sit in a shared cache (the D40
 * family).
 *
 * ## What comes back, and what it refuses to invent
 *
 * The point resolves to a set of divisions, and a jurisdiction matches when
 * the reader's point is inside it. There may be more than one — a Morris
 * municipality sits inside Morris County — and every match is returned with
 * its own model sentence, because which model applies is the answer in half
 * the cases.
 *
 * A jurisdiction whose retrieval failed comes back with its REFUSAL and every
 * rung walked, never as an empty list. "No polling places" is never the render
 * for "we could not reach the authority."
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_ADDRESS_CHARS = 200;

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
} as const;

function project(j: VotingJurisdiction): VotingSitesAnswer["jurisdictions"][number] {
  return {
    ocdId: j.ocdId,
    name: j.name,
    state: j.state,
    model: j.model,
    modelSentence: modelSentence(j),
    election: j.election,
    sourceOrg: j.sourceOrg,
    sourceUrl: j.sourceUrl,
    collectedAt: j.collectedAt,
    sites: j.sites,
    refusal: j.refusal,
    refusalLine: j.refusal ? refusalLine(j) : null,
    narrowing: narrowingFor(j),
  };
}

async function geocode(address: string) {
  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", CENSUS_BENCHMARK);
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": OUTBOUND_USER_AGENT,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!upstream.ok) return null;
    return parseCensusPoint(await upstream.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type BallotNavigationDataState = "PROMOTED" | "FIRST_SEED" | "STORE_UNREACHABLE";

const empty = (
  pollingPlaceLinks: ReturnType<typeof currentPollingPlaceLinks>,
  ballotNavigationDataState: BallotNavigationDataState,
  status = 200,
) =>
  Response.json(
    { match: false, point: null, jurisdictions: [], outsideCoverage: false, pollingPlaceLinks, ballotNavigationDataState },
    { status, headers: NO_STORE },
  );

export async function POST(request: Request) {
  const manifest = await readReaderManifest().catch(() => null);
  if (manifest?.authorityArtifacts) {
    const edge = await ensureReaderAuthorityEdge(manifest, undefined, [
      "census-districts", "registry-runtime", "ballot-navigation", "voting-sites",
    ]).catch(() => null);
    if (edge) enterReaderAuthorityEdge(edge);
  }
  let pollingPlaceLinks: ReturnType<typeof currentPollingPlaceLinks> = [];
  let ballotNavigationDataState: BallotNavigationDataState = "FIRST_SEED";
  try {
    if (process.env.NODE_ENV === "production") {
      await refreshBallotNavigationFromPromoted();
      ballotNavigationDataState = "PROMOTED";
    }
    pollingPlaceLinks = currentPollingPlaceLinks();
  } catch {
    // Official handoff links are independent of the voting-site projection.
    // Withhold only this family and continue the in-app site lookup.
    ballotNavigationDataState = "STORE_UNREACHABLE";
  }
  let address: string;
  try {
    const body = (await request.json()) as { address?: unknown };
    address = typeof body.address === "string" ? body.address.trim() : "";
  } catch {
    return empty(pollingPlaceLinks, ballotNavigationDataState, 400);
  }
  // A validity check, never behind a flag: closed shape and a length cap.
  if (address.length < 3 || address.length > MAX_ADDRESS_CHARS) return empty(pollingPlaceLinks, ballotNavigationDataState, 400);

  const point = await geocode(address);
  if (!point) return empty(pollingPlaceLinks, ballotNavigationDataState);

  const divisions = await divisionsAt(point.lat, point.lng);
  const covering = new Set(divisions.map((d) => d.ocdId));

  let file: ReturnType<typeof loadVotingSites>;
  try {
    await readVotingSitesProjection();
    file = loadVotingSites();
  } catch {
    return Response.json(
      { error: "voting-site data unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
  const hits = file.jurisdictions.filter((j) => covering.has(j.ocdId));

  /*
   * A state-level record (New Hampshire's walled state list) is not a
   * division the resolver returns, and it is exactly what a NH reader needs
   * to see: the wall, with its rungs. So a state-level record joins the
   * answer whenever the reader's point resolved into that state and nothing
   * more specific answered for them.
   */
  const state = divisions
    .map((d) => /\/state:([a-z]{2})(\/|$)/.exec(d.ocdId)?.[1])
    .find((s): s is string => typeof s === "string");
  if (state) {
    const stateRecord = file.jurisdictions.find(
      (j) => j.ocdId === `ocd-division/country:us/state:${state}`,
    );
    const haveSites = hits.some((j) => j.sites.length > 0);
    if (stateRecord && !haveSites && !hits.includes(stateRecord)) {
      hits.push(stateRecord);
    }
  }

  const answer: VotingSitesAnswer = {
    match: true,
    point,
    jurisdictions: hits.map(project),
    outsideCoverage: hits.length === 0,
    pollingPlaceLinks,
    ballotNavigationDataState,
  };
  return Response.json(answer, { headers: NO_STORE });
}
