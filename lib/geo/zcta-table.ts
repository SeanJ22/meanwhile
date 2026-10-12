/**
 * The client's zip table, loaded on first use with a dynamic `import()` and
 * cached, so the centroid JSON (about 1 MB) is its own chunk and not part of
 * the first paint. The server keeps `./zcta.ts` and its synchronous API.
 *
 * `warmZctaTable()` starts the load without waiting; a failed prefetch
 * surfaces nothing, because the real call fails visibly.
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
 * The table, loaded once per page. The promise is cached, so racing handlers
 * share one fetch.
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

/** Start the load and do not wait. */
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
