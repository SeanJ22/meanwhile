import type { FilterSpecification } from "maplibre-gl";

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
 * The rise, capped by the size of the SHAPE it is marking (g5 item 1).
 *
 * `extrusionSpecForZoom` already bottoms the rise out well above zero,
 * reasoning that "a state seen at continental scale is small on screen and a
 * 16 px shadow would swamp it". That reasoning was calibrated on Arizona.
 * New Hampshire is about a quarter of the size, and at continental zoom it is
 * roughly 25 screen pixels across while the FAR spec's rise reaches 35 and its
 * mask feathers over 12 from each side — so the two feathers meet in the
 * middle, the mask never reaches full strength anywhere inside the state, and
 * the mute bleeds into the one place the whole effect exists to keep clear.
 *
 * **What this did NOT fix, recorded because the first version of this comment
 * claimed otherwise.** `pnpm measure:focus` reported 03255 at continental zoom
 * in LIGHT theme moving 4.63 luminance units at what it called the state's
 * middle, and this cap was written and shipped against that number. It was the
 * wrong diagnosis: at that zoom New Hampshire is 45 x 82 screen pixels and the
 * check's most central REACHABLE sample was inside the mask's own 12 px ramp,
 * so it was measuring the transition and calling it the interior. The cap does
 * not bind at z4 at all — span/6 is 7.5 against a feather of 4 — and the
 * number did not move. The check now says "this state has no interior at this
 * zoom" instead, which is the true sentence.
 *
 * It is kept because the property is real below z4, where a state does become
 * smaller than the rise that marks it, and because the author's specification
 * is that the ENTIRE active state renders crisp at EVERY zoom. It is not what
 * fixed anything that was reported.
 *
 * So the same rule the zoom ramp already encodes is applied to the shape as
 * well as to the camera: the feather may not exceed a sixth of the state's
 * smaller on-screen dimension, which leaves at least a third of it at full
 * mask strength, and the offset and blur may not exceed a third of it. Nothing
 * reaches zero — a rise that vanished on a small state would be e's retired
 * release rule arriving through the back door, which is the trap the zoom ramp
 * was written to avoid.
 */
export function capSpecToSpan(spec: ExtrusionSpec, span: number): ExtrusionSpec {
  if (!Number.isFinite(span) || span <= 0) return spec;
  return {
    offsetPx: Math.max(2, Math.min(spec.offsetPx, span / 3)),
    blurPx: Math.max(2, Math.min(spec.blurPx, span / 3)),
    featherPx: Math.max(1, Math.min(spec.featherPx, span / 6)),
    simplifyPx: spec.simplifyPx,
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

/* ------------------------------------------------- the viewport clip --- */

/**
 * The box a projected ring is cut down to before it is handed to a mask, a
 * clip or a filter — g5 item 1, and it is the whole defect.
 *
 * ## What was actually wrong
 *
 * The mute is a DOM scrim carrying `backdrop-filter`, clipped to
 * "everything except the active state" by `clip-path: url(#…)`. The path fed
 * to that clip was the state's rings projected to screen AT FULL EXTENT. At
 * the zoom a reader lands on from a zip (z11) Arizona projects to roughly
 * 16,800 × 20,000 CSS pixels, and **Chromium silently drops a `clip-path`
 * that large**. A dropped clip is not a smaller clip: the scrim then paints
 * over its entire box, so the reader standing in the middle of the active
 * state saw every pixel of the frame muted and blurred.
 *
 * Measured on production before the fix, holding the topology fixed (the
 * viewport rectangle minus one enclosing rectangle, even-odd — a region that
 * is empty at every size, so a working clip must render nothing):
 *
 * | enclosing box | chroma | detail | verdict            |
 * |---------------|--------|--------|--------------------|
 * | ±2000 px      | 17.39  | 20.15  | identical to effect-off |
 * | ±8000 px      | 11.24  |  9.57  | identical to the broken frame |
 * | ±20000 px     | 11.24  |  9.57  | identical to the broken frame |
 *
 * The mask on the scrim was never doing any work at all — CSS `mask` on an
 * HTML element does not resolve an SVG `<mask>` reference in Chromium, which
 * is why the clip failing took the whole effect with it rather than degrading
 * to the mask.
 *
 * This is the same failure g4 found one layer up, where an oversized SVG
 * FILTER region was clamped rather than faded. Chromium's answer to geometry
 * it cannot rasterize is to drop it, and a dropped mask reads as full
 * coverage — the loudest possible way for an ambient effect to fail.
 *
 * ## Why cutting to the viewport is correct and not a workaround
 *
 * Everything outside `FILTER_PAD` of the canvas is already outside the mask's
 * region and outside both filter regions, so it cannot contribute a pixel the
 * reader can see. Cutting there removes only geometry that was being
 * rasterized to be thrown away — which is also why this is the cheapest frame
 * win available: at city zoom it takes the serialized path from the state's
 * full ring count down to the handful of points that cross the screen.
 *
 * **An empty result is a real answer, not a failure.** A ring clipped to
 * nothing means the viewport does not touch the active state at all — pan
 * east into New Mexico while Arizona is active — and the correct render there
 * is a fully muted frame. The caller must treat "no rings" as "everything is
 * outside", never as "draw nothing"; the two look identical in the code and
 * opposite on the screen.
 */
export interface ScreenBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Sutherland–Hodgman: one polygon ring cut down to an axis-aligned box.
 *
 * Rings are clipped INDEPENDENTLY and the result is still evaluated even-odd,
 * which is what makes holes survive: New Jersey ships three rings, and a hole
 * clipped to the box stays a hole. It also handles the case that used to be
 * invisible — a viewport sitting inside a hole clips the outer ring to the
 * box and the hole to the box as well, and even-odd cancels them to nothing,
 * which is the truth (a reader inside a hole is outside the state).
 *
 * The connecting edges this produces on a concave ring run along the box's
 * own edges and enclose no area, so they cost nothing under even-odd.
 */
export function clipRingToBox(
  points: readonly ScreenPoint[],
  box: ScreenBox,
): ScreenPoint[] {
  if (points.length < 3) return [];

  let ring: ScreenPoint[] = [...points];

  // 0: x ≥ minX, 1: x ≤ maxX, 2: y ≥ minY, 3: y ≤ maxY.
  for (let edge = 0; edge < 4; edge += 1) {
    if (ring.length === 0) break;
    const next: ScreenPoint[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      const current = ring[i];
      const previous = ring[(i + ring.length - 1) % ring.length];
      const currentIn = insideEdge(current, edge, box);
      const previousIn = insideEdge(previous, edge, box);
      if (currentIn !== previousIn) {
        next.push(intersectEdge(previous, current, edge, box));
      }
      if (currentIn) next.push(current);
    }
    ring = next;
  }

  return ring.length >= 3 ? ring : [];
}

function insideEdge(point: ScreenPoint, edge: number, box: ScreenBox): boolean {
  if (edge === 0) return point.x >= box.minX;
  if (edge === 1) return point.x <= box.maxX;
  if (edge === 2) return point.y >= box.minY;
  return point.y <= box.maxY;
}

function intersectEdge(
  from: ScreenPoint,
  to: ScreenPoint,
  edge: number,
  box: ScreenBox,
): ScreenPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // A zero denominator cannot arise: the two points straddle this edge, so
  // they differ along the axis the edge is measured on.
  if (edge === 0 || edge === 1) {
    const limit = edge === 0 ? box.minX : box.maxX;
    const t = (limit - from.x) / dx;
    return { x: limit, y: from.y + t * dy };
  }
  const limit = edge === 2 ? box.minY : box.maxY;
  const t = (limit - from.y) / dy;
  return { x: from.x + t * dx, y: limit };
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
