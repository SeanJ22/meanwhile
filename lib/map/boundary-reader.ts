import { PMTiles, type Header, type RangeResponse } from "pmtiles";
import { viewportTiles } from "./viewport-tiles.ts";
import { initialZoomForZip } from "./initial-zoom.ts";

export type BoundaryRequest = { url: string } & (
  | { kind: "header" }
  | { kind: "tile"; z: number; x: number; y: number }
  | { kind: "prefetch"; zip: string; lat: number; lng: number; width: number; height: number }
);
type Archive = Pick<PMTiles, "getHeader" | "getZxy">;

/** Only the arriving viewport loads ahead of MapLibre, off the UI thread. */
export function createBoundaryReader(create: (url: string) => Archive = url => new PMTiles(url)) {
  const archives = new Map<string, Archive>();
  const early = new Map<string, Promise<RangeResponse | undefined>>();
  let prefetch = new AbortController();
  let prefetchedPlace = "";
  return async (request: BoundaryRequest, signal?: AbortSignal): Promise<Header | RangeResponse | undefined> => {
    let archive = archives.get(request.url);
    if (!archive) { archive = create(request.url); archives.set(request.url, archive); }
    if (request.kind === "header") return archive.getHeader();
    if (request.kind === "prefetch") {
      const header = await archive.getHeader();
      const zoom = initialZoomForZip(request.zip), z = Math.min(header.maxZoom, Math.max(header.minZoom, Math.floor(zoom)));
      const width = Math.min(2048, Math.max(1, request.width)), height = Math.min(2048, Math.max(1, request.height));
      const place = `${request.url}:${request.zip}:${request.lat}:${request.lng}:${width}:${height}`;
      if (prefetchedPlace !== place) {
        prefetch.abort(); prefetch = new AbortController();
        early.clear(); prefetchedPlace = place;
      }
      const reads = viewportTiles(request, zoom, z).map(({ x, y }) => {
      const key = `${request.url}:${z}/${x}/${y}`;
      if (!early.has(key)) {
        const value = archive.getZxy(z, x, y, prefetch.signal).catch(error=>{
          if (early.get(key) === value) early.delete(key);
          throw error;
        });
        early.set(key,value);
      }
      return early.get(key)!;
      });
      await Promise.all(reads);
      return undefined;
    }
    const key = `${request.url}:${request.z}/${request.x}/${request.y}`;
    const held = early.get(key);
    if (held) { early.delete(key); return held; }
    return archive.getZxy(request.z, request.x, request.y, signal);
  };
}
