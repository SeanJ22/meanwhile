/**
 * GPS nearest-ZIP tables, loaded only after a reader asks to use their location.
 * Typed and restored ZIPs use the server's resident shelf through reader/zip.
 */
import {
  nearestIn,
  type CentroidTable,
  type ZctaCentroid,
} from "./zcta-core.ts";
import type { PostalTable } from "./postal-core.ts";

export type { ZctaCentroid };

interface Loaded {
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
    return {
      zctaCentroids: file.centroids,
      postal,
      coverageIsComplete: file.complete === true,
      source: { url: file.source, org: file.sourceOrg, vintage: file.vintage },
    };
  }).catch(error => { loading = null; throw error; });
  return loading;
}

let zipsByState: Map<string, string[]> | null = null;

/** Built on the first state-bounded search, so a nearest-ZIP lookup touches one state's ZIPs, never the country's. */
function zipsInState(table: Loaded, state: string): string[] {
  if (!zipsByState) {
    zipsByState = new Map();
    for (const zip in table.zctaCentroids) {
      const code = table.postal[zip]?.[5];
      if (!code) continue;
      const zips = zipsByState.get(code);
      if (zips) zips.push(zip);
      else zipsByState.set(code, [zip]);
    }
  }
  return zipsByState.get(state) ?? [];
}

export async function nearestZctaAsync(
  lat: number,
  lng: number,
  state?: string,
): Promise<ZctaCentroid | null> {
  const table = await loadZctaTable();
  return nearestIn(table.zctaCentroids, lat, lng, state ? zipsInState(table, state) : undefined);
}
