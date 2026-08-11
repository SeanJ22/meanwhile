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
 * Raster basemap. TEMPORARY UNBLOCK — MUST NOT SHIP.
 *
 * CLAUDE.md line 12 specifies "MapLibre GL with a vector tile provider."
 * This function violates that, deliberately and only until the bug below is
 * fixed. Raster tiles are flat images: the basemap cannot be restyled from
 * code, label typefaces cannot be changed, layers cannot be filtered, and
 * nothing can be matched to the design tokens in globals.css. Choosing a
 * basemap becomes picking from a provider's menu instead of styling one.
 *
 * Why it exists: under Next 16 + Turbopack, maplibre-gl 6's tile-parsing Web
 * Worker never starts, so vector tiles are fetched and never parsed — no
 * error, no 'load' event, nothing drawn but the style's background layer.
 *
 * The cause is a packaging bug, confirmed in both dev and production builds.
 * `maplibre-gl-worker.mjs` is an ES module whose first statement imports
 * `./maplibre-gl-shared.mjs`. Turbopack copies the worker into
 * /_next/static/media/ byte-for-byte, without rewriting that specifier, but
 * emits the sibling under a content-hashed name
 * (maplibre-gl-shared.<hash>.mjs). The worker therefore requests an
 * unhashed ./maplibre-gl-shared.mjs that does not exist, module evaluation
 * fails, and the Worker raises an error event with an empty message that
 * MapLibre does not surface.
 *
 * Delete this function, `rasterBasemapEnabled`, the NEXT_PUBLIC_MAP_RASTER
 * flag, and the setWorkerUrl/prewarm calls in map-canvas.tsx once vector
 * renders. Enabled with NEXT_PUBLIC_MAP_RASTER=1.
 *
 * Returns null when no MapTiler key is configured. There is deliberately no
 * substitute provider: a basemap that silently swaps in a different source is
 * how a total rendering failure spent hours looking like a dark style choice.
 * The caller shows "Basemap unavailable" instead.
 */
export function buildRasterStyle(): StyleSpecification | null {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (!key) return null;

  const style = process.env.NEXT_PUBLIC_MAPTILER_STYLE || MAPTILER_DEFAULT_STYLE;

  return {
    version: 8,
    // The raster basemap needs no glyphs of its own — its labels are baked into
    // the tiles — but the district overlay draws real text, and a symbol layer
    // with no glyph source renders nothing at all.
    glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${key}`,
    sources: {
      basemap: {
        type: "raster",
        tiles: [
          `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.png?key=${key}`,
        ],
        tileSize: 256,
        attribution:
          '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      {
        id: "ground",
        type: "background",
        paint: { "background-color": "#0b1518" },
      },
      { id: "basemap", type: "raster", source: "basemap" },
    ],
  };
}

/** Whether to draw the basemap from raster tiles instead of vector tiles. */
export function rasterBasemapEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MAP_RASTER === "1";
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
