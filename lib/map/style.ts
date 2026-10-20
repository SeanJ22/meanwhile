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
