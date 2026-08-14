"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CountBadge } from "@/components/map/count-badge";
import { Legend } from "@/components/map/legend";
import { ListOverlay } from "@/components/map/list-overlay";
import { Sidebar } from "@/components/shell/sidebar";
import { useDistrictLayer } from "@/hooks/use-district-layer";
import { useStoredTheme } from "@/hooks/use-stored-theme";
import { useStoredZip } from "@/hooks/use-stored-zip";
import type { SearchItem } from "@/lib/search";
import { DataProvider, type ShellData } from "@/lib/state/data";
import { applyFilters } from "@/lib/state/derive";
import { deriveActiveDistrictTypes } from "@/lib/state/district-intent";
import { haversineKm } from "@/lib/geo/distance";
import { BallotBubble } from "./ballot-bubble";
import { UiProvider, useUi, useUiDispatch } from "@/lib/state/provider";
import type { MeetingSearchResult } from "@/lib/meetings/query";
import type { SnapshotStatus } from "@/lib/meetings/freshness";
import { logEvent } from "@/lib/log/client";
import { groupByVenue, type Venue } from "@/lib/meetings/venues";
import type { Meeting } from "@/lib/sources/types";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { CoveredBody } from "@/lib/registry/coverage";
import { TIER_LABEL } from "@/lib/ocd/tiers";
import { tierForMeeting } from "@/lib/state/derive";
import {
  formatMeetingDate,
  formatMeetingTime,
  shortOcdId,
} from "@/lib/map/format";

import type { DistrictHit } from "@/lib/map/districts";
import type { DistrictType } from "@/lib/state/types";

import { CoverageNotice } from "./coverage-notice";
import { DataFreshness } from "./data-freshness";
import { DistrictPicker } from "./district-picker";
import { MapCanvas, type CameraTarget, type MapFocus } from "./map-canvas";
import { MeetingPanel } from "./meeting-panel";
import { DistrictPopup } from "./popup/district-popup";
import { MeetingPopup } from "./popup/meeting-popup";
import { OfficialPopup } from "./popup/official-popup";
import { EntityModal, type ModalSubject } from "./popup/entity-modal";
import { WelcomeOverlay } from "./welcome-overlay";

/**
 * The entry screen.
 *
 * Holds nothing about where meetings come from: it asks /api/meetings and hands
 * the answer to the shell. Shared UI state lives in lib/state, so the sidebar,
 * the legend, the count badge and the list overlay cannot disagree about what
 * is currently showing.
 */

interface TaggedResult extends MeetingSearchResult {
  zip: string;
  /** Which view request produced this answer — stale answers are dropped. */
  viewKey: string;
  /** The nearest ZCTA to a settled viewport, resolved server-side. */
  nearZip?: string | null;
  /** Present when the committed snapshot served this answer. */
  snapshot?: SnapshotStatus | null;
}

/**
 * What the map is currently looking at (2i). A typed zip and a settled
 * viewport both produce one of these; the fetch effect serves whichever is
 * newest and everything downstream reads the answer the same way.
 */
interface ViewTarget {
  key: string;
  kind: "zip" | "settled";
  /** Known for a typed zip; resolved server-side for a settled viewport. */
  zip: string | null;
  lat: number;
  lng: number;
}

export function MapEntry() {
  return (
    <UiProvider>
      <MapEntryInner />
    </UiProvider>
  );
}

function MapEntryInner() {
  const { location, restored, remember } = useStoredZip();
  const { theme } = useStoredTheme();
  const ui = useUi();
  const dispatch = useUiDispatch();

  const [result, setResult] = useState<TaggedResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [districtsFailed, setDistrictsFailed] = useState(false);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [districtCount, setDistrictCount] = useState(0);
  // Reopened by the sidebar's CHANGE button and by reset. Distinct from "no
  // zip stored yet", which opens it unconditionally.
  const [welcomeRequested, setWelcomeRequested] = useState(false);

  // One sidebar pattern at every width (2f): "default" is per-width (desktop
  // visible, phone hidden), "open"/"closed" are the reader's explicit choice
  // and win at any width. CSS keys off data-sidebar on <main>.
  const [sidebarState, setSidebarState] = useState<"default" | "open" | "closed">(
    "default",
  );
  // Dismissal (a search pick, a map tap through the backdrop) returns to the
  // per-width default rather than forcing the desktop rail closed.
  const dismissSidebar = useCallback(
    () => setSidebarState((s) => (s === "open" ? "default" : s)),
    [],
  );

  // The who-governs card shrinks out of the way once the reader engages with
  // something specific (2h) — a pin, a list row, a filter — and comes back on
  // a tap or a new area.
  const [noticeCollapsed, setNoticeCollapsed] = useState(false);

  // District visibility is persisted by its own hook, the sibling of
  // use-stored-zip. The store mirrors it one-way so the legend and the stats
  // card can read it without a second source of truth for the value.
  const {
    enabled: showDistricts,
    setEnabled: setShowDistricts,
  } = useDistrictLayer();

  useEffect(() => {
    dispatch({ type: "districts/show", value: showDistricts });
  }, [showDistricts, dispatch]);

  // The stored zip is one source of view targets; a settled viewport (2i) is
  // the other. Both funnel through `view` (derived below), and the fetch
  // effect serves whichever is current.

  // The typed zip's view is derived; a settled viewport (2i) overrides it
  // until the next zip entry. `forZip` scopes the override: entering a new
  // zip makes the settled view stale without an effect having to clear it.
  const [settled, setSettled] = useState<{
    forZip: string;
    target: ViewTarget;
  } | null>(null);

  const zipView = useMemo<ViewTarget | null>(
    () =>
      location
        ? {
            key: `zip:${location.zip}`,
            kind: "zip",
            zip: location.zip,
            lat: location.lat,
            lng: location.lng,
          }
        : null,
    [location],
  );

  const view =
    settled && location && settled.forZip === location.zip
      ? settled.target
      : zipView;

  useEffect(() => {
    if (!view) return;

    const controller = new AbortController();
    const { key, zip, lat, lng } = view;

    void (async () => {
      try {
        // The zip rides along as approximate_location for the search log —
        // orientation only, disclosed on /transparency. A settled viewport
        // has none; the server resolves the nearest ZCTA and logs that.
        const zipParam = zip ? `&zip=${zip}` : "";
        const response = await fetch(
          `/api/meetings?lat=${lat}&lng=${lng}${zipParam}`,
          {
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(`Search failed: ${response.status}`);

        const payload: MeetingSearchResult & { nearZip?: string | null } =
          await response.json();
        setResult({
          ...payload,
          // The label the notices speak: the typed zip, the settled area's
          // nearest zip, or — far from every centroid — an honest generic.
          zip: zip ?? payload.nearZip ?? "the area shown",
          viewKey: key,
        });
        setFailed(false);
      } catch {
        if (controller.signal.aborted) return;
        setResult(null);
        setFailed(true);
      }
    })();

    return () => controller.abort();
  }, [view]);

  const search = useCallback(
    (zip: string, lat: number, lng: number) => {
      dispatch({ type: "select/venue", key: null });
      setFailed(false);
      setWelcomeRequested(false);
      dismissSidebar();
      setNoticeCollapsed(false);
      // Re-entering a zip returns to it even after panning away — the stale
      // settled view would otherwise survive an identical zip.
      setSettled(null);
      remember({ zip, lat, lng });
    },
    [remember, dispatch, dismissSidebar],
  );

  const camera = useMemo<CameraTarget | null>(
    () =>
      location
        ? { zip: location.zip, lat: location.lat, lng: location.lng }
        : null,
    [location],
  );

  const current = result && view && result.viewKey === view.key ? result : null;

  // Everything downstream reads this one filtered list.
  const meetings = useMemo<Meeting[]>(
    () =>
      current
        ? applyFilters({
            meetings: current.meetings,
            ui,
            // Only constrain by radius once the reader has actually moved the
            // slider. Before that the cascade's own radius is the answer, and
            // re-filtering on the default would silently drop the meetings a
            // widened search just found. The center is whatever the map is
            // looking at — the typed zip or the settled viewport.
            center: ui.radiusOverridden ? (ui.nearMe ?? view) : null,
          })
        : [],
    [current, ui, view],
  );

  const venues = useMemo<Venue[]>(() => groupByVenue(meetings), [meetings]);

  const selectedVenue = useMemo(
    () => venues.find((v) => v.key === ui.selectedVenueKey) ?? null,
    [venues, ui.selectedVenueKey],
  );

  /*
   * Popup and modal state.
   *
   * Local rather than in the store, matching `welcomeRequested` above. These
   * are ephemeral view state derived from a selection the store already holds;
   * nothing else reads them, and putting them in the reducer would make every
   * surface re-render on a popup open.
   */
  const [popupMeeting, setPopupMeeting] = useState<Meeting | null>(null);
  const [modal, setModal] = useState<ModalSubject | null>(null);

  // The rep popup (3c): the person behind a clicked name, with the seat
  // label and tier riding along for the card header.
  const [officialPopup, setOfficialPopup] = useState<{
    holder: SeatHolder;
    seatLabel: string | null;
    tier: "local" | "state" | "national";
  } | null>(null);

  const openOfficial = useCallback(
    (
      holder: SeatHolder,
      seatLabel: string | null,
      tier: "local" | "state" | "national",
    ) => {
      // Deliberately not logged: adding an event type to the search log
      // extends what the transparency page discloses, which is the author's
      // call, not this session's (noted in the tracker).
      setOfficialPopup({ holder, seatLabel, tier });
    },
    [],
  );

  /*
   * Search-log events for the interactions the transparency page describes.
   * Each carries the divisions touched and scalar detail only — the client
   * half sends nothing that could identify the reader, and the effects fire
   * on state *changes*, so a re-render logs nothing.
   */
  const openMeeting = useCallback((meeting: Meeting) => {
    setPopupMeeting(meeting);
    setNoticeCollapsed(true);
    // A division-less body (null ocdId) logs the event with no division.
    logEvent("MEETING_OPENED", meeting.ocdId ? [meeting.ocdId] : [], {
      meetingId: meeting.id,
    });
  }, []);

  useEffect(() => {
    if (!selectedVenue) return;
    const ocdIds = [
      ...new Set(
        selectedVenue.meetings.flatMap((m) => (m.ocdId ? [m.ocdId] : [])),
      ),
    ];
    logEvent("BODY_OPENED", ocdIds, { venueKey: selectedVenue.key });
  }, [selectedVenue]);

  useEffect(() => {
    if (!ui.selectedDistrictOcdId) return;
    logEvent("DISTRICT_SELECTED", [ui.selectedDistrictOcdId]);
  }, [ui.selectedDistrictOcdId]);

  // The tier filter is the one that changes what the whole screen shows.
  // The ref skips the mount run: the default tiers are not a choice the
  // reader made, and logging them would count page loads as filter events.
  const tiersLogged = useRef(false);
  useEffect(() => {
    if (!tiersLogged.current) {
      tiersLogged.current = true;
      return;
    }
    logEvent("FILTER_APPLIED", [], {
      filter: "tiers",
      value: ui.tiers.join(","),
    });
  }, [ui.tiers]);

  /*
   * Scroll-and-settle (2i). The reader panned somewhere and stopped; the map
   * recognizes the new viewport and surfaces that area's info. Guards, in
   * order: no context yet (welcome open), an open popup or active selection
   * (never fight what the reader is looking at), and a move too small to
   * change the answer. The camera is never touched — allowAutoFrame below is
   * false for settled views.
   */
  const onViewportSettle = useCallback(
    (center: { lat: number; lng: number }) => {
      if (!location || welcomeRequested) return;
      if (popupMeeting || ui.selectedVenueKey || ui.selectedDistrictOcdId) return;
      if (view && haversineKm(center.lat, center.lng, view.lat, view.lng) < 5) {
        return;
      }
      setNoticeCollapsed(false);
      setSettled({
        forZip: location.zip,
        target: {
          key: `settled:${center.lat.toFixed(3)},${center.lng.toFixed(3)}`,
          kind: "settled",
          zip: null,
          lat: center.lat,
          lng: center.lng,
        },
      });
    },
    [
      location,
      welcomeRequested,
      popupMeeting,
      ui.selectedVenueKey,
      ui.selectedDistrictOcdId,
      view,
    ],
  );

  /*
   * The engagement signals that shrink the who-governs card (2h): a pin, a
   * list row, an open meeting, a district selection, a filter change. Map
   * panning is deliberately not one of them — panning *expands* it again,
   * because the reader is asking about a new area. Pin, list and district
   * engagement collapse it inside their handlers below; filter engagement is
   * caught here with the adjust-during-render pattern (the dispatches happen
   * in other components), keyed on identity — `ui.filters` is one object
   * from mount until a filter action actually replaces it.
   */
  const [seenFilters, setSeenFilters] = useState(ui.filters);
  const [seenTiers, setSeenTiers] = useState(ui.tiers);
  if (seenFilters !== ui.filters || seenTiers !== ui.tiers) {
    setSeenFilters(ui.filters);
    setSeenTiers(ui.tiers);
    setNoticeCollapsed(true);
  }

  // The last set of districts a click landed in, so the popup can recover the
  // full hit — the store keeps only the identifier and type.
  const [lastHits, setLastHits] = useState<DistrictHit[]>([]);

  const districtPopup = useMemo(
    () =>
      lastHits.find((hit) => hit.ocdId === ui.selectedDistrictOcdId) ?? null,
    [lastHits, ui.selectedDistrictOcdId],
  );

  /** Officeholders sourced for a division, from the coverage summary. */
  const holdersFor = useCallback(
    (ocdId: string): SeatHolder[] => {
      const coverage = current?.coverage;
      if (!coverage) return [];
      const seat = coverage.seats.find((s) => s.ocdId === ocdId);
      return seat?.representatives ?? [];
    },
    [current],
  );

  /**
   * The registry body governing a division, for the popup's link ladder.
   *
   * Comes off the same coverage summary the notice reads, so the popup and the
   * notice cannot disagree about who governs a point or what we hold for them.
   */
  const bodyFor = useCallback(
    (ocdId: string | null): CoveredBody | null =>
      // Guarded against null on both sides: a division-less meeting must not
      // accidentally match a division-less coverage body — they are different
      // bodies that merely share the absence of a division.
      ocdId
        ? (current?.coverage?.bodies.find((b) => b.ocdId === ocdId) ?? null)
        : null,
    [current],
  );

  useEffect(() => {
    if (!current) return;
    dispatch({
      type: "coverage/report",
      tier: current.tier,
      // The mock adapter drops nothing today; when a real adapter does, it
      // reports the count here rather than swallowing it.
      dropped: 0,
    });
  }, [current, dispatch]);

  const data = useMemo<ShellData>(
    () => ({
      allMeetings: current?.meetings ?? [],
      meetings,
      venues,
      result: current,
      location,
      districtCount,
      dropped: 0,
      searchFailed: failed,
    }),
    [current, meetings, venues, location, districtCount, failed],
  );

  const onSearchPick = useCallback((item: SearchItem) => {
    if (item.venueKey) dispatch({ type: "select/venue", key: item.venueKey });
    if (item.lat !== null && item.lng !== null) {
      setFocus({ lat: item.lat, lng: item.lng, zoom: 13, key: item.id });
    }
    // Picking a result means the reader wants the map, not the drawer that
    // may be covering it at phone width.
    dismissSidebar();
  }, [dispatch, dismissSidebar]);

  const onPickMeeting = useCallback(
    (meeting: Meeting) => {
      const venue = venues.find((v) =>
        v.meetings.some((m) => m.id === meeting.id),
      );
      if (venue) dispatch({ type: "select/venue", key: venue.key });
      setNoticeCollapsed(true);
      setFocus({
        lat: meeting.location.lat,
        lng: meeting.location.lng,
        zoom: 14,
        key: meeting.id,
      });
    },
    [venues, dispatch],
  );

  // Reset clears the filters a reader has got tangled in and offers the
  // location prompt again — the two things that put them somewhere they did
  // not mean to be.
  const onReset = useCallback(() => {
    dispatch({ type: "reset" });
    setFocus(null);
    setWelcomeRequested(true);
  }, [dispatch]);

  // Which overlays are drawn: the district-type checkboxes, gated by the
  // master toggle. Empty when the toggle is off. The derivation is a pure
  // function in lib/state/district-intent.ts so the may-not-derive-to-nothing
  // guard can hold it (tests/representation.test.ts).
  const activeDistrictTypes = useMemo(
    () =>
      deriveActiveDistrictTypes(
        showDistricts,
        districtsFailed,
        ui.filters.districtTypes as DistrictType[],
      ),
    [showDistricts, districtsFailed, ui.filters.districtTypes],
  );

  const selectedDistrict = useMemo(
    () =>
      ui.selectedDistrictOcdId && ui.selectedDistrictType
        ? { type: ui.selectedDistrictType, ocdId: ui.selectedDistrictOcdId }
        : null,
    [ui.selectedDistrictOcdId, ui.selectedDistrictType],
  );

  /*
   * A click on the map lands in a *set* of districts.
   *
   * One hit selects directly. More than one opens the disambiguation prompt —
   * which is the normal case, not an edge: downtown Tucson is in six districts
   * at once, and Rockaway is in two school districts from the same layer. The
   * reader's spatial choice is what selects a district; nothing here is
   * inferred from the stored zip.
   */
  const onDistrictClick = useCallback(
    (hits: DistrictHit[], at: { x: number; y: number }) => {
      // Remember the whole set, not just the chosen one: the picker may select
      // any of them, and the popup needs that hit's label and type back.
      setLastHits(hits);
      setNoticeCollapsed(true);

      if (hits.length === 1) {
        dispatch({
          type: "select/district",
          ocdId: hits[0].ocdId,
          districtType: hits[0].type,
        });
        return;
      }

      dispatch({
        type: "district/pick",
        pick: {
          at,
          choices: hits.map((h) => ({
            type: h.type,
            tier: h.tier,
            typeLabel: h.typeLabel,
            ocdId: h.ocdId,
            label: h.label,
          })),
        },
      });
    },
    [dispatch],
  );

  const onTileError = useCallback(() => setTilesFailed(true), []);
  const onDistrictError = useCallback(() => setDistrictsFailed(true), []);
  const onSelectVenue = useCallback(
    (venue: Venue) => {
      dispatch({ type: "select/venue", key: venue.key });
      // Engagement (2h): the reader picked something specific; the
      // who-governs card gets out of the way.
      setNoticeCollapsed(true);
    },
    [dispatch],
  );

  return (
    <DataProvider value={data}>
      <main
        className="relative h-dvh w-full overflow-hidden"
        data-sidebar={sidebarState}
      >
        <Sidebar
          onSearchPick={onSearchPick}
          onReset={onReset}
          onChangeLocation={() => setWelcomeRequested(true)}
          showDistricts={showDistricts}
          districtsFailed={districtsFailed}
          onToggleDistricts={setShowDistricts}
          mobileOpen={sidebarState === "open"}
          onMobileClose={() => setSidebarState("closed")}
        />

        {/* The hamburger (2f) — rendered always, shown by CSS whenever the
            sidebar is effectively hidden, at any width. The backdrop is
            phone-only: it sits under the sidebar's z-1000 so tapping the map
            closes the drawer instead of dropping a pin through it. */}
        <button
          type="button"
          className="sidebar-toggle"
          aria-label="Open menu"
          onClick={() => setSidebarState("open")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {sidebarState === "open" && (
          <div
            className="sidebar-backdrop sm:hidden"
            onClick={dismissSidebar}
          />
        )}

        {/* The map starts where the sidebar ends — full width when the rail
            is hidden at any width (2f). */}
        <div
          className={`absolute inset-y-0 right-0 left-0 ${
            sidebarState === "closed" ? "" : "sm:left-[340px]"
          }`}
        >
          <MapCanvas
            venues={venues}
            camera={camera}
            focus={focus}
            selectedVenueKey={ui.selectedVenueKey}
            frameAllVenues={
              current !== null &&
              current.tier !== "exact" &&
              view?.kind === "zip"
            }
            districtTypes={activeDistrictTypes}
            selectedDistrict={selectedDistrict}
            onDistrictClick={onDistrictClick}
            theme={theme}
            onDistrictError={onDistrictError}
            onDistrictCount={setDistrictCount}
            onSelectVenue={onSelectVenue}
            onTileError={onTileError}
            onViewportSettle={onViewportSettle}
            allowAutoFrame={view?.kind !== "settled"}
          />
        </div>

        <div
          className={`pointer-events-none absolute inset-y-0 right-0 left-0 ${
            sidebarState === "closed" ? "" : "sm:left-[340px]"
          } flex flex-col`}
        >
          {/* pr clears MapLibre's zoom control in the top-right corner. The
              ballot bubble (2b) leads the row so it stays visible left of the
              meeting panel when one is open. */}
          <div className="flex items-start justify-end gap-3 p-3 pr-14 sm:p-5 sm:pr-16">
            <div className="pointer-events-auto">
              <BallotBubble
                zip={
                  current
                    ? /^\d{5}$/.test(current.zip)
                      ? current.zip
                      : (current.nearZip ?? null)
                    : (location?.zip ?? null)
                }
                coverage={current?.coverage ?? null}
              />
            </div>
            {selectedVenue && (
              <div className="pointer-events-auto hidden sm:block">
                <MeetingPanel
                  venue={selectedVenue}
                  onOpenMeeting={openMeeting}
                  onClose={() => dispatch({ type: "select/venue", key: null })}
                />
              </div>
            )}
          </div>

          {/* Extra bottom padding clears the attribution, which now sits in
              the bottom-left corner. Anchored to the bottom edge rather than
              flexed below the top row — a tall meeting panel up there was
              pushing this whole group below the fold. */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-3 p-3 pb-9 sm:p-5 sm:pb-10">
            <div className="pointer-events-auto">
              <CountBadge />
            </div>

            {tilesFailed && <TileNotice />}
            {failed && <SearchFailedNotice />}

            {current?.snapshot && <DataFreshness snapshot={current.snapshot} />}

            {current &&
              (noticeCollapsed ? (
                // Shrunk out of the way (2h), not gone: one tap brings the
                // full card back.
                <button
                  type="button"
                  className="notice-fab pointer-events-auto"
                  aria-label="Show who governs here"
                  onClick={() => setNoticeCollapsed(false)}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  Who governs here
                </button>
              ) : (
                <CoverageNotice
                  tier={current.tier}
                  zip={current.zip}
                  radiusKm={current.radiusKm}
                  requestedRadiusKm={current.requestedRadiusKm}
                  count={current.meetings.length}
                  coverage={current.coverage}
                  failedSourceOcdIds={
                    current.snapshot?.failed.flatMap((f) => f.ocdIds) ?? []
                  }
                  onOpenOfficial={openOfficial}
                />
              ))}

            {selectedVenue && (
              // The phone form of the meeting panel: a bottom sheet pinned to
              // the viewport edge, its own scroll, the map visible behind it.
              <div className="bottom-sheet pointer-events-auto sm:hidden">
                <MeetingPanel
                  venue={selectedVenue}
                  onOpenMeeting={openMeeting}
                  onClose={() => dispatch({ type: "select/venue", key: null })}
                />
              </div>
            )}
          </div>
        </div>

        {/* Positioned against the map area, so its coordinates match the
            click that produced it. */}
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 left-0 ${
            sidebarState === "closed" ? "" : "sm:left-[340px]"
          }`}
        >
          <DistrictPicker />
        </div>

        {/* Popups sit above the panels and below the modal, and in the one
            corner nothing else claims: the coverage notice owns bottom-left
            and the meeting panel owns top-right. A first attempt put them at
            bottom-left and they landed on top of the coverage notice, which a
            screenshot caught. */}
        <div className="pointer-events-none absolute right-2 bottom-2 left-2 z-[1200] flex items-end justify-end gap-3 sm:right-5 sm:bottom-5 sm:left-auto">
          {officialPopup && (
            <OfficialPopup
              holder={officialPopup.holder}
              seatLabel={officialPopup.seatLabel}
              tier={officialPopup.tier}
              onClose={() => setOfficialPopup(null)}
            />
          )}

          {districtPopup && !officialPopup && (
            <DistrictPopup
              district={districtPopup}
              onOpenOfficial={(holder) =>
                openOfficial(holder, districtPopup.label, districtPopup.tier)
              }
              representation={holdersFor(districtPopup.ocdId)}
              upcomingMeetings={
                meetings.filter(
                  (m) =>
                    m.ocdId === districtPopup.ocdId && m.status === "SCHEDULED",
                ).length
              }
              onClose={() =>
                dispatch({ type: "select/district", ocdId: null, districtType: null })
              }
              onExpand={() => setModal(districtSubject(districtPopup))}
            />
          )}

          {popupMeeting && (
            <MeetingPopup
              meeting={popupMeeting}
              body={bodyFor(popupMeeting.ocdId)}
              onClose={() => setPopupMeeting(null)}
              onExpand={() => setModal(meetingSubject(popupMeeting))}
            />
          )}
        </div>

        {modal && <EntityModal subject={modal} onClose={() => setModal(null)} />}

        <Legend />
        <ListOverlay onPickMeeting={onPickMeeting} />

        {/* Rendered last so it wins the z-1200 tie with the legend. Nothing
            renders it until the stored zip has resolved, so a returning reader
            never sees the prompt they already answered flash past. */}
        {restored && (
          <WelcomeOverlay
            open={!location || welcomeRequested}
            onResolved={search}
            onDismiss={
              location ? () => setWelcomeRequested(false) : null
            }
          />
        )}
      </main>
    </DataProvider>
  );
}

/**
 * The modal's contents for a meeting.
 *
 * **Sources lists what is actually behind the card**, including the rows whose
 * `sourceUrl` is null. Omitting those would imply everything shown was cited,
 * which is the more damaging of the two possible lies.
 */
function meetingSubject(meeting: Meeting): ModalSubject {
  return {
    title: meeting.title,
    subtitle: `${meeting.bodyName} · ${meeting.jurisdiction}`,
    tier: tierForMeeting(meeting) ?? "local",
    badges:
      meeting.status === "SCHEDULED"
        ? []
        : [{ label: STATUS_LABEL[meeting.status], status: meeting.status }],
    facts: [
      { label: "Body", value: meeting.bodyName },
      { label: "Date", value: formatMeetingDate(meeting) },
      { label: "Time", value: formatMeetingTime(meeting), mono: true },
      { label: "Time zone", value: meeting.timeZone, mono: true },
      { label: "Location", value: meeting.location.name },
      {
        label: "Address",
        value: meeting.location.address ?? "not published",
      },
      { label: "Division", value: shortOcdId(meeting.ocdId), mono: true },
      { label: "Status", value: STATUS_LABEL[meeting.status] },
    ],
    representation: [],
    representationNote:
      "We haven't sourced who sits on this body. The people we hold for this area represent it in Congress and the state legislature, which is a different thing.",
    meetings: [meeting],
    sources: [{ what: meeting.title, provenance: meeting.provenance }],
  };
}

function districtSubject(district: DistrictHit): ModalSubject {
  return {
    title: district.label,
    subtitle: `${district.typeLabel} · ${district.state}`,
    tier: district.tier,
    facts: [
      { label: "Type", value: district.typeLabel },
      { label: "Tier", value: TIER_LABEL[district.tier] },
      { label: "OCD-ID", value: district.ocdId, mono: true },
      { label: "State", value: district.state, mono: true },
    ],
    representation: [],
    representationNote: "No sourced officeholder for this division yet.",
    meetings: [],
    sources: [],
  };
}

const STATUS_LABEL: Record<Meeting["status"], string> = {
  SCHEDULED: "Scheduled",
  CONCLUDED: "Concluded",
  CANCELED: "Canceled",
};

function SearchFailedNotice() {
  return (
    <div className="panel pointer-events-auto max-w-md px-4 py-3.5">
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-danger">
        Search failed
      </p>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-text-dim">
        Couldn&apos;t reach the meetings service. Change the zip to try again.
      </p>
    </div>
  );
}

function TileNotice() {
  return (
    <div className="panel pointer-events-auto max-w-md px-4 py-3.5">
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-danger">
        Basemap unavailable
      </p>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-text-dim">
        Map tiles didn&apos;t load. Pins and meeting details still work. Set{" "}
        <code className="font-mono text-text">NEXT_PUBLIC_MAPTILER_KEY</code> in{" "}
        <code className="font-mono text-text">.env.local</code> to use MapTiler.
      </p>
    </div>
  );
}
