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
} from "maplibre-gl";
import { useEffect, useRef } from "react";

import {
  CONUS_BOUNDS,
  FALLBACK_STYLE,
  METRO_ZOOM,
  buildRasterStyle,
  rasterBasemapEnabled,
  resolveBasemap,
} from "@/lib/map/style";
import {
  addDistrictLayers,
  districtLayersPresent,
  loadDistricts,
  removeDistrictLayers,
} from "@/lib/map/districts";
import type { Venue } from "@/lib/meetings/venues";

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

interface MapCanvasProps {
  venues: Venue[];
  camera: CameraTarget | null;
  selectedVenueKey: string | null;
  /** Draw the congressional district overlay. */
  showDistricts: boolean;
  /** The boundary file could not be loaded; the caller says so and disables the toggle. */
  onDistrictError: () => void;
  /**
   * Frame every venue rather than resting at metro zoom on the centroid. Set
   * when the cascade widened or fell back, because the meetings it found can
   * sit an hour's drive outside the zip.
   */
  frameAllVenues: boolean;
  onSelectVenue: (venue: Venue) => void;
  onTileError: () => void;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Marker element for a venue.
 *
 * A button, so it is reachable by keyboard and announced properly — MapLibre
 * will happily mount an unfocusable div and leave the map unusable without a
 * mouse.
 */
function createMarkerElement(venue: Venue): HTMLButtonElement {
  const concluded = venue.meetings.every((m) => m.status === "CONCLUDED");
  const count = venue.meetings.length;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "wtp-pin";
  button.dataset.concluded = String(concluded);
  button.setAttribute(
    "aria-label",
    `${venue.name}, ${count} ${count === 1 ? "meeting" : "meetings"}`,
  );

  const dot = document.createElement("span");
  dot.className = "wtp-pin-dot";
  button.appendChild(dot);

  if (count > 1) {
    const badge = document.createElement("span");
    badge.className = "wtp-pin-count";
    badge.textContent = String(count);
    button.appendChild(badge);
  }

  return button;
}

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
  selectedVenueKey,
  frameAllVenues,
  showDistricts,
  onDistrictError,
  onSelectVenue,
  onTileError,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, Marker>());
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // MapLibre 6 loads its tile-parsing worker as a separate file, resolving
    // the name against its own script URL. Under Turbopack that lands on
    // /_next/static/chunks/maplibre-gl-worker.mjs, but the asset is emitted to
    // /_next/static/media/ under a content-hashed name — so the fetch 404s.
    setWorkerUrl("/maplibre-gl-worker.mjs");

    // MapLibre shares one worker pool across all maps and tears it down when
    // the last map is removed. React Strict Mode mounts, cleans up, then mounts
    // again, so the second map would inherit a disposed pool. prewarm() takes a
    // reference so map.remove() cannot dispose it. Must follow setWorkerUrl and
    // precede the first map.
    prewarm();

    const basemap = resolveBasemap();
    const raster = rasterBasemapEnabled();

    // Raster mode with no key has nothing to draw. Fall through to the plain
    // ground colour and say so, rather than substituting another provider —
    // a silent swap turns a total rendering failure into something that looks
    // like a styling choice.
    const rasterStyle = raster ? buildRasterStyle() : null;
    if (raster && !rasterStyle) onTileError();

    const map = new MapLibreMap({
      container: containerRef.current,
      style: raster ? (rasterStyle ?? FALLBACK_STYLE) : basemap.styleUrl,
      bounds: CONUS_BOUNDS,
      fitBoundsOptions: { padding: 24, duration: 0 },
      // Added explicitly below so it lands bottom right, clear of the coverage
      // notices in the bottom-left corner.
      attributionControl: false,
      // The entry notice sits over the map; spinning it adds nothing.
      pitchWithRotate: false,
      dragRotate: false,
    });

    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.touchZoomRotate.disableRotation();

    // A failed style request would otherwise leave a blank screen with a
    // working UI drawn on nothing. Drop to a plain ground color instead, so
    // pins and panels stay usable, and tell the caller to say what happened.
    map.on("error", (event: MapErrorEvent) => {
      const message = event.error?.message ?? "";
      if (!/style|sprite|glyphs|tile/i.test(message)) return;

      onTileError();
      if (map.getStyle()?.layers?.length !== FALLBACK_STYLE.layers.length) {
        map.setStyle(FALLBACK_STYLE);
      }
    });

    mapRef.current = map;
    const markers = markersRef.current;

    return () => {
      map.remove();
      mapRef.current = null;
      hereRef.current = null;
      markers.clear();
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

  // Fly to a new center.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;

    const options = {
      center: [camera.lng, camera.lat] as [number, number],
      zoom: METRO_ZOOM,
    };

    if (prefersReducedMotion()) {
      map.jumpTo(options);
    } else {
      map.flyTo({ ...options, duration: 2600, essential: true, curve: 1.5 });
    }
  }, [camera]);

  // Reconcile markers against the current venues.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = markersRef.current;
    const wanted = new Set(venues.map((v) => v.key));

    for (const [key, marker] of markers) {
      if (!wanted.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }

    for (const venue of venues) {
      if (markers.has(venue.key)) continue;

      const element = createMarkerElement(venue);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(venue);
      });

      const marker = new Marker({ element, anchor: "center" })
        .setLngLat([venue.lng, venue.lat])
        .addTo(map);

      markers.set(venue.key, marker);
    }
  }, [venues]);

  // The district overlay. Kept out of the mount effect because the file is
  // only fetched when a reader first asks for it — most never will, and it is
  // the largest thing this screen can download.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!showDistricts) {
      if (districtLayersPresent(map)) removeDistrictLayers(map);
      return;
    }

    let cancelled = false;

    // Fetch as soon as the reader asks, independently of the style. Gating the
    // request on map readiness is what made this fail silently before: nothing
    // was requested at all, so even the error path never ran.
    loadDistricts()
      .then((data) => {
        // addLayer needs a loaded style. `load` fires exactly once in a map's
        // lifetime, so waiting on it here stalls forever for anyone toggling
        // after the map settled — which is everyone, because the control starts
        // off. `idle` fires every time rendering comes to rest, so this retries
        // rather than hanging.
        const attach = () => {
          const live = mapRef.current;
          if (cancelled || !live) return;
          if (!live.isStyleLoaded()) {
            live.once("idle", attach);
            return;
          }
          addDistrictLayers(live, data);
        };
        attach();
      })
      .catch(() => {
        if (!cancelled) onDistrictErrorRef.current();
      });

    return () => {
      cancelled = true;
    };
  }, [showDistricts]);

  // Selection is a class on the marker element, so it survives re-renders
  // without rebuilding the marker.
  useEffect(() => {
    for (const [key, marker] of markersRef.current) {
      marker.getElement().dataset.selected = String(key === selectedVenueKey);
    }
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
  }, [venues, camera, frameAllVenues]);

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
