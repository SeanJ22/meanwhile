import type { StyleSpecification } from "maplibre-gl";

/**
 * Which basemap the map draws: MapTiler vector tiles, or nothing. There is no
 * substitute provider; with no key configured the caller renders "Basemap
 * unavailable" over the fallback ground colour, so the failure is legible.
 */

const MAPTILER_DEFAULT_STYLE_DARK = "basic-v2-dark";
const MAPTILER_DEFAULT_STYLE_LIGHT = "basic-v2";

export interface BasemapChoice {
  provider: "maptiler";
  styleUrl: string;
}

/**
 * Null when no key is configured. The basemap follows the UI theme, so light
 * panels never sit over a dark map.
 */
export function resolveBasemap(theme: "dark" | "light" = "dark"): BasemapChoice | null {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (!key) return null;

  const style =
    theme === "light"
      ? process.env.NEXT_PUBLIC_MAPTILER_STYLE_LIGHT || MAPTILER_DEFAULT_STYLE_LIGHT
      : process.env.NEXT_PUBLIC_MAPTILER_STYLE || MAPTILER_DEFAULT_STYLE_DARK;

  return {
    provider: "maptiler",
    styleUrl: `https://api.maptiler.com/maps/${style}/style.json?key=${key}`,
  };
}

/** The same MapTiler style, painted by the provider when this browser uses CPU graphics. */
export function basemapStyle(choice: BasemapChoice, software: boolean): StyleSpecification | string {
  if (!software) return choice.styleUrl;
  return {
    version: 8,
    transition: { duration: 0, delay: 0 },
    glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf${new URL(choice.styleUrl).search}`,
    sources: {
      basemap: {
        type: "raster",
        url: choice.styleUrl.replace("/style.json?", "/tiles.json?"),
        tileSize: 512,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap", paint: { "raster-fade-duration": 0 } }],
  };
}

/** Cache the adjacent overview before arriving venues ask the camera to widen. */
export async function prefetchRasterOverview(choice: BasemapChoice, point: {lat:number;lng:number}, zoom: number, signal: AbortSignal): Promise<void> {
  const z=Math.max(0,Math.floor(zoom)-1),count=2**z;
  const longitude=((point.lng+180)%360+360)%360;
  const latitude=Math.max(-85.05112878,Math.min(85.05112878,point.lat))*Math.PI/180;
  const centerX=Math.floor(longitude/360*count),centerY=Math.floor((1-Math.asinh(Math.tan(latitude))/Math.PI)/2*count);
  const response=await fetch(choice.styleUrl.replace("/style.json?","/tiles.json?"),{signal});
  if(!response.ok)return;
  const source=await response.json() as {tiles?:string[];minzoom?:number;maxzoom?:number};
  if(!source.tiles?.length||z<(source.minzoom??0)||z>(source.maxzoom??22))return;
  const urls=new Set<string>();
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++) {
    const x=(centerX+dx+count)%count,y=centerY+dy;if(y<0||y>=count)continue;
    const template=source.tiles[(x+y)%source.tiles.length];
    urls.add(template.replaceAll("{z}",String(z)).replaceAll("{x}",String(x)).replaceAll("{y}",String(y)));
  }
  await Promise.all([...urls].map(async url=>{
    try {const tile=await fetch(url,{signal});if(tile.ok)await tile.arrayBuffer();}catch{/* Ordinary map tile requests retain their own errors and retries. */}
  }));
}

/**
 * Last resort when the remote style won't load: ground colour only, so the
 * map still initializes and pins, panels and the zip control keep working.
 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "ground",
      type: "background",
      paint: { "background-color": "#0b1518" },
    },
  ],
};

/** Continental US, for the first-load view. */
export const CONUS_BOUNDS: [[number, number], [number, number]] = [
  [-125.0, 24.4],
  [-66.9, 49.4],
];

/** Close enough that streets and neighborhoods read, wide enough for a metro. */
export const METRO_ZOOM = 11;
