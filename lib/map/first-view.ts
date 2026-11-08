import type { StyleSpecification, SourceSpecification } from "maplibre-gl";
import { mapGlyphs } from "./style.ts";
import { viewportTiles } from "./viewport-tiles.ts";
import { initialZoomForZip } from "./initial-zoom.ts";

type TileSource = { tiles?: string[]; minzoom?: number; maxzoom?: number; scheme?: "xyz" | "tms"; bounds?: [number, number, number, number]; attribution?: string };
type MapResource = { data: ArrayBuffer; cacheControl?: string; expires?: string };
type MapStart = { url: string; vector: Promise<StyleSpecification>; raster: Promise<StyleSpecification>; select: (software: boolean) => void };
declare global { interface Window { __readerMapStart?: MapStart; __readerMapResources?: Map<string, Promise<MapResource>> } }

/** Consume the styles started by the HTML, retaining the provider's complete layers. */
export function arrivingMapStyle(url: string, software: boolean): Promise<StyleSpecification> | undefined {
  const start = window.__readerMapStart;
  if (start?.url !== url) return undefined;
  start.select(software);
  return start[software ? "raster" : "vector"];
}

/** Use the early bytes even when browser HTTP caching is disabled. */
export function arrivingMapRequest(url: string) {
  const canonical = new URL(url, window.location.href).href;
  return { url: window.__readerMapResources?.has(canonical) ? `first-map://${canonical}` : url };
}
export async function firstMapProtocol(params: { url: string; type?: string }, controller: AbortController) {
  const resource = await readMapResource(params.url.slice("first-map://".length), controller.signal);
  return params.type === "json" ? { ...resource, data: JSON.parse(new TextDecoder().decode(resource.data)) } : resource;
}
async function readMapResource(url: string, signal?: AbortSignal): Promise<MapResource> {
  const resources = window.__readerMapResources, held = resources?.get(url);
  if (held) { resources!.delete(url); return held; }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Map resource: ${response.status}`);
  return { data: await response.arrayBuffer(), cacheControl: response.headers.get("Cache-Control") ?? undefined, expires: response.headers.get("Expires") ?? undefined };
}

const script = typeof document === "undefined" ? null : document.currentScript as HTMLScriptElement | null;
const url = script && (document.documentElement.dataset.theme === "light" ? script.dataset.mapLight : script.dataset.mapDark);
if (url && location.pathname === "/") {
  const json = async <T>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Map resource: ${response.status}`);
    return response.json();
  };
  const tileMetadata = async (url: string) => {
    const { tiles, minzoom, maxzoom, bounds, attribution, scheme } = await json<TileSource>(url);
    return Object.fromEntries(Object.entries({ tiles, minzoom, maxzoom, bounds, attribution, scheme }).filter(([, value]) => value !== undefined)) as TileSource;
  };
  const resources = window.__readerMapResources ??= new Map<string, Promise<MapResource>>();
  const warm = (url: string) => {
    if (resources.has(url)) return;
    const value = readMapResource(url); resources.set(url, value);
    void value.catch(() => { if (resources.get(url) === value) resources.delete(url); });
  };
  let select!: (software: boolean) => void;
  const renderer = new Promise<boolean>(resolve => { select = resolve; });
  const point = window.__readerStart?.location;
  const warmTiles = (source: TileSource, software: boolean, round = false) => {
    if (!source.tiles?.length || !point) return;
    void renderer.then(selected => selected === software ? point : null).then(p => {
      if (!p) return;
      const z = Math.min(source.maxzoom ?? 22, Math.max(source.minzoom ?? 0, (round ? Math.round : Math.floor)(initialZoomForZip(p.zip))));
      for (const { x, y } of viewportTiles({ ...p, width: innerWidth, height: innerHeight }, initialZoomForZip(p.zip), z)) {
        warm(source.tiles![(x + y) % source.tiles!.length].replaceAll("{z}", String(z)).replaceAll("{x}", String(x))
          .replaceAll("{y}", String(source.scheme === "tms" ? 2 ** z - 1 - y : y)));
      }
    }).catch(() => {});
  };
  const source = async (value: SourceSpecification): Promise<SourceSpecification> => {
    if (value.type !== "vector" && value.type !== "raster" && value.type !== "raster-dem") return value;
    const { url: sourceUrl, ...inline } = value;
    const base = new URL(sourceUrl ?? url, url).href;
    const metadata = sourceUrl ? await tileMetadata(base) : {};
    const resolved = { ...metadata, ...inline };
    if (resolved.tiles) resolved.tiles = resolved.tiles.map(tile => new URL(tile, base).href.replaceAll("%7B", "{").replaceAll("%7D", "}"));
    warmTiles(resolved, false, value.type !== "vector");
    return resolved;
  };
  const vector = json<StyleSpecification>(url).then(async style => {
    void renderer.then(software => {
      if (software) return;
      // Warm only the first alphabet range. MapLibre still asks for every other
      // range actually used by the visible labels, including non-Latin labels.
      const fonts = new Set(["Noto Sans Regular"]);
      for (const layer of style.layers) {
        const stack = layer.type === "symbol" && layer.layout?.["text-font"];
        if (Array.isArray(stack) && stack.every(font => typeof font === "string")) fonts.add(stack.join(","));
      }
      if (style.glyphs) for (const font of fonts) warm(new URL(style.glyphs.replace("{fontstack}", font).replace("{range}", "0-255"), url).href);
      const sprites = typeof style.sprite === "string" ? [{ url: style.sprite }] : style.sprite ?? [];
      for (const sprite of sprites) for (const ext of ["json", "png"]) {
        const resource = new URL(sprite.url, url);
        resource.pathname += `${devicePixelRatio > 1 ? "@2x" : ""}.${ext}`;
        warm(resource.href);
      }
    }).catch(() => {});
    const zoom = initialZoomForZip(window.__readerStart?.zip);
    const visible = new Set(style.layers.filter(layer => layer.layout?.visibility !== "none" && (layer.minzoom ?? 0) <= zoom && zoom < (layer.maxzoom ?? 24))
      .flatMap(layer => "source" in layer ? [layer.source] : []));
    const sources = await Promise.all(Object.entries(style.sources).map(async ([id, value]) => [id, visible.has(id) ? await source(value) : value]));
    return { ...style, sources: Object.fromEntries(sources) };
  });
  const raster = tileMetadata(url.replace("/style.json", "/tiles.json")).then(metadata => {
    warmTiles(metadata, true, true);
    return { version: 8, transition: { duration: 0, delay: 0 },
      glyphs: mapGlyphs(url),
      sources: { basemap: { ...metadata, type: "raster", tileSize: 512 } },
      layers: [{ id: "basemap", type: "raster", source: "basemap", paint: { "raster-fade-duration": 0 } }],
    } satisfies StyleSpecification;
  });
  void vector.catch(() => {}); void raster.catch(() => {});
  window.__readerMapStart = { url, vector, raster, select };
}
