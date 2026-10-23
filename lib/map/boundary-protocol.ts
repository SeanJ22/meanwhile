import type { Header, RangeResponse } from "pmtiles";

/** MapLibre's existing protocol contract, with retrieval and decoding in its own worker. */
export async function boundaryProtocol(params: { url: string; type?: string }, controller: AbortController) {
  const root = params.type === "json", match = /^pmtiles:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
  const url = root ? params.url.slice(10) : match?.[1];
  if (!url) throw new Error("Invalid boundary archive URL");
  const reader = window.__startReaderBoundary?.(url);
  if (!reader) throw new Error("The boundary worker is unavailable");
  if (root) {
    const header = await reader.request({ kind: "header", url }, controller.signal) as Header;
    return { data: { tiles: [`${params.url}/{z}/{x}/{y}`], minzoom: header.minZoom, maxzoom: header.maxZoom,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat] } };
  }
  const result = await reader.request({ kind: "tile", url, z: Number(match![2]), x: Number(match![3]), y: Number(match![4]) }, controller.signal) as RangeResponse | undefined;
  return { data: result ? new Uint8Array(result.data) : new Uint8Array(), cacheControl: result?.cacheControl, expires: result?.expires };
}
