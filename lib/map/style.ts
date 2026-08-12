import type { StyleSpecification } from "maplibre-gl";

/**
 * Which basemap the map draws.
 *
 * MapTiler vector tiles, or nothing. There is deliberately no substitute
 * provider: a basemap that silently swaps in a different source is how a total
 * rendering failure spent hours looking like a dark style choice. With no key
 * configured the caller renders "Basemap unavailable" over the fallback ground
 * colour, so the failure is legible instead of decorative.
 *
 * See docs/state.md §4.
 */

const MAPTILER_DEFAULT_STYLE_DARK = "basic-v2-dark";
const MAPTILER_DEFAULT_STYLE_LIGHT = "basic-v2";

export interface BasemapChoice {
  provider: "maptiler";
  styleUrl: string;
}

/**
 * Null when no key is configured — there is nothing to draw and we say so.
 *
 * The basemap follows the UI theme. EdiaStratMap does not do this, but it does
 * not need to: it draws dark panels over a single light OSM layer. Ours is a
 * dark vector style, so leaving it fixed would put light panels over a dark map
 * and the light theme would read as a bug rather than a choice.
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

/**
 * Last resort when the remote style won't load — an offline network, a revoked
 * key, a provider outage, or no key at all.
 *
 * It draws nothing but ground color, which is the point: the map still
 * initializes, so the pins, the panel, and the zip control all keep working on
 * a plain field rather than the whole screen failing on a tile request.
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
