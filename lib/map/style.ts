import type { StyleSpecification } from "maplibre-gl";

/**
 * Which basemap the map draws.
 *
 * MapTiler when a key is configured. Without one, OpenFreeMap — no account, no
 * key — so a fresh clone renders a real map instead of a blank canvas. Set the
 * key before deploying: OpenFreeMap is community-run and carries no SLA.
 */

const MAPTILER_DEFAULT_STYLE = "dataviz-dark";
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/fiord";

export type TileProvider = "maptiler" | "openfreemap";

export interface BasemapChoice {
  provider: TileProvider;
  styleUrl: string;
}

export function resolveBasemap(): BasemapChoice {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;

  if (key) {
    const style = process.env.NEXT_PUBLIC_MAPTILER_STYLE || MAPTILER_DEFAULT_STYLE;
    return {
      provider: "maptiler",
      styleUrl: `https://api.maptiler.com/maps/${style}/style.json?key=${key}`,
    };
  }

  return { provider: "openfreemap", styleUrl: OPENFREEMAP_STYLE };
}

/**
 * Last resort when the remote style won't load — an offline network, a revoked
 * key, a provider outage.
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
