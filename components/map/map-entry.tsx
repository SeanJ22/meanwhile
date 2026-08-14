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
import { applyFilters, noticeShouldExpand } from "@/lib/state/derive";
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
import {
  governingRosterHoldersForDivision,
  rosterHoldersForBody,
} from "@/lib/registry/body-rosters";
import { TIER_LABEL } from "@/lib/ocd/tiers";
import { tierForMeeting } from "@/lib/state/derive";
import {
  formatMeetingDate,
  formatMeetingTime,
  locationLine,
  meetingHeadline,
} from "@/lib/map/format";

import type { DistrictHit, DrawnDistrict } from "@/lib/map/districts";
import type { DistrictType } from "@/lib/state/types";

import { CoverageNotice } from "./coverage-notice";
import { DataFreshness } from "./data-freshness";
import { DistrictPicker } from "./district-picker";
import { MapCanvas, type CameraTarget, type MapFocus } from "./map-canvas";
import { MeetingPanel } from "./meeting-panel";
import { DistrictPopup } from "./popup/district-popup";
import { MeetingPopup } from "./popup/meeting-popup";
import { OfficialPopup } from "./popup/official-popup";
import { OfficialModal } from "./popup/official-modal";
import { EntityModal, type ModalSubject } from "./popup/entity-modal";
import { DoorOverlay } from "./door-overlay";
import { WelcomeOverlay } from "./welcome-overlay";
import { TutorialOverlay } from "./tutorial-overlay";

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
  /**
   * How the meetings fetch failed, when it did: the HTTP status the service
   * answered with, or null status for a request that never got an answer.
   * Carried so the failure card can *name* the failure — production logs
   * are not always reachable, and "SEARCH FAILED" with no cause cost a
   * session of diagnosis (2a).
   */
  const [failure, setFailure] = useState<{ status: number | null } | null>(null);
  // Bumped by the failure card's retry — re-runs the current view's fetch
  // without making the reader change their zip (2a: "change the zip to try
  // again" is wrong advice when the service hiccuped).
  const [retryNonce, setRetryNonce] = useState(0);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [districtsFailed, setDistrictsFailed] = useState(false);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  // The one denominator (3g): the card counts this list's length and the
  // districts door renders its rows.
  const [drawnDistricts, setDrawnDistricts] = useState<DrawnDistrict[]>([]);
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

  /*
   * Popup state, in the two-tier architecture (3). Declared before the
   * handlers that clear them (`search` resets all of it on a zip change).
   *
   * Compact glance cards (`popupMeeting`, `officialPopup`, the district
   * popup derived from the store) are entry points and may coexist. The
   * LARGE tier is one-at-a-time: `large` holds whichever large surface is
   * open — opening one replaces any other, subsumes the compact card that
   * opened it, and closes the list overlay.
   */
  const [popupMeeting, setPopupMeeting] = useState<Meeting | null>(null);
  const [large, setLarge] = useState<
    | { kind: "entity"; subject: ModalSubject }
    | {
        kind: "official";
        holder: SeatHolder;
        seatLabel: string | null;
        tier: "local" | "state" | "national";
      }
    | null
  >(null);
  const [officialPopup, setOfficialPopup] = useState<{
    holder: SeatHolder;
    seatLabel: string | null;
    tier: "local" | "state" | "national";
  } | null>(null);
  // The last set of districts a click landed in, so the popup can recover
  // the full hit — the store keeps only the identifier and type.
  const [lastHits, setLastHits] = useState<DistrictHit[]>([]);

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
        if (!response.ok) {
          // Let the failure name itself — the status distinguishes "the
          // service is broken" (5xx) from "the request was rejected" (4xx)
          // from "the session's access expired" (401), which are three
          // different next steps.
          console.error(
            `meetings fetch failed: ${response.status} for ${view.kind} view`,
          );
          setResult(null);
          setFailure({ status: response.status });
          return;
        }

        const payload: MeetingSearchResult & { nearZip?: string | null } =
          await response.json();
        setResult({
          ...payload,
          // The label the notices speak: the typed zip, the settled area's
          // nearest zip, or — far from every centroid — an honest generic.
          zip: zip ?? payload.nearZip ?? "the area shown",
          viewKey: key,
        });
        setFailure(null);
      } catch {
        if (controller.signal.aborted) return;
        console.error(`meetings fetch got no answer for ${view.kind} view`);
        setResult(null);
        setFailure({ status: null });
      }
    })();

    return () => controller.abort();
  }, [view, retryNonce]);

  const search = useCallback(
    (zip: string, lat: number, lng: number) => {
      dispatch({ type: "select/venue", key: null });
      // A zip change is a new area: everything showing the previous area's
      // entities must clear — holding the old reps, meeting, or district
      // across a zip change is a stale-data bug (3).
      dispatch({ type: "select/district", ocdId: null, districtType: null });
      setPopupMeeting(null);
      setOfficialPopup(null);
      setLarge(null);
      setLastHits([]);
      setFailure(null);
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

  /** The one-at-a-time rule: any large surface replaces every other. */
  const openLarge = useCallback(
    (next: NonNullable<typeof large>) => {
      setLarge(next);
      // The large tier subsumes the compact card that opened it, and the
      // list overlay yields — three surfaces at once was the defect.
      if (next.kind === "official") setOfficialPopup(null);
      if (next.kind === "entity") setPopupMeeting(null);
      dispatch({ type: "list/open", open: false });
      // 8a: a sidebar door is a large surface too, and yields the same way.
      dispatch({ type: "door/close" });
    },
    [dispatch],
  );

  const openOfficial = useCallback(
    (
      holder: SeatHolder,
      seatLabel: string | null,
      tier: "local" | "state" | "national",
      ocdId: string | null,
    ) => {
      setOfficialPopup({ holder, seatLabel, tier });
      // Author-approved (1d), disclosed on /transparency in the same change.
      // The holder id names the official opened, never the reader.
      logEvent("OFFICIAL_OPENED", ocdId ? [ocdId] : [], {
        officialId: holder.id,
      });
    },
    [],
  );

  // Opening the list overlay closes any large popup — the same
  // one-at-a-time rule, from the other direction. Adjust-during-render,
  // keyed on the store value changing, matching `seenFilters` below.
  const [seenListOpen, setSeenListOpen] = useState(ui.listOverlayOpen);
  if (seenListOpen !== ui.listOverlayOpen) {
    setSeenListOpen(ui.listOverlayOpen);
    if (ui.listOverlayOpen) {
      setLarge(null);
      // Same 8b fix as the doors: the list opened from the phone drawer
      // must not sit under the drawer's backdrop.
      dismissSidebar();
    }
  }

  // 8a: an opening door closes any large popup, same rule, same pattern.
  // And it dismisses the phone drawer — the walk caught the door rendering
  // UNDER the drawer's backdrop, which ate its clicks (8b's clutter class).
  const [seenDoor, setSeenDoor] = useState(ui.door);
  if (seenDoor !== ui.door) {
    setSeenDoor(ui.door);
    if (ui.door !== null) {
      setLarge(null);
      dismissSidebar();
    }
  }

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
      // Deliberately no notice expansion here: panning is not a question
      // about who governs. The card shows once per resolved AREA (the
      // effect below), on a click into a new district, or on a bubble tap.
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
   * The who-governs card's lifecycle (3): it shows once per resolved AREA,
   * then lives as its corner bubble until the reader clicks INTO a new
   * district or taps the bubble. Panning alone never re-expands it.
   */
  const shownAreaKey = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    // 3h (2026-08-19): only a TYPED-ZIP view may re-expand the card —
    // launch and a sidebar zip change are both typed-zip views. A settled
    // pan that crosses a ZCTA line used to change `current.zip` (the
    // nearZip) and pop the card mid-scroll; now it refreshes the data
    // under the bubble silently. The rule is pure in
    // lib/state/derive.ts#noticeShouldExpand, held by a test.
    const viewKind = current.viewKey.startsWith("zip:") ? "zip" : "settled";
    if (noticeShouldExpand(viewKind, current.zip, shownAreaKey.current)) {
      shownAreaKey.current = current.zip;
      setNoticeCollapsed(false);
    }
  }, [current]);

  // Clicking INTO a new district is a question about who governs there —
  // the card answers. Re-selecting the same district changes nothing.
  const lastExpandedDistrict = useRef<string | null>(null);
  useEffect(() => {
    if (
      ui.selectedDistrictOcdId &&
      ui.selectedDistrictOcdId !== lastExpandedDistrict.current
    ) {
      setNoticeCollapsed(false);
    }
    lastExpandedDistrict.current = ui.selectedDistrictOcdId;
  }, [ui.selectedDistrictOcdId]);

  /*
   * The engagement signals that shrink the who-governs card (2h): a pin, a
   * list row, an open meeting, a filter change. District clicks are the
   * exception above — they *ask* who governs. Pin and list engagement
   * collapse it inside their handlers below; filter engagement is caught
   * here with the adjust-during-render pattern (the dispatches happen in
   * other components), keyed on identity — `ui.filters` is one object from
   * mount until a filter action actually replaces it.
   */
  const [seenFilters, setSeenFilters] = useState(ui.filters);
  const [seenTiers, setSeenTiers] = useState(ui.tiers);
  if (seenFilters !== ui.filters || seenTiers !== ui.tiers) {
    setSeenFilters(ui.filters);
    setSeenTiers(ui.tiers);
    setNoticeCollapsed(true);
  }

  const districtPopup = useMemo(
    () =>
      lastHits.find((hit) => hit.ocdId === ui.selectedDistrictOcdId) ?? null,
    [lastHits, ui.selectedDistrictOcdId],
  );

  /**
   * Officeholders sourced for a division — legislative seats from the
   * coverage summary, and for a local governing division the curated body
   * roster (the Sunnyside catch: a school district's board members are its
   * representation, and the seat lookup alone rendered none).
   */
  const holdersFor = useCallback(
    (ocdId: string): SeatHolder[] => {
      const coverage = current?.coverage;
      const seat = coverage?.seats.find((s) => s.ocdId === ocdId);
      if (seat?.representatives.length) return seat.representatives;
      return governingRosterHoldersForDivision(ocdId);
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
      drawnDistricts,
      dropped: 0,
      searchFailed: failure !== null,
    }),
    [current, meetings, venues, location, drawnDistricts, failure],
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

      if (hits.length === 1) {
        // 6d: every selection is un-makeable by the same gesture — clicking
        // the already-selected district deselects it.
        if (hits[0].ocdId === ui.selectedDistrictOcdId) {
          dispatch({ type: "select/district", ocdId: null, districtType: null });
        } else {
          dispatch({
            type: "select/district",
            ocdId: hits[0].ocdId,
            districtType: hits[0].type,
          });
        }
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
    [dispatch, ui.selectedDistrictOcdId],
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
            onDrawnDistricts={setDrawnDistricts}
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
            {failure && (
              <SearchFailedNotice
                failure={failure}
                onRetry={() => setRetryNonce((n) => n + 1)}
              />
            )}

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
                  onMinimize={() => setNoticeCollapsed(true)}
                />
              ))}

            {/* Provenance, not headline (3): "Last checked" demotes to a
                footnote below the who-governs card. */}
            {current?.snapshot && <DataFreshness snapshot={current.snapshot} />}

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
          {officialPopup && !large && (
            <OfficialPopup
              holder={officialPopup.holder}
              seatLabel={officialPopup.seatLabel}
              tier={officialPopup.tier}
              onExpand={() =>
                openLarge({ kind: "official", ...officialPopup })
              }
              onClose={() => setOfficialPopup(null)}
            />
          )}

          {districtPopup && !officialPopup && !large && (
            <DistrictPopup
              district={districtPopup}
              onOpenOfficial={(holder) =>
                openOfficial(
                  holder,
                  districtPopup.label,
                  districtPopup.tier,
                  districtPopup.ocdId,
                )
              }
              representation={holdersFor(districtPopup.ocdId)}
              upcomingMeetings={
                // A failed fetch may not stand behind "Upcoming: 0" — the
                // popup renders couldn't-check instead (2a).
                failure
                  ? null
                  : meetings.filter(
                      (m) =>
                        m.ocdId === districtPopup.ocdId &&
                        m.status === "SCHEDULED",
                    ).length
              }
              onClose={() =>
                dispatch({ type: "select/district", ocdId: null, districtType: null })
              }
              onExpand={() =>
                openLarge({
                  kind: "entity",
                  subject: districtSubject(districtPopup, current?.meetings ?? []),
                })
              }
            />
          )}

          {popupMeeting && !large && (
            <MeetingPopup
              meeting={popupMeeting}
              body={bodyFor(popupMeeting.ocdId)}
              // Tier-3 (5a): who sits on this body, curated with citations.
              // The division fallback covers a meeting whose body is NEAR
              // the searched point but does not contain it — a Sunnyside
              // pin seen from downtown 85701 still names its board.
              representation={
                rosterHoldersForBody(
                  bodyFor(popupMeeting.ocdId)?.bodyId ?? null,
                ).length > 0
                  ? rosterHoldersForBody(
                      bodyFor(popupMeeting.ocdId)?.bodyId ?? null,
                    )
                  : governingRosterHoldersForDivision(popupMeeting.ocdId)
              }
              onClose={() => setPopupMeeting(null)}
              onExpand={() =>
                openLarge({
                  kind: "entity",
                  subject: meetingSubject(
                    popupMeeting,
                    bodyFor(popupMeeting.ocdId),
                  ),
                })
              }
            />
          )}
        </div>

        {large?.kind === "entity" && (
          <EntityModal
            subject={large.subject}
            onClose={() => setLarge(null)}
            // A roster name opens the person's full card — the one-at-a-time
            // rule swaps the large surfaces (3).
            onOpenHolder={(holder) =>
              openLarge({
                kind: "official",
                holder,
                seatLabel: null,
                tier: "local",
              })
            }
          />
        )}
        {large?.kind === "official" && (
          <OfficialModal
            holder={large.holder}
            seatLabel={large.seatLabel}
            tier={large.tier}
            // Where the reader is looking, for reaction rows — the typed
            // zip or the settled view, the search log's own basis (1b).
            reactionContext={
              view
                ? {
                    zip:
                      current && /^\d{5}$/.test(current.zip)
                        ? current.zip
                        : (view.zip ?? null),
                    lat: view.lat,
                    lng: view.lng,
                  }
                : null
            }
            onClose={() => setLarge(null)}
          />
        )}

        {/* 8a: the sidebar-count doors — large-surface lists behind the
            stat numbers, one at a time like every large surface. */}
        {ui.door && (
          <DoorOverlay
            door={ui.door}
            coverage={current?.coverage ?? null}
            meetings={current?.meetings ?? []}
            drawnDistricts={drawnDistricts}
            districtOverlayOn={ui.showDistricts}
            onOpenOfficial={(holder, seatLabel, tier) =>
              openLarge({ kind: "official", holder, seatLabel, tier })
            }
            onOpenMeeting={(meeting) =>
              openLarge({
                kind: "entity",
                subject: meetingSubject(meeting, bodyFor(meeting.ocdId)),
              })
            }
            onClose={() => dispatch({ type: "door/close" })}
          />
        )}

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
        {/* 6c (2026-08-14 second session): the first-run tour, once per
            device, after the zip resolves and the welcome overlay is out
            of the way. Skippable at every step. */}
        {restored && (
          <TutorialOverlay active={Boolean(location) && !welcomeRequested} />
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
function meetingSubject(
  meeting: Meeting,
  body: CoveredBody | null = null,
): ModalSubject {
  const direct = rosterHoldersForBody(body?.bodyId ?? null);
  const roster =
    direct.length > 0
      ? direct
      : governingRosterHoldersForDivision(meeting.ocdId);
  return {
    // What it is FIRST (3, tightened 3a 2026-08-16): the jurisdiction-
    // qualified body and sitting are the headline ("Vail Unified School
    // District — Governing Board Meeting"); when, then where ONCE — some
    // sources publish the address as the venue name, and rendering the same
    // string as Location and again as Address was the author's Vail defect.
    title: meetingHeadline(meeting),
    subtitle: meeting.jurisdiction,
    tier: tierForMeeting(meeting) ?? "local",
    badges:
      meeting.status === "SCHEDULED"
        ? []
        : [{ label: STATUS_LABEL[meeting.status], status: meeting.status }],
    facts: [
      { label: "Date", value: formatMeetingDate(meeting) },
      { label: "Time", value: formatMeetingTime(meeting), mono: true },
      {
        label: "Location",
        value: locationLine(meeting.location.name, meeting.location.address),
      },
      { label: "Status", value: STATUS_LABEL[meeting.status] },
    ],
    agenda: { meetingId: meeting.id, agendaUrl: meeting.agendaUrl },
    // 6a (2026-08-17): a concluded meeting drops the to-be-heard boilerplate
    // — there is nothing left to be heard at.
    commentAccess:
      meeting.status === "CONCLUDED"
        ? null
        : { ocdId: meeting.ocdId, bodyName: meeting.bodyName },
    // Tier-3 (5a): the curated roster where one exists; the honest absence
    // where none does.
    representation: roster,
    representationNote:
      "We haven't sourced who sits on this body. The people we hold for this area represent it in Congress and the state legislature, which is a different thing.",
    meetings: [meeting],
    sources: [{ what: meeting.title, provenance: meeting.provenance }],
  };
}

function districtSubject(
  district: DistrictHit,
  allMeetings: Meeting[] = [],
): ModalSubject {
  // 6c (2026-08-17): the county popup fills in. A county's large surface
  // lists every local meeting in view (local coverage is clipped to exactly
  // the clip counties, so the state prefix IS the county membership test
  // for local-tier meetings — Vail's AND Tucson's together), and the
  // county's own commissioners from the curated roster. Other district
  // types list their own division's meetings.
  const isCounty = /\/county:[^/]+$/.test(district.ocdId);
  const statePrefix = `state:${district.state.toLowerCase()}`;
  const meetings = allMeetings
    .filter((m) =>
      isCounty
        ? tierForMeeting(m) === "local" &&
          (m.ocdId === null || m.ocdId.includes(statePrefix))
        : m.ocdId === district.ocdId,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  // Both registry suffixes — a school district's body is `#board`, and the
  // `#governing`-only form left every school-district popup claiming no
  // sourced officeholder over a curated roster.
  const roster = governingRosterHoldersForDivision(district.ocdId);
  return {
    title: district.label,
    subtitle: `${district.typeLabel} · ${district.state}`,
    tier: district.tier,
    facts: [
      // No OCD-ID row: internal identifiers never render to readers (4a).
      { label: "Type", value: district.typeLabel },
      { label: "Tier", value: TIER_LABEL[district.tier] },
      { label: "State", value: district.state, mono: true },
    ],
    representation: roster,
    representationNote: "No sourced officeholder for this division yet.",
    meetings,
    sources: [],
  };
}

const STATUS_LABEL: Record<Meeting["status"], string> = {
  SCHEDULED: "Scheduled",
  CONCLUDED: "Concluded",
  CANCELED: "Canceled",
};

function SearchFailedNotice({
  failure,
  onRetry,
}: {
  failure: { status: number | null };
  onRetry: () => void;
}) {
  return (
    <div className="panel pointer-events-auto max-w-md px-4 py-3.5">
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-danger">
        Search failed
      </p>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-text-dim">
        We couldn&apos;t check this area — the meetings service didn&apos;t
        answer. That doesn&apos;t mean nothing is happening here.
      </p>
      {/* The failure names itself: this line is what turns the next
          screenshot of this card into a diagnosis (2a). */}
      <p className="mt-1 font-mono text-[0.625rem] text-muted">
        {failure.status !== null
          ? `The service answered ${failure.status}.`
          : "The request never got an answer."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2.5 cursor-pointer rounded border border-[var(--panel-border)] px-3 py-1.5 text-[0.75rem] text-paper hover:border-[var(--signal)] hover:text-signal"
      >
        Try again
      </button>
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
