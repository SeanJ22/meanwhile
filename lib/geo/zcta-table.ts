/**
 * **THE CLIENT'S ZIP TABLE, LOADED WHEN IT IS ASKED FOR** — P-002, 2026-08-24.
 *
 * ## The measurement
 *
 * `lib/geo/zcta-centroids.json` is 960,770 raw bytes and was **32.5% of the
 * landing page's initial JavaScript**, larger than MapLibre — measured by
 * module provenance with `pnpm tsx scripts/p002-module-table.mts` against an
 * attribution build, not estimated.
 *
 * It reached the client because `lib/geo/zcta.ts` imports it statically and
 * three client components import that module: the welcome overlay, the
 * location bar and the zip switcher. Every one of them uses it INSIDE an event
 * handler — a submit, a pick, a *use my location* press. None of them needs a
 * byte of it to paint.
 *
 * ## What this changes, and what it deliberately does not
 *
 * The server keeps `lib/geo/zcta.ts` and its synchronous API. Nothing on a
 * server path pays for a dynamic import, `app/ballot/page.tsx` and
 * `app/api/meetings/route.ts` are untouched, and every script that resolves a
 * zip keeps working exactly as it did.
 *
 * The client gets this: one dynamic `import()`, cached after the first call, so
 * the table becomes its own chunk that the browser fetches when a reader first
 * asks a question that needs it.
 *
 * ## The prefetch, and why it is not a cheat
 *
 * `warmZctaTable()` starts the load without waiting for it. The entry overlay
 * calls it on mount, so by the time a reader has typed five digits the chunk is
 * almost always already there — the interaction is not slower, the FIRST PAINT
 * is lighter, and that is the whole trade. It is a `void` call with no error
 * path on purpose: a prefetch that fails must not surface anything, because the
 * real call will fail visibly if the chunk is genuinely unreachable.
 */
import {
  isWellFormedZip,
  lookupIn,
  nearestIn,
  resolveIn,
  type CentroidTable,
  type ZctaCentroid,
  type ZipResolution,
} from "./zcta-core.ts";

export type { ZctaCentroid, ZipResolution };
export { isWellFormedZip };

interface Loaded {
  centroids: CentroidTable;
  coverageIsComplete: boolean;
  source: { url: string; org: string; vintage: string };
}

let loading: Promise<Loaded> | null = null;

/**
 * The table, loaded once per page.
 *
 * The promise is cached rather than the result, so two handlers racing on a
 * cold start share one fetch instead of both decoding a megabyte of JSON —
 * the same reason `lib/registry/server.ts` caches its promise.
 */
export function loadZctaTable(): Promise<Loaded> {
  loading ??= import("./zcta-centroids.json").then((module) => {
    const file = (module.default ?? module) as unknown as {
      centroids: Record<string, [number, number]>;
      complete?: boolean;
      source: string;
      sourceOrg: string;
      vintage: string;
    };
    return {
      centroids: file.centroids as CentroidTable,
      coverageIsComplete: file.complete === true,
      source: { url: file.source, org: file.sourceOrg, vintage: file.vintage },
    };
  });
  return loading;
}

/** Start the load and do not wait. See the note above. */
export function warmZctaTable(): void {
  void loadZctaTable();
}

export async function resolveZipAsync(input: string): Promise<ZipResolution> {
  // The malformed case never needs the table, so a reader who typed four
  // digits is told so immediately rather than after a download.
  if (!isWellFormedZip(input)) return { ok: false, reason: "malformed" };
  const { centroids, coverageIsComplete } = await loadZctaTable();
  return resolveIn(centroids, coverageIsComplete, input);
}

export async function lookupZctaAsync(input: string): Promise<ZctaCentroid | null> {
  if (!isWellFormedZip(input)) return null;
  const { centroids } = await loadZctaTable();
  return lookupIn(centroids, input);
}

export async function nearestZctaAsync(
  lat: number,
  lng: number,
): Promise<ZctaCentroid | null> {
  const { centroids } = await loadZctaTable();
  return nearestIn(centroids, lat, lng);
}
