/**
 * **KEEP A FEW SERVER INSTANCES BOOTED, AND READY FOR A COLD ASK (C21, C20;
 * 2026-09-24/25. The owner: a load over 3 s is not a win; he chose a keep-warm
 * pinger over more memory.)**
 *
 * Every route shares one Netlify server function, and a new instance of it
 * spends 2.7-3.7 s booting Next before it runs any page code (function logs,
 * 2026-09-24 9:17 PM EDT, M4). Traffic that lands on a booted instance does
 * not pay that.
 *
 * `netlify/functions/keep-warm.mts` calls this route fourteen times at once
 * every five minutes. A marked call holds for up to a second, so the calls
 * overlap and keep instances booted. Measured 2026-09-24 11:54 PM to 2026-09-25
 * 12:47 AM MST, overlapping calls reach fewer instances than calls (ten reached
 * 8-9, fourteen 10-11), and the calls sharing an instance wait for each other.
 *
 * A booted instance can still be cold for an Ask: on 38e2a643 (11:41 PM MST)
 * two of five concurrent Pima Asks spent 1.9-2.1 s in the server loading the
 * reader edge on their instance (the manifest ~0.2 s, the authority families
 * ~0.65 s, the meetings ~0.2-0.4 s), and a request queued behind one of them
 * reached 3.27 s end to end. So a marked call also loads, on its instance, what
 * a cold Ask reads first: the edge manifest, the authority families
 * (`ensureReaderAuthorityEdge`, cached per version per process) and the
 * published meeting artifacts (`readReaderEdgeMeetings`). It never reads the
 * database: without an edge store or manifest it loads nothing, and the
 * meetings read's database fallback is refused.
 *
 * **C21 (2026-09-25): AND READY FOR A COLD MAP.** Loading the bytes was not
 * enough for `/api/meetings`: on pool instances after the pinger it still took
 * a median ~1.0 s and up to 2.4 s, because the first request on an instance
 * still validated the registry, read ~25 geometry files, built the coverage
 * graph and fetched its state's registration. So a marked call now also
 * resolves one place in every state the edge publishes meetings for — the
 * divisions at that state's lowest indexed ZIP, the ZIP's area, its coverage —
 * which loads the geometry, the rosters, the registrations, the ZIP shards and
 * the ZIP table exactly as a reader's request would. Within
 * {@link PRIME_PLACES_BUDGET_MS}; what is unfinished then goes on in the
 * background and the call answers.
 *
 * Those reads run in an EDGE-ONLY context (`edgeOnly` in
 * lib/registry/runtime-edge.ts): anything the manifest does not carry is
 * refused rather than read from Neon, so a missing family costs this call that
 * place and never wakes the database fourteen times every five minutes. The
 * context is entered here, in the function whose own reads follow it
 * (AsyncLocalStorage.enterWith; tests/reader-edge-context.test.ts).
 *
 * **2026-09-25 (after batch E): AND READY FOR A COLD ASK, ITS CODE AND ITS
 * SOURCES.** Measured on production at bba8770b (9:57 PM MST, synthetic
 * "When does the Mesa City Council meet next?", answered in code with no
 * model): on a kept instance the edge was loaded (the Ask's `authorityEdge`
 * 3-5 ms), yet its first Ask took ~2.0 s end to end against ~0.4 s for the
 * next one. ~0.73 s was the Ask's own source preloads (`sourcePreloads`
 * 730-737 ms, 5-8 ms warm: the proven pointers read through their Readers
 * from the edge copy), and ~0.6 s was outside the handler (0.87 s against
 * 0.21-0.25 s warm): loading the Ask route's module graph, which no warm call
 * ever touched. So a marked call also loads that graph (a dynamic import of
 * the route module, which shares Turbopack's one module cache with the route
 * itself; nothing in it runs, so no handler, no model, no log and no write)
 * and settles the Ask's source preloads (`ASK_SOURCE_PRELOADS`) in the same
 * edge-only context, within {@link PRIME_ASK_BUDGET_MS}.
 *
 * An unmarked call, or a hold asked beyond the cap, is answered at once or
 * capped, loads nothing, and cannot hold an instance longer than that.
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
 * The Ask's own source preloads, under the names its trace times them by
 * (`essentialPreloads` and `deferrablePreloads` in
 * app/api/ask/grounded/route.ts; tests/ask-warm.test.ts holds the two lists
 * equal). Every one is edge first (`settleEdgeFirst` / `readPromotedEdgeFirst`),
 * so in this route's edge-only context a source the edge does not carry is
 * refused, never read from the database. The state roll calls are left out:
 * the Ask reads them from the database, per state, only for that state.
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

/**
 * One state's place: the lowest indexed ZIP whose centroid resolves to that
 * state's own divisions, with those divisions. The lowest ZIP alone is not
 * enough: AZ's is 84531, a Utah ZIP that reaches across the line, whose
 * centroid resolves to nothing in Arizona.
 */
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
