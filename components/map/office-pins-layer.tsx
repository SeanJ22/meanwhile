"use client";

import { Landmark } from "lucide-react";
import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { clusterOfficeSites, ringBackground, type OfficeCluster } from "@/lib/map/office-clusters";
import { officeAriaLabel, type OfficePin, type OfficeSite } from "@/lib/map/office-pins";
import { COLLISION_RADIUS, OFFICE_FAN, fanRightOffsets } from "@/lib/map/spiderfy";

/** Where an office pin may step, in CSS pixels, when it would cover a meeting pin: the first spot clear of all. */
const MEETING_CLEARANCE: readonly [number, number][] = [[0, 0], [24, 0], [0, -24], [0, 24], [-36, 0], [48, 0]];

/**
 * The reader's representatives' offices as Lumen capsules. Offices whose pins would overlap merge into one count
 * pin with a split tier ring; pressing it fans the offices out to its right. The office layer never enters the
 * meeting pool or its count and filter denominator.
 */
export function OfficePinsLayer({
  map,
  sites,
  meetingPoints,
  selectedOfficeId,
  onSelect,
}: {
  map: MapLibreMap;
  sites: readonly OfficeSite[];
  /** Visible meeting venues: an office pin never covers one. */
  meetingPoints: readonly { lat: number; lng: number }[];
  selectedOfficeId: string | null;
  onSelect: (officeId: string) => void;
}) {
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => { map.off("zoomend", onZoom); };
  }, [map]);
  const clusters = useMemo(
    () => {
      const meetings = meetingPoints.map(point => map.project([point.lng, point.lat]));
      return clusterOfficeSites(sites, site => map.project([site.lng, site.lat])).map(cluster => {
        const at = map.project([cluster.lng, cluster.lat]);
        const clear = ([dx, dy]: readonly [number, number]) =>
          meetings.every(point => Math.hypot(point.x - at.x - dx, point.y - at.y - dy) >= COLLISION_RADIUS);
        return { cluster, offset: MEETING_CLEARANCE.find(clear) ?? MEETING_CLEARANCE[1] };
      });
    },
    // Screen distance between two points changes with zoom only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sites, meetingPoints, map, zoom],
  );
  const touch = useNoHover();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const hubs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!openKey) return;
    /* A press on the map background puts the fan back; presses on office pins never count. */
    const onMapClick = (event: { originalEvent?: Event }) => {
      if (isOfficePress(event.originalEvent)) return;
      setOpenKey(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenKey(null);
      hubs.current.get(openKey)?.focus();
    };
    map.on("click", onMapClick);
    window.addEventListener("keydown", onKey);
    return () => {
      map.off("click", onMapClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [map, openKey]);

  const onHubMount = useCallback((key: string, button: HTMLButtonElement | null) => {
    if (button) hubs.current.set(key, button);
    else hubs.current.delete(key);
  }, []);

  return clusters.map(({ cluster, offset }) => (
    <OfficeMarker
      key={cluster.key}
      map={map}
      cluster={cluster}
      offset={offset}
      open={openKey === cluster.key}
      touch={touch}
      selectedOfficeId={selectedOfficeId}
      onToggle={() => setOpenKey(key => (key === cluster.key ? null : cluster.key))}
      onSelect={onSelect}
      onHubMount={onHubMount}
    />
  ));
}

/** Whether a map event started on an office pin. */
export function isOfficePress(event: Event | undefined): boolean {
  const target = event?.target;
  return target instanceof Element && target.closest(".mw-office-marker") !== null;
}

function OfficeMarker({
  map,
  cluster,
  offset,
  open,
  touch,
  selectedOfficeId,
  onToggle,
  onSelect,
  onHubMount,
}: {
  map: MapLibreMap;
  cluster: OfficeCluster;
  /** Screen offset that keeps the pin off meeting pins. */
  offset: readonly [number, number];
  open: boolean;
  touch: boolean;
  selectedOfficeId: string | null;
  onToggle: () => void;
  onSelect: (officeId: string) => void;
  onHubMount: (key: string, button: HTMLButtonElement | null) => void;
}) {
  const [element] = useState(() => {
    const div = document.createElement("div");
    div.className = "mw-office-marker";
    return div;
  });
  const marker = useRef<Marker | null>(null);
  useEffect(() => {
    const placed = new Marker({ element, anchor: "center" }).setLngLat([cluster.lng, cluster.lat]).addTo(map);
    marker.current = placed;
    return () => { placed.remove(); marker.current = null; };
    // Placed once; the effect below moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, element]);
  useEffect(() => { marker.current?.setLngLat([cluster.lng, cluster.lat]); }, [cluster.lng, cluster.lat]);
  const [dx, dy] = offset;
  useEffect(() => { marker.current?.setOffset([dx, dy]); }, [dx, dy]);

  const { offices } = cluster;
  if (offices.length === 1) {
    return createPortal(
      <OfficeCapsule office={offices[0]} label={offices[0].role} selected={offices[0].id === selectedOfficeId} onSelect={onSelect} />,
      element,
    );
  }

  const fan = fanRightOffsets(offices.map(office => office.id), touch ? OFFICE_FAN.mobile : OFFICE_FAN.desktop);
  return createPortal(
    <>
      <button
        ref={button => onHubMount(cluster.key, button)}
        type="button"
        className="mw-office-hub"
        aria-label={`${offices.length} representative offices`}
        aria-expanded={open}
        style={{ "--ring-fill": ringBackground(cluster.tiers) } as CSSProperties}
        onClick={onToggle}
      >
        <span className="mw-office-hub__body">
          <Landmark aria-hidden="true" className="mw-office-glyph" />
          <span className="mw-office-hub__count">{offices.length}</span>
          <span className="mw-office-reveal"><span>offices</span></span>
        </span>
      </button>
      <svg className="mw-office-leaders" aria-hidden="true" width="1" height="1">
        {fan.map((offset, i) => (
          <line key={offset.key} x1={0} y1={0} x2={offset.dx} y2={offset.dy} stroke={`var(--accent-${offices[i].tier})`} />
        ))}
      </svg>
      {offices.map((office, i) => (
        <OfficeCapsule
          key={office.id}
          office={office}
          // Two offices of one kind in a fan are told apart by whose they are.
          label={offices.filter(other => other.role === office.role).length > 1 ? `${office.name}, ${office.role}` : office.role}
          fanned
          selected={office.id === selectedOfficeId}
          onSelect={onSelect}
          style={{ "--dx": `${fan[i].dx}px`, "--dy": `${fan[i].dy}px` } as CSSProperties}
        />
      ))}
    </>,
    element,
  );
}

function OfficeCapsule({
  office,
  label,
  fanned = false,
  selected,
  onSelect,
  style,
}: {
  office: OfficePin;
  label: string;
  fanned?: boolean;
  selected: boolean;
  onSelect: (officeId: string) => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className={fanned ? "mw-office-pin mw-office-fan-item" : "mw-office-pin"}
      data-tier={office.tier}
      data-office-id={office.id}
      data-selected={selected}
      aria-label={officeAriaLabel(office)}
      style={style}
      onClick={() => onSelect(office.id)}
    >
      <Landmark aria-hidden="true" className="mw-office-glyph" />
      <span className="mw-office-reveal"><span>{label}</span></span>
    </button>
  );
}

/** Phones and tablets have no hover: pins draw open and larger, and fans open wider. */
function useNoHover(): boolean {
  return useSyncExternalStore(subscribeNoHover, readNoHover, () => false);
}
const NO_HOVER = "(hover: none)";
function subscribeNoHover(onChange: () => void) {
  const query = window.matchMedia(NO_HOVER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function readNoHover() {
  return window.matchMedia(NO_HOVER).matches;
}
