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
 * An unmarked call, or a hold asked beyond the cap, is answered at once or
 * capped, loads nothing, and cannot hold an instance longer than that.
 */
import { numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { divisionIdsForZipArea } from "@/lib/ballot/zip-divisions";
import { zipCertainty } from "@/lib/geo/zip-certainty";
import { lowestZipByDivision } from "@/lib/geo/zip-division-index";
import { lookupZctaAsync } from "@/lib/geo/zcta-table";
import { NATIONAL_SCOPE, type ReaderManifest } from "@/lib/meetings/edge-artifacts";
import { ensureReaderAuthorityEdge, readReaderEdgeMeetings, readReaderManifest } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge, ReaderEdgeOnlyRefusal } from "@/lib/registry/runtime-edge";
import { coverageAt, divisionsAt, divisionsByOcdIds, prefetchReaderGeography } from "@/lib/registry/server";

/** The synthetic-run marker the pinger sends (`x-wtp-synthetic-run`). */
export const KEEP_WARM_MARKER = "keep-warm";
/** The longest a marked call holds its instance. */
export const MAX_HOLD_MS = 1000;
/** The longest a marked call spends resolving places before it answers. */
export const PRIME_PLACES_BUDGET_MS = 4000;

const bootedAt = new Date().toISOString();

export interface ReaderEdgePrimed {
  readonly manifest: boolean;
  readonly authorityFamilies: number;
  readonly meetings: boolean;
  /** States whose place resolved end to end (divisions, area, coverage) from the edge within the budget. */
  readonly places: number;
  /** States whose place needed a family the manifest does not carry, so it was refused rather than read from the database. */
  readonly placesRefused: number;
}

const NOTHING_PRIMED: ReaderEdgePrimed = { manifest: false, authorityFamilies: 0, meetings: false, places: 0, placesRefused: 0 };

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
  const states = manifest.scopes.map((scope) => scope.scope).filter((scope) => scope !== NATIONAL_SCOPE);
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

/** Loads, on this instance, what a cold Ask or a cold map reads first from the reader edge. Never the database. */
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
  const places = bundle?.registryRuntime ? await primeReaderPlaces(manifest) : { places: 0, placesRefused: 0 };
  return { manifest: true, authorityFamilies: bundle ? Object.keys(bundle).length : 0, meetings, ...places };
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["hold"]);
  if (!unknown.ok) return refuse(unknown.error);
  const asked = numericInRange(params, "hold", 0, MAX_HOLD_MS, { default: 0 });
  if (!asked.ok) return refuse(asked.error);
  const marked = request.headers.get("x-wtp-synthetic-run") === KEEP_WARM_MARKER;
  const primed = marked ? await primeReaderEdge() : null;
  const heldMs = marked ? Math.round(asked.value) : 0;
  if (heldMs > 0) await new Promise((resolve) => setTimeout(resolve, heldMs));
  return Response.json(
    { warm: true, heldMs, bootedAt, primed },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
