
import { POST as askHandler } from "@/app/api/ask/grounded/route";
import { numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { settleAzPimaFinanceRead } from "@/lib/control-plane/campaign-finance/held-records";
import { settleOfficeholderStatementsRead } from "@/lib/corpus/data-plane";
import { settleFundingRead } from "@/lib/funding/snapshot";
import { settleStateMoneyReads } from "@/lib/funding/state-snapshot";
import { lowestZipByDivision } from "@/lib/geo/zip-division-index";
import { lookupZcta } from "@/lib/geo/zcta";
import { publishedCountyDivisions, warmPlacesForCounties, type WarmPlace } from "@/lib/ops/warm-places";
import { readNationalShelf } from "@/lib/reader/national";
import { factReader } from "@/lib/facts/db";
import { settleExecutiveActionsRead } from "@/lib/officials/executive-actions";
import { settleOutcomeRead } from "@/lib/outcomes/store";
import { ReaderEdgeOnlyRefusal } from "@/lib/registry/runtime-edge";
import { settleCommentAccessRead } from "@/lib/registry/server";
import { settleFederalKeyVotesRead } from "@/lib/votes/key-votes-projection";
import { settleFederalVotesRead } from "@/lib/votes/snapshot";

/** The synthetic-run marker the pinger sends (`x-wtp-synthetic-run`). */
export const KEEP_WARM_MARKER = "keep-warm";
/** The longest a marked call holds its instance. */
export const MAX_HOLD_MS = 1000;
/** The longest a marked call spends loading the Ask's code and sources before it answers; the rest goes on in the background. */
export const PRIME_ASK_BUDGET_MS = 4000;


const ASK_SOURCE_PRELOADS: Readonly<Record<string, () => Promise<unknown>>> = {
  outcomes: settleOutcomeRead,
  commentAccess: settleCommentAccessRead,
  funding: settleFundingRead,
  stateMoney: settleStateMoneyReads,
  azPimaFinance: settleAzPimaFinanceRead,
  federalVotes: settleFederalVotesRead,
  federalKeyVotes: settleFederalKeyVotesRead,
  officeholderStatements: settleOfficeholderStatementsRead,
  executiveActions: settleExecutiveActionsRead,
};

const bootedAt = new Date().toISOString();

/** What a marked call loaded, on its instance, for a cold Ask. */
export interface AskPrimed {
  /** Milliseconds to load the Ask route's module graph here (near 0 once loaded); null when the import failed or outran the budget. */
  readonly graphMs: number | null;
  /** Ask sources that settled from their canonical stores. */
  readonly sources: number;
  /** Ask sources that refused the read. */
  readonly sourcesRefused: number;
  /** Ask sources whose read failed (the Ask reports its own gap for these). */
  readonly sourcesFailed: number;
  /** Milliseconds the source preloads took, or null when they outran the budget. */
  readonly sourcesMs: number | null;
}

export interface ReaderPrimed {
  readonly nationalShelf: boolean;
  readonly ask: AskPrimed | null;
}

async function primeAsk(): Promise<AskPrimed> {
  const primed: { -readonly [K in keyof AskPrimed]: AskPrimed[K] } = { graphMs: null, sources: 0, sourcesRefused: 0, sourcesFailed: 0, sourcesMs: null };
  const work = (async () => {
    const graphStarted = Date.now();
    if (typeof askHandler === "function") primed.graphMs = Date.now() - graphStarted;
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

/** Loads the national shelf and Ask's code on this instance. */
async function primeReader(): Promise<ReaderPrimed> {
  const shelf = await readNationalShelf().catch(() => null);
  return { nationalShelf: shelf !== null, ask: shelf ? await primeAsk() : null };
}

async function publishedWarmPlaces(): Promise<{ readonly places: readonly WarmPlace[]; readonly skipped: number }> {
  const query = factReader();
  if (!query) return { places: [], skipped: 0 };
  const rows = await query("SELECT DISTINCT place_id FROM entity_place WHERE place_id LIKE '%/county:%'");
  const divisions = rows.map(row => String(row.place_id));
  const counties = publishedCountyDivisions(divisions);
  const states = [...new Set(counties.map((county) => county.split("/state:")[1].split("/")[0]))];
  const zipByDivision = new Map<string, string>();
  await Promise.all(states.map(async (state) => {
    for (const [division, zip] of (await lowestZipByDivision(state)) ?? []) zipByDivision.set(division, zip);
  }));
  const zips = [...new Set(counties.flatMap((county) => zipByDivision.get(county) ?? []))];
  const centroids = new Map<string, { lat: number; lng: number }>();
  await Promise.all(zips.map(async (zip) => {
    const centroid = lookupZcta(zip);
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
  const primed = marked ? await primeReader() : null;
  const heldMs = marked ? Math.round(asked.value) : 0;
  if (heldMs > 0) await new Promise((resolve) => setTimeout(resolve, heldMs));
  return Response.json(
    { warm: true, heldMs, bootedAt, primed },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
