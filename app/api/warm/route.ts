/**
 * Keeps server instances booted and ready for a cold Ask or map. `netlify/functions/keep-warm.mts` calls this
 * route fourteen times at once every five minutes. A marked call holds for up to a second and loads, on its
 * instance, the reader edge, one place per published state, and the Ask route's module graph and source
 * preloads. All of it runs in an edge-only context (`edgeOnly`), so it never reads the database. An unmarked
 * call loads nothing and answers at once.
 */
import { numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { divisionIdsForZipArea } from "@/lib/ballot/zip-divisions";
import { settleAzBallotRead, settleCandidateCorpusRead, settleCandidateProfilesRead } from "@/lib/civic-data/manual-read-models";
import { settleAzPimaFinanceRead } from "@/lib/control-plane/campaign-finance/held-records";
import { settleOfficeholderStatementsRead } from "@/lib/corpus/data-plane";
import { settleFundingRead } from "@/lib/funding/snapshot";
import { settleStateMoneyReads } from "@/lib/funding/state-snapshot";
import { zipCertainty } from "@/lib/geo/zip-certainty";
import { lowestZipByDivision } from "@/lib/geo/zip-division-index";
import { lookupZctaAsync } from "@/lib/geo/zcta-table";
import { publishedCountyDivisions, warmPlacesForCounties, type WarmPlace } from "@/lib/ops/warm-places";
import { NATIONAL_SCOPE, stateOfOcdId, type ReaderManifest } from "@/lib/meetings/edge-artifacts";
import { ensureReaderAuthorityEdge, readReaderEdgeMeetings, readReaderManifest } from "@/lib/meetings/edge-serving";
import { settleExecutiveActionsRead } from "@/lib/officials/executive-actions";
import { settleOutcomeRead } from "@/lib/outcomes/store";
import { enterReaderAuthorityEdge, ReaderEdgeOnlyRefusal } from "@/lib/registry/runtime-edge";
import {
  coverageAt,
  divisionsAt,
  divisionsByOcdIds,
  prefetchReaderGeography,
  settleCommentAccessRead,
  settleFederalDirectoryRead,
  settleRegistryAuthorityReads,
} from "@/lib/registry/server";
import { settleFederalKeyVotesRead } from "@/lib/votes/key-votes-projection";
import { settleFederalVotesRead } from "@/lib/votes/snapshot";

/** The synthetic-run marker the pinger sends (`x-wtp-synthetic-run`). */
export const KEEP_WARM_MARKER = "keep-warm";
/** The longest a marked call holds its instance. */
export const MAX_HOLD_MS = 1000;
/** The longest a marked call spends resolving places before it answers. */
export const PRIME_PLACES_BUDGET_MS = 4000;
/** The longest a marked call spends loading the Ask's code and sources before it answers; the rest goes on in the background. */
export const PRIME_ASK_BUDGET_MS = 4000;

/**
 * The Ask's own source preloads, under the names its trace times them by (`essentialPreloads` and
 * `deferrablePreloads` in app/api/ask/grounded/route.ts). The state roll calls are left out.
 */
export const ASK_SOURCE_PRELOADS: Readonly<Record<string, () => Promise<unknown>>> = {
  registry: () => settleRegistryAuthorityReads("REGISTRY"),
  federalDirectory: settleFederalDirectoryRead,
  outcomes: settleOutcomeRead,
  commentAccess: settleCommentAccessRead,
  funding: settleFundingRead,
  stateMoney: settleStateMoneyReads,
  azPimaFinance: settleAzPimaFinanceRead,
  federalVotes: settleFederalVotesRead,
  federalKeyVotes: settleFederalKeyVotesRead,
  azBallot: settleAzBallotRead,
  candidateProfiles: settleCandidateProfilesRead,
  candidateCorpus: settleCandidateCorpusRead,
  officeholderStatements: settleOfficeholderStatementsRead,
  executiveActions: settleExecutiveActionsRead,
};

const bootedAt = new Date().toISOString();

/** What a marked call loaded, on its instance, for a cold Ask. */
export interface AskPrimed {
  /** Milliseconds to load the Ask route's module graph here (near 0 once loaded); null when the import failed or outran the budget. */
  readonly graphMs: number | null;
  /** Ask sources that settled from the edge. */
  readonly sources: number;
  /** Ask sources the edge does not carry, refused rather than read from the database. */
  readonly sourcesRefused: number;
  /** Ask sources whose edge read failed some other way (the Ask reports its own gap for these). */
  readonly sourcesFailed: number;
  /** Milliseconds the source preloads took, or null when they outran the budget. */
  readonly sourcesMs: number | null;
}

export interface ReaderEdgePrimed {
  readonly manifest: boolean;
  readonly authorityFamilies: number;
  readonly meetings: boolean;
  /** States whose place resolved end to end (divisions, area, coverage) from the edge within the budget. */
  readonly places: number;
  /** States whose place needed a family the manifest does not carry, so it was refused rather than read from the database. */
  readonly placesRefused: number;
  /** The Ask's code and sources on this instance; null when there is no edge to load them from. */
  readonly ask: AskPrimed | null;
}

const NOTHING_PRIMED: ReaderEdgePrimed = { manifest: false, authorityFamilies: 0, meetings: false, places: 0, placesRefused: 0, ask: null };

/** How many of a state's lowest ZIPs are tried for a centroid that lies inside it. */
const PLACE_CANDIDATES = 5;

/** One state's place: the lowest indexed ZIP whose centroid resolves to that state's own divisions. The lowest ZIP alone can belong to a neighbouring state. */
async function statePlace(state: string) {
  const lowest = await lowestZipByDivision(state);
  const prefix = `ocd-division/country:us/state:${state}/`;
  const zips = [...new Set([...(lowest ?? [])].filter(([division]) => division.startsWith(prefix)).map(([, zip]) => zip))].sort();
  for (const zip of zips.slice(0, PLACE_CANDIDATES)) {
    const centroid = await lookupZctaAsync(zip);
    if (!centroid) continue;
    const own = await divisionsAt(centroid.lat, centroid.lng);
    if (own.some((division) => division.ocdId.startsWith(prefix))) return { zip, lat: centroid.lat, lng: centroid.lng, own };
  }
  return null;
}

/** Resolve one place per published state the way `/api/meetings` does, so its reads are loaded on this instance. */
async function primeReaderPlaces(manifest: ReaderManifest): Promise<{ places: number; placesRefused: number }> {
  const states = [...new Set(manifest.scopes.map((scope) =>
    stateOfOcdId(scope.ocdId) ?? (/^[a-z]{2}$/.test(scope.scope) && scope.scope !== NATIONAL_SCOPE ? scope.scope : null),
  ).filter((state): state is string => state !== null))];
  const counts = { places: 0, placesRefused: 0 };
  const each = states.map(async (state) => {
    try {
      const place = await statePlace(state);
      if (!place) return;
      const own = place.own;
      const widened = await divisionsByOcdIds(await divisionIdsForZipArea(place.zip, own.map((d) => d.ocdId)));
      await coverageAt(place.lat, place.lng, 0, widened.length >= own.length ? widened : own);
      await zipCertainty(place.zip);
      counts.places += 1;
    } catch (error) {
      if (error instanceof ReaderEdgeOnlyRefusal) counts.placesRefused += 1;
    }
  });
  let expired: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(each),
    new Promise((resolve) => { expired = setTimeout(resolve, PRIME_PLACES_BUDGET_MS); }),
  ]);
  clearTimeout(expired);
  return { ...counts };
}

/**
 * Load, on this instance, the Ask route's module graph and settle its source
 * preloads, in the caller's edge-only context. Importing the route module runs
 * its module-level code only (one startup log line); its handler is never
 * called, so no question is read, resolved, logged or sent to a model.
 */
async function primeAsk(): Promise<AskPrimed> {
  const primed: { -readonly [K in keyof AskPrimed]: AskPrimed[K] } = { graphMs: null, sources: 0, sourcesRefused: 0, sourcesFailed: 0, sourcesMs: null };
  const work = (async () => {
    const graphStarted = Date.now();
    await import("@/app/api/ask/grounded/route").then(() => { primed.graphMs = Date.now() - graphStarted; }, () => undefined);
    const sourcesStarted = Date.now();
    await Promise.all(Object.values(ASK_SOURCE_PRELOADS).map((preload) =>
      Promise.resolve().then(preload).then(
        () => { primed.sources += 1; },
        (error: unknown) => {
          if (error instanceof ReaderEdgeOnlyRefusal) primed.sourcesRefused += 1;
          else primed.sourcesFailed += 1;
        },
      )));
    primed.sourcesMs = Date.now() - sourcesStarted;
  })();
  let expired: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise((resolve) => { expired = setTimeout(resolve, PRIME_ASK_BUDGET_MS); })]);
  clearTimeout(expired);
  return { ...primed };
}

/** Loads, on this instance, what a cold Ask or a cold map reads first from the reader edge, and the Ask's own code. Never the database. */
export async function primeReaderEdge(): Promise<ReaderEdgePrimed> {
  const manifest = await readReaderManifest().catch(() => null);
  if (!manifest) return NOTHING_PRIMED;
  prefetchReaderGeography();
  const bundle = manifest.authorityArtifacts ? await ensureReaderAuthorityEdge(manifest).catch(() => null) : null;
  // Entered here, before the reads below, in the function that makes them.
  enterReaderAuthorityEdge({ ...bundle, edgeOnly: true });
  const meetings = await readReaderEdgeMeetings({
    manifest,
    fallback: () => Promise.reject(new Error("keep-warm loads the edge only, never the database")),
  }).then(() => true, () => false);
  // Both started here, after the edge-only context was entered, so every read they make is inside it.
  const [places, ask] = await Promise.all([
    bundle?.registryRuntime ? primeReaderPlaces(manifest) : Promise.resolve({ places: 0, placesRefused: 0 }),
    primeAsk(),
  ]);
  return { manifest: true, authorityFamilies: bundle ? Object.keys(bundle).length : 0, meetings, ...places, ask };
}

/**
 * One place per county the reader edge manifest publishes, for the post-deploy
 * warm (lib/ops/post-deploy-warm.ts): the county's lowest indexed ZIP and the
 * centroid the map sends for it. Reads the manifest and the ZIP index only.
 */
export async function publishedWarmPlaces(): Promise<{ readonly places: readonly WarmPlace[]; readonly skipped: number }> {
  const manifest = await readReaderManifest().catch(() => null);
  if (!manifest) return { places: [], skipped: 0 };
  const counties = publishedCountyDivisions(manifest.scopes);
  const states = [...new Set(counties.map((county) => county.split("/state:")[1].split("/")[0]))];
  const zipByDivision = new Map<string, string>();
  await Promise.all(states.map(async (state) => {
    for (const [division, zip] of (await lowestZipByDivision(state)) ?? []) zipByDivision.set(division, zip);
  }));
  const zips = [...new Set(counties.flatMap((county) => zipByDivision.get(county) ?? []))];
  const centroids = new Map<string, { lat: number; lng: number }>();
  await Promise.all(zips.map(async (zip) => {
    const centroid = await lookupZctaAsync(zip);
    if (centroid) centroids.set(zip, centroid);
  }));
  return warmPlacesForCounties({ counties, zipFor: (county) => zipByDivision.get(county), centroidFor: (zip) => centroids.get(zip) });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["hold", "places"]);
  if (!unknown.ok) return refuse(unknown.error);
  const asked = numericInRange(params, "hold", 0, MAX_HOLD_MS, { default: 0 });
  if (!asked.ok) return refuse(asked.error);
  const marked = request.headers.get("x-wtp-synthetic-run") === KEEP_WARM_MARKER;
  if (marked && params.get("places") === "1") {
    return Response.json(await publishedWarmPlaces(), { headers: { "cache-control": "no-store, max-age=0" } });
  }
  const primed = marked ? await primeReaderEdge() : null;
  const heldMs = marked ? Math.round(asked.value) : 0;
  if (heldMs > 0) await new Promise((resolve) => setTimeout(resolve, heldMs));
  return Response.json(
    { warm: true, heldMs, bootedAt, primed },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
