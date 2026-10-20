import { PMTiles, type Header, type RangeResponse } from "pmtiles";
import { initialZoomForZip } from "./initial-zoom.ts";

export type BoundaryRequest = { url: string } & (
  | { kind: "header" }
  | { kind: "tile"; z: number; x: number; y: number }
  | { kind: "prefetch"; zip: string; lat: number; lng: number }
);
type Archive = Pick<PMTiles, "getHeader" | "getZxy">;

/** One archive cache and at most one unused center tile, kept off the UI thread. */
export function createBoundaryReader(create: (url: string) => Archive = url => new PMTiles(url)) {
  const archives = new Map<string, Archive>();
  let early: { key: string; controller: AbortController; value: Promise<RangeResponse | undefined> } | undefined;
  return async (request: BoundaryRequest, signal?: AbortSignal): Promise<Header | RangeResponse | undefined> => {
    let archive = archives.get(request.url);
    if (!archive) { archive = create(request.url); archives.set(request.url, archive); }
    if (request.kind === "header") return archive.getHeader();
    if (request.kind === "prefetch") {
      const header = await archive.getHeader();
      const z = Math.min(header.maxZoom, Math.max(header.minZoom, Math.floor(initialZoomForZip(request.zip))));
      const scale = 2 ** z, lat = Math.max(-85.05112878, Math.min(85.05112878, request.lat)) * Math.PI / 180;
      const x = Math.min(scale - 1, Math.max(0, Math.floor((request.lng + 180) / 360 * scale)));
      const y = Math.min(scale - 1, Math.max(0, Math.floor((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * scale)));
      const key = `${request.url}:${z}/${x}/${y}`;
      if (early?.key !== key) {
        early?.controller.abort();
        const controller = new AbortController();
        early = { key, controller, value: archive.getZxy(z, x, y, controller.signal) };
      }
      const value = early.value;
      try { await value; }
      catch (error) { if (early?.value === value) early = undefined; throw error; }
      return undefined;
    }
    const key = `${request.url}:${request.z}/${request.x}/${request.y}`;
    if (early?.key === key) { const value = early.value; early = undefined; return value; }
    return archive.getZxy(request.z, request.x, request.y, signal);
  };
}
