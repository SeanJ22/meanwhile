"use client";

// MapLibre 6 dropped its default export; everything is named now.
import {
  AttributionControl,
  LngLatBounds,
  MapLibreMap,
  Marker,
  NavigationControl,
  type ErrorEvent as MapErrorEvent,
} from "maplibre-gl";
import { useEffect, useRef } from "react";

import {
  CONUS_BOUNDS,
  FALLBACK_STYLE,
  METRO_ZOOM,
  resolveBasemap,
} from "@/lib/map/style";
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const basemap = resolveBasemap();

    const map = new MapLibreMap({
      container: containerRef.current,
      style: basemap.styleUrl,
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
