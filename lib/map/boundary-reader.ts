import { PMTiles, type Header, type RangeResponse } from "pmtiles";
import { initialZoomForZip } from "./initial-zoom.ts";

export type BoundaryRequest = { url: string } & (
  | { kind: "header" }
  | { kind: "tile"; z: number; x: number; y: number }
  | { kind: "prefetch"; zip: string; lat: number; lng: number; width: number; height: number }
);
type Archive = Pick<PMTiles, "getHeader" | "getZxy">;

/** The bounded arriving viewport and its wider fit load off the UI thread. */
export function createBoundaryReader(create: (url: string) => Archive = url => new PMTiles(url)) {
  const archives = new Map<string, Archive>();
  const early = new Map<string, { controller: AbortController; value: Promise<RangeResponse | undefined> }>();
  let prefetchedPlace = "";
  return async (request: BoundaryRequest, signal?: AbortSignal): Promise<Header | RangeResponse | undefined> => {
    let archive = archives.get(request.url);
    if (!archive) { archive = create(request.url); archives.set(request.url, archive); }
    if (request.kind === "header") return archive.getHeader();
    if (request.kind === "prefetch") {
      const header = await archive.getHeader();
      const zoom = Math.min(header.maxZoom, Math.max(header.minZoom, Math.floor(initialZoomForZip(request.zip))));
      const width = Math.min(2048, Math.max(1, request.width)), height = Math.min(2048, Math.max(1, request.height));
      const place = `${request.url}:${request.zip}:${request.lat}:${request.lng}:${width}:${height}`;
      if (prefetchedPlace !== place) {
        for (const held of early.values()) held.controller.abort();
        early.clear(); prefetchedPlace = place;
      }
      const reads = [...new Set([zoom, Math.max(header.minZoom,zoom-1)])].flatMap(z=>{
      const scale = 2 ** z, lat = Math.max(-85.05112878, Math.min(85.05112878, request.lat)) * Math.PI / 180;
      const centerX = (request.lng + 180) / 360 * scale, centerY = (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * scale;
      const tiles = new Set<string>();
      for (let x=Math.floor(centerX-width/1024); x<=Math.floor(centerX+width/1024); x++) {
        for (let y=Math.max(0,Math.floor(centerY-height/1024)); y<=Math.min(scale-1,Math.floor(centerY+height/1024)); y++) {
          tiles.add(`${((x%scale)+scale)%scale}/${y}`);
        }
      }
      return [...tiles].map(tile=>{
      const [x,y] = tile.split("/").map(Number);
      const key = `${request.url}:${z}/${x}/${y}`;
      if (!early.has(key)) {
        const controller = new AbortController();
        const value = archive.getZxy(z, x, y, controller.signal).catch(error=>{
          if (early.get(key)?.value === value) early.delete(key);
          throw error;
        });
        early.set(key,{ controller, value });
      }
      return early.get(key)!.value;
      });
      });
      await Promise.all(reads);
      return undefined;
    }
    const key = `${request.url}:${request.z}/${request.x}/${request.y}`;
    const held = early.get(key);
    if (held) { early.delete(key); return held.value; }
    return archive.getZxy(request.z, request.x, request.y, signal);
  };
}
