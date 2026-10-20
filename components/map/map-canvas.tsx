"use client";

// The voting ring is drawn at the radius the panel sorts by.
import { readDesignToken } from "@/lib/design/read-token";
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
import { boundaryProtocol } from "@/lib/map/boundary-protocol";
import { startMap } from "@/lib/map/start-map";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { holdMapPresentation, releaseMapPresentation, mapPresentationHeld, setPresentationVisible } from "@/lib/map/flight-presentation";
import { detectRaster } from "@/components/map/raster-capability";
import flightStyles from "./map-flight.module.css";
type ProjectPoint = (point: [number, number]) => { x: number; y: number };

import {
  CONUS_BOUNDS,
  FALLBACK_STYLE,
  basemapStyle,
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
  setDistrictState,
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
  loadStateOutlines,
  stateAbbrFromOcdId,
  stateOcdIdAt,
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

/** Where the map should be looking. A new object means a new fly-to. */
export interface CameraTarget {
  zip: string;
  lat: number;
  lng: number;
}

export interface MapFocus {
  lat: number;
  lng: number;
  zoom?: number;
  key: string;
}

/** The cheap read-only camera probe; see where it is installed. */
interface CameraProbe {
  (): { zoom: number; lat: number; lng: number };
}

import { OfficePinsLayer, isOfficePress } from "./office-pins-layer";
import type { MapBounds, OfficeSite } from "@/lib/map/office-pins";

const NO_OFFICE_SITES: readonly OfficeSite[] = [];

let workersPrepared = false;
/** Download and initialize the map's existing worker pool while the ZIP reads run. */
export function prepareMapWorkers(): void {
  if (workersPrepared) return;
  setWorkerUrl("/maplibre-gl-worker.mjs");
  prewarm();
  workersPrepared = true;
}

interface MapCanvasProps {
  officeSites?: readonly OfficeSite[];
  onSelectOffice?: (id: string) => void;
  selectedOfficeId?: string | null;
  /** The settled view's edges, after every camera move. */
  onBoundsChange?: (bounds: MapBounds) => void;
  onPresentationReadyChange?: (ready: boolean) => void;

  venues: Venue[];
  /** The keys the current filters leave visible, a subset of `venues`. `null` shows every venue. */
  visibleVenueKeys?: ReadonlySet<string> | null;
  camera: CameraTarget | null;
  here: CameraTarget | null;
  focus: MapFocus | null;
  /** The districts drawn; the stats card counts this list and the districts door renders it. */
  onDrawnDistricts: (districts: DrawnDistrict[]) => void;
  selectedVenueKey: string | null;
  /** District overlays to draw. Empty draws none. */
  districtTypes: DistrictType[];
  /** The district the reader picked, highlighted via feature-state. */
  selectedDistrict: { type: DistrictType; ocdId: string } | null;
  /** The reader's narrowed divisions, shaded quieter than a selection via feature-state. */
  narrowedDistricts?: { type: DistrictType; ocdId: string }[];
  /** A click landed in these districts. Always a set — see districtsAt. */
  onDistrictClick: (hits: DistrictHit[], at: { x: number; y: number }) => void;
  /** The boundary file could not be loaded; the caller says so and disables the toggle. */
  onDistrictError: () => void;
  /** Frame every venue rather than resting on the centroid; set for recent meetings. */
  frameAllVenues: boolean;
  /** Basemap follows the UI theme; changing it restyles the map in place. */
  theme: Theme;

  leftInset?: number;

  insets?: { top: number; right: number; bottom: number; left: number };
  /** Bumped by "Fit boundary": re-fit the selected district. */
  fitNonce?: number;
  onSelectVenue: (venue: Venue) => void;
  onTileError: () => void;
  /** The basemap is drawing again after a tile error, so the error notice can clear. */
  onTilesRecovered?: () => void;

  onViewportSettle?: (view: {
    lat: number;
    lng: number;
    /** Half the visible diagonal, so the fetch follows zoom. */
    viewportRadiusKm: number;
  }) => void;
  /** Whether the app may move the camera to frame results. False for a settle-driven result. */
  allowAutoFrame: boolean;
  /** The reader's state OCD-ID, raised out of the map. Null before a zip resolves: nothing raised or muted. */
  focusStateOcdId?: string | null;

  votingSites?: VotingSitePin[];
  /** The point the reader's typed address resolved to; the address never reaches the map. */
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

/** The zip's own centroid — where the reader asked us to look. */
function createHereElement(zipLabel: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "wtp-here";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", `Center of zip code ${zipLabel}`);
  return element;
}

function documentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function MapCanvas({
  onPresentationReadyChange,
  venues,
  visibleVenueKeys = null,
  camera,
  here,
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
  officeSites,
  onSelectOffice,
  selectedOfficeId = null,
  onBoundsChange,
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
  // The style currently applied. Seeded with the mount style; see the restyle effect on Strict Mode.
  const appliedStyleRef = useRef<string | null>(null);
  const poolRef = useRef(createMarkerPool());
  const hereRef = useRef<Marker | null>(null);
  /** Voting-site markers, keyed by site id. Their own set, never the pool. */
  /** The office layer mounts once the map has loaded. */
  const [officeMap, setOfficeMap] = useState<MapLibreMap | null>(null);
  const onBoundsChangeRef = useRef(onBoundsChange);
  useEffect(() => { onBoundsChangeRef.current = onBoundsChange; }, [onBoundsChange]);
  const votePinsRef = useRef(new Map<string, Marker>());

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

  const outlinesRef = useRef<StateOutlines | null>(null);
  useEffect(() => {
    let live = true;
    loadStateOutlines().then(data => { if (live) outlinesRef.current = data; }).catch(() => undefined);
    return () => { live = false; };
  }, []);

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
      try { addDistrictLayer(map, type, stateAbbrFromOcdId(focusOcdRef.current)); }
      catch { onDistrictErrorRef.current(); }
    }
    setDistrictState(map, stateAbbrFromOcdId(focusOcdRef.current));
    } finally { attachingDistrictsRef.current = false; }
  }, []);

  useEffect(() => {
    ensureDistricts();
  }, [focusStateOcdId, ensureDistricts]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // MapLibre 6 resolves its worker URL dynamically, which no bundler emits;
    // scripts/build-map-worker.mjs bundles a copy here. Must precede the first map.
    prepareMapWorkers();
    addProtocol("pmtiles", boundaryProtocol);

    // No key: fall through to the plain ground colour and say so, never another provider.
    const basemap = resolveBasemap(documentTheme());
    appliedStyleRef.current = basemap?.styleUrl ?? null;
    if (!basemap) onTileError();

    /* Open at the remembered camera (`lib/map/camera-memory.ts`); CONUS otherwise. */
    const remembered = recallCamera();

    const container = containerRef.current;
    const map = startMap(() => new MapLibreMap({
      container,
      ...(camera
        ? { center: [camera.lng, camera.lat] as [number, number], zoom: initialZoomForZip(camera.zip) }
        : remembered
        ? {
            center: [remembered.lng, remembered.lat] as [number, number],
            zoom: remembered.zoom,
          }
        : { bounds: CONUS_BOUNDS }),
      fitBoundsOptions: { padding: 24, duration: 0 },
      // Added below, bottom right, clear of the bottom-left notices.
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
      // Labels appear in their first complete frame, including the automatic ZIP fit.
      fadeDuration: 0,
    }));
    if (!map) {
      document.documentElement.dataset.raster = "unknown";
      const frame = window.requestAnimationFrame(() => {
        setGraphicsUnavailable(true);
        setPresentationReady(true);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const raster = detectRaster(map.getCanvas());
    document.documentElement.dataset.raster = raster.kind;
    // A software renderer paints on the CPU. Retain every feature and label
    // while avoiding four canvas pixels per CSS pixel on a 2x display.
    if (raster.kind === "software" && map.getPixelRatio() > 1) map.setPixelRatio(1);

    // Start CPU graphics with its final style, rather than compile a fallback
    // frame and then discard it. The district source remains independent.
    const initialStyle = basemap && raster.kind === "software" ? basemapStyle(basemap, true) : FALLBACK_STYLE;
    if (typeof initialStyle !== "string") map.setStyle(withDistricts(initialStyle, districtTypesRef.current, stateAbbrFromOcdId(focusOcdRef.current)));

    holdMapPresentation(map);

    // No +/− buttons: zoom works by wheel, pinch, double-click and keyboard on the labelled canvas.
    map.getCanvas().setAttribute(
      "aria-label",
      "Map. Use plus and minus to zoom, arrow keys to pan.",
    );
    map.addControl(new AttributionControl({ compact: true }), "bottom-left");

    // A failed style request drops to a plain ground colour so pins and panels stay usable.
    let boundaryFallback = false;
    map.on("error", (event: MapErrorEvent) => {
      const message = event.error?.message ?? "";

      // Log everything; only the displayed notice is filtered to what a reader can act on.
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
      // Keep the usable style; resetting on each tile error restarts the failing requests.
    });

    map.on("idle", () => {
      if (!map.isStyleLoaded()) return;
      // Recovering into the fallback would clear the notice with no basemap.
      const layers = map.getStyle()?.layers ?? [];
      if (!layers.some(layer => layer.type !== "background" && !layer.id.startsWith("district-"))) return;
      onTilesRecovered?.();
    });

    /* Read-only handle for walk checks; nothing in the app reads it. */
    (window as unknown as { __wtpMap?: MapLibreMap }).__wtpMap = map;

    mapRef.current = map;
    const pool = poolRef.current;

    // Put the district overlay back on every style change; see ensureDistricts.
    map.on("styledata", ensureDistricts);
    map.once("style.load", () => {
      ensureDistricts();
      if (basemap && raster.kind !== "software") map.setStyle(basemap.styleUrl, { transformStyle: preserveDistrictStyle });
    });

    /* Click to select a district: one hit selects, several open a picker, none keeps the selection. */
    const onClick = (event: MapMouseEvent) => {
      /* An office pin press is the office layer's own. */
      if (isOfficePress(event.originalEvent)) return;
      /* A press on the map puts a fanned pin group back; pin presses never reach here. */
      clearSpiderfy(pool);

      const clicked = stateOcdIdAt(outlinesRef.current, event.lngLat.lat, event.lngLat.lng);
      if (clicked && clicked !== focusOcdRef.current) {
        map.easeTo({ center: event.lngLat, duration: prefersReducedMotion() ? 0 : 300 }, { originalEvent: event.originalEvent });
        return;
      }
      const hits = districtsAt(map, event.point, districtTypesRef.current);
      if (hits.length === 0) return;
      onDistrictClickRef.current(hits, { x: event.point.x, y: event.point.y });
    };

    map.on("click", onClick);

    /* Escape puts a fanned group back too. */
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") clearSpiderfy(pool);
    };
    window.addEventListener("keydown", onKeyDown);

    const degradeInMotion = raster.kind === "software";
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
      // A first usable boundary tile is enough to reveal.
      if (event.sourceId === NATIONAL_BOUNDARIES_SOURCE && event.sourceDataType === "content") onPresentationIdle();
    };
    map.on("sourcedata", onBoundaryData);

    let userMoved = false;
    let settleTimer: number | undefined;
    const onMoveStart = (event: { originalEvent?: unknown; instant?: boolean }) => {
      if (!event.instant) enterMotionDegrade();
      if (event.originalEvent) {
        userMoved = true;
        // The reader has taken the camera until an explicit action hands it back.
        userMovedRef.current = true;
      }
      window.clearTimeout(settleTimer);
    };
    const onMoveEnd = () => {

      // Movement ending does not imply tiles have settled; idle owns reveal.
      const wasUserMove = userMoved;
      userMoved = false;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        // wrap(): longitudes past the antimeridian make the API return 400.
        const center = map.getCenter().wrap();
        const bounds = map.getBounds();
        rememberCamera({
          lat: center.lat,
          lng: center.lng,
          zoom: map.getZoom(),
        });
        /* Re-querying on our own camera move would loop. */
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
    const reportBounds = () => {
      const bounds = map.getBounds();
      onBoundsChangeRef.current?.({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() });
    };
    map.on("moveend", reportBounds);
    map.once("load", () => {
      reportBounds();
      setOfficeMap(map);
    });

    /* Read-only zoom probe for walk checks; nothing in the app consults it. */
    (window as unknown as { __wtpZoom?: () => number }).__wtpZoom = () =>
      map.getZoom();
    (window as unknown as { __wtpZoomOut?: (by?: number) => void }).__wtpZoomOut = (
      by = 2,
    ) => {
      // With `originalEvent`, so the settle path runs as for a real gesture.
      map.zoomTo(map.getZoom() - by, {}, { originalEvent: new Event("wheel") });
    };

    /* Read-only map and projection probes for walk checks; nothing in the app consults them. */
    // Typed through `ProjectPoint`: the server/client boundary guard reads an
    // indented `name: (args) => Ret` as an injected function prop.
    (window as unknown as { __wtpProject?: ProjectPoint }).__wtpProject = (p) =>
      map.project(p);

    /* Camera only, cheap enough to read every animation frame. Typed through `CameraProbe` for the same guard. */
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
          /** The state the district layers were built for. */
          districtState: "national",
          /** Every district layer currently on the style, by id. */
          districtLayers,
          /** The state each district line layer is filtered to, read back off the map. */
          districtFilterStates: [
            ...new Set(
              districtLayers
                .filter((id) => id.endsWith("-line"))
                .map((id) => filterStateAbbr(map.getFilter(id))),
            ),
          ],
          /** Every custom source on the style; a source can hold geometry after its layers are gone. */
          customSources: Object.keys(map.getStyle()?.sources ?? {}),
          /** Total style layers. */
          layerCount: layers.length,
        };
      };

    /* Read-only probe: which pins are stacked now and where, using the click path's projection. */
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
      map.off("moveend", reportBounds);
      setOfficeMap(null);
      map.remove();
      // A disposed map must not stay readable on `window`.
      delete (window as unknown as { __wtpMap?: MapLibreMap }).__wtpMap;
      mapRef.current = null;
      hereRef.current = null;
      destroyMarkerPool(pool);
    };
    // Mount once. onTileError is stable by construction in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark the zip's centroid.
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!here) {
      hereRef.current?.remove();
      hereRef.current = null;
      return;
    }
    if (!presentationReady) return;

    if (!hereRef.current) {
      hereRef.current = new Marker({
        element: createHereElement(here.zip),
        anchor: "center",
      })
        .setLngLat([here.lng, here.lat])
        .addTo(map);
      return;
    }

    hereRef.current.setLngLat([here.lng, here.lat]);
    hereRef.current
      .getElement()
      .setAttribute("aria-label", `Center of zip code ${here.zip}`);
  }, [here, presentationReady]);

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pins = votePinsRef.current;
    const wanted = new Map((votingSites ?? []).map((s) => [s.id, s]));

    for (const [id, marker] of pins) {
      if (wanted.has(id)) continue;
      marker.remove();
      pins.delete(id);
    }

    if (mapPresentationHeld(map)) return;

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

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const SOURCE = "voting-address-ring";
    const FILL = "voting-address-ring-fill";
    const LINE = "voting-address-ring-line";

    const clear = () => {
      if (map.getLayer(LINE)) map.removeLayer(LINE);
      if (map.getLayer(FILL)) map.removeLayer(FILL);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };

    if (!votingAddressPoint) {
      clear();
      return;
    }

    if (mapPresentationHeld(map)) return;
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
        paint: { "fill-color": readDesignToken("--ask"), "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: LINE,
        type: "line",
        source: SOURCE,
        paint: {
          "line-color": readDesignToken("--ask"),
          "line-width": 1.25,
          "line-opacity": 0.5,
          "line-dasharray": [3, 3],
        },
      });
    } catch {
      // The style is not ready; the map is still correct without the ring.
    }

    // Retain the hidden ring during motion; update it after the idle reveal.
  }, [votingAddressPoint, presentationReady]);

  // Selection is a data attribute on the element, so it survives re-renders.
  useEffect(() => {
    for (const [id, marker] of votePinsRef.current) {
      marker.getElement().dataset.selected = String(id === selectedVotingSiteId);
    }
  }, [selectedVotingSiteId, votingSites]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setPadding(
      insets ?? { top: 0, bottom: 0, left: leftInset, right: 0 },
      { instant: true },
    );
  }, [leftInset, insets]);

  const cameraMapRef = useRef<MapLibreMap | null>(null);

  // The initial ZIP must land immediately. An animated arrival can be stopped
  // by hydration's layout/padding updates, leaving the camera at its old place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;

    // An explicit request to be moved hands the camera back.
    userMovedRef.current = false;

    const options = {
      center: [camera.lng, camera.lat] as [number, number],
      zoom: initialZoomForZip(camera.zip),
    };

    if (cameraMapRef.current !== map || prefersReducedMotion()) {
      map.jumpTo(options, { instant: true });
    } else {
      map.flyTo({ ...options, duration: 350, essential: true, curve: 1.5 });
    }
    cameraMapRef.current = map;
  }, [camera]);

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!venues.length) {
      destroyMarkerPool(poolRef.current);
      return;
    }
    if (mapPresentationHeld(map)) return;
    rebuildMarkerPool(poolRef.current, map, venues, (venue) => {
      const pool = poolRef.current;

      // Already fanned: this press is the reader choosing one of them.
      if (pool.spiderfiedKeys.has(venue.key)) {
        onSelectRef.current(venue);
        return;
      }

      // Projected, not measured off the DOM: an unpainted pin has no box.
      const points = [...pool.entries.values()]
        .filter((entry) => entry.element.dataset.hidden !== "true")
        .map((entry) => {
          const p = map.project([entry.venue.lng, entry.venue.lat]);
          return { key: entry.venue.key, x: p.x, y: p.y };
        });

      const group = findCollisionGroups(points).find((g) => g.includes(venue.key));
      if (!group) {
        // Not in a stack. One fan at a time.
        clearSpiderfy(pool);
        onSelectRef.current(venue);
        return;
      }

      applySpiderfy(pool, fanOffsets(group));
    });
    /* Read-only probe for walk checks: the count of visible pins, not the pool. */
    (window as unknown as { __wtpPinCount?: () => number }).__wtpPinCount = () =>
      [...poolRef.current.entries.values()].filter(
        (entry) => entry.element.dataset.hidden !== "true",
      ).length;
  }, [venues, presentationReady]);

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

    // Keyed on the style applied, not a first-run flag: under Strict Mode a
    // flag fires setStyle while the initial style loads and wedges the renderer.
    if (appliedStyleRef.current === basemap.styleUrl) return;
    appliedStyleRef.current = basemap.styleUrl;

    map.setStyle(basemapStyle(basemap, detectRaster(map.getCanvas()).kind === "software"), { transformStyle: preserveDistrictStyle });
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
      }, { instant: prefersReducedMotion() });
    });
    return () => {
      cancelled = true;
    };
    // With `insets` the camera padding already excludes the chrome; the fit adds a 24px margin.
    // `insets` is read, not a trigger: the refit effect below owns that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDistrict, districtTypes]);

  /* The selected boundary refits when the unobstructed area changes or on Fit boundary. */
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
      }, { instant: prefersReducedMotion() });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDistrict, insets, insetsKey, fitNonce]);

  // Narrowed-division shading, re-applied as boundary layers load.
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

  // A one-off fly-to from search or the list; `camera` stays the zip's centroid.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;

    // An explicit request to be moved hands the camera back.
    userMovedRef.current = false;

    const options = {
      center: [focus.lng, focus.lat] as [number, number],
      zoom: focus.zoom ?? 13,
    };

    if (prefersReducedMotion()) map.jumpTo(options, { instant: true });
    else map.flyTo({ ...options, duration: 900, essential: true });
  }, [focus]);

  // The districts drawn, counted after render settles; feeds the stats card and the districts door.
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

  useEffect(() => {
    applySelection(poolRef.current, selectedVenueKey);
  }, [selectedVenueKey]);

  const framed = useMemo(
    () =>
      visibleVenueKeys ? venues.filter((v) => visibleVenueKeys.has(v.key)) : venues,
    [venues, visibleVenueKeys],
  );

  const framedMapRef = useRef<MapLibreMap | null>(null);
  const framedBoundsRef = useRef("");

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera || framed.length === 0) return;

    // A settle-driven result never moves the camera.
    if (!allowAutoFrame) return;

    /* Once the reader pans or zooms, no automatic reframe until an explicit action clears the flag. */
    if (userMovedRef.current) return;

    const frameVenues = () => {
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

      const signature = `${camera.zip}:${bounds.toArray().flat().join(",")}`;
      if (framedMapRef.current === map && framedBoundsRef.current === signature) return;
      framedMapRef.current = map;
      framedBoundsRef.current = signature;

      map.fitBounds(bounds, {
        padding: { top: 96, bottom: 128, left: 64, right: 64 },
        maxZoom: METRO_ZOOM,
        duration: 0,
      }, { instant: true });
    };

    // Initial ZIP arrival is a jump. Later choices wait for the actual flight,
    // rather than leaving a fixed delay after an already usable camera.
    if (map.isMoving()) map.once("moveend", frameVenues);
    else frameVenues();
    return () => { map.off("moveend", frameVenues); };
  }, [framed, camera, frameAllVenues, allowAutoFrame]);

  // The inner div is the MapLibre container; maplibre-gl.css's `position: relative`
  // would collapse it if positioned directly.
  return (
    // Marker visibility changes once at motion start and once at idle.
    <div ref={shellRef} className={`absolute inset-0 ${flightStyles.shell}`}>
      <div ref={containerRef} className="size-full" />
      {officeMap && (
        <OfficePinsLayer
          map={officeMap}
          sites={officeSites ?? NO_OFFICE_SITES}
          meetingPoints={framed}
          selectedOfficeId={selectedOfficeId}
          onSelect={id => onSelectOffice?.(id)}
        />
      )}
      {graphicsUnavailable && (
        <p role="status" className="absolute inset-x-0 bottom-0 p-4 t-body text-voice bg-panel">
          The map can’t show on this device. You can still browse the meeting list.
        </p>
      )}
    </div>
  );
}
