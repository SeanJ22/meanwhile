import type {
  FilterSpecification,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";

/**
 * **The state rises out of the map** — M91, rebuilt for g4 item 2 after the
 * author ruled the first version SLOPPY against his own reference
 * (breakfreegraphics.com on neumorphism in user interfaces).
 *
 * ## What was wrong, stated plainly, because it is the whole design
 *
 * The first version drew the rise as **two MapLibre `line` layers** — a white
 * one translated `[-2,-2]` and a black one translated `[+2,+2]`, each 7 px
 * wide with 6 px of `line-blur`. The author's report was that the edge reads
 * as "a visible STROKE — a gray band tracing the polygon with every coastal
 * vertex showing", and the arithmetic says exactly that:
 *
 * - **The two shadows were 4 px apart and 7 px wide**, so they overlapped
 *   over roughly two-thirds of their width. White at 0.5 composited over
 *   black at 0.42 is a GREY BAND, and it ran all the way round the polygon —
 *   on the lit side as much as the shaded one. One light source produces
 *   light on one side and dark on the other; this produced grey on both,
 *   which is an outline wearing a shadow's clothes.
 * - **A line layer traces the geometry**, so New Hampshire's 256-point coast
 *   drew every digitized vertex. At continental zoom the stroke was 3 px and
 *   the vertices are sub-pixel apart: a saw.
 *
 * ## The mechanic now, and it is the reference's own
 *
 * A shadow is cast by the SHAPE, not drawn along its edge. So the rise is two
 * **blurred silhouettes** of the state — one white offset toward the light at
 * top-left, one black offset away from it — each masked to the region OUTSIDE
 * the state so nothing inside is ever touched. That is `drop-shadow` in CSS
 * terms, and it is drawn in the same SVG overlay that already projects the
 * polygon every frame (`components/map/state-focus-overlay.tsx`).
 *
 * **The rejected alternative, recorded:** keeping the line layers and simply
 * widening the blur relative to the width. It is one line of change and it
 * cannot work — two opposed strokes on the same path composite to grey
 * wherever they overlap, and separating them far enough not to overlap turns
 * each into its own visible band. The defect is not the blur radius; it is
 * that a stroke follows the path and a shadow follows the light. A second
 * rejected alternative, stacking many MapLibre line layers of decreasing
 * opacity to fake a gradient, buys a gradient at the cost of six more layers
 * per state and still traces every vertex.
 *
 * ## The three properties the author named, and where each is enforced
 *
 * 1. **No visible line anywhere.** The shadow's inner edge is FEATHERED by
 *    the mask (`FEATHER_PX`), so it rises from zero AT the border rather than
 *    stepping to full strength the way a hard clip would. This is the whole
 *    reason the mask is a blurred `<mask>` and not a `<clipPath>`: a clip is
 *    binary, and a binary edge on a shadow that is at ~97% of peak where it
 *    meets the shape IS the line the author is objecting to.
 * 2. **One light source, two opposed shadows.** The offset is applied in
 *    SCREEN space, so the sun does not rotate or scale with the map. Because
 *    each silhouette is offset a full `OFFSET_PX` before blurring, the dark
 *    one contributes nothing on the lit side and the light one nothing on the
 *    shaded side — the asymmetry is structural, not tuned.
 * 3. **The silhouette reads; the digitization must not.** The projected rings
 *    are simplified in SCREEN space at a sub-pixel tolerance
 *    (`simplifyScreenRing`), which is zoom-adaptive by construction: the same
 *    1 px rule drops almost nothing at neighbourhood zoom and most of the
 *    coast at continental zoom.
 *
 * ## Zoom, and the author's ruling on release
 *
 * The effect **never releases** — e's 6b2 rule that zooming out surrenders
 * focus is retired by the author's g4 ruling and recorded in `docs/DESIGN.md`.
 * Only the SIZE of the rise scales with zoom, and it bottoms out well above
 * zero: a state seen at continental scale is small on screen and a 16 px
 * shadow would swamp it, but a zero-px one would be the release rule wearing
 * a different name.
 */

export const STATE_FOCUS_SOURCE = "state-outlines";

/** Where the outlines live. Generalized geometry — see the fetch script. */
export const STATE_OUTLINES_URL = "/geo/state-outlines.geojson";

export interface StateOutlineFeature {
  type: "Feature";
  properties: { statefp: string; name: string; ocdId: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

export interface StateOutlines {
  type: "FeatureCollection";
  features: StateOutlineFeature[];
}

/* ------------------------------------------------------------ geometry --- */

/** The state OCD-ID a point falls in, or null. Ray casting, no dependency. */
export function stateOcdIdAt(
  outlines: StateOutlines | null,
  lat: number,
  lng: number,
): string | null {
  if (!outlines) return null;
  for (const feature of outlines.features) {
    if (pointInPolygon(lng, lat, feature.geometry.coordinates)) {
      return feature.properties.ocdId;
    }
  }
  return null;
}

export function outlineFor(
  outlines: StateOutlines | null,
  ocdId: string | null,
): StateOutlineFeature | null {
  if (!outlines || !ocdId) return null;
  return outlines.features.find((f) => f.properties.ocdId === ocdId) ?? null;
}

/**
 * The two-letter state code inside a state OCD-ID, upper-cased, or null.
 *
 * g4 item 3: the district overlays carry a `state` property in USPS form
 * ("AZ"), and the focus is carried as an OCD-ID because that is how this
 * product keys everything. This is the one place the two vocabularies meet,
 * and it parses rather than looking up a name string.
 */
export function stateAbbrFromOcdId(ocdId: string | null): string | null {
  if (!ocdId) return null;
  const match = /\/state:([a-z]{2})$/.exec(ocdId);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Even-odd ray casting over a polygon's rings.
 *
 * The first ring is the outer boundary and the rest are holes, and even-odd
 * handles both without the caller having to know which is which — New Jersey
 * ships three rings.
 */
function pointInPolygon(x: number, y: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Ramer–Douglas–Peucker, in SCREEN pixels.
 *
 * The author's third complaint about the shipped extrusion — "the coastline's
 * vertices saw when zoomed out" — is a projection problem, not a data one.
 * The outline is generalized once, in degrees, at fetch time; a fixed angular
 * tolerance is a different number of pixels at every zoom, so at continental
 * scale New Hampshire's 256 points land on top of each other and the edge
 * turns to noise.
 *
 * Simplifying HERE, after projection, makes the rule zoom-adaptive by
 * construction: one sub-pixel tolerance, applied to what the reader can
 * actually resolve. It is also the cheapest frame win available — most of the
 * per-frame cost of this overlay is serializing points into a path string,
 * and at continental zoom this drops most of them.
 *
 * A ring is never simplified below a triangle: three points is the least that
 * still encloses area, and returning fewer would silently delete the state.
 */
export function simplifyScreenRing(
  points: readonly ScreenPoint[],
  tolerance: number,
): ScreenPoint[] {
  if (points.length <= 3 || tolerance <= 0) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative rather than recursive: a 600-point ring is fine either way, but
  // an explicit stack cannot blow up on a pathological input.
  const stack: [number, number][] = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let farthest = -1;
    let farthestDistance = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistanceSquared(
        points[i],
        points[first],
        points[last],
      );
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }

    if (farthestDistance > toleranceSquared && farthest > 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  const simplified: ScreenPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) simplified.push(points[i]);
  }

  // A ring reduced past a triangle has lost its area. Fall back to an evenly
  // sampled triangle rather than to nothing: an empty path would clear the
  // mask and un-mute the entire country, which is a far louder failure than a
  // coarse shape.
  if (simplified.length < 3) {
    const step = Math.floor(points.length / 3) || 1;
    return [points[0], points[step], points[Math.min(2 * step, points.length - 1)]];
  }

  return simplified;
}

function perpendicularDistanceSquared(
  point: ScreenPoint,
  start: ScreenPoint,
  end: ScreenPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const numerator = dy * point.x - dx * point.y + end.x * start.y - end.y * start.x;
  return (numerator * numerator) / (dx * dx + dy * dy);
}

/* ----------------------------------------------------------- the light --- */

/**
 * The rise, in screen pixels, as a function of zoom.
 *
 * Screen pixels, not map units: a light source does not scale with a map, and
 * the reference's whole mechanic is a fixed light hitting a surface. The only
 * thing zoom changes is how big the rise should be relative to a state that
 * is now the size of a thumbnail.
 *
 * `offset` is deliberately equal to `blur`. Smaller, and the two silhouettes
 * overlap and start compositing toward grey — the shipped defect, reproduced
 * at a different scale. Much larger, and each shadow separates from the shape
 * and reads as a second outline drifting off it.
 */
export interface ExtrusionSpec {
  /** How far each silhouette is displaced along the light's axis. */
  offsetPx: number;
  /** Gaussian sigma applied to each displaced silhouette. */
  blurPx: number;
  /**
   * Gaussian sigma of the MASK's edge — how far the shadow takes to rise
   * from nothing at the border. This is the number that makes the difference
   * between a soft gradient and the visible line the author rejected.
   */
  featherPx: number;
  /** Sub-pixel simplification tolerance for the projected rings. */
  simplifyPx: number;
}

/** Neighbourhood zoom and closer: the border is a detail in the corner. */
const NEAR: ExtrusionSpec = {
  offsetPx: 16,
  blurPx: 16,
  featherPx: 7,
  simplifyPx: 0.9,
};

/**
 * Continental zoom: the whole outline is on screen at once.
 *
 * The floor is non-zero and deliberately so — the author's test is looking at
 * 85701 and zooming ALL the way out, and the effect holding there is the
 * ruling. A spec that interpolated to zero would be e's retired release rule
 * arriving through the back door.
 */
const FAR: ExtrusionSpec = {
  offsetPx: 8,
  blurPx: 9,
  featherPx: 4,
  simplifyPx: 0.9,
};

const NEAR_ZOOM = 10;
const FAR_ZOOM = 4;

export function extrusionSpecForZoom(zoom: number): ExtrusionSpec {
  const t = Math.min(1, Math.max(0, (zoom - FAR_ZOOM) / (NEAR_ZOOM - FAR_ZOOM)));
  const mix = (far: number, near: number) =>
    Math.round((far + (near - far) * t) * 100) / 100;
  return {
    offsetPx: mix(FAR.offsetPx, NEAR.offsetPx),
    blurPx: mix(FAR.blurPx, NEAR.blurPx),
    featherPx: mix(FAR.featherPx, NEAR.featherPx),
    simplifyPx: NEAR.simplifyPx,
  };
}

/**
 * Opacity of each silhouette, BY THEME — and the split is a measured fix.
 *
 * The first build used one pair for both themes, and `pnpm measure:extrusion`
 * failed the one-light-source test in light mode at both zooms while passing
 * it in dark mode. The rendered difference said why: a white silhouette at
 * half opacity over a pale basemap is almost nothing, while the same black
 * silhouette over the same pale ground is a lot. The lit edge was invisible
 * on a light map — so the extrusion had one shadow and no light, which is a
 * rim, not a rise.
 *
 * The mute compounds it in opposite directions, which is why the numbers are
 * not simply mirrored: outside the state DARKENS in dark mode and BRIGHTENS
 * in light mode (see `globals.css`), so on a light ground the highlight is
 * fighting a brightened neighbourhood and the shadow is working with a
 * darkened one.
 *
 * Both remain low. The reference's own accessibility caution is that a
 * low-contrast extrusion cannot be asked to carry information, and this one
 * carries none.
 */
export interface RiseAlphas {
  /** The silhouette displaced TOWARD the light, at top-left. */
  light: number;
  /** The silhouette displaced away from it. */
  dark: number;
}

export function riseAlphasFor(theme: "light" | "dark"): RiseAlphas {
  return theme === "light"
    ? { light: 0.85, dark: 0.3 }
    : { light: 0.5, dark: 0.42 };
}

/* -------------------------------------------------------- zip shading --- */

/**
 * The current zip's own polygon, tinted (g4 item 4, the author's ask).
 *
 * A MapLibre fill rather than more SVG, and the distinction is the same one
 * that split this feature in two in the first place: the extrusion needs to
 * BLUR what is underneath it and only the compositor can do that, while a
 * tint is a tint and belongs on the map where it will be occluded correctly
 * by labels and pins.
 *
 * **It carries no data.** Like the extrusion it is orientation only — it
 * answers "which zip am I looking at" and says nothing about coverage,
 * quality, or how much we hold for that zip. `CLAUDE.md` forbids treating a
 * zip as district truth and this shape is not treated as any kind of truth:
 * it is generalized to ~200 m and nothing is resolved against it.
 */
export const ZIP_SHADE_SOURCE = "zip-shade";
export const ZIP_SHADE_LAYER = "zip-shade-fill";
export const ZIP_SHADE_OUTLINE_LAYER = "zip-shade-line";

export interface ZipOutlineFeature {
  type: "Feature";
  properties: { zip: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

const EMPTY = {
  type: "FeatureCollection" as const,
  features: [] as ZipOutlineFeature[],
};

/**
 * Put the shading layers on the map, or update the polygon they draw.
 *
 * Idempotent, and re-callable after every style change for the same reason
 * the district layers are: `setStyle` discards every source and layer that is
 * not in the incoming stylesheet.
 *
 * A null feature empties the source rather than removing the layers. That
 * keeps the add path and the clear path the same shape, and it means a zip
 * we hold no polygon for renders nothing — never a stale neighbour's outline,
 * which would be a wrong claim about where the reader is standing.
 */
export function applyZipShade(
  map: MapLibreMap,
  feature: ZipOutlineFeature | null,
  before?: string,
): void {
  const data = feature
    ? { type: "FeatureCollection" as const, features: [feature] }
    : EMPTY;

  const source = map.getSource(ZIP_SHADE_SOURCE);
  if (source && "setData" in source) {
    (source as { setData: (d: unknown) => void }).setData(data);
  } else if (!source) {
    map.addSource(ZIP_SHADE_SOURCE, {
      type: "geojson",
      data,
    } as GeoJSONSourceSpecification);
  }

  if (!map.getLayer(ZIP_SHADE_LAYER)) {
    map.addLayer(
      {
        id: ZIP_SHADE_LAYER,
        type: "fill",
        source: ZIP_SHADE_SOURCE,
        paint: {
          // Warm, low, and deliberately NOT a tier accent: a tier colour
          // would read as a claim about what kind of place this is. The
          // opacity is the whole design brief for this layer — "clear but not
          // overwhelming", visible against terrain, never competing with a
          // pin drawn on top of it.
          "fill-color": "#f2c14e",
          "fill-opacity": 0.14,
        },
      },
      before,
    );
  }

  if (!map.getLayer(ZIP_SHADE_OUTLINE_LAYER)) {
    map.addLayer(
      {
        id: ZIP_SHADE_OUTLINE_LAYER,
        type: "line",
        source: ZIP_SHADE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#f2c14e",
          "line-opacity": 0.5,
          "line-width": 1.2,
        },
      },
      before,
    );
  }
}

/** Drop the shading entirely — no zip resolved means no shape to answer with. */
export function removeZipShade(map: MapLibreMap): void {
  for (const id of [ZIP_SHADE_OUTLINE_LAYER, ZIP_SHADE_LAYER]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(ZIP_SHADE_SOURCE)) map.removeSource(ZIP_SHADE_SOURCE);
}

/**
 * Which state a district layer's filter is pinned to (g4 item 3).
 *
 * Read back off the map by `__wtpMapProbe` so a walk can assert the rule
 * rather than photograph it. Returns null for the "no active state" filter,
 * which is the case the item exists to make checkable.
 */
export function filterStateAbbr(
  // `map.getFilter()` is typed as returning `void | FilterSpecification` — a
  // layer with no filter yields nothing at all — so the parameter has to
  // accept what the caller actually has in hand.
  filter: FilterSpecification | void | undefined,
): string | null {
  if (!Array.isArray(filter) || filter.length < 3) return null;
  const value = filter[2];
  return typeof value === "string" && value !== NO_STATE ? value : null;
}

/**
 * The sentinel a layer is filtered to when no state is active.
 *
 * A string no state code can equal, rather than removing the layer, for the
 * layers whose data is shared. Never rendered anywhere near a reader.
 */
export const NO_STATE = "__none__";

/** The filter that pins a district layer to one state, or to nothing. */
export function stateFilter(abbr: string | null): FilterSpecification {
  return ["==", ["get", "state"], abbr ?? NO_STATE] as FilterSpecification;
}
