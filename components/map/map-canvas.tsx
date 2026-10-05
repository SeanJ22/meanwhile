"use client";

// VOT-1: the ring is drawn at the radius the panel sorts by, so the picture
// and the list can never disagree about what "near" means.
import { NEARBY_RADIUS_MILES } from "@/lib/ballot/voting-sites";

// MapLibre 6 dropped its default export; everything is named now.
import {
  addProtocol,
  AttributionControl,
  LngLatBounds,
  MapLibreMap,
  Marker,
  prewarm,
  setWorkerUrl,
  type ErrorEvent as MapErrorEvent,
  type MapMouseEvent,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import { startMap } from "@/lib/map/start-map";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { holdMapPresentation, releaseMapPresentation, mapPresentationHeld, setPresentationVisible } from "@/lib/map/flight-presentation";
import { detectRaster } from "@/components/map/raster-capability";
import flightStyles from "./map-flight.module.css";
type ProjectPoint = (point: [number, number]) => { x: number; y: number };

import {
  CONUS_BOUNDS,
  FALLBACK_STYLE,
  METRO_ZOOM,
  resolveBasemap,
} from "@/lib/map/style";
import { initialZoomForZip } from "@/lib/map/initial-zoom";
import { recallCamera, rememberCamera } from "@/lib/map/camera-memory";
import { viewportRadiusKm } from "@/lib/map/viewport-radius";
import {
  DISTRICT_TYPES,
  NATIONAL_BOUNDARIES_SOURCE,
  BOUNDARY_ARCHIVE_URL,
  BOUNDARY_ARCHIVE_FALLBACK,
  boundarySource,
  withDistricts,
  preserveDistrictStyle,
  addDistrictLayer,
  boundsOfDistrict,
  fullBoundsOfDistrict,
  districtLayerPresent,
  districtsAt,
  drawnDistrictsOn,
  onSettledDistrictChange,
  removeDistrictLayer,
  setNarrowedDistricts,
  setSelectedDistrict,
  type DistrictHit,
  type DrawnDistrict,
} from "@/lib/map/districts";
import {
  filterStateAbbr,
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
  onPresentationReadyChange?: (ready: boolean) => void;
  /**
   * **EVERY venue the DATA contains** — P-001, 2026-08-24.
   *
   * Not the filtered list. `lib/map/marker-pool.ts` says in its own header
   * that filtering "changes which are VISIBLE, never which exist", and the
   * wiring here made that false: `map-entry` passed the filtered venues in,
   * so a filter that narrowed 500 pins to 480 arrived as twenty venues the
   * data no longer had, and `rebuildMarkerPool` destroyed their markers —
   * then rebuilt them when the filter was reversed. The optimisation was
   * documented and bypassed, which is the chromium-pin shape.
   *
   * This drives the POOL. {@link MapCanvasProps.visibleVenueKeys} drives what
   * is shown, and the two are separate effects.
   */
  venues: Venue[];
  /**
   * The keys the current filters leave visible — P-001.
   *
   * A subset of `venues` by construction. Passing `null` means "no filter is
   * narrowing anything", and every venue in the pool is shown.
   */
  visibleVenueKeys?: ReadonlySet<string> | null;
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
  /**
   * **F01 10.3 (2026-08-19)** — how much of the map’s left edge is covered by
   * the floating rail, in CSS pixels. 0 when the rail is hidden.
   *
   * The canvas is now FULL-BLEED and the rail floats over it, which is what
   * removed the dead column under the rail. That would have moved every
   * framing decision half a rail to the left, so the number is handed to
   * MapLibre as camera PADDING: `flyTo`, `jumpTo` and `fitBounds` all honour
   * it, so a zip centroid still lands in the middle of what the reader can
   * actually SEE rather than in the middle of what is painted.
   */
  leftInset?: number;
  /**
   * The unobstructed map area (approved reader design, DESIGN-SPEC §5): clear
   * of the sidebar, the collapsed header, the selection pill and the phone
   * sheet. When present it replaces `leftInset` as the camera padding, so a
   * boundary fit lands where the reader can see it, and it refits when this
   * area changes.
   */
  insets?: { top: number; right: number; bottom: number; left: number };
  /** Bumped by "Fit boundary": re-fit the selected district. */
  fitNonce?: number;
  onSelectVenue: (venue: Venue) => void;
  onTileError: () => void;
  /**
   * **The basemap is drawing again** (`VF02`, NJ Hunt 6).
   *
   * `onTileError` had no counterpart, so the notice it raises was a one-way
   * door: one transient error — a single tile 404, a glyph range that timed
   * out, a worker that died with an empty message — latched *Basemap
   * unavailable* over a map that then loaded perfectly and kept drawing for the
   * rest of the session.
   *
   * That is why 371 walk checks and every DOM assertion were content while a
   * capture showed the notice: nothing was broken by the time anything looked,
   * and the notice was a fact about a moment that had passed.
   */
  onTilesRecovered?: () => void;
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
  /**
   * **VOT-1: the point the reader's typed address resolved to.**
   *
   * Only the POINT ever reaches the map. The address itself never leaves the
   * panel — it is the reader's home, and the resolved point is the answer they
   * asked to see.
   */
  votingAddressPoint?: { lat: number; lng: number } | null;
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


/**
 * The theme the page is painted in, read from the attribute `app/layout.tsx`
 * sets before first paint and `useStoredTheme` keeps current.
 *
 * The `theme` prop is "dark" for the hydration pass whatever the reader saved,
 * so a light-theme reader's map was built with the dark style and swapped to the
 * light one a moment later — two MapTiler styles, sprites and all, on every
 * load. The document attribute is right from the first paint, so the map is
 * built with, and only ever swapped to, the style the reader actually sees.
 */
function documentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function MapCanvas({
  onPresentationReadyChange,
  venues,
  visibleVenueKeys = null,
  camera,
  focus,
  selectedVenueKey,
  frameAllVenues,
  districtTypes,
  selectedDistrict,
  narrowedDistricts,
  theme,
  leftInset = 0,
  insets,
  fitNonce = 0,
  onDistrictError,
  onDrawnDistricts,
  onDistrictClick,
  onSelectVenue,
  onTileError,
  onTilesRecovered,
  onViewportSettle,
  allowAutoFrame,
  focusStateOcdId = null,
  votingSites,
  votingAddressPoint = null,
  onSelectVotingSite,
  selectedVotingSiteId = null,
}: MapCanvasProps) {
  const [presentationReady, setPresentationReady] = useState(false);
  const [graphicsUnavailable, setGraphicsUnavailable] = useState(false);
  const presentationCallbackRef = useRef(onPresentationReadyChange);
  useEffect(() => { presentationCallbackRef.current = onPresentationReadyChange; }, [onPresentationReadyChange]);
  const containerRef = useRef<HTMLDivElement>(null);
  /** The motion attribute hides map markers while camera presentation is held. */
  const shellRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // The style currently applied to the map. Seeded with the one the mount
  // effect builds with, so the restyle effect below never re-applies it — see
  // the note there about Strict Mode.
  const appliedStyleRef = useRef<string | null>(null);
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
  const focusOcdRef = useRef<string | null>(focusStateOcdId ?? null);
  useEffect(() => {
    focusOcdRef.current = focusStateOcdId ?? null;
  }, [focusStateOcdId]);

  const attachingDistrictsRef = useRef(false);
  const ensureDistricts = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()?.layers?.length || attachingDistrictsRef.current) return;
    // addSource/addLayer synchronously emit styledata. Do not re-enter midway
    // through attaching the shared source and its layers.
    attachingDistrictsRef.current = true;
    try {

    const wanted = districtTypesRef.current;

    // Drop what is no longer asked for, before adding what is.
    for (const type of DISTRICT_TYPES) {
      if (!wanted.includes(type) && districtLayerPresent(map, type)) {
        removeDistrictLayer(map, type);
      }
    }

    for (const type of wanted) {
      try { addDistrictLayer(map, type); }
      catch { onDistrictErrorRef.current(); }
    }
    } finally { attachingDistrictsRef.current = false; }
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
    addProtocol("pmtiles", new Protocol().tile);

    // MapLibre shares one worker pool across all maps and tears it down when
    // the last map is removed. React Strict Mode mounts, cleans up, then mounts
    // again, so the second map would inherit a disposed pool. prewarm() takes a
    // reference so map.remove() cannot dispose it. Must follow setWorkerUrl and
    // precede the first map.
    prewarm();

    // No key means nothing to draw. Fall through to the plain ground colour and
    // say so, rather than substituting another provider — a silent swap turns a
    // total rendering failure into something that looks like a styling choice.
    const basemap = resolveBasemap(documentTheme());
    appliedStyleRef.current = basemap?.styleUrl ?? null;
    if (!basemap) onTileError();

    /*
     * **BAL-9 (2026-08-24): open where the reader last was, not at the
     * continent.**
     *
     * `bounds: CONUS_BOUNDS` is what the author photographed on `12-19-41`
     * after pressing back — the whole country, while the rail still read
     * "Meetings near 85701". Every mount started there, and returning from
     * another route is a fresh mount.
     *
     * CONUS remains the answer for a reader with no remembered camera, which
     * is every first visit. See `lib/map/camera-memory.ts` for why this is a
     * separate store from the zip and why it is not history state.
     */
    const remembered = recallCamera();

    const container = containerRef.current;
    const map = startMap(() => new MapLibreMap({
      container,
      // Districts start without any dependency on the basemap provider.
      style: withDistricts(FALLBACK_STYLE, districtTypesRef.current),
      ...(camera
        ? { center: [camera.lng, camera.lat] as [number, number], zoom: initialZoomForZip(camera.zip) }
        : remembered
        ? {
            center: [remembered.lng, remembered.lat] as [number, number],
            zoom: remembered.zoom,
          }
        : { bounds: CONUS_BOUNDS }),
      fitBoundsOptions: { padding: 24, duration: 0 },
      // Added explicitly below so it lands bottom right, clear of the coverage
      // notices in the bottom-left corner.
      attributionControl: false,
      // The entry notice sits over the map; spinning it adds nothing.
      pitchWithRotate: false,
      dragRotate: false,
    }));
    if (!map) {
      const frame = window.requestAnimationFrame(() => {
        setGraphicsUnavailable(true);
        setPresentationReady(true);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    holdMapPresentation(map);

    // The legend owns the bottom-right corner (Edia puts it there and the port
    // keeps it), so the map's own controls move out of its way rather than
    // stacking on top of it.
    // Approved reader design (2026-09-28): no +/− buttons. Zoom stays fully
    // operable — wheel/trackpad, pinch, double-click, and the keyboard
    // (+ / − / arrows) on the focusable map canvas, which is labelled below.
    map.getCanvas().setAttribute(
      "aria-label",
      "Map. Use plus and minus to zoom, arrow keys to pan.",
    );
    map.addControl(new AttributionControl({ compact: true }), "bottom-left");

    // A failed style request would otherwise leave a blank screen with a
    // working UI drawn on nothing. Drop to a plain ground color instead, so
    // pins and panels stay usable, and tell the caller to say what happened.
    let boundaryFallback = false;
    map.on("error", (event: MapErrorEvent) => {
      const message = event.error?.message ?? "";

      // Log everything. Filtering before logging is what hid this class of bug
      // for hours: an unrecognised message — "Failed to fetch", a worker that
      // died with an empty string — was dropped on the floor and the map just
      // sat there looking like a design choice. Only the *display* of a notice
      // is filtered, and only to the categories a reader can act on.
      console.error("[map]", message || event.error || event);

      if ((event as MapErrorEvent & { sourceId?: string }).sourceId === NATIONAL_BOUNDARIES_SOURCE) {
        const source = map.getSource(NATIONAL_BOUNDARIES_SOURCE) as { setUrl?: (url: string) => void } | undefined;
        if (!boundaryFallback && BOUNDARY_ARCHIVE_URL !== BOUNDARY_ARCHIVE_FALLBACK && source?.setUrl) {
          boundaryFallback = true;
          source.setUrl(boundarySource(BOUNDARY_ARCHIVE_FALLBACK).url!);
        } else onDistrictErrorRef.current();
        return;
      }

      onTileError();
      // Keep the usable style and boundary tiles. Resetting on each tile error
      // discards them and can recursively restart the same failing requests.
    });

    /**
     * **And the way back** (`VF02`). The notice states a present-tense fact
     * about the reader's screen — *the basemap is unavailable* — so it may only
     * stand while that is true. A map that has gone idle with a real style
     * loaded is a map that is drawing, and the reader can see that it is; the
     * notice contradicting their own eyes is worse than no notice at all.
     *
     * `idle` rather than `load`: it fires every time the map comes to rest, so
     * a recovery after the first paint is caught too, which is the common case
     * — the failing request is usually a glyph range fetched when a label first
     * comes into view.
     */
    map.on("idle", () => {
      if (!map.isStyleLoaded()) return;
      // The fallback draws ground colour and nothing else. Recovering INTO it
      // would clear the notice while the reader still has no basemap.
      const layers = map.getStyle()?.layers ?? [];
      if (!layers.some(layer => layer.type !== "background" && !layer.id.startsWith("district-"))) return;
      onTilesRecovered?.();
    });

    /*
     * **A read-only handle for the walk** (`VF02`, NJ Hunt 6).
     *
     * `pnpm walk:all` needs to answer "is a real basemap drawing, or is this
     * the plain-ground fallback?", and that question has no answer in the DOM —
     * which is exactly why a broken basemap was invisible to 371 checks and
     * every DOM assertion. The style's layer count answers it, and the style
     * lives inside the MapLibre instance.
     *
     * Deliberately the instance itself rather than a snapshot: a snapshot goes
     * stale the moment the theme swaps the style, and a stale reading is how a
     * check starts passing about a map that is no longer on screen. Nothing in
     * the app reads this, and it grants a page script nothing it could not
     * already reach through the canvas.
     */
    (window as unknown as { __wtpMap?: MapLibreMap }).__wtpMap = map;

    mapRef.current = map;
    const pool = poolRef.current;

    // Standing invariant: any time the style changes — including the initial
    // load and every theme swap — put the district overlay back if it is wanted
    // and missing. See ensureDistricts for why this is not a one-shot.
    map.on("styledata", ensureDistricts);
    map.once("style.load", () => {
      ensureDistricts();
      if (basemap) map.setStyle(basemap.styleUrl, { transformStyle: preserveDistrictStyle });
    });

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
    /*
     * Restore the 2026-09-01 scoping (db727666): the motion hold hides NOTHING
     * on a GPU. V94 (8f37c059) made this unconditional on every renderer, which
     * is what blanked the district lines, the meeting pins and the who-governs
     * card on every wheel-zoom and pan for EVERY reader — trading a real
     * software-rasteriser win (the fly-in slideshow, measured at 28.8% of a bare
     * map) for a defect on the hardware the overwhelming majority of readers
     * have.
     *
     * So the hold — hiding the district/relief/voting layers and the DOM
     * markers, and reporting the map surface not-ready — runs ONLY on a
     * positively-identified CPU rasteriser (SwiftShader, llvmpipe, …). On
     * hardware and on an unreadable ("unknown") renderer it is a no-op: MapLibre
     * lays out its own layers and the DOM markers track the camera natively
     * there, which is exactly what the CPU rasteriser is too slow to do (see
     * components/map/raster-capability.ts). The reading runs ONCE per map, never
     * per frame. The mount-time hold (above) and its first-idle reveal are
     * separate and still unconditional, so every renderer still reveals its
     * overlays once the first style has drawn.
     */
    const degradeInMotion = detectRaster().kind === "software";
    const enterMotionDegrade = () => {
      if (!degradeInMotion) return;
      holdMapPresentation(map);
      shellRef.current?.setAttribute("data-camera-moving", "1");
      setPresentationVisible(map, false);
      setPresentationReady(false);
      presentationCallbackRef.current?.(false);
    };
    const onPresentationIdle = () => {
      if (map.isMoving() || !mapPresentationHeld(map)) return;
      releaseMapPresentation(map);
      setPresentationVisible(map, true);
      shellRef.current?.removeAttribute("data-camera-moving");
      ensureDistricts();
      setPresentationReady(true);
      presentationCallbackRef.current?.(true);
    };
    map.on("idle", onPresentationIdle);
    const onBoundaryData = (event: { sourceId?: string; sourceDataType?: string }) => {
      // A first usable boundary tile is enough. Waiting for every tile and
      // basemap/glyph idle kept both lines and their count hidden for seconds.
      if (event.sourceId === NATIONAL_BOUNDARIES_SOURCE && event.sourceDataType === "content") onPresentationIdle();
    };
    map.on("sourcedata", onBoundaryData);

    let userMoved = false;
    let settleTimer: number | undefined;
    const onMoveStart = (event: { originalEvent?: unknown }) => {
      enterMotionDegrade();
      if (event.originalEvent) {
        userMoved = true;
        // g4 item 5: the reader has taken the camera. It stays theirs until
        // an explicit action hands it back — see the auto-frame effect.
        userMovedRef.current = true;
      }
      window.clearTimeout(settleTimer);
    };
    const onMoveEnd = () => {
      /*
       * **BAL-9, SECOND PASS (2026-08-25) — THE GATE WAS WHY THE FIX DID NOT
       * WORK.**
       *
       * `camera-memory.ts` was built correctly and restores correctly, and the
       * author still got the continent back the next morning. The reason is
       * six lines above this one, in this file's own words: *a user gesture is
       * the only thing that carries an `originalEvent` on movestart — flyTo,
       * jumpTo and fitBounds never do.*
       *
       * Entering a zip flies the camera PROGRAMMATICALLY. So on the entry path
       * — type a zip, look at the ballot, press back — `userMoved` was never
       * true, nothing was ever remembered, `recallCamera()` returned null, and
       * the map fell back to `CONUS_BOUNDS`. The fix worked only for a reader
       * who happened to pan or pinch first.
       *
       * **A FLY-TO'S END IS A DELIBERATE ARRIVAL TOO.** The original reasoning
       * — a settle is an arrival, a frame of an animation is not — is right,
       * and it argues for ignoring the FRAMES rather than the destination. The
       * debounce already handles the frames. Where the app put the reader is
       * exactly where the reader was.
       *
       * So the camera is remembered on ANY settled arrival. The gesture gate
       * stays on `onViewportSettle` below, which is a different question: that
       * one re-queries the server, and firing it on our own camera moves would
       * be a query loop.
       */
      // Movement ending does not imply tiles have settled; idle owns reveal.
      const wasUserMove = userMoved;
      userMoved = false;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        // wrap(): a map panned past the antimeridian reports longitudes
        // outside [-180, 180], which the API rejects with a 400 — the one
        // settle-only failure a client can manufacture on its own (2a).
        const center = map.getCenter().wrap();
        const bounds = map.getBounds();
        /*
         * BAL-9: the reader moved the camera and it came to rest. THIS is the
         * moment worth remembering — a settle is a deliberate arrival, where
         * every frame of a fly-to is not, and writing on every frame would
         * store wherever an animation happened to be interrupted.
         */
        rememberCamera({
          lat: center.lat,
          lng: center.lng,
          zoom: map.getZoom(),
        });
        /*
         * The gesture gate lives HERE and only here. A re-query on our own
         * camera move is a loop: the answer moves the camera, the camera asks
         * again. BAL-9 needed the camera REMEMBERED on every arrival; it never
         * needed the server asked again.
         */
        if (!wasUserMove) return;
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
          districtState: "national",
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
      map.off("idle", onPresentationIdle);
      map.off("sourcedata", onBoundaryData);
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      map.off("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      map.off("styledata", ensureDistricts);
      map.remove();
      // A removed map left on `window` is a handle the walk would read a style
      // off after the instance was disposed — a stale reading, which is the one
      // failure mode a check like this must not have.
      delete (window as unknown as { __wtpMap?: MapLibreMap }).__wtpMap;
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
    if (!map || !camera || !presentationReady) return;

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
  }, [camera, presentationReady]);

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
    if (!map || mapPresentationHeld(map)) return;
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
  }, [votingSites, presentationReady]);

  /*
   * **VOT-1 (2026-08-25) — THE TEN-MILE RING AROUND THE ENTERED ADDRESS.**
   *
   * Sean: *"Draw a roughly 10-mile radius on the map around the entered
   * address and surface the closest locations first, keeping the full county
   * list available."* The ring is the half a reader can SEE: the list is sorted
   * nearest-first in the panel, and the ring says what "near" means on this map
   * at this zoom without anybody having to read a number.
   *
   * **It is a boundary drawn for orientation and it is never a filter.** Every
   * county site stays in the list, pinned and reachable, inside the ring and
   * out — which is Sean's own first clause and the thing the ring is most
   * likely to be mistaken for.
   *
   * Drawn as a GeoJSON polygon rather than a circle-radius paint property,
   * because a `circle-radius` is in SCREEN PIXELS: it would stay the same size
   * on screen as the reader zooms, so it would describe ten miles at exactly
   * one zoom level and lie at every other. A projected polygon is ten miles on
   * the ground at all of them.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const SOURCE = "voting-address-ring";
    const FILL = "voting-address-ring-fill";
    const LINE = "voting-address-ring-line";
    if (mapPresentationHeld(map)) return;

    const clear = () => {
      if (map.getLayer(LINE)) map.removeLayer(LINE);
      if (map.getLayer(FILL)) map.removeLayer(FILL);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };

    if (!votingAddressPoint) {
      clear();
      return;
    }

    const { lat, lng } = votingAddressPoint;
    const STEPS = 96;
    const milesPerDegLat = 69.0;
    const milesPerDegLng = Math.max(0.0001, 69.172 * Math.cos((lat * Math.PI) / 180));
    const ring: [number, number][] = [];
    for (let i = 0; i <= STEPS; i += 1) {
      const angle = (i / STEPS) * 2 * Math.PI;
      ring.push([
        lng + (NEARBY_RADIUS_MILES / milesPerDegLng) * Math.cos(angle),
        lat + (NEARBY_RADIUS_MILES / milesPerDegLat) * Math.sin(angle),
      ]);
    }

    const data = {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [ring] },
    };

    const existing = map.getSource(SOURCE) as { setData?: (d: unknown) => void } | undefined;
    if (existing?.setData) {
      existing.setData(data);
      return;
    }

    try {
      map.addSource(SOURCE, { type: "geojson", data });
      map.addLayer({
        id: FILL,
        type: "fill",
        source: SOURCE,
        paint: { "fill-color": "#7c5cff", "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: LINE,
        type: "line",
        source: SOURCE,
        paint: {
          "line-color": "#7c5cff",
          "line-width": 1.25,
          "line-opacity": 0.5,
          "line-dasharray": [3, 3],
        },
      });
    } catch {
      // The style is not ready. The ring is orientation, never data — a map
      // without it is still correct, so this never becomes a thrown error on
      // a surface whose job is to answer where somebody votes.
    }

    // Retain the hidden ring during motion; update it after the idle reveal.
  }, [votingAddressPoint, presentationReady]);

  // Selection is a data attribute on the element, so it survives re-renders.
  useEffect(() => {
    for (const [id, marker] of votePinsRef.current) {
      marker.getElement().dataset.selected = String(id === selectedVotingSiteId);
    }
  }, [selectedVotingSiteId, votingSites]);

  /*
   * F01 10.3 — the rail covers part of the canvas, and the camera knows it.
   *
   * `setPadding` is persistent: every subsequent flyTo, jumpTo and fitBounds
   * honours it without a single call site being touched, which is exactly why
   * it is used instead of threading a padding object through the three of them
   * (and through the next one somebody adds).
   *
   * It runs on every change and once at mount, and it does NOT animate: a
   * padding change is a correction to the frame, not a journey, and animating
   * it would slide the map sideways every time the reader opened the rail.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setPadding(
      insets ?? { top: 0, bottom: 0, left: leftInset, right: 0 },
      { duration: 0 },
    );
  }, [leftInset, insets]);

  const cameraMapRef = useRef<MapLibreMap | null>(null);

  // The initial ZIP must land immediately. An animated arrival can be stopped
  // by hydration's layout/padding updates, leaving the camera at its old place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;

    // An explicit request to be moved hands the camera back (g4 item 5).
    userMovedRef.current = false;

    const options = {
      center: [camera.lng, camera.lat] as [number, number],
      zoom: initialZoomForZip(camera.zip),
    };

    if (cameraMapRef.current !== map || prefersReducedMotion()) {
      map.jumpTo(options);
    } else {
      map.flyTo({ ...options, duration: 350, essential: true, curve: 1.5 });
    }
    cameraMapRef.current = map;
  }, [camera]);

  /*
   * Reconcile the marker pool against the venues the data contains.
   *
   * Markers are created once and reused. This effect runs when the *data*
   * changes; a filter that merely narrows what is shown goes through
   * applyVisibility below and touches only the pins whose visibility actually
   * changed. Separating the two is the whole point of the pool — see
   * lib/map/marker-pool.ts.
   *
   * **P-001, 2026-08-24: the separation is now real.** The sentence above was
   * true of the pool and false of this component, because `venues` arrived
   * already filtered. This effect depends on the DATA list and does no
   * visibility work at all; the visibility effect below owns that and depends
   * on the filtered keys, so a filter change cannot reach `rebuildMarkerPool`.
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
    if (mapPresentationHeld(map)) return;
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
    /*
     * **P-001: it counts the VISIBLE pins, not the pool.**
     *
     * Its own sentence above is "how many pins are you showing". While
     * `venues` was the filtered list those were the same number; now that the
     * pool holds every venue in the data they are not, and returning the pool
     * size would quietly change what `pnpm walk:all`'s zoom-out check is
     * asserting. It reads the elements, because visibility is a data
     * attribute on them and that is the thing a reader can actually see.
     */
    (window as unknown as { __wtpPinCount?: () => number }).__wtpPinCount = () =>
      [...poolRef.current.entries.values()].filter(
        (entry) => entry.element.dataset.hidden !== "true",
      ).length;
  }, [venues, presentationReady]);

  /*
   * **P-001 · VISIBILITY IS ITS OWN EFFECT, WITH ITS OWN DEPENDENCY.**
   *
   * This is the half that makes the pool's design work. It depends on the
   * filtered KEYS and never on the venue objects, so a filter keystroke runs
   * this and nothing else: `applyVisibility` touches only the pins whose
   * visibility actually changed — twenty writes on a 500-to-480 filter, which
   * is the number the pool's header has claimed since it was written and
   * which `tests/marker-pool-ops.test.ts` now asserts.
   *
   * A null `visibleVenueKeys` means nothing is narrowing, so everything in
   * the pool is shown. That is the honest default rather than an empty set,
   * which would hide every pin on a caller that has not opted in.
   */
  useEffect(() => {
    if (!mapRef.current || mapPresentationHeld(mapRef.current)) return;
    applyVisibility(
      poolRef.current,
      visibleVenueKeys ? new Set(visibleVenueKeys) : new Set(venues.map((v) => v.key)),
    );
  }, [venues, visibleVenueKeys, presentationReady]);

  // Swap the basemap when the theme changes. The listener above puts the
  // districts back once the new style lands.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const basemap = resolveBasemap(documentTheme());
    if (!basemap) return;

    // Keyed on the style actually applied, not on a "skip the first run" flag.
    // Strict Mode re-invokes effects against the same component instance, so a
    // first-run flag reads as already-spent on the second pass and fires a
    // setStyle while the initial style is still loading — which wedges the
    // renderer. Comparing URLs makes this idempotent under any number of runs.
    if (appliedStyleRef.current === basemap.styleUrl) return;
    appliedStyleRef.current = basemap.styleUrl;

    map.setStyle(basemap.styleUrl, { transformStyle: preserveDistrictStyle });
  }, [theme]);

  // National boundaries depend on the chosen kinds, never an active state.
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

    /*
     * **MAP-2 (2026-08-25) — WHATEVER THE READER CLICKED BECOMES FRONT AND
     * CENTRE.**
     *
     * Sean: *"clicking a shaded area renders it off-center. The map moves to
     * center the selected area."* On `17-25-38` the Vail Unified polygon sits
     * in the bottom-right corner with most of it off screen — the shading is
     * correct and the reader still cannot see the thing they just asked about.
     *
     * **This is an EXPLICIT reader action, so it is allowed to move the
     * camera**, and that distinction is the whole reason it is safe here. The
     * g4 item 5 defect was an AUTOMATIC reframe on a timer dragging a reader
     * back after they had panned away; `userMovedRef` guards that one and is
     * deliberately NOT consulted here. A click is the reader asking, and
     * refusing to move because they panned earlier would be the map ignoring
     * them.
     *
     * A deselect moves nothing: `selectedDistrict` is null, there is nothing to
     * centre on, and yanking the camera when a reader dismisses something is
     * the opposite of what they asked for.
     *
     * Bounds come from what is RENDERED. A district not on screen returns
     * null and the camera stays where it is, rather than flying to a box
     * computed from no geometry.
     */
    if (!selectedDistrict) return;
    const rendered = boundsOfDistrict(map, selectedDistrict.type, selectedDistrict.ocdId);
    // The whole boundary, from the source geometry, when it can be read;
    // the rendered part otherwise.
    let cancelled = false;
    void fullBoundsOfDistrict(map, selectedDistrict.type, selectedDistrict.ocdId).then((full) => {
      if (cancelled) return;
      const box = full ?? rendered;
      if (!box) return;
      map.fitBounds(box, {
        padding: insets ? 24 : { top: 96, bottom: 128, left: 64, right: 64 },
        maxZoom: METRO_ZOOM,
        duration: prefersReducedMotion() ? 0 : 900,
      });
    });
    return () => {
      cancelled = true;
    };
    // With `insets` the camera padding already excludes the sidebar, the
    // header and the pill, so the fit only adds the design's 24px margin.
    // `insets` is read, not a trigger: the refit effect below owns that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDistrict, districtTypes]);

  /*
   * Approved reader design (DESIGN-SPEC §5): the selected boundary REFITS when
   * the unobstructed area changes — a resize, the sidebar opening or closing,
   * the selection pill appearing — and when the reader presses Fit boundary.
   */
  const insetsKey = insets
    ? `${insets.top}|${insets.right}|${insets.bottom}|${insets.left}`
    : "";
  const lastFit = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedDistrict || !insets) return;
    const key = `${selectedDistrict.ocdId}|${insetsKey}|${fitNonce}`;
    if (key === lastFit.current) return;
    const first = lastFit.current === "" || !lastFit.current.startsWith(`${selectedDistrict.ocdId}|`);
    lastFit.current = key;
    // The selection effect above already fits a NEW selection.
    if (first && fitNonce === 0) return;
    const rendered = boundsOfDistrict(map, selectedDistrict.type, selectedDistrict.ocdId);
    let cancelled = false;
    void fullBoundsOfDistrict(map, selectedDistrict.type, selectedDistrict.ocdId).then((full) => {
      const box = full ?? rendered;
      if (cancelled || !box) return;
      map.fitBounds(box, {
        padding: 24,
        maxZoom: METRO_ZOOM,
        duration: prefersReducedMotion() ? 0 : 600,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDistrict, insets, insetsKey, fitNonce]);

  // Narrowed-division shading (item 7): same feature-state mechanism,
  // re-applied on the map's load signals because the boundary layers load
  // asynchronously — the shading appears the moment the polygon does.
  const narrowedRef = useRef(narrowedDistricts ?? []);
  useEffect(() => {
    narrowedRef.current = narrowedDistricts ?? [];
    const map = mapRef.current;
    if (!map) return;

    return onSettledDistrictChange(map, () => {
      const live = mapRef.current;
      if (!live) return;
      setNarrowedDistricts(live, narrowedRef.current);
    });
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

    let previous = "";
    return onSettledDistrictChange(map, () => {
      const live = mapRef.current;
      if (!live) return;
      const drawn = drawnDistrictsOn(live, districtTypesRef.current);
      // Tiles repeat polygons at their edges and can arrive in any order.
      // An unchanged drawn set should not rerender the entire reader shell.
      const signature = JSON.stringify(drawn.map(row => [row.ocdId, row.type, row.label]).sort((a, b) => a[0].localeCompare(b[0])));
      if (signature === previous) return;
      previous = signature;
      onDrawnDistrictsRef.current(drawn);
    });
  }, [districtTypes]);

  /*
   * Selection is a data attribute on the marker element, so it survives
   * re-renders without rebuilding the marker.
   *
   * **P-004, 2026-08-24: `venues` is out of the dependency list.** Selection
   * does not change when the data does — the pool holds the selected key and
   * `applySelection` diffs against it, so re-running on every data change
   * swept the whole pool to re-assert something that had not moved. It stays
   * correct across a rebuild because a newly created marker's
   * `dataset.selected` is unset, and the selected pin is not recreated by a
   * rebuild that keeps it.
   */
  useEffect(() => {
    applySelection(poolRef.current, selectedVenueKey);
  }, [selectedVenueKey]);

  /**
   * Keep the pins in frame.
   *
   * Metro zoom on the centroid is right when the meetings are in the metro.
   * When the cascade widened or fell back to the recent past, they can be an
   * hour's drive away — so frame all of them, along with the centroid, rather
   * than resting on a view with nothing in it.
   */
  /*
   * **P-001 · FRAMING FOLLOWS THE VISIBLE PINS, NOT THE POOL.**
   *
   * `venues` is now every venue the DATA holds, which is right for the marker
   * pool and wrong for a camera: framing a pin the current filter hides would
   * fly the reader to somewhere with nothing on it. `framed` is the filtered
   * subset, and it is computed from the same key set the visibility effect
   * uses so the two cannot disagree about what is on screen.
   */
  const framed = useMemo(
    () =>
      visibleVenueKeys ? venues.filter((v) => visibleVenueKeys.has(v.key)) : venues,
    [venues, visibleVenueKeys],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera || framed.length === 0) return;

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
        const anyVisible = framed.some((venue) =>
          map.getBounds().contains([venue.lng, venue.lat]),
        );
        if (anyVisible) return;
      }

      const bounds = new LngLatBounds();
      bounds.extend([camera.lng, camera.lat]);
      for (const venue of framed) bounds.extend([venue.lng, venue.lat]);

      map.fitBounds(bounds, {
        padding: { top: 96, bottom: 128, left: 64, right: 64 },
        maxZoom: METRO_ZOOM,
        duration: prefersReducedMotion() ? 0 : 1400,
      });
    }, 2800);

    return () => window.clearTimeout(timer);
  }, [framed, camera, frameAllVenues, allowAutoFrame]);

  // The inner div is the MapLibre container and gets its size from this
  // wrapper. maplibre-gl.css sets `position: relative` on `.maplibregl-map`
  // with the same specificity as a Tailwind utility, and loads after it — so
  // positioning the container itself collapses it to zero height.
  return (
    // Marker visibility changes once at motion start and once at idle.
    <div ref={shellRef} className={`absolute inset-0 ${flightStyles.shell}`}>
      <div ref={containerRef} className="size-full" />
      {graphicsUnavailable && (
        <p role="status" className="absolute inset-x-0 bottom-0 p-4 t-body text-voice bg-panel">
          The map can’t show on this device. You can still browse the meeting list.
        </p>
      )}
    </div>
  );
}
