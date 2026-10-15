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
import type { PostalTable } from "./postal-core.ts";

export type { ZctaCentroid, ZipResolution };
export { isWellFormedZip };

interface Loaded {
  centroids: CentroidTable;
  zctaCentroids: CentroidTable;
  postal: PostalTable;
  coverageIsComplete: boolean;
  source: { url: string; org: string; vintage: string };
}

let loading: Promise<Loaded> | null = null;

/**
 * The table, loaded once per page. The promise is cached, so racing handlers
 * share one fetch.
 */
export function loadZctaTable(): Promise<Loaded> {
  loading ??= Promise.all([import("./zcta-centroids.json"), import("./postal-zips.json")]).then(([module, postalModule]) => {
    const file = (module.default ?? module) as unknown as {
      centroids: Record<string, [number, number]>;
      complete?: boolean;
      source: string;
      sourceOrg: string;
      vintage: string;
    };
    const postal = (postalModule.default ?? postalModule).zips as unknown as PostalTable;
    const centroids: CentroidTable = { ...file.centroids };
    for (const [zip, row] of Object.entries(postal)) {
      if (!centroids[zip] && row[0] !== null && row[1] !== null) centroids[zip] = [row[0], row[1]];
    }
    return {
      centroids,
      zctaCentroids: file.centroids,
      postal,
      coverageIsComplete: file.complete === true,
      source: { url: file.source, org: file.sourceOrg, vintage: file.vintage },
    };
  }).catch(error => { loading = null; throw error; });
  return loading;
}

/** Start the load and do not wait. */
export function warmZctaTable(): void {
  void loadZctaTable().catch(() => undefined);
}

export async function resolveZipAsync(input: string): Promise<ZipResolution> {
  // The malformed case never needs the table, so a reader who typed four
  // digits is told so immediately rather than after a download.
  if (!isWellFormedZip(input)) return { ok: false, reason: "malformed" };
  const { centroids, postal } = await loadZctaTable();
  return resolveIn(centroids, input, postal);
}

export async function lookupZctaAsync(input: string): Promise<ZctaCentroid | null> {
  if (!isWellFormedZip(input)) return null;
  const { centroids, postal } = await loadZctaTable();
  return lookupIn(centroids, input, postal);
}

export async function nearestZctaAsync(
  lat: number,
  lng: number,
): Promise<ZctaCentroid | null> {
  const { zctaCentroids } = await loadZctaTable();
  return nearestIn(zctaCentroids, lat, lng);
}
