"use client";

import { useOfficePins } from "@/hooks/use-office-pins";
import { primeOfficePoints } from "@/lib/map/office-geocode";
import { primeMemberDirectories, primeStateMemberDirectories } from "@/hooks/use-member-directory";
import { loadReaderState, loadStateAndPlace, mergeReaderCoverage, stateCoverageForZip } from "@/lib/reader/client";
import { beginReaderAgenda, discardReaderAgendaStart, fetchReaderResponse, readReaderJson } from "@/lib/reader/bootstrap";
import { groupOfficePins, officeOwners, type MapBounds, type OfficePin } from "@/lib/map/office-pins";
import { useBodyOfficeLocations } from "@/hooks/use-body-office-locations";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { forgetCamera } from "@/lib/map/camera-memory";

import dynamic from "next/dynamic";

import { CountBadge } from "@/components/map/count-badge";
import { Legend } from "@/components/map/legend";
import { Sidebar } from "@/components/shell/sidebar";
import { useDistrictLayer } from "@/hooks/use-district-layer";
import { useDivisionsRepresentation } from "@/hooks/use-division-representation";
import { districtSubject, spotDivisionsFor } from "./district-subject";
import { useNarrowing } from "@/hooks/use-narrowing";
import { useStoredTheme } from "@/hooks/use-stored-theme";
import { useStoredZip } from "@/hooks/use-stored-zip";
import type { SearchItem } from "@/lib/search";
import { bodyFromRow, resolveBodyRow, sameName } from "@/lib/search/body-row";
import { AddressResolutionProvider } from "@/components/address/address-resolution-context";
import { venueLink } from "@/lib/registry/links";
import { DataProvider, type ShellData } from "@/lib/state/data";
import { applyFilters, noticeShouldExpand } from "@/lib/state/derive";
import { deriveActiveDistrictTypes } from "@/lib/state/district-intent";
import { DEFAULT_RADIUS_KM } from "@/lib/meetings/constants";
import { carryPins } from "@/lib/map/carry-pins";
import { stateAbbrFromOcdId } from "@/lib/map/state-focus";
import { captureEvent } from "@/lib/events/client";
import { useActiveScroll } from "@/hooks/use-active-scroll";
import { readLocationOriginFor } from "@/lib/state/location-origin";
import { bodyDisplayName, readerGovernmentName, withReaderNames } from "@/lib/text/reader-names";
import { requestRadiusKm, shouldRequery } from "@/lib/map/viewport-radius";
import { useStateFocus } from "@/hooks/use-state-focus";
import { StateCrossingPrompt } from "./state-crossing-prompt";
import { PillCluster, type ReaderPop } from "@/components/shell/pill-cluster";
import { ReaderCard } from "@/components/shell/reader-card";
import { ReaderPopup } from "@/components/shell/reader-popup";
import { SelectionPill } from "@/components/shell/selection-pill";
import { Logo } from "@/components/brand/logo";
import { ResetViewButton } from "@/components/reset-view-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useReaderLayout } from "@/hooks/use-reader-layout";
import { ZipSwitcher } from "./zip-switcher";
import { PostalZipNotice } from "./postal-zip-notice";
import { useSidebarVisible } from "@/hooks/use-sidebar-visible";
import { UiProvider, useUi, useUiDispatch } from "@/lib/state/provider";
import type { MeetingSearchResult } from "@/lib/meetings/query";
import type { SnapshotStatus } from "@/lib/meetings/freshness";
import { logEvent } from "@/lib/log/client";
import { groupByVenue, placelessSittingsOfVenueBodies, type Venue } from "@/lib/meetings/venues";
import { meetingCardGaps } from "@/lib/meetings/card-gaps";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { heldSnapshot, lastReadByDivision, snapshotInView } from "@/lib/meetings/freshness";
import type { MeetingListingIdentityReadback } from "@/lib/meetings/listing-identity";
import { isPlaceUnrecorded, onlineAccessFor, placelessWhereLine } from "@/lib/meetings/online";
import type { Meeting } from "@/lib/sources/types";
import type { SeatHolder } from "@/lib/officials/lookup";
import {
  districtCardSources,
  meetingCardSources,
  personCardSources,
} from "@/lib/officials/card-sources";
import type { CoveredBody } from "@/lib/registry/coverage";
import { bodyClassLong } from "@/lib/registry/body-class-labels";
import { projectedBodyRoster } from "@/lib/registry/body-roster-client";
import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import { definitionsForBody } from "@/lib/officials/body-definitions";
import { divisionTypeLabel, tierForMeeting } from "@/lib/state/derive";
import {
  formatMeetingDate,
  formatMeetingTime,
  locationLine,
  meetingEntryTitle,
} from "@/lib/map/format";

import { SCHOOL_DISTRICT_TYPES } from "@/lib/map/districts";
import type { DistrictHit, DrawnDistrict } from "@/lib/map/districts";
import type { DistrictType } from "@/lib/state/types";

import { jurisdictionClaim, representationNoteForClaim } from "@/lib/meetings/jurisdiction-badge";

import { CoverageNotice } from "./coverage-notice";
import { GoverningSkeleton } from "./governing-skeleton";
import { DistrictPicker } from "./district-picker";
import type { CameraTarget, MapFocus, VotingSitePin } from "./map-canvas";
import type { ModalSubject } from "./popup/entity-modal";

const MeetingPanel = dynamic(
  () => import("./meeting-panel").then((m) => m.MeetingPanel),
  { ssr: false },
);
const VotingSitesPanel = dynamic(
  () => import("./voting-sites-panel").then((m) => m.VotingSitesPanel),
  { ssr: false },
);
const OfficialModal = dynamic(
  () => import("./popup/official-modal").then((m) => m.OfficialModal),
  { ssr: false },
);
const EntityModal = dynamic(
  () => import("./popup/entity-modal").then((m) => m.EntityModal),
  { ssr: false },
);
const WelcomeOverlay = dynamic(
  () => import("./welcome-overlay").then((m) => m.WelcomeOverlay),
  { ssr: false },
);
const TutorialOverlay = dynamic(
  () => import("./tutorial-overlay").then((m) => m.TutorialOverlay),
  { ssr: false },
);

interface TaggedResult extends MeetingSearchResult {
  zip: string;
  /** Which view request produced this answer; stale answers are dropped. */
  viewKey: string;
  /** The nearest ZCTA to a settled viewport, resolved server-side. */
  nearZip?: string | null;
  /** Present when the committed snapshot served this answer. */
  snapshot?: SnapshotStatus | null;
}

interface ViewTarget {
  key: string;
  kind: "zip" | "settled";
  /** Known for a typed zip; resolved server-side for a settled viewport. */
  zip: string | null;
  lat: number;
  lng: number;

  radiusKm?: number;
  state?: string;
}

const EMPTY_COVERED_BODIES: CoveredBody[] = [];
const EMPTY_MEETINGS: Meeting[] = [];
// Start the split map download when its client module arrives, before hydration's effects.
let arrivingMap = typeof window === "undefined" ? null : import("./map-canvas");
void arrivingMap?.catch(() => { arrivingMap=null; });
let arrivingAsk: Promise<typeof import("@/components/ask/ask-box")> | null = null;
function prepareAsk() {
  if (!arrivingAsk) {
    arrivingAsk = import("@/components/ask/ask-box");
    void arrivingAsk.catch(() => { arrivingAsk = null; });
  }
  return arrivingAsk;
}

export function MapEntry() {
  return (
    <UiProvider>
      <MapEntryInner />
    </UiProvider>
  );
}

function MapEntryInner() {
  const [MapCanvas, setMapCanvas] = useState<typeof import("./map-canvas").MapCanvas | null>(null);
  const [AskBox, setAskBox] = useState<typeof import("@/components/ask/ask-box").AskBox | null>(null);
  const [DoorOverlay, setDoorOverlay] = useState<typeof import("./door-overlay").DoorOverlay | null>(null);
  const [ListOverlay, setListOverlay] = useState<typeof import("./list-overlay").ListOverlay | null>(null);
  const [mapLoadError, setMapLoadError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    void (arrivingMap ?? import("./map-canvas")).then(module => {
      module.prepareMapWorkers();
      if (active) setMapCanvas(() => module.MapCanvas);
    }).catch(error => { if (active) setMapLoadError(error); });
    return () => { active = false; };
  }, []);
  const { location, restored, remember } = useStoredZip();
  const { theme } = useStoredTheme();
  const ui = useUi();
  const dispatch = useUiDispatch();

  const takeForeground = useCallback(() => {
    discardReaderAgendaStart();
    dispatch({ type: "select/venue", key: null });
    dispatch({ type: "select/district", ocdId: null, districtType: null });
  }, [dispatch]);

  const [mapPresentationReady, setMapPresentationReady] = useState(false);
  const onMapPresentationReady = useCallback((ready: boolean) => {
    setMapPresentationReady(ready);
  }, []);
  const [result, setResult] = useState<TaggedResult | null>(null);
  /** How the meetings fetch failed: the HTTP status, or null for no answer. Named on the failure card. */
  const [failure, setFailure] = useState<{ status: number | null } | null>(null);
  // Bumped by the failure card's retry to re-run the current view's fetch.
  const [retryNonce, setRetryNonce] = useState(0);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [districtsFailed, setDistrictsFailed] = useState(false);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  // The card counts this list's length and the districts door renders its rows.
  const [drawnDistricts, setDrawnDistricts] = useState<DrawnDistrict[]>([]);
  // Reopened by CHANGE and by reset; distinct from "no zip stored yet".
  const [welcomeRequested, setWelcomeRequested] = useState(false);

  // "default" is per-width (desktop visible, phone hidden); "open"/"closed" are
  // the reader's choice and win at any width. CSS keys off data-sidebar on <main>.
  const [sidebarState, setSidebarState] = useState<"default" | "open" | "closed">(
    "default",
  );
  // Dismissal returns to the per-width default.
  const dismissSidebar = useCallback(
    () => setSidebarState((s) => (s === "open" ? "default" : s)),
    [],
  );

  // The who-governs card collapses to a pill when the reader engages with
  // something specific, and starts collapsed.
  const [noticeCollapsed, setNoticeCollapsed] = useState(true);
  /** The one small popup on screen, if any. */
  const [pop, setPop] = useState<ReaderPop>(null);

  const [popupMeeting, setPopupMeeting] = useState<Meeting | null>(null);

  type LargeSurface =
    | { kind: "entity"; subject: ModalSubject }
    | {
        kind: "official";
        holder: SeatHolder;
        seatLabel: string | null;
        tier: "local" | "state" | "national";
        /** The district office the card was opened from, shown near its top. */
        office?: OfficePin;
      };
  const LARGE_STACK_LIMIT = 8;
  const [largeStack, setLargeStack] = useState<LargeSurface[]>([]);
  const large = largeStack.length > 0 ? largeStack[largeStack.length - 1] : null;
  const setLarge = useCallback((next: LargeSurface | null) => {
    setLargeStack(next ? [next] : []);
  }, []);
  useEffect(() => discardReaderAgendaStart, []);
  // The last district hits, so the popup can recover the full set.
  const [lastHits, setLastHits] = useState<DistrictHit[]>([]);

  // District visibility is persisted by its own hook; the store mirrors it one-way.
  const {
    enabled: showDistricts,
    restored: districtsRestored,
    setEnabled: setShowDistricts,
  } = useDistrictLayer();

  useEffect(() => {
    dispatch({ type: "districts/show", value: showDistricts });
  }, [showDistricts, dispatch]);

  // A settled viewport overrides the typed zip's view until the next zip
  // entry; `forZip` makes it stale on a new zip without an effect.
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
            state: location.postal?.state,
          }
        : null,
    [location],
  );

  const view =
    settled && location && settled.forZip === location.zip
      ? settled.target
      : zipView;

  useEffect(() => {
    // Fires as soon as a `view` is known; the camera never gates the data. A
    // settled-viewport re-query happens only on a user gesture.
    if (!view) return;

    const controller = new AbortController();
    const { key, zip, lat, lng, radiusKm } = view;

    let status: number | null = null;
    const publish = (payload: MeetingSearchResult & { nearZip?: string | null }) => {
      if (controller.signal.aborted) return;
      setResult({
        ...withReaderNames(payload),
        zip: zip ?? payload.nearZip ?? "the area shown",
        viewKey: key,
      });
      setFailure(null);
    };
    void loadStateAndPlace({
      state: () => zip && view.state ? loadReaderState(view.state, zip) : Promise.resolve(null),
      place: async () => {
        const zipParam = zip ? `&zip=${zip}` : "";
        const radiusParam = radiusKm ? `&radiusKm=${radiusKm}` : "";
        const response = await fetchReaderResponse(
          `/api/meetings?lat=${lat}&lng=${lng}${zipParam}${radiusParam}`,
          { headers: { accept: "application/json" }, signal: controller.signal },
        );
        if (!response.ok) {
          status = response.status;
          throw new Error(`Meetings request failed: ${response.status}`);
        }
        return readReaderJson<MeetingSearchResult & { nearZip?: string | null }>(response);
      },
      signal: controller.signal,
      onState: state => {
        if (state.officePoints) primeOfficePoints(state.officePoints);
        primeStateMemberDirectories(state.memberDirectories, state.state);
        primeMemberDirectories(state.directory, state.state);
        const coverage = zip ? stateCoverageForZip(state, zip) : null;
        if (!coverage) return;
        const divisions = state.zipPlaces[zip!];
        publish({
          coverage, meetings: [], localPending: true, tier: "none", center: { lat, lng },
          radiusKm: radiusKm ?? DEFAULT_RADIUS_KM,
          governingOcdIds: divisions ? [...divisions.ids] : null, partialOcdIds: divisions ? [...divisions.partial] : null,
        });
      },
      onPlace: (payload, state) => {
        const entry = state && zip ? state.zipPlaces[zip] : undefined;
        const complete = {
          ...payload,
          ...(entry ? { governingOcdIds: [...entry.ids], partialOcdIds: [...entry.partial] } : {}),
          localPending: false,
          coverage: mergeReaderCoverage(state && zip ? stateCoverageForZip(state, zip) : null, payload.coverage, payload.meetings.length),
        };
        // Both async reads are complete. Commit their answer before another
        // map animation frame can postpone the reader's ready information.
        flushSync(() => publish(complete));
        logEvent(
          "SEARCH",
          Array.isArray(payload.governingOcdIds) ? [...payload.governingOcdIds] : [],
          { tier: payload.tier, radiusKm: payload.radiusKm, meetingCount: payload.meetings.length },
          zip ?? payload.nearZip ?? null,
        );
      },
    }).catch(() => {
      if (controller.signal.aborted) return;
      console.error(`meetings fetch failed for ${view.kind} view`);
      // State officials remain usable when the independent local read fails.
      setResult(previous => previous?.viewKey === key ? previous : null);
      setFailure({ status });
    });

    return () => controller.abort();
  }, [view, retryNonce]);

  const search = useCallback(
    (zip: string, lat: number, lng: number) => {
      discardReaderAgendaStart();
      dispatch({ type: "select/venue", key: null });
      // A new area clears every entity of the previous one.
      dispatch({ type: "select/district", ocdId: null, districtType: null });
      setPopupMeeting(null);
      setLarge(null);
      setPop(null);
      setLastHits([]);
      setFailure(null);
      setWelcomeRequested(false);
      dismissSidebar();
      setNoticeCollapsed(false);
      // Re-entering a zip returns to it even after panning away.
      setSettled(null);
      remember({ zip, lat, lng });
    },
    [remember, dispatch, dismissSidebar, setLarge],
  );

  const addressLocated = useCallback((zip: string, lat: number, lng: number) => {
    search(zip, lat, lng);
    setSettled({ forZip: zip, target: {
      key: `street:${lat.toFixed(4)},${lng.toFixed(4)}`, kind: "settled", zip: null, lat, lng,
    } });
    setFocus({ lat, lng, zoom: 14, key: `address:${lat.toFixed(4)},${lng.toFixed(4)}` });
  }, [search]);

  const focusState = useStateFocus(view);
  const { contains } = focusState;

  // Once per ZIP, with how the reader reached it; the server stamps home vs browsing.
  const viewedZip = location?.zip ?? null;
  useEffect(() => {
    if (viewedZip) {
      captureEvent({ type: "ZIP_VIEW", zip: viewedZip, locationOrigin: readLocationOriginFor(viewedZip) });
    }
  }, [viewedZip]);
  useActiveScroll("MAP");

  const camera = useMemo<CameraTarget | null>(
    () =>
      location
        ? { zip: location.zip, lat: location.lat, lng: location.lng }
        : null,
    [location],
  );

  const current = result && view && result.viewKey === view.key ? result : null;

  const [held, setHeld] = useState<{
    result: TaggedResult;
    /* The zip the held answer belongs to. */
    forZip: string | null;
    stateOcdId: string | null;
  } | null>(null);
  if (current && held?.result !== current) {
    setHeld({ result: current, forZip: location?.zip ?? null, stateOcdId: focusState.activeOcdId });
  }
  const pinned = carryPins({
    current,
    held,
    stateOcdId: focusState.activeOcdId,
    locationZip: location?.zip ?? null,
  });
  const shown = pinned;
  const refreshing = current === null && shown !== null;

  // Everything downstream reads this one filtered list.
  const meetings = useMemo<Meeting[]>(
    () =>
      pinned
        ? applyFilters({
            meetings: pinned.meetings,
            ui,
            // Constrain by radius only once the reader moved the slider.
            center: ui.radiusOverridden ? (ui.nearMe ?? view) : null,
          })
        : [],
    [pinned, ui, view],
  );

  const officeLocations = useBodyOfficeLocations(pinned?.coverage?.bodies ?? EMPTY_COVERED_BODIES, pinned?.meetings ?? EMPTY_MEETINGS);
  const venues = useMemo<Venue[]>(() => groupByVenue(meetings, pinned?.listingIdentity, officeLocations), [meetings, pinned?.listingIdentity, officeLocations]);

  /* The reader's representatives' district offices: a pin each, or a line on the venue card in the same building. */
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const officePins = useOfficePins(pinned?.coverage ?? null, { bounds: mapBounds, venues });
  const officeSites = useMemo(() => groupOfficePins(officePins.pins.filter(pin =>
    contains(pin.lat, pin.lng),
  )), [officePins.pins, contains]);
  const officeOwnerById = useMemo(
    () => new Map(officeOwners(pinned?.coverage ?? null).map((owner) => [owner.holder.id, owner])),
    [pinned?.coverage],
  );

  const allVenues = useMemo<Venue[]>(
    () => (pinned ? groupByVenue(pinned.meetings, pinned.listingIdentity, officeLocations).filter(venue =>
      venue.lat !== null && venue.lng !== null && contains(venue.lat, venue.lng),
    ) : []),
    [pinned, officeLocations, contains],
  );
  const visibleVenueKeys = useMemo(
    () => new Set(venues.map((v) => v.key)),
    [venues],
  );

  const selectedVenue = useMemo(
    () => venues.find((v) => v.key === ui.selectedVenueKey) ?? null,
    [venues, ui.selectedVenueKey],
  );
  /* The same bodies' sittings with no building, from the filtered `meetings`. */
  const selectedVenuePlaceless = useMemo(
    () => (selectedVenue ? placelessSittingsOfVenueBodies(selectedVenue, meetings) : []),
    [selectedVenue, meetings],
  );

  const openSurface = useCallback(
    (surface: "sidebar" | "wgh" | "large") => {
      // The sidebar stays put (dimmed under the scrim) while the card is open.
      if (surface === "sidebar") setSidebarState("open");
      setNoticeCollapsed(surface !== "wgh");
      if (surface !== "large") setLarge(null);
    },
    [setLarge],
  );

  /** Open a card from inside another one, keeping the way back. */
  const pushLarge = useCallback((next: LargeSurface) => {
    beginReaderAgenda(next.kind === "entity" ? next.subject.agenda : null);
    setLargeStack((stack) =>
      [...stack, next].slice(-LARGE_STACK_LIMIT),
    );
  }, []);

  /** The one-at-a-time rule: any large surface replaces every other. */
  const openLarge = useCallback(
    (next: LargeSurface) => {
      beginReaderAgenda(next.kind === "entity" ? next.subject.agenda : null);
      captureEvent(
        next.kind === "official"
          ? { type: "CARD_OPEN", cardId: `OFFICIAL:${next.holder.id}`, cardKind: "OFFICIAL" }
          : { type: "CARD_OPEN", cardId: `${next.subject.subjectKind}:${next.subject.subjectId}`, cardKind: next.subject.subjectKind },
      );
      setLarge(next);
      // The sidebar and the who-governs card yield to a large card.
      openSurface("large");
      // The large tier subsumes the compact card that opened it; the list overlay yields.
      setPopupMeeting(null);
      dispatch({ type: "list/open", open: false });
      // A sidebar door is a large surface too.
      dispatch({ type: "door/close" });
    },
    [dispatch, openSurface, setLarge],
  );

  const openOfficial = useCallback(
    (
      holder: SeatHolder,
      seatLabel: string | null,
      tier: "local" | "state" | "national",
      ocdId: string | null,
      office?: OfficePin,
    ) => {
      // A person opens their full card in the one large card.
      openLarge({ kind: "official", holder, seatLabel, tier, ...(office ? { office } : {}) });
      // The holder id names the official opened, never the reader.
      logEvent("OFFICIAL_OPENED", ocdId ? [ocdId] : [], {
        officialId: holder.id,
      });
    },
    [openLarge],
  );

  /** An office opens its owner's battlecard, with that office near the top. */
  const openOffice = useCallback(
    (office: OfficePin) => {
      const owner = officeOwnerById.get(office.ownerId);
      if (owner) openOfficial(owner.holder, owner.seatLabel, owner.tier, null, office);
    },
    [officeOwnerById, openOfficial],
  );
  /* Bounds arrive after every settled move; an unchanged view keeps its identity so nothing recomputes. */
  const onMapBounds = useCallback((next: MapBounds) => {
    setMapBounds((current) =>
      current && current.west === next.west && current.south === next.south && current.east === next.east && current.north === next.north
        ? current
        : next,
    );
  }, []);

  // Opening the list overlay closes any large popup. Adjust-during-render.
  const [seenListOpen, setSeenListOpen] = useState(ui.listOverlayOpen);
  if (seenListOpen !== ui.listOverlayOpen) {
    setSeenListOpen(ui.listOverlayOpen);
    if (ui.listOverlayOpen) {
      setLarge(null);
      // The list must not sit under the phone drawer's backdrop.
      dismissSidebar();
    }
  }

  // An opening door closes any large popup and dismisses the phone drawer.
  const [seenDoor, setSeenDoor] = useState(ui.door);
  if (seenDoor !== ui.door) {
    setSeenDoor(ui.door);
    if (ui.door !== null) {
      setLarge(null);
      dismissSidebar();
    }
  }

  const openMeetingCard = useRef<(meeting: Meeting) => void>(() => {});
  const openMeeting = useCallback((meeting: Meeting) => {
    // A meeting opens its full card inside the one card.
    openMeetingCard.current(meeting);
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

  // The ref skips the mount run: default tiers are not a reader's choice.
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

  const onViewportSettle = useCallback(
    (center: { lat: number; lng: number; viewportRadiusKm: number }) => {
      const crossing = focusState.stateAt(center.lat, center.lng) !== focusState.activeOcdId;
      if (!location || welcomeRequested) return;
      if (!crossing && (popupMeeting || ui.selectedVenueKey || ui.selectedDistrictOcdId)) return;

      const radiusKm = requestRadiusKm(center.viewportRadiusKm);
      // A materially larger radius is its own reason to re-ask.
      if (
        !crossing && !shouldRequery(
          view
            ? {
                lat: view.lat,
                lng: view.lng,
                // Compare a ZIP view against the default radius.
                radiusKm: view.radiusKm ?? DEFAULT_RADIUS_KM,
              }
            : null,
          { lat: center.lat, lng: center.lng, radiusKm },
        )
      ) {
        return;
      }
      if (crossing) {
        setResult(null);
        setHeld(null);
        dispatch({ type: "select/venue", key: null });
        dispatch({ type: "select/district", ocdId: null, districtType: null });
        dispatch({ type: "district/pick", pick: null });
        dispatch({ type: "scope/jurisdiction", ocdId: null });
        dispatch({ type: "radius/clear" });
        dispatch({ type: "nearMe/toggle", enabled: false });
        dispatch({ type: "search/clear" });
        dispatch({ type: "list/open", open: false });
        setPopupMeeting(null);
        setLarge(null);
        setPop(null);
        setLastHits([]);
        setDrawnDistricts([]);
      }
      setSettled({
        forZip: location.zip,
        target: {
          // The radius is part of the key: same centre, different zoom is a different question.
          key: `settled:${center.lat.toFixed(3)},${center.lng.toFixed(3)}@${radiusKm}:${focusState.stateAt(center.lat, center.lng) ?? ""}`,
          kind: "settled",
          zip: null,
          lat: center.lat,
          lng: center.lng,
          radiusKm,
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
      focusState,
      dispatch,
      setLarge,
    ],
  );

  /* The who-governs card answers once per resolved area; panning never re-expands it. */
  const shownAreaKey = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    // Only a typed-zip view counts as a new area (lib/state/derive.ts#noticeShouldExpand).
    const viewKind = current.viewKey.startsWith("zip:") ? "zip" : "settled";
    if (noticeShouldExpand(viewKind, current.zip, shownAreaKey.current)) {
      shownAreaKey.current = current.zip;

      setNoticeCollapsed(true);
    }
  }, [current]);

  const selectionKey = `${ui.selectedVenueKey ?? ""}\u0000${ui.selectedDistrictOcdId ?? ""}`;
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (selectionKey !== prevSelectionKey) {
    setPrevSelectionKey(selectionKey);
    if (ui.selectedVenueKey || ui.selectedDistrictOcdId) {
      setPopupMeeting(null);
    }
  }

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

  const districtRepresentations = useDivisionsRepresentation(
    current?.coverage ?? null,
    lastHits.flatMap(hit => [hit.ocdId, ...spotDivisionsFor(hit, lastHits).map(division => division.ocdId)]),
  );

  const bodyForMeeting = useCallback(
    (meeting: Meeting): CoveredBody | null => {
      const bodies = current?.coverage?.bodies;
      if (!bodies || !meeting.bodyId) return null;
      return bodies.find((b) => b.bodyId === meeting.bodyId) ?? null;
    },
    [current],
  );
  useEffect(() => {
    openMeetingCard.current = (meeting: Meeting) =>
      openLarge({
        kind: "entity",
        subject: meetingSubject(meeting, bodyForMeeting(meeting)),
      });
  }, [openLarge, bodyForMeeting]);

  useEffect(() => {
    if (!current) return;
    dispatch({
      type: "coverage/report",
      tier: current.tier,
      // Reported here once a real adapter drops anything.
      dropped: 0,
    });
  }, [current, dispatch]);

  const data = useMemo<ShellData>(() => {

    const answer = current ?? shown;
    return {
      allMeetings: answer?.meetings ?? [],
      commentAccess: answer?.commentAccess ?? [],
      everydayRouting: answer?.everydayRouting ?? null,
      meetings,
      listingIdentity: pinned?.listingIdentity,
      venues,
      officePins: officePins.pins.length,
      result: answer,
      location: answer && /^\d{5}$/.test(answer.zip)
        ? { zip: answer.zip, lat: answer.center.lat, lng: answer.center.lng }
        : view?.kind === "zip" ? location : null,
      drawnDistricts,
      dropped: 0,
      searchFailed: failure !== null,
      // Only the street-point view's key starts with "street:".
      atAddress: view?.key.startsWith("street:") ?? false,
      /* One set for every surface. Missing or null both become null ("cannot say"), never an empty set. */
      governing: answer?.governingOcdIds
        ? new Set(answer.governingOcdIds)
        : null,
      /* Same null discipline as `governing`. */
      zipPartial: answer?.partialOcdIds ? new Set(answer.partialOcdIds) : null,
      basis: view?.key.startsWith("street:") ? "ADDRESS" : "ZIP",
    };
  }, [current, shown, meetings, pinned?.listingIdentity, venues, officePins.pins.length, location, drawnDistricts, failure, view]);

  const onSearchPick = useCallback((item: SearchItem) => {
    if (item.venueKey) dispatch({ type: "select/venue", key: item.venueKey });
    if (item.lat !== null && item.lng !== null) {
      setFocus({ lat: item.lat, lng: item.lng, zoom: 13, key: item.id });
    }

    if (!item.venueKey) {
      if (item.kind === "meeting") {
        const meeting = (current?.meetings ?? []).find(
          (m) => `meeting:${m.id}` === item.id,
        );
        if (meeting) {
          openLarge({
            kind: "entity",
            subject: meetingSubject(meeting, bodyForMeeting(meeting)),
          });
        }
      } else if (item.kind === "body") {

        const resolved = resolveBodyRow(item, current?.coverage?.bodies ?? []);
        const body =
          resolved?.body ??
          (item.ocdId !== null
            ? bodyFromRow({
                label: item.label,
                ocdId: item.ocdId,
                jurisdiction:
                  (current?.meetings ?? []).find(
                    (m) => m.ocdId === item.ocdId && sameName(m.bodyName, item.label),
                  )?.jurisdiction ?? item.label,
              })
            : null);
        if (body) {
          openLarge({
            kind: "entity",
            subject: bodySubject(body, current?.meetings ?? []),
          });
        }
      } else if (item.kind === "place" && item.ocdId !== null) {
        // The place card lists every body we hold in the place; it elects none.
        openLarge({
          kind: "entity",
          subject: placeSubject(
            item.ocdId,
            item.label,
            item.tier,
            current?.coverage?.bodies ?? [],
            current?.meetings ?? [],
            current?.listingIdentity,
          ),
        });
      }
    }

    // Picking a result dismisses the phone drawer covering the map.
    dismissSidebar();
  }, [dispatch, dismissSidebar, current, openLarge, bodyForMeeting]);

  const onPickMeeting = useCallback(
    (meeting: Meeting) => {
      // A list row opens that meeting's card one level deeper; the camera still moves to the room.
      openMeeting(meeting);
      /* An online meeting is in no venue: the camera stays where the reader left it. */
      if (meeting.location) {
        setFocus({
          lat: meeting.location.lat,
          lng: meeting.location.lng,
          zoom: 14,
          key: meeting.id,
        });
      }
    },
    [openMeeting],
  );

  const onReset = useCallback(() => {
    dispatch({ type: "reset" });
    setFocus(null);
    /* Reset forgets the remembered camera. */
    forgetCamera();
    if (location) {
      search(location.zip, location.lat, location.lng);
      return;
    }
    setWelcomeRequested(true);
  }, [dispatch, location, search]);

  // Drawn overlays: the checked district types, gated by the master toggle
  // (lib/state/district-intent.ts).
  const activeDistrictTypes = useMemo(
    () =>
      deriveActiveDistrictTypes(
        showDistricts,
        districtsFailed,
        ui.filters.districtTypes as DistrictType[],
        // The same Local/State/Federal selection the meeting list filters on.
        ui.tiers,
      ),
    [showDistricts, districtsFailed, ui.filters.districtTypes, ui.tiers],
  );

  const selectedDistrict = useMemo(
    () =>
      ui.selectedDistrictOcdId && ui.selectedDistrictType
        ? { type: ui.selectedDistrictType, ocdId: ui.selectedDistrictOcdId }
        : null,
    [ui.selectedDistrictOcdId, ui.selectedDistrictType],
  );

  const noticeZip =
    shown && /^\d{5}$/.test(shown.zip) ? shown.zip : view?.kind === "zip" ? (location?.zip ?? "") : "";
  const narrowing = useNarrowing(noticeZip);

  const narrowedDistricts = useMemo(
    () =>
      narrowing.divisions.flatMap((ocdId) =>
        ocdId.includes("school_district:")
          ? SCHOOL_DISTRICT_TYPES.map((type) => ({ ocdId, type }))
          : [{ ocdId, type: "municipal" as DistrictType }],
      ),
    [narrowing.divisions],
  );

  // Applying a narrowing turns on the boundary overlay with the municipal and
  // school layers; declining or undoing never touches overlay settings.
  const onNarrowApplied = useCallback(() => {
    setShowDistricts(true);
    dispatch({
      type: "filter/districtTypesSet",
      value: [
        ...new Set([
          ...ui.filters.districtTypes,
          "municipal" as DistrictType,
          // All three school layers, whichever holds the reader's district.
          ...SCHOOL_DISTRICT_TYPES,
        ]),
      ],
    });
  }, [setShowDistricts, dispatch, ui.filters.districtTypes]);

  const onStreetPoint = useCallback(
    (point: { lat: number; lng: number; street: string }) => {
      if (!location) return;
      setFocus({
        lat: point.lat,
        lng: point.lng,
        zoom: 14,
        key: `street:${point.street}:${point.lat.toFixed(4)}`,
      });
      setSettled({
        forZip: location.zip,
        target: {
          key: `street:${point.lat.toFixed(4)},${point.lng.toFixed(4)}`,
          kind: "settled",
          // Null: the server resolves and logs the nearest ZCTA, never the street point.
          zip: null,
          lat: point.lat,
          lng: point.lng,
        },
      });
    },
    [location],
  );

  const onDistrictClick = useCallback(
    (hits: DistrictHit[], at: { x: number; y: number }) => {
      // Remember the whole set: the picker may select any of them.
      setLastHits(hits);

      if (hits.length === 1) {
        // Clicking the already-selected district deselects it.
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
  /** The basemap notice clears when the basemap draws again. */
  const onTilesRecovered = useCallback(() => setTilesFailed(false), []);
  const onDistrictError = useCallback(() => setDistrictsFailed(true), []);

  const [votingPins, setVotingPins] = useState<VotingSitePin[]>([]);
  /** The point the reader's address resolved to, for the ten-mile ring. */
  const [votingAddressPoint, setVotingAddressPoint] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [selectedVotingSiteId, setSelectedVotingSiteId] = useState<string | null>(
    null,
  );
  const onVotingSites = useCallback((sites: VotingSitePin[]) => {
    setVotingPins(sites);
    // ZIP answers may have no address point; their sites still locate the map.
    const point = sites[0];
    if (point) setFocus({ lat: point.lat, lng: point.lng, zoom: 10, key: `vote:${point.lat},${point.lng}` });
  }, []);
  const onVotingAddressPoint = useCallback((point: { lat: number; lng: number } | null) => {
    setVotingAddressPoint(point);
    if (point) setFocus({ lat: point.lat, lng: point.lng, zoom: 10, key: `vote:${point.lat},${point.lng}` });
  }, []);

  const closePop = useCallback(() => {
    setPop(null);
    setVotingPins([]);
    setSelectedVotingSiteId(null);
  }, []);

  /* Near me resolves districts through the same path as a narrowed street address. */
  const onNearMePoint = useCallback(
    (point: { lat: number; lng: number }) => {
      onStreetPoint({ ...point, street: "your approximate location" });
      dismissSidebar();
    },
    [onStreetPoint, dismissSidebar],
  );

  const onSelectVenue = useCallback(
    (venue: Venue) => {
      discardReaderAgendaStart();
      // A pin opens its venue card and focuses the map on the room.
      setLarge(null);
      dispatch({ type: "list/open", open: false });
      dispatch({ type: "door/close" });
      dispatch({ type: "select/venue", key: venue.key });
      setNoticeCollapsed(true);
      if (venue.lat !== null && venue.lng !== null) {
        setFocus({ lat: venue.lat, lng: venue.lng, zoom: 15, key: `venue:${venue.key}` });
      }
    },
    [dispatch, setLarge],
  );

  const sidebarVisible = useSidebarVisible(sidebarState);
  const {
    bp: layoutBp,
    headerBottom,
    measureHeader,
    mapInsets: insetsFor,
    sheetHeight,
  } = useReaderLayout();
  const wghOpen = Boolean(shown) && !noticeCollapsed;
  // The sidebar stays under the scrim while a card is open.
  const sidebarUp = sidebarVisible;

  const clusterZip = shown
    ? /^\d{5}$/.test(shown.zip)
      ? shown.zip
      : (shown.nearZip ?? null)
    : view?.kind === "zip" ? (location?.zip ?? null) : null;
  const clusterCoverage = shown?.coverage ?? null;
  const clusterOcdIds = useMemo(
    () =>
      clusterCoverage
        ? [
            ...new Set(
              [
                ...clusterCoverage.bodies.map((b) => b.ocdId),
                ...clusterCoverage.seats.map((s) => s.ocdId),
              ].filter((id): id is string => Boolean(id)),
            ),
          ]
        : [],
    [clusterCoverage],
  );

  type CardView =
    | { kind: "large"; surface: LargeSurface }
    | { kind: "venue"; venue: Venue }
    | { kind: "door"; door: "bodies" | "districts" | "officials" }
    | { kind: "list" }
    | { kind: "governs" };
  const cardView: CardView | null = large
    ? { kind: "large", surface: large }
    : selectedVenue
      ? { kind: "venue", venue: selectedVenue }
      : ui.door
        ? { kind: "door", door: ui.door }
        : ui.listOverlayOpen
          ? { kind: "list" }
          : wghOpen
            ? { kind: "governs" }
            : null;
  const cardKey = cardView
    ? cardView.kind === "large"
      ? `large:${largeStack.length}:${
          cardView.surface.kind === "entity"
            ? cardView.surface.subject.subjectId
            : cardView.surface.holder.id
        }`
      : cardView.kind === "venue"
        ? `venue:${cardView.venue.key}`
        : cardView.kind === "door"
          ? `door:${cardView.door}`
          : `${cardView.kind}`
    : null;
  const cardLabel = cardView ? cardViewLabel(cardView) : "";
  const cardKind = cardView?.kind;
  useEffect(() => {
    let active = true;
    // Publish a downloaded panel directly, as with the map. Suspending an
    // already-open card adds React's reveal delay after its module arrives.
    const failed = (kind: "list" | "door" | "ask", error: Error) => { if (active && (cardKind === kind || kind === "ask" && pop === "ask")) setMapLoadError(error); };
    const phoneMenu = layoutBp === "phone" && sidebarState === "open";
    if ((cardKind === "list" || phoneMenu) && !ListOverlay) void import("./list-overlay")
      .then(module => { if (active) setListOverlay(() => module.ListOverlay); }).catch(error=>failed("list",error));
    if ((cardKind === "door" || phoneMenu) && !DoorOverlay) void import("./door-overlay")
      .then(module => { if (active) setDoorOverlay(() => module.DoorOverlay); }).catch(error=>failed("door",error));
    if (pop === "ask" && !AskBox) void prepareAsk()
      .then(module => { if (active) setAskBox(() => module.AskBox); }).catch(error=>failed("ask",error));
    return () => { active = false; };
  }, [cardKind, pop, AskBox, DoorOverlay, ListOverlay, layoutBp, sidebarState]);

  interface CardSnapshot {
    key: string;
    label: string;
    largeStack: LargeSurface[];
    venueKey: string | null;
    door: "bodies" | "districts" | "officials" | null;
    listOpen: boolean;
    listFocus: {
      focusBodyId: string | null;
      focusBodyName: string | null;
      focusDivision: { ocdId: string; name: string } | null;
    };
    wgh: boolean;
    scroll: number;
  }
  const [backStack, setBackStack] = useState<CardSnapshot[]>([]);
  const [restoreScroll, setRestoreScroll] = useState(0);
  // Parked: the card is set aside so the map can show a boundary or a room,
  // and the selection pill's "Details ↗" brings it back unchanged.
  const [parked, setParked] = useState(false);
  const cardScroll = useRef(0);
  const restoring = useRef(false);
  // "Show the whole boundary" from the Districts list: the district card
  // opens PARKED, so the map shows the fitted boundary with Details ↗.
  const parkOnOpen = useRef(false);
  const lastCard = useRef<CardSnapshot | null>(null);
  const historyDepth = useRef(0);

  const snapshotNow: CardSnapshot | null = cardKey
    ? {
        key: cardKey,
        label: cardLabel,
        largeStack,
        venueKey: ui.selectedVenueKey,
        door: ui.door,
        listOpen: ui.listOverlayOpen,
        listFocus: {
          focusBodyId: ui.listFocusBodyId,
          focusBodyName: ui.listFocusBodyName,
          focusDivision: ui.listFocusDivision,
        },
        wgh: !noticeCollapsed,
        scroll: 0,
      }
    : null;

  // Transitions only: runs when the view changes, reading the snapshot the
  // previous render stored (the effect after this one keeps it current).
  useEffect(() => {
    const prev = lastCard.current;
    const prevKey = prev?.key ?? null;
    if (cardKey !== prevKey) {
      if (restoring.current) {
        // A Back: the restored view is not a new level.
      } else if (prev && cardKey) {
        // Deeper inside the card: remember where the reader was. Read the
        // position now — the updater runs after this effect resets it.
        const left = { ...prev, scroll: cardScroll.current };
        setBackStack((stack) => [...stack, left]);
        setRestoreScroll(0);
        pushCardHistory(historyDepth);
      } else if (cardKey) {
        setBackStack([]);
        setRestoreScroll(0);
        pushCardHistory(historyDepth);
      } else {
        setBackStack([]);
        unwindCardHistory(historyDepth);
      }
      cardScroll.current = 0;
      if (cardKey) {
        setPop(null);
        setParked(parkOnOpen.current);
        parkOnOpen.current = false;
      }
    }
    restoring.current = false;
  }, [cardKey]);
  useEffect(() => {
    lastCard.current = snapshotNow;
  });

  const closeCard = useCallback(() => {
    discardReaderAgendaStart();
    setLargeStack([]);
    dispatch({ type: "list/open", open: false });
    dispatch({ type: "door/close" });
    dispatch({ type: "select/venue", key: null });
    setNoticeCollapsed(true);
    setBackStack([]);
    setParked(false);
  }, [dispatch]);

  const applySnapshot = useCallback(
    (snap: CardSnapshot) => {
      const restored = snap.largeStack.at(-1);
      beginReaderAgenda(restored?.kind === "entity" ? restored.subject.agenda : null);
      setLargeStack(snap.largeStack);
      dispatch({ type: "select/venue", key: snap.venueKey });
      if (snap.listOpen) {
        dispatch({ type: "list/open", open: true, ...snap.listFocus });
      } else if (snap.door) {
        dispatch({ type: "door/open", door: snap.door });
      } else {
        dispatch({ type: "list/open", open: false });
        dispatch({ type: "door/close" });
      }
      setNoticeCollapsed(!snap.wgh);
      setRestoreScroll(snap.scroll);
    },
    [dispatch],
  );

  const backCard = useCallback(() => {
    const snap = backStack[backStack.length - 1];
    if (!snap) {
      closeCard();
      return;
    }
    setBackStack((stack) => stack.slice(0, -1));
    // The restored view is not a new level; flag it only when the view will
    // actually change (the transition effect consumes the flag).
    if (snap.key !== cardKey) restoring.current = true;
    applySnapshot(snap);
  }, [backStack, applySnapshot, closeCard, cardKey]);

  const backRef = useRef(backCard);
  const closeRef = useRef(closeCard);
  useEffect(() => {
    backRef.current = backCard;
    closeRef.current = closeCard;
  }, [backCard, closeCard]);
  useEffect(() => {
    const onPop = () => {
      if (historyDepth.current <= 0) return;
      historyDepth.current -= 1;
      if (historyDepth.current === 0) closeRef.current();
      else backRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const onCardBack = useCallback(() => {
    if (historyDepth.current > 1) window.history.back();
    else backCard();
  }, [backCard]);
  const onCardClose = useCallback(() => {
    closeCard();
  }, [closeCard]);

  const openPopup = useCallback(
    (next: Exclude<ReaderPop, null>) => {
      if (pop === next) {
        closePop();
        return;
      }
      if (pop === "vote") {
        setVotingPins([]);
        setSelectedVotingSiteId(null);
      }
      closeCard();
      takeForeground();
      setPop(next);
    },
    [pop, closePop, closeCard, takeForeground],
  );

  // The Ballot card's "Where can I vote?" closes that card and asks the map
  // for its small popup (components/shell/route-card.tsx).
  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === "vote" || detail === "zip" || detail === "ask") {
        closeCard();
        setPop(detail);
      }
    };
    window.addEventListener("mw:open-pop", onRequest);
    return () => window.removeEventListener("mw:open-pop", onRequest);
  }, [closeCard]);

  const openGoverns = useCallback(() => {
    if (wghOpen) {
      closeCard();
      return;
    }
    closeCard();
    setPop(null);
    setNoticeCollapsed(false);
  }, [wghOpen, closeCard]);

  const openSidebar = useCallback(() => {
    closeCard();
    setPop(null);
    setSidebarState("open");
  }, [closeCard]);
  const collapseSidebar = useCallback(() => {
    setPop(null);
    setSidebarState("closed");
  }, []);

  const selectedDistrictHit = districtPopup;
  const pillVenue = !cardView || parked ? selectedVenue : null;
  const pillDistrict =
    (!cardView || parked) && ui.selectedDistrictOcdId
      ? (selectedDistrictHit ?? {
          ocdId: ui.selectedDistrictOcdId,
          label: "the selected district",
          tier: "local" as const,
        })
      : null;
  const [fitNonce, setFitNonce] = useState(0);
  const parkCard = useCallback(() => setParked(true), []);

  // A map click that selects a district opens its card (the district view).
  const openedDistrict = useRef<string | null>(null);
  useEffect(() => {
    const id = ui.selectedDistrictOcdId;
    if (!id) {
      openedDistrict.current = null;
      return;
    }
    if (id === openedDistrict.current || !districtPopup) return;
    openedDistrict.current = id;
    openLarge({
      kind: "entity",
      subject: districtSubject(
        districtPopup,
        current?.meetings ?? [],
        current?.coverage ?? null,
        districtRepresentations,
        lastHits,
      ),
    });
  }, [ui.selectedDistrictOcdId, districtPopup, openLarge, current, districtRepresentations, lastHits]);

  const showDistrictOnMap = useCallback(
    (ocdId: string) => {
      const drawn = drawnDistricts.find((d) => d.ocdId === ocdId);
      if (!drawn) return;
      setLastHits([
        {
          type: drawn.type,
          tier: drawn.tier,
          typeLabel: drawn.typeLabel,
          ocdId: drawn.ocdId,
          label: drawn.label,
          state: /state:([a-z]{2})/.exec(drawn.ocdId)?.[1]?.toUpperCase() ?? "",
        },
      ]);
      parkOnOpen.current = true;
      setShowDistricts(true);
      dispatch({ type: "select/district", ocdId: drawn.ocdId, districtType: drawn.type });
    },
    [drawnDistricts, dispatch, setShowDistricts],
  );

  const selectionTop =
    pillVenue || pillDistrict ? (layoutBp === "phone" && (parked || pillVenue) ? 112 : 64) : 0;
  const desiredMapInsets = useMemo(
    () => insetsFor({ sidebar: sidebarUp, selection: selectionTop }),
    [insetsFor, sidebarUp, selectionTop],
  );
  // A phone detail card covers the map and makes it inert. Keep its current
  // viewport while the drawer yields, then apply the visible layout on close.
  // Otherwise opening a list downloads and paints a second, covered viewport.
  const mapCovered = layoutBp === "phone" && Boolean(cardView) && !parked;
  const [visibleMapInsets, setVisibleMapInsets] = useState(desiredMapInsets);
  if (!mapCovered && (visibleMapInsets.top !== desiredMapInsets.top || visibleMapInsets.bottom !== desiredMapInsets.bottom
    || visibleMapInsets.left !== desiredMapInsets.left || visibleMapInsets.right !== desiredMapInsets.right)) {
    setVisibleMapInsets(desiredMapInsets);
  }
  const mapInsets = mapCovered ? visibleMapInsets : desiredMapInsets;

  const cluster = (
    <PillCluster
      placement={sidebarUp ? "sidebar" : "map"}
      zip={clusterZip}
      state={stateAbbrFromOcdId(focusState.activeOcdId)}
      point={view?.kind === "settled" ? view : null}
      pop={pop}
      governsOpen={cardView?.kind === "governs"}
      onOpenPop={openPopup}
      onOpenGoverns={openGoverns}
      onOpenBallot={closePop}
    />
  );

  const zipContext = clusterZip
    ? `Near ${clusterZip} · orientation, not your exact districts`
    : null;

  const cardBody = (() => {
    if (!cardView) return null;
    switch (cardView.kind) {
      case "governs":
        return !shown ? (
          <GoverningSkeleton />
        ) : (
          <CoverageNotice
            embedded
            tier={shown.tier}
            zip={shown.zip}
            listingCount={readerMeetingCount(shown.meetings, shown.listingIdentity)}
            coverage={shown.coverage}
            localPending={shown.localPending}
            refreshing={refreshing}
            failedSourceOcdIds={
              shown.snapshot?.failed.flatMap((f) => f.ocdIds) ?? []
            }
            lastCheckedAt={heldSnapshot(shown.snapshot)?.generatedAt ?? null}
            lastReadByOcdId={lastReadByDivision(shown.meetings ?? [])}
            ocdIdsWithMeetings={[
              ...new Set(
                (shown.meetings ?? []).flatMap((m) => (m.ocdId ? [m.ocdId] : [])),
              ),
            ]}
            onOpenOfficial={openOfficial}
            onOpenBody={(body) =>
              openLarge({
                kind: "entity",
                subject: bodySubject(body, shown.meetings ?? []),
              })
            }
            onNarrowApplied={onNarrowApplied}
            onStreetPoint={onStreetPoint}
            clusterElsewhere
          />
        );
      case "list":
        return ListOverlay && <ListOverlay embedded onPickMeeting={onPickMeeting} />;
      case "door":
        return DoorOverlay && (
          <DoorOverlay
            embedded
            door={cardView.door}
            coverage={current?.coverage ?? null}
            meetings={current?.meetings ?? []}
            drawnDistricts={drawnDistricts}
            districtOverlayOn={ui.showDistricts}
            atAddress={data.atAddress}
            onShowDistricts={() => setShowDistricts(true)}
            onOpenOfficial={(holder, seatLabel, tier) =>
              openLarge({ kind: "official", holder, seatLabel, tier })
            }
            onOpenMeeting={openMeeting}
            onOpenBody={(body) =>
              openLarge({
                kind: "entity",
                subject: bodySubject(body, current?.meetings ?? []),
              })
            }
            onClose={closeCard}
            showableDistrictIds={drawnDistricts.map((d) => d.ocdId)}
            onShowDistrict={showDistrictOnMap}
          />
        );
      case "venue":
        return (
          <MeetingPanel
            embedded
            venue={cardView.venue}
            placeless={selectedVenuePlaceless}
            onOpenMeeting={openMeeting}
            onShowOnMap={parkCard}
            offices={officePins.atVenue.get(cardView.venue.key)}
            onOpenOffice={openOffice}
            onClose={closeCard}
          />
        );
      case "large": {
        const surface = cardView.surface;
        if (surface.kind === "entity") {
          const subject =
            surface.subject.divisionOcdId &&
            districtPopup &&
            surface.subject.divisionOcdId === districtPopup.ocdId
              ? districtSubject(
                  districtPopup,
                  current?.meetings ?? [],
                  current?.coverage ?? null,
                  districtRepresentations,
                  lastHits,
                )
              : surface.subject;
          return (
            <EntityModal
              embedded
              subject={subject}
              onClose={closeCard}
              homeZip={clusterZip}
              onOpenVenue={
                subject.subjectKind === "MEETING"
                  ? (() => {
                      const venue = venues.find((v) =>
                        v.meetings.some((m) => m.id === subject.subjectId),
                      );
                      return venue
                        ? () => {
                            // One level deeper: the room, with every sitting
                            // held there, and the map focused on it.
                            setLargeStack([]);
                            dispatch({ type: "select/venue", key: venue.key });
                            setFocus({
                              lat: venue.lat,
                              lng: venue.lng,
                              zoom: 15,
                              key: `venue:${venue.key}`,
                            });
                          }
                        : undefined;
                    })()
                  : undefined
              }
              onShowOnMap={
                subject.divisionOcdId && subject.divisionOcdId === ui.selectedDistrictOcdId
                  ? () => {
                      setFitNonce((n) => n + 1);
                      parkCard();
                    }
                  : undefined
              }
              onOpenHolder={(holder) =>
                pushLarge({
                  kind: "official",
                  holder,
                  seatLabel: null,
                  tier: "local",
                })
              }
              onOpenPlaceBody={(key) => {
                const body = (current?.coverage?.bodies ?? []).find(
                  (b) => b.bodyId === key,
                );
                if (body) {
                  pushLarge({
                    kind: "entity",
                    subject: bodySubject(body, current?.meetings ?? []),
                  });
                }
              }}
            />
          );
        }
        return (
          <OfficialModal
            embedded
            holder={surface.holder}
            seatLabel={surface.seatLabel}
            tier={surface.tier}
            office={surface.office}
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
            onClose={closeCard}
          />
        );
      }
    }
  })();

  const cardTone =
    cardView?.kind === "large"
      ? cardView.surface.kind === "entity"
        ? `var(--accent-${cardView.surface.subject.tier})`
        : `var(--accent-${cardView.surface.tier})`
      : undefined;
  const cardKicker =
    cardView?.kind === "large"
      ? cardView.surface.kind === "official"
        ? "Battlecard"
        : cardView.surface.subject.subjectKind === "MEETING"
          ? "Meeting"
          : cardView.surface.subject.divisionOcdId
            ? "District"
            : "Body"
      : cardView?.kind === "venue"
        ? "Venue"
        : cardLabel;

  const popTitle =
    pop === "zip" ? "Show me a ZIP" : pop === "vote" ? "Where can I vote?" : "Ask";

  if (mapLoadError) throw mapLoadError;
  return (
    <DataProvider value={data}>
      {/* The jurisdiction badge can open the address prompt anywhere; the page re-resolves from the answer. */}
      <AddressResolutionProvider
        value={{ onPoint: onStreetPoint, onResolved: onNarrowApplied }}
      >
      <main
        className="mw-reader relative h-dvh w-full overflow-hidden"
        onPointerDownCapture={event => {
          if (event.button === 0 && event.target instanceof Element && event.target.closest(".ask-pill")) void prepareAsk();
        }}
        onFocusCapture={event => {
          if (event.target instanceof Element && event.target.closest(".ask-pill")) void prepareAsk();
        }}
        data-sidebar={sidebarUp ? "open" : "closed"}
        data-bp={layoutBp}
        style={
          {
            "--hdr-bottom": `${headerBottom}px`,
            "--sheet-h": `${sheetHeight(sidebarUp, selectionTop)}px`,
          } as React.CSSProperties
        }
      >
        <div className="mw-map-layer absolute inset-0">
          {MapCanvas && districtsRestored && (view !== null || failure !== null || (restored && !location)) && <MapCanvas
            onPresentationReadyChange={onMapPresentationReady}
            venues={allVenues}
            visibleVenueKeys={visibleVenueKeys}
            camera={camera}
            here={location && contains(location.lat, location.lng) ? location : null}
            focus={focus}
            selectedVenueKey={ui.selectedVenueKey}
            frameAllVenues={
              current !== null &&
              current.tier !== "exact" &&
              view?.kind === "zip"
            }
            districtTypes={activeDistrictTypes}
            selectedDistrict={selectedDistrict}
            narrowedDistricts={narrowedDistricts}
            onDistrictClick={onDistrictClick}
            theme={theme}
            insets={mapInsets}
            fitNonce={fitNonce}
            onDistrictError={onDistrictError}
            onDrawnDistricts={setDrawnDistricts}
            onSelectVenue={onSelectVenue}
            onTileError={onTileError}
            onTilesRecovered={onTilesRecovered}
            onViewportSettle={onViewportSettle}
            allowAutoFrame={view?.kind !== "settled"}
            focusStateOcdId={focusState.activeOcdId}
            officeSites={officeSites}
            selectedOfficeId={large?.kind === "official" ? (large.office?.id ?? null) : null}
            onSelectOffice={id => {
              const office = officePins.pins.find(value => value.id === id);
              if (!office) return;
              dispatch({ type: "select/venue", key: null });
              dispatch({ type: "select/district", ocdId: null, districtType: null });
              openOffice(office);
            }}
            onBoundsChange={onMapBounds}
            votingSites={votingPins}
            votingAddressPoint={votingAddressPoint}
            onSelectVotingSite={setSelectedVotingSiteId}
            selectedVotingSiteId={selectedVotingSiteId}
          />}
          {focusState.failed && <div className="state-crossing" role="status">We couldn&apos;t load state boundaries. Reload to try again.</div>}
          {focusState.crossing && (
            <StateCrossingPrompt
              toName={focusState.crossing.toName}
              onDismiss={focusState.dismissCrossing}
            />
          )}
          {/* The map-click disambiguation stays anchored to the click. */}
          <div className="pointer-events-none absolute inset-0">
            <DistrictPicker />
          </div>
        </div>

        {(pillVenue || pillDistrict) && (
          <SelectionPill
            venue={pillVenue}
            district={pillDistrict}
            parked={parked && Boolean(cardView)}
            onDetails={() => setParked(false)}
            onBack={
              pillVenue
                ? () => {
                    dispatch({ type: "select/venue", key: null });
                    setParked(false);
                  }
                : undefined
            }
            onRefit={() => {
              if (pillVenue && pillVenue.lat !== null && pillVenue.lng !== null) {
                setFocus({
                  lat: pillVenue.lat,
                  lng: pillVenue.lng,
                  zoom: 15,
                  key: `venue:${pillVenue.key}:${Date.now()}`,
                });
              } else {
                setFitNonce((n) => n + 1);
              }
            }}
            onClear={() => {
              closeCard();
              dispatch({ type: "select/district", ocdId: null, districtType: null });
              dispatch({ type: "select/venue", key: null });
            }}
          />
        )}

        <div className="mw-map-notices">
          {tilesFailed && <TileNotice />}
          {failure && (
            <SearchFailedNotice
              failure={failure}
              onRetry={() => setRetryNonce((n) => n + 1)}
            />
          )}
          {location && (!shown || shown.localPending) && !failure && (
            <p className="mw-loading-note" role="status">
              Loading meetings {view?.kind === "zip" ? `near ${location.zip}` : `in ${focusState.stateName ?? "this area"}`}…
            </p>
          )}
          {refreshing && !failure && (
            <p className="mw-loading-note" role="status">
              Updating for the new map area…
            </p>
          )}
          {!sidebarUp && location && (
            <div className="pointer-events-auto">
              <CountBadge />
            </div>
          )}
        </div>

        {ui.tiers.length === 0 && (
          <p className="mw-no-tier">No government layers selected</p>
        )}

        <div className="mw-legend-float">
          <Legend />
        </div>

        {!sidebarUp && (
          <header className="mw-header" data-bp={layoutBp} ref={measureHeader}>
            <div className="mw-header-left">
              <button
                type="button"
                className="mw-menu-btn sidebar-toggle"
                aria-label="Open sidebar"
                onClick={openSidebar}
              >
                <span aria-hidden="true">☰</span>
              </button>
              <span className="mw-header-logo">
                <Logo variant="wordmark" size={38} />
              </span>
              <span className="mw-header-spacer" />
              <ResetViewButton onReset={onReset} />
              <ThemeToggle className="mw-header-theme" />
            </div>
            <div className="mw-header-right">{cluster}</div>
          </header>
        )}

        {!sidebarUp && layoutBp === "phone" && (
          <button type="button" className="mw-sheet-handle" onClick={openSidebar}>
            Meetings, filters and more <span aria-hidden="true">▴</span>
          </button>
        )}

        <Sidebar
          onReset={onReset}
          showDistricts={showDistricts}
          districtsFailed={districtsFailed}
          onToggleDistricts={setShowDistricts}
          mobileOpen={sidebarState === "open"}
          onMobileClose={collapseSidebar}
          onNearMePoint={onNearMePoint}
          nav={sidebarUp ? cluster : null}
          snapshot={snapshotInView(shown?.snapshot, meetings)}
          onJurisdictionChosen={showDistrictOnMap}
        />

        {pop && (
          <ReaderPopup
            pop={pop}
            anchor={sidebarUp ? "sidebar" : "header"}
            title={popTitle}
            onClose={closePop}
          >
            {pop === "zip" && (
              <ZipSwitcher
                embedded
                current={clusterZip}
                onPick={search}
                onAddressLocated={addressLocated}
                onClose={closePop}
              />
            )}
            {pop === "vote" && (
              <VotingSitesPanel
                embedded
                onSites={onVotingSites}
                onAddressPoint={onVotingAddressPoint}
                selectedSiteId={selectedVotingSiteId}
                onSelectSite={setSelectedVotingSiteId}
                onClose={closePop}
              />
            )}
            {pop === "ask" &&
              (clusterCoverage && clusterZip ? (
                <div data-ask-panel>
                  {AskBox && <AskBox
                    coverage={clusterCoverage}
                    zip={clusterZip}
                    ocdIds={clusterOcdIds}
                    onSearchPick={onSearchPick}
                    onOpenBody={(body) =>
                      openLarge({
                        kind: "entity",
                        subject: bodySubject(body, shown?.meetings ?? []),
                      })
                    }
                    onOpenPerson={(holder) => openOfficial(holder, null, "local", null)}
                  />}
                </div>
              ) : (
                <p className="mw-pop-note">
                  We have not resolved who governs this point yet, so there is
                  nothing here to route a question against. Choose a ZIP and ask
                  again.
                </p>
              ))}
          </ReaderPopup>
        )}

        {cardView && !parked && (
          <ReaderCard
            viewKey={cardKey ?? "card"}
            sources={cardView.kind === "venue"
              ? [...cardView.venue.meetings, ...selectedVenuePlaceless].flatMap(meeting => meetingCardSources(meeting, []))
              : cardView.kind === "large" && cardView.surface.kind === "entity" ? cardView.surface.subject.sources
                : cardView.kind === "large" && cardView.surface.kind === "official" ? personCardSources(cardView.surface.holder) : []}
            gaps={cardView.kind === "venue" ? [...cardView.venue.meetings, ...selectedVenuePlaceless].flatMap(meetingCardGaps)
              : cardView.kind === "large" && cardView.surface.kind === "entity" ? cardView.surface.subject.meetings.flatMap(meetingCardGaps) : []}
            subject={cardView.kind === "large" && cardView.surface.kind === "official" ? { type: "CANDIDATE", id: cardView.surface.holder.id }
              : cardView.kind === "large" && cardView.surface.kind === "entity" && cardView.surface.subject.subjectKind === "BODY" ? { type: "BODY", id: cardView.surface.subject.subjectId } : undefined}
            kicker={cardKicker}
            kickerTone={cardTone}
            enter={cardView.kind === "large" && cardView.surface.kind === "official" && cardView.surface.office ? "rise" : undefined}
            zip={clusterZip}
            recordId={cardView.kind === "large"
              ? cardView.surface.kind === "entity"
                ? cardView.surface.subject.subjectId
                : cardView.surface.holder.id
              : cardView.kind === "venue" ? cardView.venue.key : null}
            zipContext={
              cardView.kind === "list" ||
              cardView.kind === "door" ||
              cardView.kind === "governs"
                ? zipContext
                : null
            }
            backLabel={backStack.length > 0 ? backStack[backStack.length - 1].label : null}
            onBack={onCardBack}
            onClose={onCardClose}
            restoreScroll={restoreScroll}
            onScroll={(top) => {
              cardScroll.current = top;
            }}
          >
            {cardBody}
          </ReaderCard>
        )}

        {/* Until the stored zip has resolved, so a returning reader never sees the prompt. */}
        {restored && (
          <WelcomeOverlay
            open={!location || welcomeRequested}
            onResolved={search}
            onAddressLocated={addressLocated}
            onDismiss={
              location ? () => setWelcomeRequested(false) : null
            }
          />
        )}
        {location && <PostalZipNotice location={location} onLocated={addressLocated} hidden={welcomeRequested || pop !== null || cardView !== null} />}
        {restored && (
          <TutorialOverlay active={Boolean(location) && !welcomeRequested && mapPresentationReady} />
        )}
      </main>
      </AddressResolutionProvider>
    </DataProvider>
  );
}

/** The card's name for a view; also the "← Back to …" label. */
function cardViewLabel(
  view:
    | { kind: "large"; surface: { kind: "entity"; subject: ModalSubject } | { kind: "official"; holder: SeatHolder } }
    | { kind: "venue"; venue: Venue }
    | { kind: "door"; door: "bodies" | "districts" | "officials" }
    | { kind: "list" }
    | { kind: "governs" },
): string {
  switch (view.kind) {
    case "large":
      return view.surface.kind === "entity"
        ? view.surface.subject.title
        : view.surface.holder.name;
    case "venue":
      return view.venue.name;
    case "door":
      return view.door === "bodies"
        ? "Bodies"
        : view.door === "districts"
          ? "Districts"
          : "Officials";
    case "list":
      return "Meetings";
    case "governs":
      return "Who governs here?";
  }
}

/** One history entry per card level; same URL, so no route re-renders. */
function pushCardHistory(depth: { current: number }): void {
  try {
    window.history.pushState(window.history.state, "", window.location.href);
    depth.current += 1;
  } catch {
    /* History unavailable (sandboxed frame): the in-card Back still works. */
  }
}

/** The card closed from inside: drop the entries it pushed. */
function unwindCardHistory(depth: { current: number }): void {
  const n = depth.current;
  if (n <= 0) return;
  depth.current = 0;
  try {
    window.history.go(-n);
  } catch {
    /* Nothing to unwind. */
  }
}

function locationWithDirections(location: NonNullable<Meeting["location"]>): React.ReactNode {
  const line = locationLine(location.name, location.address);
  const directions = venueLink(location);
  if (!directions) return line;
  return (
    <a
      href={directions.url}
      target="_blank"
      rel="noreferrer"
      title={directions.hint}
      className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {line}
    </a>
  );
}

function meetingSubject(
  meeting: Meeting,
  body: CoveredBody | null = null,
): ModalSubject {
  /* The body holding this sitting, resolved explicitly; never a division fallback. */
  const roster = [...projectedBodyRoster(body).members];
  return {
    // The body is the headline; the jurisdiction is the subtitle.
    subjectId: meeting.id,
    subjectKind: "MEETING" as const,
    heldByBodyId: body?.bodyId ?? null,
    title: meetingEntryTitle(meeting, { bodyShown: true }),
    /* The line beneath the sitting names the body from the registry, else the jurisdiction. */
    subtitle: body?.name ?? meeting.jurisdiction,
    tier: tierForMeeting(meeting) ?? "local",
    badges:
      meeting.status === "SCHEDULED"
        ? []
        : [{ label: STATUS_LABEL[meeting.status], status: meeting.status }],
    facts: [
      { label: "Date", value: formatMeetingDate(meeting) },
      { label: "Time", value: formatMeetingTime(meeting), mono: true },
      meeting.location
        ? {
            label: "Location",
            value: locationWithDirections(meeting.location),
          }
        : {
            // The online sentence only where the body published online access.
            label: "Where",
            value: isPlaceUnrecorded(meeting) ? null : placelessWhereLine(meeting),
          },
      ...(() => {
        const access = onlineAccessFor(meeting);
        return access?.joinUrl
          ? [{ label: "How to join", value: <a href={access.joinUrl} target="_blank" rel="noreferrer">Join online</a> }]
          : [];
      })(),
      { label: "Status", value: STATUS_LABEL[meeting.status] },
    ],
    /* The whole observation, not just the link. */
    agenda: {
      meetingId: meeting.id,
      bodyId: meeting.bodyId ?? "",
      agendaUrl: meeting.agendaUrl,
      agendaSlotObservedEmpty: meeting.agendaSlotObservedEmpty,
      provenance: meeting.provenance,
      carried: (meeting as { carried?: unknown }).carried,
    },
    // A concluded meeting drops the how-to-be-heard section.
    commentAccess:
      meeting.status === "CONCLUDED"
        ? null
        : { ocdId: meeting.ocdId, bodyName: meeting.bodyName, bodyId: meeting.bodyId },
    // The curated roster where one exists.
    representation: roster,
    rosterGaps: [...projectedBodyRoster(body).gaps],
    representationNote:
      "We haven't sourced who sits on this body. The people we hold for this area represent it in Congress and the state legislature, which is a different thing.",
    meetings: [meeting],
    // The shared assembler.
    sources: meetingCardSources(meeting, roster),
  };
}

export function bodySubject(
  body: CoveredBody,
  allMeetings: Meeting[] = [],
): ModalSubject {

  const roster = [...projectedBodyRoster(body).members];

  const meetings = allMeetings
    .filter((m) => m.bodyId !== undefined && m.bodyId === body.bodyId)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  /* The superintendent is hired by the board, so is shown only under "Runs the district day to day". */
  const superintendent =
    body.divisionType === "school_district"
      ? (roster.find((h) => /superintendent/i.test(h.officeTitle ?? "")) ?? null)
      : null;
  const seated = superintendent
    ? roster.filter((h) => h.id !== superintendent.id)
    : roster;

  /* One claim, read by both the jurisdiction row and the representation note. */
  const claim = jurisdictionClaim(body);

  return {
    // The body id, never the display title, which several governments share.
    subjectId: body.bodyId,
    publicRecordsDivisionId: body.ocdId,
    subjectKind: "BODY" as const,
    title: bodyDisplayName(body),
    subtitle: readerGovernmentName(body.divisionLabel, body.divisionType),
    tier: body.tier,
    // Decides whether the card carries "Who runs it".
    divisionKind: body.divisionType,
    divisionOcdId: null,
    facts: [
      { label: "Type", value: BODY_TYPE_LABEL(body) },
      { label: "Tier", value: TIER_LABEL[body.tier] },
      // Absent where no hunt found one; never a guessed URL.
      ...(body.homepageUrl
        ? [
            {
              label: "Official site",
              value: (
                <a
                  href={body.homepageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  {new URL(body.homepageUrl).hostname.replace(/^www\./, "")} →
                </a>
              ),
            },
          ]
        : []),
      // As the body's own page states them; sourced in this card's Sources.
      ...(body.officeContact?.address
        ? [{ label: "Office address", value: <>{body.officeContact.address}</> }]
        : []),
      ...(body.officeContact?.phone
        ? [{ label: "Office phone", value: <>{body.officeContact.phone}</> }]
        : []),
      // The body's own statement of when it meets, never turned into dates.
      ...(body.meetingCadence && meetings.length === 0
        ? [
            {
              label: "Regular meetings",
              value: (
                <>
                  {body.meetingCadence.text}

                </>
              ),
            },
          ]
        : []),
    ],
    representation: seated,
    rosterGaps: [...projectedBodyRoster(body).gaps],
    representationNote: representationNoteForClaim(claim),
    meetings,
    sources: [...districtCardSources(roster, meetings, body.officeContact?.provenance), ...(body.meetingCadence ? [{ what: "Regular meeting cadence", provenance: { sourceOrg: body.name ?? "", sourceUrl: body.meetingCadence.sourceUrl, collectedAt: "", verifiedAt: null } }] : [])],
    // Every section renders for every body: content, or its own absence line.
    bodyCard: {
      /* A body with no division has a null `divisionType` and gets no class definition. */
      whatItDoes:
        body.divisionType === null
          ? { classDefinition: null, formDefinition: null, classKey: null, unreadNote: null }
          : definitionsForBody({
              // Keyed on the body, not on a shared division.
              bodyId: body.bodyId,
              ocdId: body.ocdId,
              divisionType: body.divisionType,
              lsad: body.lsad,
              // Server-stamped so the dependency table stays out of the client bundle.
              schoolDependency: body.schoolDependency,
            }),
      isSchoolDistrict: body.divisionType === "school_district",
      // Not in the elected roster; null renders the named gap.
      superintendent: superintendent,
      contact: bodyContactRows(body),
      /* The claim is made only in lib/meetings/jurisdiction-badge.ts; no published boundary, no Governs row. */
      jurisdiction: [
        { label: claim.label, value: claim.value },
        { label: "Level", value: TIER_LABEL[body.tier] },
      ],
    },
  };
}

/** A body's published contact routes: only what the registry holds, never a guessed address. */
function bodyContactRows(
  body: CoveredBody,
): { label: string; value: string; href: string | null }[] {
  const rows: { label: string; value: string; href: string | null }[] = [];
  if (body.homepageUrl) {
    rows.push({
      label: "Official site",
      value: new URL(body.homepageUrl).hostname.replace(/^www\./, ""),
      href: body.homepageUrl,
    });
  }
  // The registry holds no phone or email for a body; those are on the people's cards.
  return rows;
}

function placeSubject(
  ocdId: string,
  label: string,
  rowTier: Tier | null,
  bodies: CoveredBody[],
  meetings: Meeting[],
  listingIdentity?: MeetingListingIdentityReadback,
): ModalSubject {
  const mine = bodies.filter((b) => b.ocdId === ocdId);
  const divisionType = mine[0]?.divisionType ?? typeFromOcdId(ocdId);

  const tier: Tier | null = rowTier ?? mine[0]?.tier ?? null;

  return {
    // A place is neither a body nor a person; the ocd-id is its id.
    subjectId: ocdId,
    publicRecordsDivisionId: ocdId,
    subjectKind: "BODY" as const,
    title: label,
    subtitle: divisionTypeLabel(divisionType),
    tier: tier ?? "local",

    divisionOcdId: null,
    facts: [],
    placeCard: {
      typeLabel: divisionTypeLabel(divisionType),
      tierLabel: tier ? TIER_LABEL[tier] : null,
      bodies: mine
        .map((b) => {
          /* Matched by body id, not by comparing published and registry names. */
          const listingCount = readerMeetingCount(meetings.filter(
            (m) => m.ocdId === ocdId && m.bodyId === b.bodyId,
          ), listingIdentity);
          return {
            key: b.bodyId,
            name: bodyDisplayName(b),
            tier: b.tier,
            // Omitted at zero rather than rendered as "0".
            meta: listingCount.count > 0 ? `${listingCount.count}${listingCount.unresolved ? " calendar listings · distinct meeting count unresolved" : ""}` : undefined,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      absence:
        "",
    },
    // A place has no roster of its own; the people are on the bodies' cards.
    representation: [],
    representationNote:
      "A place isn't governed by one body. Open a body above to see who sits on it.",
    meetings: meetings.filter((m) => m.ocdId === ocdId),
    sources: [],
  };
}

function typeFromOcdId(ocdId: string): string {
  return (ocdId.split("/").pop() ?? "").split(":")[0];
}

/** A body's own kind where it is curated; its division's kind where derived. */
function BODY_TYPE_LABEL(body: CoveredBody): string {
  const DIVISION: Record<NonNullable<CoveredBody["divisionType"]>, string> = {
    county: "County",
    place: "Municipal",
    school_district: "School district",
    cd: "Congressional",
    sldu: "State senate",
    sldl: "State house",
  };
  const CLASS = (bodyClass: CoveredBody["bodyClass"]): string => bodyClassLong(bodyClass);
  // No division means no division noun.
  return body.name === null && body.divisionType !== null
    ? DIVISION[body.divisionType]
    : CLASS(body.bodyClass);
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
      <p className="font-mono t-caption uppercase trailing-space-trimmed-20 tracking-[0.2em] text-danger">
        Search failed
      </p>
      <p className="mt-1.5 t-body leading-relaxed text-text-dim">
        We couldn&apos;t check this area — the meetings service didn&apos;t
        answer. That doesn&apos;t mean nothing is happening here.
      </p>
      {/* The failure names itself. */}
      <p className="mt-1 font-mono t-caption text-muted">
        {failure.status !== null
          ? `The service answered ${failure.status}.`
          : "The request never got an answer."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2.5 cursor-pointer rounded border border-[var(--panel-border)] px-3 py-1.5 t-detail text-paper hover:border-[var(--signal)] hover:text-signal"
      >
        Try again
      </button>
    </div>
  );
}

function TileNotice() {
  return (
    <div className="panel pointer-events-auto max-w-md px-4 py-3.5">
      <p className="font-mono t-caption uppercase trailing-space-trimmed-20 tracking-[0.2em] text-danger">
        Basemap unavailable
      </p>
      <p className="mt-1.5 t-body leading-relaxed text-text-dim">
        The map&apos;s background image isn&apos;t loading right now. Everything else
        works — the pins are in the right places, and meeting details still open.
        Reloading often fixes it.
      </p>
    </div>
  );
}
