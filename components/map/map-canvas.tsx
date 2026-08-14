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
import { useCallback, useEffect, useRef } from "react";

import {
  CONUS_BOUNDS,
  FALLBACK_STYLE,
  METRO_ZOOM,
  resolveBasemap,
} from "@/lib/map/style";
import { initialZoomForZip } from "@/lib/map/initial-zoom";
import {
  DISTRICT_TYPES,
  addDistrictLayer,
  districtLayerPresent,
  districtsAt,
  drawnDistrictsOn,
  loadDistricts,
  removeDistrictLayer,
  setSelectedDistrict,
  type DistrictHit,
  type DrawnDistrict,
} from "@/lib/map/districts";
import type { DistrictType } from "@/lib/state/types";
import type { Theme } from "@/hooks/use-stored-theme";
import type { Venue } from "@/lib/meetings/venues";
import {
  applySelection,
  applyVisibility,
  createMarkerPool,
  destroyMarkerPool,
  rebuildMarkerPool,
} from "@/lib/map/marker-pool";

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

interface MapCanvasProps {
  venues: Venue[];
  camera: CameraTarget | null;
  focus: MapFocus | null;
  /** The districts currently drawn — the stats card counts this list and
   *  the districts door renders it, one denominator for both (3g). */
  onDrawnDistricts: (districts: DrawnDistrict[]) => void;
  selectedVenueKey: string | null;
  /** District overlays to draw. Empty draws none. */
  districtTypes: DistrictType[];
  /** The district the reader picked, highlighted via feature-state. */
  selectedDistrict: { type: DistrictType; ocdId: string } | null;
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
  onViewportSettle?: (center: { lat: number; lng: number }) => void;
  /**
   * Whether the app may move the camera to frame results. False for a
   * settle-driven result: the reader chose this viewport by hand, and
   * yanking it to fit venues would fight them (2i).
   */
  allowAutoFrame: boolean;
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
  districtTypes,
  selectedDistrict,
  theme,
  onDistrictError,
  onDrawnDistricts,
  onDistrictClick,
  onSelectVenue,
  onTileError,
  onViewportSettle,
  allowAutoFrame,
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

  // Handlers live in a ref so re-renders don't tear down and rebuild markers.
  const onSelectRef = useRef(onSelectVenue);
  useEffect(() => {
    onSelectRef.current = onSelectVenue;
  }, [onSelectVenue]);

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
  const ensureDistricts = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()?.layers?.length) return;

    const wanted = districtTypesRef.current;

    // Drop what is no longer asked for, before adding what is.
    for (const type of DISTRICT_TYPES) {
      if (!wanted.includes(type) && districtLayerPresent(map, type)) {
        removeDistrictLayer(map, type);
      }
    }

    for (const type of wanted) {
      if (districtLayerPresent(map, type)) continue;

      loadDistricts(type)
        .then((data) => {
          // Re-check: the fetch is async and the style may have moved on.
          const live = mapRef.current;
          if (!live) return;
          if (!districtTypesRef.current.includes(type)) return;
          if (!live.getStyle()?.layers?.length) return;
          addDistrictLayer(live, type, data);
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
      const hits = districtsAt(map, event.point, districtTypesRef.current);
      if (hits.length === 0) return;
      onDistrictClickRef.current(hits, { x: event.point.x, y: event.point.y });
    };

    map.on("click", onClick);

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
      if (event.originalEvent) userMoved = true;
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
        onViewportSettleRef.current?.({ lat: center.lat, lng: center.lng });
      }, 650);
    };
    map.on("movestart", onMoveStart);
    map.on("moveend", onMoveEnd);

    return () => {
      window.clearTimeout(settleTimer);
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      map.off("click", onClick);
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

  // Fly to a new center, at the zip's deliberate first-view altitude (6f).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;

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

    rebuildMarkerPool(poolRef.current, map, venues, (venue) =>
      onSelectRef.current(venue),
    );
    applyVisibility(poolRef.current, new Set(venues.map((v) => v.key)));
  }, [venues]);

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
  useEffect(() => {
    ensureDistricts();
  }, [districtTypes, ensureDistricts]);

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

  // A one-off fly-to from search or the list. Separate from `camera`, which is
  // the zip's own centroid and must not move when a reader looks at a result.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;

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

    // Let the fly-to land before overriding where it went.
    const timer = window.setTimeout(() => {
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
    </div>
  );
}
