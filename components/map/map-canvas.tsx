"use client";

// MapLibre 6 dropped its default export; everything is named now.
import {
  AttributionControl,
  LngLatBounds,
  MapLibreMap,
  Marker,
  NavigationControl,
  prewarm,
  setWorkerUrl,
  type ErrorEvent as MapErrorEvent,
  type MapMouseEvent,
} from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  StateFocusOverlay,
  type ProjectPoint,
} from "@/components/map/state-focus-overlay";

import {
  CONUS_BOUNDS,
  FALLBACK_STYLE,
  METRO_ZOOM,
  resolveBasemap,
} from "@/lib/map/style";
import { initialZoomForZip } from "@/lib/map/initial-zoom";
import { viewportRadiusKm } from "@/lib/map/viewport-radius";
import {
  DISTRICT_TYPES,
  addDistrictLayer,
  districtLayerPresent,
  districtsAt,
  drawnDistrictsOn,
  firstSymbolLayerId,
  loadDistricts,
  removeDistrictLayer,
  setNarrowedDistricts,
  setSelectedDistrict,
  type DistrictHit,
  type DrawnDistrict,
} from "@/lib/map/districts";
import {
  STATE_OUTLINES_URL,
  filterStateAbbr,
  outlineFor,
  stateAbbrFromOcdId,
  type StateOutlines,
} from "@/lib/map/state-focus";
import type { DistrictType } from "@/lib/state/types";
import type { Theme } from "@/hooks/use-stored-theme";
import type { Venue } from "@/lib/meetings/venues";
import {
  applySelection,
  applySpiderfy,
  applyVisibility,
  clearSpiderfy,
  createMarkerPool,
  destroyMarkerPool,
  rebuildMarkerPool,
} from "@/lib/map/marker-pool";
import { fanOffsets, findCollisionGroups } from "@/lib/map/spiderfy";

import "maplibre-gl/dist/maplibre-gl.css";

/**
 * The map.
 *
 * Owns the MapLibre instance and the markers, and nothing else — it takes
 * venues and a camera target and knows nothing about zip codes, the cascade, or
 * where the meetings came from.
 */

/** Where the map should be looking. A new object means a new fly-to. */
export interface CameraTarget {
  zip: string;
  lat: number;
  lng: number;
}

/**
 * A one-off camera move, from search or the list overlay.
 *
 * `key` identifies the request rather than the place, so picking the same
 * result twice flies again instead of being deduplicated into nothing.
 */
export interface MapFocus {
  lat: number;
  lng: number;
  zoom?: number;
  key: string;
}

/** The cheap read-only camera probe (g5 item 1). See where it is installed. */
interface CameraProbe {
  (): { zoom: number; lat: number; lng: number };
}

interface MapCanvasProps {
  venues: Venue[];
  camera: CameraTarget | null;
  focus: MapFocus | null;
  /** The districts currently drawn — the stats card counts this list and
   *  the districts door renders it, one denominator for both (3g). */
  onDrawnDistricts: (districts: DrawnDistrict[]) => void;
  selectedVenueKey: string | null;
  /**
   * A full-screen overlay is open over the map (g5 item 2).
   *
   * The state-focus scrim is suspended while it is, because two stacked
   * backdrop-filter surfaces over the WebGL canvas cost the overlay its own
   * paint — measured on production, not inferred. See the note at the render
   * site.
   */
  overlayOpen?: boolean;
  /** District overlays to draw. Empty draws none. */
  districtTypes: DistrictType[];
  /** The district the reader picked, highlighted via feature-state. */
  selectedDistrict: { type: DistrictType; ocdId: string } | null;
  /** The reader's narrowed divisions (item 7): shaded quieter than a
   *  selection, via feature-state, re-applied as layers load. */
  narrowedDistricts?: { type: DistrictType; ocdId: string }[];
  /** A click landed in these districts. Always a set — see districtsAt. */
  onDistrictClick: (hits: DistrictHit[], at: { x: number; y: number }) => void;
  /** The boundary file could not be loaded; the caller says so and disables the toggle. */
  onDistrictError: () => void;
  /**
   * Frame every venue rather than resting at metro zoom on the centroid. Set
   * when the cascade widened or fell back, because the meetings it found can
   * sit an hour's drive outside the zip.
   */
  frameAllVenues: boolean;
  /** Basemap follows the UI theme; changing it restyles the map in place. */
  theme: Theme;
  onSelectVenue: (venue: Venue) => void;
  onTileError: () => void;
  /**
   * The reader panned or zoomed and the map came to rest (2i). Fired only for
   * gestures — never for flyTo/fitBounds the app itself issued — and only
   * after a debounce, never mid-gesture. The parent decides whether to act
   * (it skips when a popup is open or a selection is active).
   */
  onViewportSettle?: (view: {
    lat: number;
    lng: number;
    /**
     * How far the reader can actually SEE, corner to corner and halved
     * (g3 item 6). Carried because the fetch used to ignore zoom entirely
     * and always ask for the ladder's first rung, so zooming out re-drew a
     * 25 km circle around a moved centre and pins disappeared.
     */
    viewportRadiusKm: number;
  }) => void;
  /**
   * Whether the app may move the camera to frame results. False for a
   * settle-driven result: the reader chose this viewport by hand, and
   * yanking it to fit venues would fight them (2i).
   */
  allowAutoFrame: boolean;
  /**
   * The state the reader is in, as its OCD-ID — the state that RISES out of
   * the map (g3 item 10, M91). Null before a zip resolves, and then nothing
   * is raised and nothing is muted: a reader who has not said where they are
   * has no "here" to mark.
   *
   * Keyed on the OCD-ID like everything else in this product, never on a
   * name string.
   */
  focusStateOcdId?: string | null;
  /**
   * Voting locations (B19), drawn as their OWN pin class.
   *
   * Deliberately not folded into `venues`. A meeting pin and a voting-site
   * pin answer different questions, and a reader scanning a map for "where do
   * I vote" must be able to tell them apart at a glance — B19's spec says
   * "visually unmistakable against meeting pins", so they carry a separate
   * element class, a separate colour token, and a separate marker set with no
   * pooling, because this list is small and static where the venue list is
   * neither.
   */
  votingSites?: VotingSitePin[];
  onSelectVotingSite?: (id: string) => void;
  /** The site whose card is open, so its pin can show it. */
  selectedVotingSiteId?: string | null;
}

/** The map's whole view of a voting location. */
export interface VotingSitePin {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* The marker element now lives in lib/map/marker-pool.ts, with the pool that
   reuses it. It is still a real <button> with an aria-label. */

/** The zip's own centroid — where the reader asked us to look. */
function createHereElement(zipLabel: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "wtp-here";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", `Center of zip code ${zipLabel}`);
  return element;
}

export function MapCanvas({
  venues,
  camera,
  focus,
  selectedVenueKey,
  frameAllVenues,
  overlayOpen = false,
  districtTypes,
  selectedDistrict,
  narrowedDistricts,
  theme,
  onDistrictError,
  onDrawnDistricts,
  onDistrictClick,
  onSelectVenue,
  onTileError,
  onViewportSettle,
  allowAutoFrame,
  focusStateOcdId = null,
  votingSites,
  onSelectVotingSite,
  selectedVotingSiteId = null,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // The style currently applied to the map. Seeded with the one the mount
  // effect builds with, so the restyle effect below never re-applies it — see
  // the note there about Strict Mode.
  const appliedStyleRef = useRef<string | null>(
    resolveBasemap(theme)?.styleUrl ?? null,
  );
  const poolRef = useRef(createMarkerPool());
  const hereRef = useRef<Marker | null>(null);
  /** Voting-site markers, keyed by site id. Their own set, never the pool. */
  const votePinsRef = useRef(new Map<string, Marker>());
  /**
   * Has the reader taken the camera by hand? (g4 item 5.)
   *
   * A ref rather than state on purpose: nothing renders differently because
   * of it, and putting it in state would re-render the map on every pan.
   * Raised by any gesture; lowered only by the two effects that represent an
   * explicit request to be moved — a new `camera` (a zip) and a new `focus`
   * (a search result or a card).
   */
  const userMovedRef = useRef(false);

  // Handlers live in a ref so re-renders don't tear down and rebuild markers.
  const onSelectRef = useRef(onSelectVenue);
  useEffect(() => {
    onSelectRef.current = onSelectVenue;
  }, [onSelectVenue]);
  const onSelectVotingSiteRef = useRef(onSelectVotingSite);
  useEffect(() => {
    onSelectVotingSiteRef.current = onSelectVotingSite;
  }, [onSelectVotingSite]);

  const onDistrictErrorRef = useRef(onDistrictError);
  useEffect(() => {
    onDistrictErrorRef.current = onDistrictError;
  }, [onDistrictError]);

  const onDrawnDistrictsRef = useRef(onDrawnDistricts);
  useEffect(() => {
    onDrawnDistrictsRef.current = onDrawnDistricts;
  }, [onDrawnDistricts]);

  const districtTypesRef = useRef(districtTypes);
  useEffect(() => {
    districtTypesRef.current = districtTypes;
  }, [districtTypes]);

  const onDistrictClickRef = useRef(onDistrictClick);
  useEffect(() => {
    onDistrictClickRef.current = onDistrictClick;
  }, [onDistrictClick]);

  const onViewportSettleRef = useRef(onViewportSettle);
  useEffect(() => {
    onViewportSettleRef.current = onViewportSettle;
  }, [onViewportSettle]);

  /*
   * Put the district overlay back whenever it is wanted and missing.
   *
   * This is written as a standing invariant rather than a one-shot for a
   * reason. setStyle discards every source and layer that is not in the new
   * stylesheet, and `styledata` fires several times per style change —
   * including for the *outgoing* style, before the new one is applied. A
   * `once("styledata")` re-attach therefore ran while the old style was still
   * in place, saw the layers present, concluded there was nothing to do, and
   * then the incoming style wiped them. Light mode came up with no districts
   * and nothing logged: the same silent shape as the `idle` bug.
   *
   * Subscribed to every `styledata` instead, guarded on "wanted, absent, and
   * the stylesheet is parsed", it is idempotent however many times it fires and
   * self-heals after any style change.
   */
  /**
   * The state whose districts are currently ON the map (g4 item 3).
   *
   * A ref, not state: `ensureDistricts` is a stable callback subscribed to
   * `styledata`, and it has to know what it built LAST time to know whether
   * to tear it down. Held separately from `focusStateOcdId` because the two
   * disagree for the whole duration of a fetch, and that gap is exactly when
   * the old state's boundaries used to survive into the new state's view.
   */
  const districtStateRef = useRef<string | null>(null);
  const focusAbbrRef = useRef<string | null>(stateAbbrFromOcdId(focusStateOcdId));
  const focusOcdRef = useRef<string | null>(focusStateOcdId ?? null);
  useEffect(() => {
    focusAbbrRef.current = stateAbbrFromOcdId(focusStateOcdId);
    focusOcdRef.current = focusStateOcdId ?? null;
  }, [focusStateOcdId]);

  const ensureDistricts = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()?.layers?.length) return;

    const abbr = focusAbbrRef.current;
    /*
     * g4 item 3: NO ACTIVE STATE MEANS NO DISTRICT BOUNDARIES ANYWHERE.
     *
     * `wanted` is emptied rather than the loop being skipped, so the removal
     * pass below runs and the previous state's layers actually come off. A
     * `return` here would have left them drawn — the same shape as the stale
     * mask in item 1, one layer down.
     */
    const wanted = abbr ? districtTypesRef.current : [];

    // The active state changed under the layers: every one of them is now
    // holding the wrong state's geometry, so they all go before anything is
    // added back. Selecting a new state depopulates the old.
    if (districtStateRef.current !== abbr) {
      for (const type of DISTRICT_TYPES) {
        if (districtLayerPresent(map, type)) removeDistrictLayer(map, type);
      }
      districtStateRef.current = abbr;
    }

    // Drop what is no longer asked for, before adding what is.
    for (const type of DISTRICT_TYPES) {
      if (!wanted.includes(type) && districtLayerPresent(map, type)) {
        removeDistrictLayer(map, type);
      }
    }

    for (const type of wanted) {
      if (districtLayerPresent(map, type)) continue;

      loadDistricts(type, abbr)
        .then((data) => {
          // Re-check: the fetch is async and the style may have moved on.
          const live = mapRef.current;
          if (!live) return;
          if (!districtTypesRef.current.includes(type)) return;
          if (!live.getStyle()?.layers?.length) return;
          // ...and the ACTIVE STATE may have moved on too. Without this the
          // reader who types an Arizona zip while New Hampshire's school
          // districts are still in flight gets New Hampshire's boundaries
          // painted over Arizona, seconds after the map has flown.
          if (focusAbbrRef.current !== abbr) return;
          addDistrictLayer(live, type, data, abbr);
        })
        .catch(() => onDistrictErrorRef.current());
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // MapLibre 6 locates its tile-parsing worker at runtime, by resolving
    // "./maplibre-gl-worker.mjs" against its own import.meta.url. That is a
    // dynamic template, so no bundler emits the worker as an addressable
    // asset and the computed URL 404s under both Turbopack and webpack.
    // scripts/build-map-worker.mjs bundles a self-contained copy here; see it
    // for the full account. Must precede the first map.
    setWorkerUrl("/maplibre-gl-worker.mjs");

    // MapLibre shares one worker pool across all maps and tears it down when
    // the last map is removed. React Strict Mode mounts, cleans up, then mounts
    // again, so the second map would inherit a disposed pool. prewarm() takes a
    // reference so map.remove() cannot dispose it. Must follow setWorkerUrl and
    // precede the first map.
    prewarm();

    // No key means nothing to draw. Fall through to the plain ground colour and
    // say so, rather than substituting another provider — a silent swap turns a
    // total rendering failure into something that looks like a styling choice.
    const basemap = resolveBasemap(theme);
    if (!basemap) onTileError();

    const map = new MapLibreMap({
      container: containerRef.current,
      style: basemap?.styleUrl ?? FALLBACK_STYLE,
      bounds: CONUS_BOUNDS,
      fitBoundsOptions: { padding: 24, duration: 0 },
      // Added explicitly below so it lands bottom right, clear of the coverage
      // notices in the bottom-left corner.
      attributionControl: false,
      // The entry notice sits over the map; spinning it adds nothing.
      pitchWithRotate: false,
      dragRotate: false,
    });

    // The legend owns the bottom-right corner (Edia puts it there and the port
    // keeps it), so the map's own controls move out of its way rather than
    // stacking on top of it.
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-left");
    map.touchZoomRotate.disableRotation();

    // A failed style request would otherwise leave a blank screen with a
    // working UI drawn on nothing. Drop to a plain ground color instead, so
    // pins and panels stay usable, and tell the caller to say what happened.
    map.on("error", (event: MapErrorEvent) => {
      const message = event.error?.message ?? "";

      // Log everything. Filtering before logging is what hid this class of bug
      // for hours: an unrecognised message — "Failed to fetch", a worker that
      // died with an empty string — was dropped on the floor and the map just
      // sat there looking like a design choice. Only the *display* of a notice
      // is filtered, and only to the categories a reader can act on.
      console.error("[map]", message || event.error || event);

      if (!/style|sprite|glyphs|tile/i.test(message)) return;

      onTileError();
      if (map.getStyle()?.layers?.length !== FALLBACK_STYLE.layers.length) {
        map.setStyle(FALLBACK_STYLE);
      }
    });

    mapRef.current = map;
    const pool = poolRef.current;

    // Standing invariant: any time the style changes — including the initial
    // load and every theme swap — put the district overlay back if it is wanted
    // and missing. See ensureDistricts for why this is not a one-shot.
    map.on("styledata", ensureDistricts);

    /*
     * Click to select a district.
     *
     * The answer is a *set*. One hit selects directly; several open a
     * disambiguation prompt; none is a no-op rather than a cleared selection,
     * so clicking empty water does not silently drop what a reader chose.
     */
    const onClick = (event: MapMouseEvent) => {
      /*
       * DISMISSAL RETURNS THEM (M19, 2026-08-17).
       *
       * A press on the map itself puts a fanned group back. Markers are DOM
       * overlays, so a press on a pin never reaches the canvas and never
       * reaches here — which is what makes this the right place: it fires for
       * exactly the presses that mean "not one of those".
       *
       * It runs BEFORE the district hit-test and does not return, because
       * dismissing the fan and selecting a district are two different answers
       * to the same press and both are wanted: the pins go back, and the
       * district under the finger still opens.
       */
      clearSpiderfy(pool);

      const hits = districtsAt(map, event.point, districtTypesRef.current);
      if (hits.length === 0) return;
      onDistrictClickRef.current(hits, { x: event.point.x, y: event.point.y });
    };

    map.on("click", onClick);

    /*
     * Escape puts them back too — the explicit control beside the gesture,
     * for the same reason M90 kept one: a gesture nobody discovers is not an
     * exit. No history entry is pushed (M52).
     */
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") clearSpiderfy(pool);
    };
    window.addEventListener("keydown", onKeyDown);

    /*
     * Scroll-and-settle (2i). A user gesture is the only thing that carries
     * an `originalEvent` on movestart — flyTo, jumpTo and fitBounds never do
     * — so this fires for pans and pinches and stays silent through every
     * camera move the app makes itself. The debounce means "came to rest":
     * a new gesture inside the window cancels the pending settle, so nothing
     * ever fires mid-gesture.
     */
    let userMoved = false;
    let settleTimer: number | undefined;
    const onMoveStart = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) {
        userMoved = true;
        // g4 item 5: the reader has taken the camera. It stays theirs until
        // an explicit action hands it back — see the auto-frame effect.
        userMovedRef.current = true;
      }
      window.clearTimeout(settleTimer);
    };
    const onMoveEnd = () => {
      if (!userMoved) return;
      userMoved = false;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        // wrap(): a map panned past the antimeridian reports longitudes
        // outside [-180, 180], which the API rejects with a 400 — the one
        // settle-only failure a client can manufacture on its own (2a).
        const center = map.getCenter().wrap();
        const bounds = map.getBounds();
        onViewportSettleRef.current?.({
          lat: center.lat,
          lng: center.lng,
          viewportRadiusKm: viewportRadiusKm({
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
          }),
        });
      }, 650);
    };
    map.on("movestart", onMoveStart);
    map.on("moveend", onMoveEnd);

    /*
     * The camera probe (g3 item 6), sibling of `__wtpPinCount` below.
     *
     * `pnpm walk:all` has to prove it actually zoomed before it can claim
     * anything about what zooming did. Without this the walk's first version
     * reported "zooming out never removes pins — 11 → 11 → 11" while its
     * gesture was landing on an overlay and the map had never moved: a green
     * check for an experiment that did not run, which is worse than a red
     * one. Read-only; nothing in the product consults it.
     */
    (window as unknown as { __wtpZoom?: () => number }).__wtpZoom = () =>
      map.getZoom();
    (window as unknown as { __wtpZoomOut?: (by?: number) => void }).__wtpZoomOut = (
      by = 2,
    ) => {
      // Dispatched as a USER gesture would be seen: `zoomTo` with an
      // `originalEvent` so the settle path — the one the defect lived in —
      // is the path the walk exercises. A bare `map.zoomTo()` would skip it.
      map.zoomTo(map.getZoom() - by, {}, { originalEvent: new Event("wheel") });
    };

    /*
     * The MAP probe (g4) — the third of the read-only instruments, and the
     * one the g4 walk checks are built on.
     *
     * Several items are claims about map STATE that no screenshot can
     * settle: which state the focus layers point at, which district layers
     * exist, which state each one is filtered to, and whether the camera
     * moved. g3's lesson was that three defects survived
     * screenshots and died to measurement, so these are read off the map
     * itself rather than off pixels.
     *
     * Read-only by construction: it returns copies of ids and filters and
     * nothing in the product consults it, so it cannot become a feature by
     * accident. Same standing as `__wtpZoom` and `__wtpPinCount`.
     */
    /*
     * The map's projection, for the extrusion measurement only.
     *
     * `scripts/measure-extrusion.mts` samples the rendered canvas along
     * normals crossing the state border, and only the live map can say where
     * on screen a border vertex has landed. Read-only and nothing in the
     * product consults it — the same standing as the three probes around it.
     */
    // Typed through `ProjectPoint` rather than an inline arrow: the
    // server/client boundary guard reads any indented `name: (args) => Ret`
    // as an injected function prop, and a window cast is neither injected nor
    // a prop. Naming the shape says the same thing without tripping it.
    (window as unknown as { __wtpProject?: ProjectPoint }).__wtpProject = (p) =>
      map.project(p);

    /*
     * The camera, and NOTHING else (g5 item 1).
     *
     * `__wtpMapProbe` walks the style's layers and sources on every call,
     * which is fine once a frame is finished and useless sixty times a
     * second. The fly-in measurement reads the camera on every animation
     * frame to find where the transition begins and ends, so it needs a
     * probe cheap enough not to change the thing it is measuring.
     */
    // Typed through `CameraProbe` rather than inline, for the same reason
    // `__wtpProject` is: the server/client boundary guard reads any indented
    // `name: (args) => Ret` as an injected function prop, and a window cast
    // is neither injected nor a prop. Naming the shape says the same thing
    // without tripping it.
    (window as unknown as { __wtpCamera?: CameraProbe }).__wtpCamera = () => {
      const c = map.getCenter();
      return { zoom: map.getZoom(), lat: c.lat, lng: c.lng };
    };

    (window as unknown as { __wtpMapProbe?: () => unknown }).__wtpMapProbe =
      () => {
        const centre = map.getCenter();
        const layers = (map.getStyle()?.layers ?? []).map((l) => l.id);
        const districtLayers = layers.filter((id) => id.startsWith("district-"));
        return {
          zoom: map.getZoom(),
          centre: { lat: centre.lat, lng: centre.lng },
          /** Which state is raised — null when none, and then nothing is muted. */
          focusOcdId: focusOcdRef.current,
          /** The state the district layers were actually built for (item 3). */
          districtState: districtStateRef.current,
          /** Every district layer currently on the style, by id. */
          districtLayers,
          /**
           * The state each district LINE layer is filtered to. Read back off
           * the map rather than assumed, because item 3's claim is about what
           * the map is drawing and not about what the app intended.
           */
          districtFilterStates: [
            ...new Set(
              districtLayers
                .filter((id) => id.endsWith("-line"))
                .map((id) => filterStateAbbr(map.getFilter(id))),
            ),
          ],
          /**
           * Every custom source on the style, by id (g5 item 1).
           *
           * The data-scoping rule is about what is HELD, not only about what
           * is drawn, so the walk needs the sources and not just the layers:
           * a released state's layers can be gone while its GeoJSON source
           * is still on the style holding the geometry.
           */
          customSources: Object.keys(map.getStyle()?.sources ?? {}),
          /** Total style layers, for item 3's before/after load measurement. */
          layerCount: layers.length,
        };
      };

    /*
     * THE SPIDERFY PROBE (M19, 2026-08-17) — the fourth read-only instrument.
     *
     * The claim is "two overlapping pins are each reachable", and a walk
     * cannot check it by clicking blindly: which pins collide depends on the
     * zoom, the data and the viewport, so a walk that guessed a pair would
     * report green on a build where nothing overlapped at all. This answers
     * WHICH pins are stacked right now, and where they are — the same
     * projection the click path uses, so the walk and the product cannot
     * disagree about what a collision is.
     *
     * Read-only: nothing in the product consults it.
     */
    (window as unknown as { __wtpSpiderProbe?: () => unknown }).__wtpSpiderProbe =
      () => {
        const points = [...pool.entries.values()]
          .filter((entry) => entry.element.dataset.hidden !== "true")
          .map((entry) => {
            const p = map.project([entry.venue.lng, entry.venue.lat]);
            return { key: entry.venue.key, x: p.x, y: p.y };
          });
        return {
          visible: points.length,
          groups: findCollisionGroups(points),
          fanned: [...pool.spiderfiedKeys],
          /** Where each pin's ELEMENT actually sits, fan offsets included. */
          boxes: Object.fromEntries(
            [...pool.entries.values()]
              .filter((entry) => entry.element.dataset.hidden !== "true")
              .map((entry) => {
                const r = entry.element.getBoundingClientRect();
                return [
                  entry.venue.key,
                  { x: r.x + r.width / 2, y: r.y + r.height / 2 },
                ];
              }),
          ),
        };
      };

    return () => {
      window.clearTimeout(settleTimer);
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      map.off("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      map.off("styledata", ensureDistricts);
      map.remove();
      mapRef.current = null;
      hereRef.current = null;
      destroyMarkerPool(pool);
    };
    // Mount once. onTileError is stable by construction in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark the zip's centroid. When the cascade widens, the gap between this and
  // the nearest pin is the honest picture of how far away the meetings are.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;

    if (!hereRef.current) {
      hereRef.current = new Marker({
        element: createHereElement(camera.zip),
        anchor: "center",
      })
        .setLngLat([camera.lng, camera.lat])
        .addTo(map);
      return;
    }

    hereRef.current.setLngLat([camera.lng, camera.lat]);
    hereRef.current
      .getElement()
      .setAttribute("aria-label", `Center of zip code ${camera.zip}`);
  }, [camera]);

  /*
   * Voting-site pins (B19).
   *
   * Reconciled by id — create what is new, move what stayed, remove only what
   * the answer no longer contains. A site with no coordinate never reaches
   * here: `isPinnable` filters upstream, and the card lists it with its
   * address instead, because a location we could not place is a gap in OUR
   * geocoding and pinning it at a plausible point would be the guess this
   * whole row exists to refuse.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pins = votePinsRef.current;
    const wanted = new Map((votingSites ?? []).map((s) => [s.id, s]));

    for (const [id, marker] of pins) {
      if (wanted.has(id)) continue;
      marker.remove();
      pins.delete(id);
    }

    for (const [id, site] of wanted) {
      const existing = pins.get(id);
      if (existing) {
        existing.setLngLat([site.lng, site.lat]);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wtp-vote-pin";
      button.dataset.siteId = id;
      button.setAttribute("aria-label", `Voting location: ${site.name}`);
      const dot = document.createElement("span");
      dot.className = "wtp-vote-pin-dot";
      button.appendChild(dot);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectVotingSiteRef.current?.(id);
      });
      const marker = new Marker({ element: button, anchor: "bottom" })
        .setLngLat([site.lng, site.lat])
        .addTo(map);
      pins.set(id, marker);
    }
  }, [votingSites]);

  // Selection is a data attribute on the element, so it survives re-renders.
  useEffect(() => {
    for (const [id, marker] of votePinsRef.current) {
      marker.getElement().dataset.selected = String(id === selectedVotingSiteId);
    }
  }, [selectedVotingSiteId, votingSites]);

  // Fly to a new center, at the zip's deliberate first-view altitude (6f).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;

    // An explicit request to be moved hands the camera back (g4 item 5).
    userMovedRef.current = false;

    const options = {
      center: [camera.lng, camera.lat] as [number, number],
      zoom: initialZoomForZip(camera.zip),
    };

    if (prefersReducedMotion()) {
      map.jumpTo(options);
    } else {
      map.flyTo({ ...options, duration: 2600, essential: true, curve: 1.5 });
    }
  }, [camera]);

  /*
   * Reconcile the marker pool against the venues the data contains.
   *
   * Markers are created once and reused. This effect runs when the *data*
   * changes; a filter that merely narrows what is shown goes through
   * applyVisibility below and touches only the pins whose visibility actually
   * changed. Separating the two is the whole point of the pool — see
   * lib/map/marker-pool.ts.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    /*
     * THE PIN CLICK, WITH FAN-OUT IN FRONT OF IT (M19, 2026-08-17, the
     * author's ruling: A, spiderfy).
     *
     * A press on a pin that is sitting under or over another pin FANS THE
     * GROUP first and selects nothing — because a click landing on a stack is
     * a click whose target the reader has not chosen yet, and picking one for
     * them is how the top pin came to swallow its neighbour. The second press
     * lands on one fanned pin and selects it normally.
     *
     * Once a group is fanned, its members are no longer colliding (that is
     * the point), so the next press on any of them falls straight through to
     * selection. Nothing else in the app changes: a pin that never collides
     * behaves exactly as it always did, in one press.
     */
    rebuildMarkerPool(poolRef.current, map, venues, (venue) => {
      const pool = poolRef.current;

      // Already fanned: this press is the reader choosing one of them.
      if (pool.spiderfiedKeys.has(venue.key)) {
        onSelectRef.current(venue);
        return;
      }

      // Where the VISIBLE pins actually are on screen, right now. Projected
      // rather than measured off the DOM: a pin the browser has not painted
      // yet has no box, and the collision is a fact about the map's geometry.
      const points = [...pool.entries.values()]
        .filter((entry) => entry.element.dataset.hidden !== "true")
        .map((entry) => {
          const p = map.project([entry.venue.lng, entry.venue.lat]);
          return { key: entry.venue.key, x: p.x, y: p.y };
        });

      const group = findCollisionGroups(points).find((g) => g.includes(venue.key));
      if (!group) {
        // Not in a stack. Any other group that was fanned goes back first —
        // one fan at a time, or the new positions land on the old ones.
        clearSpiderfy(pool);
        onSelectRef.current(venue);
        return;
      }

      applySpiderfy(pool, fanOffsets(group));
    });
    applyVisibility(poolRef.current, new Set(venues.map((v) => v.key)));

    /*
     * The pin-count probe (g3 item 6).
     *
     * `pnpm walk:all` asserts that zooming out never REMOVES pins, and a
     * count read off the DOM would be counting what the browser happened to
     * have painted rather than what the map holds. This is the map's own
     * answer to "how many pins are you showing", and it exists for exactly
     * one caller. It is a read-only integer: nothing about the product
     * behaves differently when it is or isn't there, so it cannot become a
     * feature by accident.
     */
    (window as unknown as { __wtpPinCount?: () => number }).__wtpPinCount = () =>
      venues.length;
  }, [venues]);

  /*
   * THE STATE FOCUS (g3 item 10, M91) — the author's design, against his
   * neumorphism reference.
   *
   * Two halves, and they live apart for a reason the reference forces: the
   * raised EDGE is map layers (a light NW edge and a dark SE edge, one light
   * source at top-left, per `lib/map/state-focus.ts`), while the MUTE AND
   * BLUR outside is a DOM scrim, because no WebGL paint property can blur
   * what is painted underneath it. Inside the border nothing is touched at
   * all — that is what makes it an extrusion rather than a card.
   *
   * The outlines load once, lazily, and a failure is silent by design: this
   * is ambient decoration carrying no information, and a map that draws
   * without it is a working map. Anything louder would be an outage over a
   * shadow.
   */
  const [outlines, setOutlines] = useState<StateOutlines | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(STATE_OUTLINES_URL);
        if (!response.ok) return;
        const data = (await response.json()) as StateOutlines;
        if (live) setOutlines(data);
      } catch {
        // Ambient only. The map is fine without it.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const focusOutline = useMemo(
    () => outlineFor(outlines, focusStateOcdId ?? null),
    [outlines, focusStateOcdId],
  );

  /*
   * THE CURRENT ZIP IS NOT DRAWN ON THE MAP (g5 item 1, the author's ruling).
   *
   * g4 item 4 tinted the reader's own ZCTA polygon here, fetched one polygon
   * at a time from a route built for it. The author removed it from the
   * product: the zip chooses the active state and centres the camera, and
   * that is all it does. The tint, its layer, its source, its geometry fetch
   * and the route that served it are gone — not flagged off, gone — so a
   * reader's zip now costs the map no request and no layer at all.
   *
   * The committed ZCTA geometry stays in the repository, unused.
   */

  /*
   * The projection, handed to the scrim as a STABLE function.
   *
   * `map.project` is bound to the map instance and the map instance is
   * created once, so this identity never changes — which matters because the
   * scrim's effect depends on it, and a new function every render would
   * rebuild the clip path on every render instead of on every camera move.
   */
  const [projectFn, setProjectFn] = useState<ProjectPoint | null>(null);
  const [subscribeMove, setSubscribeMove] = useState<
    ((onMove: () => void) => () => void) | null
  >(null);
  /**
   * The camera's zoom, read at DRAW time (g4 item 2).
   *
   * The rise is sized in screen pixels and its size scales with zoom, so the
   * overlay needs the zoom on every frame of a pinch. Passed as a getter
   * rather than a number: a prop would re-render this whole subtree sixty
   * times a second to change two filter radii.
   */
  const [zoomOf, setZoomOf] = useState<(() => number) | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // `setState` with a function argument would CALL it, so all three are
    // wrapped.
    setProjectFn(() => (lngLat: [number, number]) => map.project(lngLat));
    setZoomOf(() => () => map.getZoom());
    setSubscribeMove(() => (onMove: () => void) => {
      map.on("move", onMove);
      map.on("zoom", onMove);
      map.on("resize", onMove);
      return () => {
        map.off("move", onMove);
        map.off("zoom", onMove);
        map.off("resize", onMove);
      };
    });
  }, [outlines]);

  // Swap the basemap when the theme changes. The listener above puts the
  // districts back once the new style lands.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const basemap = resolveBasemap(theme);
    if (!basemap) return;

    // Keyed on the style actually applied, not on a "skip the first run" flag.
    // Strict Mode re-invokes effects against the same component instance, so a
    // first-run flag reads as already-spent on the second pass and fires a
    // setStyle while the initial style is still loading — which wedges the
    // renderer. Comparing URLs makes this idempotent under any number of runs.
    if (appliedStyleRef.current === basemap.styleUrl) return;
    appliedStyleRef.current = basemap.styleUrl;

    map.setStyle(basemap.styleUrl);
  }, [theme]);

  /*
   * The district overlay follows the toggle.
   *
   * The boundary file is only fetched when a reader first asks for it — most
   * never will, and it is the largest thing this screen can download.
   *
   * Attaching is delegated to `ensureDistricts`, which is also subscribed to
   * `styledata`. That matters for readiness as much as for restyles: addLayer
   * needs the stylesheet parsed, and `getStyle().layers` is the public signal
   * for exactly that. It must not be `isStyleLoaded()` or `idle`, both of which
   * are `style.loaded()` — that additionally requires every source to have
   * loaded, and the MapTiler styles declare a `maptiler_attribution` source
   * that is a vector source carrying only an attribution string: no `url`, no
   * `tiles`, no layer referencing it. Nothing to fetch, so it never reports
   * loaded, `map.loaded()` is never true, and `idle` never fires. Gating here
   * on either one hung forever, leaving the toggle enabled and the map empty.
   */
  /*
   * M139 (2026-08-18) — `focusStateOcdId` is in these deps, and leaving it out
   * was the half-load.
   *
   * `ensureDistricts` reads the active state off `focusAbbrRef`, a REF, and a
   * ref changing re-runs nothing. So when this pass ran before the state had
   * resolved, `abbr` was null, `wanted` was emptied, every district layer came
   * off — and nothing ever called it again, because neither `districtTypes`
   * nor `ensureDistricts` changes when a state activates. The layers stayed
   * off for the life of the page.
   *
   * On a cold arrival it usually recovered by luck: `ensureDistricts` is also
   * subscribed to `styledata`, which tends to fire after the state has
   * activated. Coming BACK from the ballot page the style is already parsed,
   * so that second chance fires early or not at all — which is why the report
   * on this row was "returning from the ballot page, the sidebar renders
   * half" and why it was intermittent. Measured at 03255 before the fix
   * (`pnpm probe:m139`, sampling every 100 ms): the districts tile read 0 for
   * the whole ten-second window on 1 of 3 returns, recovered after ~2s on
   * another, and was fine on the third.
   *
   * Naming the state here is the fix: the pass re-runs when the state
   * resolves, and the ref-sync effect above is declared earlier so it has
   * already landed by the time this runs.
   */
  useEffect(() => {
    ensureDistricts();
  }, [districtTypes, ensureDistricts, focusStateOcdId]);

  // Selection is feature-state, never a source mutation.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setSelectedDistrict(
      map,
      selectedDistrict?.type ?? null,
      selectedDistrict?.ocdId ?? null,
    );
  }, [selectedDistrict, districtTypes]);

  // Narrowed-division shading (item 7): same feature-state mechanism,
  // re-applied on the map's load signals because the boundary layers load
  // asynchronously — the shading appears the moment the polygon does.
  const narrowedRef = useRef(narrowedDistricts ?? []);
  useEffect(() => {
    narrowedRef.current = narrowedDistricts ?? [];
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const live = mapRef.current;
      if (!live) return;
      setNarrowedDistricts(live, narrowedRef.current);
    };

    apply();
    map.on("idle", apply);
    map.on("sourcedata", apply);
    return () => {
      map.off("idle", apply);
      map.off("sourcedata", apply);
    };
  }, [narrowedDistricts, districtTypes]);

  // A one-off fly-to from search or the list. Separate from `camera`, which is
  // the zip's own centroid and must not move when a reader looks at a result.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;

    // A search result or a card is an explicit request to be moved, so it
    // hands the camera back to the app (g4 item 5).
    userMovedRef.current = false;

    const options = {
      center: [focus.lng, focus.lat] as [number, number],
      zoom: focus.zoom ?? 13,
    };

    if (prefersReducedMotion()) map.jumpTo(options);
    else map.flyTo({ ...options, duration: 900, essential: true });
  }, [focus]);

  // Report the districts currently drawn, for the stats card AND the
  // districts door — the same list feeds both, so the stated count and the
  // rendered rows share one denominator (3g). Counted after rendering
  // settles rather than from the source, because what matters is what a
  // reader can see.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const report = () => {
      const live = mapRef.current;
      if (!live) return;
      onDrawnDistrictsRef.current(
        drawnDistrictsOn(live, districtTypesRef.current),
      );
    };

    report();
    map.on("idle", report);
    map.on("sourcedata", report);

    return () => {
      map.off("idle", report);
      map.off("sourcedata", report);
    };
  }, [districtTypes]);

  // Selection is a class on the marker element, so it survives re-renders
  // without rebuilding the marker.
  useEffect(() => {
    applySelection(poolRef.current, selectedVenueKey);
  }, [selectedVenueKey, venues]);

  /**
   * Keep the pins in frame.
   *
   * Metro zoom on the centroid is right when the meetings are in the metro.
   * When the cascade widened or fell back to the recent past, they can be an
   * hour's drive away — so frame all of them, along with the centroid, rather
   * than resting on a view with nothing in it.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera || venues.length === 0) return;

    // A settle-driven result must never move the camera — the reader put the
    // viewport where they wanted it (2i).
    if (!allowAutoFrame) return;

    /*
     * g4 item 5 — "the map stops dragging the reader back".
     *
     * The author's report was that free panning GLIDES BACK TO THE STARTING
     * POINT. That rules out drag inertia, which continues a motion and never
     * reverses it, and it names this timer exactly: the reader pans away, and
     * 2.8 seconds later `fitBounds` flies the camera back to a frame computed
     * around the zip's own centroid — the starting point, by construction.
     *
     * `allowAutoFrame` did not catch it because it is about where the RESULT
     * came from, not about what the reader has done since. A zip-driven
     * result keeps `allowAutoFrame` true for as long as it is on screen, so
     * every pan inside that window was living on borrowed time: the venues
     * array only had to change once — a refresh, a filter, a late arrival —
     * to re-arm a timer that then yanked the camera home.
     *
     * So the gate is the READER's own hand. Once they pan or zoom, no
     * automatic reframe may move the camera again until a new explicit action
     * justifies it — a zip change, a search result, a card opening — each of
     * which clears the flag where it is raised, in `camera`/`focus`.
     */
    if (userMovedRef.current) return;

    // Let the fly-to land before overriding where it went.
    const timer = window.setTimeout(() => {
      // Re-checked INSIDE the timer as well as before it. The whole defect
      // lives in the 2.8 s gap: the reader's pan almost always happens after
      // the effect ran and before the callback fires, and a guard that only
      // runs at scheduling time cannot see it.
      if (userMovedRef.current) return;
      if (!frameAllVenues) {
        const anyVisible = venues.some((venue) =>
          map.getBounds().contains([venue.lng, venue.lat]),
        );
        if (anyVisible) return;
      }

      const bounds = new LngLatBounds();
      bounds.extend([camera.lng, camera.lat]);
      for (const venue of venues) bounds.extend([venue.lng, venue.lat]);

      map.fitBounds(bounds, {
        padding: { top: 96, bottom: 128, left: 64, right: 64 },
        maxZoom: METRO_ZOOM,
        duration: prefersReducedMotion() ? 0 : 1400,
      });
    }, 2800);

    return () => window.clearTimeout(timer);
  }, [venues, camera, frameAllVenues, allowAutoFrame]);

  // The inner div is the MapLibre container and gets its size from this
  // wrapper. maplibre-gl.css sets `position: relative` on `.maplibregl-map`
  // with the same specificity as a Tailwind utility, and loads after it — so
  // positioning the container itself collapses it to zero height.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="size-full" />
      {/* g3 item 10 (M91): the mute-and-blur half of the state extrusion.
          Inside the wrapper so it sits over the canvas; `pointer-events:
          none` keeps the map underneath fully draggable. */}
      {/*
        SUSPENDED WHILE A FULL-SCREEN OVERLAY IS OPEN (g5 item 2).

        The author opened the meetings panel at 85701 and got a header reading
        "86 meetings" above an empty box; moving the mouse over it made the
        rows appear. A phone has no hover, so a mobile reader taps meetings,
        sees a count above nothing, and concludes we hold nothing — a stated-N
        versus rendered-rows violation produced by a paint bug.

        Measured on production rather than guessed at. The DOM and the layout
        were always complete: the panel's group headers were present, at real
        coordinates, with counts summing to the header's own number. What was
        missing was PIXELS, and the missing subset varied run to run — the
        signature of a compositor that never painted a layer rather than of a
        component that never rendered.

        The cause is item 1, one layer down. This scrim carries
        `backdrop-filter`, and while its clip was being dropped it covered the
        entire viewport; the list overlay carries a `backdrop-filter` of its
        own and stacks directly on top of it, over the map's WebGL canvas.
        Two backdrop surfaces deep, Chromium did not paint the upper one's
        contents until something dirtied the layer — which a pointer move is.
        With the scrim removed first and nothing else changed, the panel
        painted; with it present, the panel's own ground never did (header
        luminance 25 against 16 at 1280px, and 26 against 10 at 390px).

        Item 1's fix is therefore most of item 2's — but only while the reader
        is INSIDE the active state. Pan into New Mexico with Arizona active
        and a full-viewport scrim is correct and back, and the panel would go
        blank again. So the suspension is the rule and not the workaround: a
        reader looking at a modal cannot see the map through it, the scrim has
        nothing to say to them while it is open, and the one thing it can
        still do is cost them the content they opened.

        Removing the overlay's own `backdrop-filter` was tried first and
        measured: 0 of 4 at 390px, no better than the control. It is not the
        upper surface that has to go.
      */}
      {overlayOpen ? null : (
      <StateFocusOverlay
        outline={focusOutline}
        project={projectFn}
        subscribe={subscribeMove}
        zoomOf={zoomOf}
        // The rise stands on the basemap, so its light and shade are sized
        // against that ground — see riseAlphasFor.
        theme={theme === "light" ? "light" : "dark"}
      />
      )}
    </div>
  );
}
