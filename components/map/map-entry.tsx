"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forgetCamera } from "@/lib/map/camera-memory";

import dynamic from "next/dynamic";

import { CountBadge } from "@/components/map/count-badge";
import { Legend } from "@/components/map/legend";
import { Sidebar } from "@/components/shell/sidebar";
import { useDistrictLayer } from "@/hooks/use-district-layer";
import {
  useDivisionRepresentation,
  type DivisionRepresentation,
} from "@/hooks/use-division-representation";
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
import { RADIUS_LADDER_KM } from "@/lib/meetings/constants";
import { carryPins } from "@/lib/map/carry-pins";
import { requestRadiusKm, shouldRequery } from "@/lib/map/viewport-radius";
import { useStateFocus } from "@/hooks/use-state-focus";
import { StateCrossingPrompt } from "./state-crossing-prompt";
import { VotingSitesPanel } from "./voting-sites-panel";
import type { VotingSitePin } from "./map-canvas";
import { PillCluster } from "@/components/shell/pill-cluster";
import { clusterPlacement } from "@/lib/map/cluster-placement";
import { useSidebarVisible } from "@/hooks/use-sidebar-visible";
import { UiProvider, useUi, useUiDispatch } from "@/lib/state/provider";
import type { MeetingSearchResult } from "@/lib/meetings/query";
import type { SnapshotStatus } from "@/lib/meetings/freshness";
import { logEvent } from "@/lib/log/client";
import { groupByVenue, type Venue } from "@/lib/meetings/venues";
import { joinLine, onlineAccessFor, ONLINE_ONLY_LINE } from "@/lib/meetings/online";
import type { Meeting } from "@/lib/sources/types";
import type { SeatHolder } from "@/lib/officials/lookup";
import {
  districtCardSources,
  meetingCardSources,
} from "@/lib/officials/card-sources";
import type { CoverageSummary, CoveredBody } from "@/lib/registry/coverage";
import { bodyClassLong } from "@/lib/registry/body-class-labels";
import { rosterHoldersForBody } from "@/lib/registry/body-rosters";
import { membersOfBody } from "@/lib/registry/body-composition";
import {
  noteStateFor,
  representationForDivision,
  representationNoteFor,
} from "@/lib/registry/representation";
import { TIER_LABEL, type Tier } from "@/lib/ocd/tiers";
import { definitionsForBody } from "@/lib/officials/body-definitions";
import { schoolDependency } from "@/lib/officials/school-dependency";
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

import { jurisdictionClaim } from "@/lib/meetings/jurisdiction-badge";

import { CoverageNotice } from "./coverage-notice";
import { SiteFootnote } from "./site-footnote";
import { DistrictPicker } from "./district-picker";
import { MapCanvas, type CameraTarget, type MapFocus } from "./map-canvas";
import { MeetingPanel } from "./meeting-panel";
import { DoorOverlay } from "./door-overlay";
import type { ModalSubject } from "./popup/entity-modal";

/*
 * AUD-03 MEASUREMENT BRANCH (g17, 2026-08-18) — see docs/aud-03-prereg.md.
 *
 * The eight surfaces below are the pre-registered candidate set: none is on the
 * first paint of `/`, and every one of them was in the initial chunk. They are
 * behind async boundaries here so the build can be measured against the same
 * build with them static. The threshold was committed BEFORE this measurement,
 * in its own earlier commit, and the decision follows the number.
 *
 * `ssr: false` on every one is a statement of fact rather than a choice: each
 * already renders nothing on the server. The three popups and the two modals
 * are gated on click state; `ListOverlay` returns null unless the reader has
 * opened it; `WelcomeOverlay` and `TutorialOverlay` are gated on `restored`,
 * which only becomes true in a client effect. The map is NOT here — the
 * author's instruction is explicit and MapLibre is the landing product.
 */
const DistrictPopup = dynamic(
  () => import("./popup/district-popup").then((m) => m.DistrictPopup),
  { ssr: false },
);
const MeetingPopup = dynamic(
  () => import("./popup/meeting-popup").then((m) => m.MeetingPopup),
  { ssr: false },
);
const OfficialPopup = dynamic(
  () => import("./popup/official-popup").then((m) => m.OfficialPopup),
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
const ListOverlay = dynamic(
  () => import("./list-overlay").then((m) => m.ListOverlay),
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
  /**
   * What to ask the meetings API for (g3 item 6). Absent means the ladder's
   * first rung, which is right for a typed zip — the reader named a place,
   * not a viewport. A settled view carries what the reader can actually see,
   * so zooming out returns a superset instead of a smaller circle around a
   * moved centre.
   */
  radiusKm?: number;
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

  /**
   * **MTG-11 (2026-08-25) — ONE THING UP AT A TIME, AND IT NOW REACHES BEYOND
   * CARDS.** BC-16 made two SMALL CARDS exclude each other. The author's
   * `17-22-03` and `17-23-22` show the same overlap one layer out: he opens
   * *Where can I vote?*, and the eight-meeting Vail card is still sitting on
   * the right — in `17-23-22` it is still there while he reads a polling
   * address. His arrow marks the meetings card. *Clicking anywhere else means
   * the meetings card goes back to not being viewed.*
   *
   * So the three controls that take the foreground — **Where can I vote?, Ask,
   * and Change Zip** — dismiss whichever small card is open.
   *
   * **THE MAP-3 EXCEPTION SURVIVES BY CONSTRUCTION, and that is why this is a
   * dispatch rather than an effect.** Who Governs Here and an area's
   * battlecard appearing together on an AREA CLICK is deliberate and the
   * author says so outright. This closes the venue and district selections and
   * touches neither the Who Governs Here panel nor anything an area click
   * does; nothing here runs on an area click at all. `tests/one-at-a-time.test.ts`
   * asserts both halves.
   *
   * **It is one direction only.** No surface closes Ask — the note on
   * `askOpen` records that as deliberate and it is untouched.
   */
  const takeForeground = useCallback(() => {
    dispatch({ type: "select/venue", key: null });
    dispatch({ type: "select/district", ocdId: null, districtType: null });
  }, [dispatch]);

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
  /**
   * **LAY-4 (2026-08-24) — ONE collapse mechanism, at every width.**
   *
   * The card floats; minimizing shrinks it to a pill in the same region it
   * floated in. `columnCard` — LAY-1's "which card holds the left column" —
   * is DELETED rather than left inert, because a second collapse mechanism
   * for one card is how `wghOpen` came to need a conditional to work out
   * which of two booleans it was asking about.
   */
  /*
   * WGH-8 (2026-08-25): the card starts COLLAPSED, so the default paint is the
   * rail up and Who Governs Here sitting as its pill beneath it — which is the
   * state the author annotated as correct in `08-53-15`. It began `false`,
   * which is why the first paint carried both surfaces at once.
   */
  const [noticeCollapsed, setNoticeCollapsed] = useState(true);

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
  /*
   * **F01 2.4 (2026-08-19, the author) — THE LARGE SURFACE IS A STACK.**
   *
   * *"If I go to More to open a large battle card, open Representation, and
   * select Dr. Ravi Shah, his card pops up, which is right. However, if I
   * close out Dr. Ravi Shah, it brings me back to the map. It doesn't bring
   * me back to Tucson Unified."* His rule: **navigation unwinds one level at
   * a time, everywhere.**
   *
   * This was ONE SLOT. A person's card opened from inside a body's card
   * REPLACED it, so closing had nowhere to go but the map, and the reader lost
   * the card they had been reading with no way back but to find it again.
   *
   * It is now a stack, and the distinction that makes it work is WHERE the
   * card was opened from:
   *
   *  - from OUTSIDE any large surface — a map pin, a who-governs row, a list
   *    row — `openLarge` REPLACES the stack. That is the one-at-a-time rule
   *    and it is unchanged; two unrelated battlecards were never meant to nest.
   *  - from INSIDE an open large surface — a roster name, a place card's body
   *    row — `pushLarge` appends, and closing pops back to what opened it.
   *
   * The depth cap is a cycle guard, not a design limit: a reader can bounce
   * between a board's card and a member's card indefinitely, and an unbounded
   * array would grow for as long as they enjoyed themselves. At the cap the
   * OLDEST frame is dropped, so the most recent history — which is the history
   * a Back gesture is about — always survives.
   */
  type LargeSurface =
    | { kind: "entity"; subject: ModalSubject }
    | {
        kind: "official";
        holder: SeatHolder;
        seatLabel: string | null;
        tier: "local" | "state" | "national";
      };
  const LARGE_STACK_LIMIT = 8;
  const [largeStack, setLargeStack] = useState<LargeSurface[]>([]);
  const large = largeStack.length > 0 ? largeStack[largeStack.length - 1] : null;
  const setLarge = useCallback((next: LargeSurface | null) => {
    setLargeStack(next ? [next] : []);
  }, []);
  /** Close the top card and return to the one under it — never straight out. */
  const closeLarge = useCallback(() => {
    setLargeStack((stack) => stack.slice(0, -1));
  }, []);
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
    const { key, zip, lat, lng, radiusKm } = view;

    void (async () => {
      try {
        // The zip rides along as approximate_location for the search log —
        // orientation only, disclosed on /transparency. A settled viewport
        // has none; the server resolves the nearest ZCTA and logs that.
        const zipParam = zip ? `&zip=${zip}` : "";
        // g3 item 6: stated, never defaulted. Omitting it meant the server
        // used the ladder's first rung at every zoom level, which is how
        // zooming out came to REMOVE pins.
        const radiusParam = radiusKm ? `&radiusKm=${radiusKm}` : "";
        const response = await fetch(
          `/api/meetings?lat=${lat}&lng=${lng}${zipParam}${radiusParam}`,
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
    [remember, dispatch, dismissSidebar, setLarge],
  );

  /*
   * g3 item 10 (M91): which state rises out of the map, and the
   * border-crossing clarification.
   *
   * Declared HERE — above both the zip-activation effect below and the settle
   * handler further down — because both read it. A hook declared after its
   * first reader is a temporal-dead-zone error, not a style preference.
   */
  const focusState = useStateFocus();

  /*
   * A resolved zip activates its state.
   *
   * Driven off `location` rather than from inside the search handler, because
   * a session-restored location never passes through that handler and a
   * returning reader's state must rise exactly the same way. The hook is
   * idempotent — activating the state that is already active is a no-op — so
   * running this on every location change costs nothing.
   */
  const { activateAt } = focusState;
  useEffect(() => {
    // Depends on `activateAt` alone, never on the whole `focusState` object
    // (g4 item 1). The object used to be rebuilt every render, so this effect
    // ran every render and re-asserted the zip's state — which undid an
    // accepted border crossing one render after the reader accepted it, and
    // cleared the crossing prompt one render after it was raised. See
    // hooks/use-state-focus.ts for the full account.
    if (location) activateAt(location.lat, location.lng);
  }, [location, activateAt]);

  const camera = useMemo<CameraTarget | null>(
    () =>
      location
        ? { zip: location.zip, lat: location.lat, lng: location.lng }
        : null,
    [location],
  );

  const current = result && view && result.viewKey === view.key ? result : null;

  /*
   * 6f (2026-08-15) — "it keeps reappearing and disappearing while
   * scrolling", the tester's words, and the cause is right here rather than
   * in the expansion rule everyone suspected.
   *
   * `current` is null for the whole gap between a settle and its answer,
   * because the answer in hand is keyed to the view the reader just left.
   * Everything in the bottom stack hangs off `current` — including the
   * COLLAPSED card's bubble, which is a button with no data in it. So a pan
   * blinked the bubble out and back on every settle, which is exactly the
   * churn reported, and no amount of tuning `noticeShouldExpand` could have
   * touched it: the card was never re-expanding, it was un-rendering.
   *
   * `held` keeps the last answer on screen through the gap. Two rules keep
   * that honest: the card carries `data-refreshing` while the answer under
   * it is stale (dimmed by the stylesheet, so the reader can see it is
   * settling rather than asserting), and nothing NEW is claimed — this is
   * the previous answer still visible, not a guess about the new area.
   */
  // Adjust-during-render, the pattern this file already uses for `seenFilters`
  // and the door/list guards — a ref would be read during render, which React
  // forbids and the lint rule catches.
  const [held, setHeld] = useState<{
    result: TaggedResult;
    /*
     * The zip the held answer BELONGS to. Carried because the pins below hold
     * on a narrower rule than the card does, and telling the two cases apart
     * needs to know whether the area itself changed.
     */
    forZip: string | null;
  } | null>(null);
  if (current && held?.result !== current) {
    setHeld({ result: current, forZip: location?.zip ?? null });
  }
  const shown = current ?? held?.result ?? null;
  const refreshing = current === null && shown !== null;

  /*
   * R47 (2026-08-18) — THE PINS GET THE SAME CARRY-FORWARD THE CARD GOT.
   *
   * 6f above fixed this gap for the who-governs card and stopped there, so
   * `meetings` still read `current` and emptied to `[]` for the whole gap
   * between a settle and its answer. Every pin left the map for the duration.
   *
   * MEASURED before it was touched, because a single-sample walk check could
   * not tell a wipe from a slow refill and reported this 1 of 2 runs, which
   * read as a race. It is not a race. Sampling the pin count every 100 ms
   * through a zoom-out at 85701 (`pnpm probe:r47`, 4 of 4 runs against
   * production): the pool drops to ZERO for 200–500 ms on EVERY zoom-out that
   * re-queries, while an `/api/meetings` request is in flight and while the
   * card beside it already carries `data-refreshing`. What was intermittent
   * was the instrument, never the defect — one sample per zoom lands inside a
   * 300 ms window only sometimes.
   *
   * So the map holds its last answer through the gap, which is CLAUDE.md's
   * own refresh corollary — "a failed fetch never silently empties a
   * previously-full surface" — applied one layer up, and its render-default
   * rule too: an empty map during a refresh is absence rendered as a finding.
   * Nothing new is claimed; these are the pins that were already on screen.
   *
   * THE SCOPE IS THE POINT, and it is narrower than the card's. `held` alone
   * would carry pins across a ZIP CHANGE, and holding one area's entities
   * while another area loads is the stale-data bug this file names at
   * `search()` — Tucson's pins under a New Hampshire zip. So the pins hold
   * only while the held answer belongs to the zip still being shown; a new
   * zip drops them on the same render it always did.
   */
  const pinned = carryPins({
    current,
    held,
    locationZip: location?.zip ?? null,
  });

  // Everything downstream reads this one filtered list.
  const meetings = useMemo<Meeting[]>(
    () =>
      pinned
        ? applyFilters({
            meetings: pinned.meetings,
            ui,
            // Only constrain by radius once the reader has actually moved the
            // slider. Before that the cascade's own radius is the answer, and
            // re-filtering on the default would silently drop the meetings a
            // widened search just found. The center is whatever the map is
            // looking at — the typed zip or the settled viewport.
            center: ui.radiusOverridden ? (ui.nearMe ?? view) : null,
          })
        : [],
    [pinned, ui, view],
  );

  const venues = useMemo<Venue[]>(() => groupByVenue(meetings), [meetings]);

  /*
   * **P-001 · TWO LISTS, AND THE MAP NEEDS BOTH.**
   * (Performance audit of `336a3eb`, remediated 2026-08-24.)
   *
   * `venues` above is grouped from the FILTERED meetings, and everything that
   * renders a list of what is currently shown reads it — the count badge, the
   * list overlay, the panel.
   *
   * The MAP needs the other one. Its marker pool exists so that filtering
   * changes which pins are visible and never which markers exist, and passing
   * it the filtered list defeated exactly that: twenty filtered-out venues
   * arrived as twenty venues the data no longer had, their markers were
   * destroyed, and reversing the filter built twenty new ones.
   *
   * So `allVenues` is grouped from the UNFILTERED held result, and the keys
   * the filters leave are passed beside it. Neither is derived from the other
   * at the component boundary, which is what stops the next well-meaning edit
   * collapsing them back into one.
   */
  const allVenues = useMemo<Venue[]>(
    () => (pinned ? groupByVenue(pinned.meetings) : []),
    [pinned],
  );
  const visibleVenueKeys = useMemo(
    () => new Set(venues.map((v) => v.key)),
    [venues],
  );

  const selectedVenue = useMemo(
    () => venues.find((v) => v.key === ui.selectedVenueKey) ?? null,
    [venues, ui.selectedVenueKey],
  );

  /*
   * G05 RULE 4c — ONE SURFACE OPEN AT A TIME, MUTUAL AND SYMMETRIC.
   *
   * *"One surface open at a time - sidebar, WGH and the large battlecard each
   * close the others, mutual and symmetric."*
   *
   * Before this the rule ran in exactly one direction and only between two of
   * the three: a large surface closed the popups, the list overlay and the
   * doors, and nothing at all closed the sidebar or the who-governs card. So
   * a phone could carry the rail, the card and a battlecard at once, stacked,
   * which is the clutter class M54/M55 came out of.
   *
   * It is one function rather than three call sites for the same reason 4e's
   * placement is one function: symmetry that lives in three places stops being
   * symmetric the first time a fourth entry point is added. Every opener goes
   * through here, and the closes are explicit — `setSidebarState("closed")`
   * rather than `dismissSidebar()`, because the desktop rail is a surface too
   * and "dismiss" only ever returned the phone drawer to its default.
   *
   * Ask is deliberately NOT one of the three (rule 4a, the author's words):
   * *"Ask's expansion is NOT a surface for 4c and never closes the sidebar,
   * WGH or a battlecard."* It is left untouched here on purpose.
   */
  const openSurface = useCallback(
    (surface: "sidebar" | "wgh" | "large") => {
      setSidebarState(surface === "sidebar" ? "open" : "closed");
      setNoticeCollapsed(surface !== "wgh");
      if (surface !== "large") setLarge(null);
    },
    [setLarge],
  );

  /**
   * F01 2.4 — open a card FROM INSIDE another one, keeping the way back.
   *
   * Everything `openLarge` does to the other surfaces has already been done by
   * the card this was opened from, so this only grows the stack.
   */
  const pushLarge = useCallback((next: LargeSurface) => {
    setLargeStack((stack) =>
      [...stack, next].slice(-LARGE_STACK_LIMIT),
    );
  }, []);

  /** The one-at-a-time rule: any large surface replaces every other. */
  const openLarge = useCallback(
    (next: LargeSurface) => {
      setLarge(next);
      // 4c: the sidebar and the who-governs card are surfaces too, and they
      // yield to a battlecard exactly as a battlecard yields to them.
      openSurface("large");
      // The large tier subsumes the compact card that opened it, and the
      // list overlay yields — three surfaces at once was the defect.
      if (next.kind === "official") setOfficialPopup(null);
      if (next.kind === "entity") setPopupMeeting(null);
      dispatch({ type: "list/open", open: false });
      // 8a: a sidebar door is a large surface too, and yields the same way.
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
    ) => {
      setOfficialPopup({ holder, seatLabel, tier });
      // BC-16: most recent click wins.
      setPopupMeeting(null);
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
    // BC-16: most recent click wins. See the effect below for the half of this
    // that no opener can be relied on to do.
    setOfficialPopup(null);
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
    (center: { lat: number; lng: number; viewportRadiusKm: number }) => {
      // The crossing detector runs on EVERY settle, ahead of the re-query
      // guard below: a reader who pans across a state line and stops has
      // crossed it whether or not the meetings answer needs refreshing, and
      // returning early before this is how the clarification would go missing
      // exactly when the pan was small.
      focusState.noteCentre(center.lat, center.lng);
      if (!location || welcomeRequested) return;
      if (popupMeeting || ui.selectedVenueKey || ui.selectedDistrictOcdId) return;

      const radiusKm = requestRadiusKm(center.viewportRadiusKm);
      // g3 item 6: the distance test alone was half the pin-dropping defect.
      // A reader who zooms OUT without moving the centre passes no distance
      // check, so the radius never widened and the new viewport stayed empty
      // of pins that exist. A materially larger request is its own reason to
      // re-ask; a smaller one never is.
      if (
        !shouldRequery(
          view
            ? {
                lat: view.lat,
                lng: view.lng,
                // A zip view carries no radius because it never asked for
                // one — which means it got the ladder's FIRST RUNG from the
                // server. That default is what a widening has to be compared
                // against. Falling back to the incoming radius (the first
                // draft of this line) made every comparison a no-op: the two
                // sides were the same number by construction, the zoom-out
                // never re-queried, and the walk reported "11 → 11 → 11" for
                // a fix that was doing nothing.
                radiusKm: view.radiusKm ?? RADIUS_LADDER_KM[0],
              }
            : null,
          { lat: center.lat, lng: center.lng, radiusKm },
        )
      ) {
        return;
      }
      // Deliberately no notice expansion here: panning is not a question
      // about who governs. The card shows once per resolved AREA (the
      // effect below), on a click into a new district, or on a bubble tap.
      setSettled({
        forZip: location.zip,
        target: {
          // The radius is part of the key: two settles at the same centre and
          // different zooms are two different questions, and sharing a key
          // would make the wider one a no-op.
          key: `settled:${center.lat.toFixed(3)},${center.lng.toFixed(3)}@${radiusKm}`,
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
      /*
       * **WGH-8 (2026-08-25) — ARRIVING AT A ZIP NO LONGER OPENS THE CARD, and
       * this SUPERSEDES the expanding half of 3h (2026-08-19).**
       *
       * 3h let a typed-zip view re-expand the who-governs card, launch
       * included, and that was right while the rail and the card could share
       * the column. They can no longer: the author's rule is that exactly one
       * of the two is up, so auto-expanding on arrival does not add a card —
       * it CLOSES THE RAIL, on every launch, before the reader has asked for
       * anything.
       *
       * His annotated capture `08-53-15` is the state being specified, and it
       * is unambiguous: the rail up and running the full height of the column,
       * with Who Governs Here sitting beneath it as a pill. So arrival is the
       * rail, and the card is one click away.
       *
       * **`noticeShouldExpand` is deliberately still called and its answer is
       * still recorded in `shownAreaKey`.** The pure rule and its test are
       * untouched, and the zip/settled distinction it draws still matters —
       * what changed is only what this component DOES with the answer. Ripping
       * the call out would delete the record of which area the card has
       * already answered for, and the district effect below relies on that
       * bookkeeping staying honest.
       */
      setNoticeCollapsed(true);
    }
  }, [current]);

  /**
   * **BC-16 (2026-08-25) — ONE SMALL CARD AT A TIME, ENFORCED WHERE NO OPENER
   * CAN FORGET IT.**
   *
   * The author's `09-20-11` has the Rockaway Township venue card and the
   * Morris County card open at once, overlapping, each scrolling inside itself.
   *
   * The venue/district half lives in the reducer, because both are transitions
   * there. The two popups are React state on this component and cannot be, so
   * the exclusion is an EFFECT keyed on the selection rather than a line
   * inside every opener. WGH-8, earlier in this same file today, is why:
   * `openSurface` had enforced its exclusion correctly since 4c and the FIRST
   * PAINT still carried both surfaces, because a rule enforced by every path
   * that calls it is not enforced on the path that does not call it.
   *
   * Selecting NOTHING is a close and clears nothing — dismissing one card must
   * never dismiss the others with it.
   *
   * **This was an EFFECT until 2026-08-25 (RO04), and it was one of the two
   * `react-hooks/set-state-in-effect` errors that held `main` red.** It is
   * now React's documented adjust-state-during-render pattern instead: the
   * previous selection is held in state, and a CHANGE to it is detected
   * while rendering rather than after painting.
   *
   * **Why this and not a `key`,** which is how the same problem was solved in
   * `speak-your-mind.tsx` the same day: these two popups are THIS component's
   * own state, and remounting the map to clear a popup would tear down the
   * MapLibre canvas with it. Keying is the right answer when a child owns the
   * state; adjusting during render is the right answer when the component
   * that owns the state is the one that has to react.
   *
   * **The semantics are preserved exactly, including the two subtleties the
   * effect had.** Selecting nothing still clears nothing — the guard moved
   * inside the transition rather than in front of it. And the comparison is
   * on a COMPOSED key, so venue→district and district→venue are transitions
   * too, not just null→value; the effect got that from having both values in
   * its dependency array.
   *
   * Clearing on FIRST RENDER is not needed and does not happen: `prevSelection`
   * initialises to the current selection, and both popups start `null` anyway,
   * so there has never been anything to clear on mount.
   */
  const selectionKey = `${ui.selectedVenueKey ?? ""}\u0000${ui.selectedDistrictOcdId ?? ""}`;
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (selectionKey !== prevSelectionKey) {
    setPrevSelectionKey(selectionKey);
    if (ui.selectedVenueKey || ui.selectedDistrictOcdId) {
      setPopupMeeting(null);
      setOfficialPopup(null);
    }
  }

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
   * Officeholders sourced for a division — one resolver, shared with the
   * division battlecard and with anything else that asks the question.
   *
   * This used to be the resolution itself, written out here, while the
   * battlecard did its own narrower version six hundred lines down. See
   * `representationForDivision`.
   */
  /**
   * The SELECTED division's officeholders, resolved by the division's own
   * key rather than by where the reader is standing (M112, 2026-08-16).
   *
   * `holdersFor` above answers instantly for the divisions containing the
   * point and for curated local rosters; it cannot answer for any of the
   * other drawn districts, and its empty array was being rendered as our
   * gap over people we hold. This hook asks. Both surfaces for the selected
   * district — the small popup and the battlecard — read it, so they cannot
   * disagree, and neither renders a gap sentence while the answer is still
   * in flight.
   */
  const districtRepresentation = useDivisionRepresentation(
    current?.coverage ?? null,
    districtPopup?.ocdId ?? null,
  );

  /**
   * The registry body governing a division, for the popup's link ladder.
   *
   * Comes off the same coverage summary the notice reads, so the popup and the
   * notice cannot disagree about who governs a point or what we hold for them.
   */
  /**
   * The body that held this sitting — matched on the body it NAMES.
   * (DATA-3, 2026-08-28.)
   *
   * This used to match on the meeting's DIVISION, and the only thing the
   * result is ever used for is `membersOfBody(body.bodyId)` — so a division
   * match was a membership claim derived from shared geography, which is the
   * one inference `lib/registry/body-composition.ts` exists to forbid.
   *
   * Six coverage bodies sit on `county:pima`. The division match returned the
   * FIRST, which is `county:pima#governing`, so every Central Arizona Water
   * Conservation District sitting rendered the five Pima County Supervisors
   * under its Representation tab — Rex Scott, Matt Heinz, Jennifer Allen,
   * Steve Christy, Andrés Cano — for a board of fifteen directly elected
   * directors presided over by Terry Goddard. The composition module was
   * already correct and was being asked about the wrong body.
   *
   * Measured before changing, over the 462-meeting snapshot at the 85641
   * coverage set: every meeting carries a `bodyId`, 14 rendered a different
   * body's members, and NOTHING loses an honest roster by matching on
   * identity instead. The division fallback is not a safety net; it was the
   * defect.
   *
   * A meeting whose named body is not in the coverage set resolves to null,
   * and null renders the named gap the subject already carries. An unknown
   * body is not the same fact as a body with no members, and neither is the
   * county board.
   */
  const bodyForMeeting = useCallback(
    (meeting: Meeting): CoveredBody | null => {
      const bodies = current?.coverage?.bodies;
      if (!bodies || !meeting.bodyId) return null;
      return bodies.find((b) => b.bodyId === meeting.bodyId) ?? null;
    },
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
      // The street-point view is the only one keyed on a resolved address —
      // `onStreetPoint` mints exactly this prefix. Reading the key rather
      // than carrying a second flag keeps the two from disagreeing.
      atAddress: view?.key.startsWith("street:") ?? false,
      /*
       * M81. Built here rather than in each consumer so the SAME set answers
       * the popup, the list and any surface added later — a badge computed
       * twice is a badge that can disagree with itself.
       *
       * `undefined` (an older cached payload with no such field) and `null`
       * (the server's resolution failed) both mean "we cannot say", and both
       * become null rather than an empty set.
       */
      governing: current?.governingOcdIds
        ? new Set(current.governingOcdIds)
        : null,
      /*
       * `JUR-2` (2026-08-23). Same construction and same null discipline as
       * `governing` directly above: `undefined` (an older cached payload) and
       * `null` (unmeasured) both become null, because neither is "measured,
       * nothing partial" and an empty set says exactly that.
       */
      zipPartial: current?.partialOcdIds ? new Set(current.partialOcdIds) : null,
      basis: view?.key.startsWith("street:") ? "ADDRESS" : "ZIP",
    }),
    [current, meetings, venues, location, drawnDistricts, failure, view],
  );

  /*
   * M135 (2026-08-18) — the autocomplete's rows join the rule the rest of the
   * product already follows: a row opens a card.
   *
   * MEASURED BEFORE, across the four pilot zips: 227 rows, of which 163 opened
   * something (a meeting row with a venue opens the MeetingPanel, agenda link
   * inside), 43 moved the camera and opened nothing, and **21 did nothing at
   * all** — `onSearchPick` selected a venue when the row carried a venueKey and
   * flew when it carried a lat/lng, and a row carrying neither fell off the end
   * of the function. D18 named that defect ("a row that answers a click with
   * silence") and fixed it for the meetings LIST; its sibling here never got
   * the same fix. Two changes close it, and the geometry half is upstream in
   * `buildSearchIndex` (see `represents`).
   *
   * THE CARD HALF, here:
   *
   * - A MEETING row with no venue opens the large meeting card. This is D18's
   *   fix verbatim — an online sitting is in no venue, so the venue-shaped
   *   route can never answer for it, and the card is the answer that does.
   *   The camera stays where the reader left it: an online meeting has nowhere
   *   to fly to, and moving to the last place they looked answers a question
   *   they did not ask.
   *
   * - A BODY row opens that body's large battlecard, which is this item's
   *   ruling in its own words ("Selecting a body ANYWHERE opens that body's
   *   large battlecard"), built by the same `bodySubject` the who-governs list
   *   and the sidebar's Bodies door both use. Two doors onto one card, never
   *   two cards. It still flies where it can, because the reader who picked a
   *   body on a map surface wants both.
   *
   * RESOLUTION IS REFUSED RATHER THAN GUESSED. A body row is matched to a
   * covered body on the division AND the name, because several bodies share
   * one division — Pima County alone carries a dozen — and `CoveredBody.name`
   * is null on derived rows, so an ocdId-only match would open one body's card
   * from another body's row. Where the match is ambiguous or absent the row
   * falls back to flying, exactly as it does today: no card is strictly worse
   * than the wrong card, and the wrong card is a false claim about a
   * government.
   *
   * A PLACE row is deliberately not converted here, and that is a finding
   * rather than an omission: a place is a division that several bodies sit in,
   * this product has no committed card for a place subject, and picking one of
   * N bodies to stand for it would be an invented answer. Place rows fly (and
   * after the `represents` fix they always can); the card they should open is
   * the author's to rule on.
   */
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
        /*
         * PU02 / M135, NJ Hunt 4 item 3 (2026-08-22). The resolution moved to
         * `lib/search/body-row.ts` — read its header for the measurement.
         *
         * In short: the old matcher required `CoveredBody.name === item.label`
         * on the same division, and across twenty production rows at four zips
         * that comparison succeeded ONCE. Everything that opened, opened through
         * the one-body-on-the-division fallback. At 03255 nothing opened at all.
         *
         * The refusal principle is unchanged and is why this is not a fuzzy
         * match: `resolveBodyRow` normalises two spellings of the SAME name and
         * refuses anything less certain. What changed is what happens when it
         * refuses — the card is now built from the ROW, which names the body the
         * reader clicked and carries that body's meetings, instead of the row
         * answering a click with silence.
         */
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
        // g18, ruling A: the place card. It elects nobody to stand for the
        // place — it lists every body we hold in it and lets the reader
        // choose, which is the only honest resolution of a one-to-many.
        openLarge({
          kind: "entity",
          subject: placeSubject(
            item.ocdId,
            item.label,
            item.tier,
            current?.coverage?.bodies ?? [],
            current?.meetings ?? [],
          ),
        });
      }
    }

    // Picking a result means the reader wants the map, not the drawer that
    // may be covering it at phone width.
    dismissSidebar();
  }, [dispatch, dismissSidebar, current, openLarge, bodyForMeeting]);

  const onPickMeeting = useCallback(
    (meeting: Meeting) => {
      const venue = venues.find((v) =>
        v.meetings.some((m) => m.id === meeting.id),
      );
      if (venue) dispatch({ type: "select/venue", key: venue.key });
      setNoticeCollapsed(true);
      /*
       * D18: a meeting held online has nowhere to fly the camera to, and it
       * is in no venue — so the venue selection above finds nothing and the
       * meeting panel, which is a panel ABOUT a venue, can never open for it.
       * Picking such a row did nothing at all, which is the reader-friction
       * rule's plainest case: a row that answers a click with silence.
       *
       * It opens the same large card every other route to a meeting opens,
       * built by the same subject builder, and leaves the camera exactly
       * where the reader left it — moving it to the last place they looked,
       * or to the body's building, would both answer a question they did not
       * ask.
       */
      if (meeting.location) {
        setFocus({
          lat: meeting.location.lat,
          lng: meeting.location.lng,
          zoom: 14,
          key: meeting.id,
        });
      } else {
        openLarge({
          kind: "entity",
          subject: meetingSubject(meeting, bodyForMeeting(meeting)),
        });
      }
    },
    [venues, dispatch, openLarge, bodyForMeeting],
  );

  /*
   * RESET = "PUT ME BACK WHERE I STARTED" — F01 9.5, 2026-08-19, the author.
   *
   * *"The reset view should not be a pop-up of the zip again like 'hey, what
   * zip do you want to go back to?' The reset view should be the last zip that
   * I selected, so it'll zoom back. If the last zip I selected was 85701,
   * hitting reset should act as if I just simply put in 85701 again. If I want
   * to change it then I can click Change. The reset view option is doing more
   * work than it needs to."*
   *
   * It was: it cleared the filters AND reopened the welcome overlay, which
   * asks a question the reader has already answered. Two jobs where one was
   * wanted, and the second one undid the reader's own answer.
   *
   * Now it clears the controls and re-runs the zip they are already on,
   * through `search` — the SAME path a typed zip takes, which is what makes
   * "acts as if I put in 85701 again" literally true rather than approximately
   * true. `search` drops the settled viewport, so a reader who panned to the
   * next county is flown home; it also clears the selections and open cards,
   * which is the tangle reset existed to undo in the first place.
   *
   * The welcome prompt survives for the ONE case where it is the honest
   * answer: no zip yet, so there is nowhere to return to. Reset with nothing
   * to reset to has to ask.
   */
  const onReset = useCallback(() => {
    dispatch({ type: "reset" });
    setFocus(null);
    /*
     * BAL-9: reset FORGETS the remembered camera. The whole point of reset is
     * "put me back where I started" — restoring the viewport the reader just
     * asked to leave would make the control do nothing visible, which is the
     * click-that-does-nothing defect this repo names most often.
     */
    forgetCamera();
    if (location) {
      search(location.zip, location.lat, location.lng);
      return;
    }
    setWelcomeRequested(true);
  }, [dispatch, location, search]);

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
        // MAP-5: the SAME Local/State/Federal selection the meeting list
        // filters on. One state, two consumers, no synchronising callback.
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

  /*
   * Item 7 (design pass): the reader's narrowed divisions shade on the map.
   * The narrowing store is read for the zip the who-governs card speaks —
   * the same zip the chip stored it under. Division type is derived from
   * the OCD id's own segment, never from a label: the street index only
   * ever narrows to municipalities and school districts.
   */
  const noticeZip =
    result && /^\d{5}$/.test(result.zip) ? result.zip : (location?.zip ?? "");
  const narrowing = useNarrowing(noticeZip);
  /*
   * M12 (2026-08-17): an OCD id says `school_district:` and stops there — it
   * does not say whether the district is unified, elementary or secondary,
   * and now that those are three separate sources the shading has to reach
   * the right one.
   *
   * It asks all three rather than guessing at one. That is exact rather than
   * scattershot: the Census assigns every district exactly ONE of unsd/elsd/
   * scsd, so the id can appear in at most one of the three sources and the
   * other two calls set state on an id they do not hold, which is a no-op.
   * Guessing a single type would silently shade nothing for two thirds of
   * the school districts in the country.
   */
  const narrowedDistricts = useMemo(
    () =>
      narrowing.divisions.flatMap((ocdId) =>
        ocdId.includes("school_district:")
          ? SCHOOL_DISTRICT_TYPES.map((type) => ({ ocdId, type }))
          : [{ ocdId, type: "municipal" as DistrictType }],
      ),
    [narrowing.divisions],
  );

  // The street's visible payoff (item 7): applying a narrowing turns the
  // boundary overlay on with the municipal and school layers active, so
  // the shaded district is actually on screen. Only an APPLY does this —
  // declining or undoing never touches the reader's overlay settings.
  const onNarrowApplied = useCallback(() => {
    setShowDistricts(true);
    dispatch({
      type: "filter/districtTypesSet",
      value: [
        ...new Set([
          ...ui.filters.districtTypes,
          "municipal" as DistrictType,
          // M12: all three school layers, so an applied narrowing turns on
          // whichever one actually holds the reader's district. Turning on
          // one of three would leave two thirds of readers looking at an
          // overlay that does not contain the thing they just narrowed to.
          ...SCHOOL_DISTRICT_TYPES,
        ]),
      ],
    });
  }, [setShowDistricts, dispatch, ui.filters.districtTypes]);

  /*
   * D53 (2026-08-15): the street became a POINT, so the answer becomes the
   * point's rather than the ZCTA's.
   *
   * Two things happen and they are separate on purpose. The camera flies —
   * that is the visible payoff the shading half could not give. And the
   * QUERY point moves, through the same `settled` override a panned viewport
   * already uses, so the meetings, the officials and the sidebar counters
   * all resolve to the street instead of to a centroid that may sit in
   * another town. Reusing `settled` rather than inventing a third view kind
   * matters: `forZip` already makes it stale the moment a new zip is
   * entered, which is exactly the lifetime this point should have.
   *
   * Nothing here persists. The point is React state; a reload has none.
   */
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
          // Null, deliberately. A settled view carries no zip into the search
          // log — the server resolves the nearest ZCTA and logs THAT, so a
          // street-level point never reaches the log even as a parameter.
          zip: null,
          lat: point.lat,
          lng: point.lng,
        },
      });
    },
    [location],
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
  /**
   * **`VF02` — the notice comes DOWN when the basemap draws.**
   *
   * It was a one-way door: `setTilesFailed(true)` was the only writer, so a
   * single transient error latched *Basemap unavailable* over a map that then
   * loaded and kept drawing. The notice states a present-tense fact about the
   * reader's screen, and a reader looking at a working map while we tell them
   * it is broken is worse than saying nothing — it teaches them not to believe
   * the next notice either.
   */
  const onTilesRecovered = useCallback(() => setTilesFailed(false), []);
  const onDistrictError = useCallback(() => setDistrictsFailed(true), []);
  /*
   * G05 RULE 4a — THE ASK PILL OPENS ASK, AND NOTHING ELSE.
   *
   * What it used to do is the whole reason the rule exists: `openAsk`
   * un-collapsed the who-governs card and scrolled the cursor into the ask box
   * living inside it, across two animation frames. Tapping "Ask" opened a
   * different surface — which is precisely *"tapping the Ask pill never opens
   * WGH"*. The two frames were needed because the box was somewhere else; now
   * the box is under the pill, so there is nothing to wait for and nothing to
   * scroll to.
   *
   * The expansion is one boolean, and it deliberately does not participate in
   * 4c: opening Ask closes no surface, and no surface closes Ask.
   */
  const [askOpen, setAskOpen] = useState(false);

  /*
   * B19 — where the reader can actually vote.
   *
   * Three pieces of state and no more: whether the panel is open, the pins
   * the answer produced, and which pin is selected. The pins live HERE rather
   * than inside the panel because the map draws them and the panel does not,
   * and a component that owns a list the map renders is the one that has to
   * clear it when it closes.
   */
  const [votingOpen, setVotingOpen] = useState(false);
  const [votingPins, setVotingPins] = useState<VotingSitePin[]>([]);
  /** VOT-1: the point the reader's address resolved to, for the ten-mile ring. */
  const [votingAddressPoint, setVotingAddressPoint] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [selectedVotingSiteId, setSelectedVotingSiteId] = useState<string | null>(
    null,
  );
  const closeVoting = useCallback(() => {
    setVotingOpen(false);
    setVotingPins([]);
    setSelectedVotingSiteId(null);
  }, []);

  // 4a: focus lands in the input the expansion just mounted. One frame,
  // because the input is a child of the pill's own cluster rather than a
  // surface that has to be opened first.
  const onToggleAsk = useCallback((open: boolean) => {
    setAskOpen(open);
    if (!open) return;
    takeForeground(); // MTG-11

    requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>("[data-ask-panel] [data-ask-box]")
        ?.focus({ preventScroll: true });
    });
  }, [takeForeground]);

  /*
   * 6f: Near me resolves districts, through the SAME machinery a narrowed
   * street address uses (D53). Reusing `onStreetPoint` rather than inventing
   * a parallel path is the point — one definition of what a point means, one
   * lifetime (React state, this tab), one promise about storage. A second
   * path would drift, and the thing it would drift on is the promise.
   *
   * `street` is the label the card shows for where the answer came from.
   * "your approximate location" is the honest one here: a browser fix is a
   * radius, and calling it an address would be the overclaim the caveat on
   * the control exists to prevent.
   */
  const onNearMePoint = useCallback(
    (point: { lat: number; lng: number }) => {
      onStreetPoint({ ...point, street: "your approximate location" });
      dismissSidebar();
    },
    [onStreetPoint, dismissSidebar],
  );

  const onSelectVenue = useCallback(
    (venue: Venue) => {
      dispatch({ type: "select/venue", key: venue.key });
      // Engagement (2h): the reader picked something specific; the
      // who-governs card gets out of the way.
      setNoticeCollapsed(true);
    },
    [dispatch],
  );

  /*
   * G05 RULE 4e — THE SINGLE PILL CLUSTER.
   *
   * ONE `<PillCluster>` is constructed here and handed to exactly one of the
   * three slots below. That is the enforcement: the placements are not three
   * conditional mounts of the same markup, which is the shape that renders two
   * the day a fourth state appears — they are one node, placed. The rule's own
   * check counts rendered instances in the live DOM (`scripts/walk-all.mts`),
   * because a variable holding one node and a page painting one cluster are
   * different claims and only the second one is what a reader sees.
   *
   * Location is a function of two booleans and nothing else, exactly as the
   * rule states — a large battlecard is not a parameter, so with one open the
   * cluster is on the map.
   */
  const sidebarVisible = useSidebarVisible(sidebarState);
  /*
   * F01 10.3 — is the rail a SIDE panel covering part of the map, or a
   * full-width drawer over all of it?
   *
   * `useSidebarVisible("default")` is the media query on its own: at `sm` and
   * up the rail shows by default, below it the rail is a drawer. Padding the
   * camera by 364px while a phone drawer covers the whole screen would frame
   * the map around a rail that is not there once the drawer closes, so the
   * inset applies only where the rail is genuinely a 364px column.
   */
  const railIsAColumn = useSidebarVisible("default") && sidebarVisible;
  /**
   * **WGH-6 (2026-08-24) — the left REGION is a column even when the RAIL is
   * not in it.**
   *
   * The author: *clicking Who Governs Here minimizes the sidebar to the left
   * and takes over that space, wide enough that every entry — Morris Hills
   * Regional School District included — fits on one line.*
   *
   * The minimizing half already worked: `openSurface("wgh")` closes the rail,
   * which is 4c's mutual exclusion. What did not work is "takes over that
   * space" — with the rail closed, `railIsAColumn` goes false and LAY-4 would
   * send the floaters back over the map, so the card would abandon the space
   * the rail had just vacated rather than claiming it.
   *
   * This is the question LAY-4 actually needs to ask, and it is a different
   * one: is there a left COLUMN REGION at this width, whether or not the rail
   * is currently occupying it. `railIsAColumn` stays exactly as it was for the
   * camera inset, which genuinely is a question about what the rail covers.
   */
  const railRegionIsAColumn = useSidebarVisible("default");
  /*
   * **LAY-4 (2026-08-24, the author's annotated capture `11-55-29`) — THE
   * FLOATING CARDS ARE BACK, AND THEY BELONG UNDER THE RAIL.**
   *
   * LAY-1 (2026-08-23) nested the who-governs card INSIDE the rail's
   * scrolling column. The author's arrows say otherwise, and the supersession
   * table in the 8/24 brief is explicit: LAY-1 must not exist as built. Who
   * Governs Here, the meetings/venues count and the venue panel are SEPARATE
   * FLOATING CARDS in the viewport region BENEATH the rail — none of the
   * three inside the rail's content area.
   *
   * `railIsAColumn` still decides WHERE that region is, and it is still the
   * existing boolean rather than a second breakpoint that could drift from
   * it: where the rail is a 364px column the floaters sit under it in
   * `.rail-floaters`; where it is a full-width drawer they keep their place
   * over the map in `.map-bottom-stack`, unchanged.
   *
   * `.rail-column` is what makes LAY-3 true BY CONSTRUCTION rather than by
   * measurement — the rail and the floaters are flex children of one fixed
   * column, so neither can be laid out on top of the other at any viewport.
   * A bound that has to be measured is a bound that holds until the content
   * changes.
   */
  /*
   * Is the who-governs card OPEN? One mechanism now, at every width.
   */
  const wghOpen = Boolean(shown) && !noticeCollapsed;
  /**
   * **WGH-8 / LAY-7 (2026-08-25) — EXACTLY ONE OF THE TWO IS UP. NEVER BOTH.**
   *
   * The author, on the popup WGH-6 shipped: *"hate the way it looks."* His
   * capture `09-11-14` is the other half and it is the one that names the
   * defect — the rail is up at 07866 AND the who-governs card is expanded
   * underneath it, both scrolling internally, on a 2048px screen.
   *
   * **`openSurface` was not the problem and it never was.** It has enforced
   * this since 4c: opening WGH sets `sidebarState` to `"closed"`. What it
   * cannot enforce is the state nobody opened — `noticeCollapsed` began
   * `false` and `sidebarState` began `"default"`, so the FIRST PAINT had both
   * up, at every width, before any reader touched anything.
   *
   * That is the shape this repo names most often: a rule enforced by every
   * path that calls it, and a default that never calls it. So the exclusion
   * is DERIVED here rather than maintained by handlers — `sidebarUp` cannot be
   * true while the card is open, whatever route the state arrived by, and
   * there is no branch left where both can paint.
   */
  const sidebarUp = sidebarVisible && !wghOpen;
  const clusterAt = clusterPlacement({ wgh: wghOpen, sidebar: sidebarUp });
  const clusterZip = shown
    ? /^\d{5}$/.test(shown.zip)
      ? shown.zip
      : (shown.nearZip ?? null)
    : (location?.zip ?? null);
  const clusterCoverage = shown?.coverage ?? result?.coverage ?? null;
  const cluster = (
    <PillCluster
      placement={clusterAt}
      zip={clusterZip}
      coverage={clusterCoverage}
      onPickZip={search}
      askOpen={askOpen}
      onToggleAsk={onToggleAsk}
      ocdIds={
        clusterCoverage
          ? [
              ...new Set(
                [
                  ...clusterCoverage.bodies.map((b) => b.ocdId),
                  ...clusterCoverage.seats.map((s) => s.ocdId),
                ].filter((id): id is string => Boolean(id)),
              ),
            ]
          : []
      }
      onSearchPick={onSearchPick}
      /*
        **ASK-3 / ASK-4 / ASK-8 (2026-08-24) — the SAME two openers the
        who-governs card is handed, a few lines below.**

        Not a second implementation: the who-governs card settled this click
        grammar on 2026-08-16 — a person's name opens their card, a body's row
        opens the body's — and handing Ask the identical handlers is what makes
        "the name is a door" mean the same thing on both surfaces. A second
        lookup keyed on a label could resolve one name to a different body,
        which is the class of defect the distinct-keys rule names.

        There is exactly one `PillCluster` in this app, constructed here, so
        every placement of the Ask panel — the rail, the who-governs card, and
        the collapsed top-right pill the author captured in `12-12-28` —
        inherits both openers from this one line.
      */
      onOpenBody={(body) =>
        openLarge({
          kind: "entity",
          subject: bodySubject(body, shown?.meetings ?? []),
        })
      }
      onOpenPerson={(holder) => openOfficial(holder, null, "local", null)}
    />
  );
  /*
   * Is a cluster on screen ANYWHERE? `PillCluster` renders null without a
   * resolved five-digit zip, so "we placed it" and "it painted" are different
   * claims and only the second one decides whether a fallback ballot door is
   * needed.
   *
   * THE DEFECT THIS FIXES, caught in a 390px screenshot rather than reasoned
   * about: 4c makes the rail and the who-governs card mutually exclusive on
   * every reader-initiated open, but it does not touch the DEFAULT state, and
   * on desktop the default is a visible rail plus WGH's automatic first-show.
   * With the cluster at WGH, the rail fell through to its own ballot link and
   * the reader had two doors onto one surface — the duplicate-entry friction
   * CLAUDE.md calls a defect. Each fallback is now conditioned on there being
   * no cluster at all, so the count on screen is exactly one.
   *
   * The default state is deliberately left alone: closing the desktop rail on
   * page load, before the reader has touched anything, would remove the app's
   * primary navigation to satisfy a rule written about phone stacking.
   */
  const clusterRendered = Boolean(clusterZip && /^\d{5}$/.test(clusterZip));

  /*
   * **LAY-4: the floating cards, built ONCE and placed in one of two
   * regions.**
   *
   * One constructor, two placements — a second construction is a second
   * component that drifts, and LAY-1 proved it: the card had two prop lists
   * and two collapse handlers, and `wghOpen` needed a conditional to work out
   * which of them was in force.
   *
   * The order is the author's, read off `11-55-29` and `11-54-33`: the
   * meetings/venues count leads, the who-governs card follows, the freshness
   * footnote closes. Each is its OWN card — separate boxes with the map
   * visible between them, never one panel with three sections in it.
   */
  const floaters = (
    <>
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

      {shown &&
        (noticeCollapsed ? (
          /*
           * Shrunk out of the way (2h), not gone: one tap brings the full
           * card back. **LAY-4: the pill lands in the SAME region the card
           * floated in** — never inside the rail, which is what
           * `.sidebar-wgh-pill` did and is why that class is deleted.
           */
          <button
            type="button"
            className="notice-fab pointer-events-auto"
            aria-label="Show who governs here"
            /* 4c: opening WGH closes the rail and any battlecard. */
            onClick={() => openSurface("wgh")}
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
          // NOT wrapped in a div: `.map-bottom-stack > .coverage-notice` and
          // `.rail-floaters > .coverage-notice` are the bounds that keep this
          // card inside its region (M54/M55), and a `>` combinator reads the
          // DOM tree, not the box tree — a wrapper would silently unbind it
          // and the card would grow off the top again. The refreshing state
          // rides as a prop instead.
          <CoverageNotice
            tier={shown.tier}
            zip={shown.zip}
            radiusKm={shown.radiusKm}
            requestedRadiusKm={shown.requestedRadiusKm}
            count={shown.meetings.length}
            coverage={shown.coverage}
            refreshing={refreshing}
            failedSourceOcdIds={
              shown.snapshot?.failed.flatMap((f) => f.ocdIds) ?? []
            }
            /* F01 7.2: what the MAP is actually showing, so the card
               cannot say “may be missing” about a body whose pins the
               reader can see. Read off the same meeting array the pins
               are drawn from — a second derivation is how two surfaces
               come to disagree, which is the defect this closes. */
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
            onMinimize={() => setNoticeCollapsed(true)}
            onNarrowApplied={onNarrowApplied}
            onStreetPoint={onStreetPoint}
            /* 4e: the WGH slot, which wins over the other two. */
            pillCluster={clusterAt === "wgh" ? cluster : null}
            clusterElsewhere={clusterRendered}
          />
        ))}

      {/* Provenance, not headline (3): "Last checked" demotes to a
          footnote below the who-governs card — and LAY-8 (2026-08-25) sends
          the rail’s "What this site collects / Feedback" block down to sit
          beside it, which is where the author’s dotted arrow lands. */}
      <SiteFootnote snapshot={shown?.snapshot ?? null} />
    </>
  );

  return (
    <DataProvider value={data}>
      {/*
        `JUR-2` (2026-08-23). The jurisdiction badge renders on three surfaces,
        every one of them several components deep, and until now it could only
        ASSERT — clicking it did nothing, and what it asserted was resolved
        from a zip. Providing the two handlers once here means a badge anywhere
        can open the address prompt and have the whole page re-resolve from the
        server's answer, without a dozen component signatures each getting a
        chance to forget to pass them.
      */}
      <AddressResolutionProvider
        value={{ onPoint: onStreetPoint, onResolved: onNarrowApplied }}
      >
      <main
        className="relative h-dvh w-full overflow-hidden"
        /* WGH-8: the attribute carries the DERIVED state, not the raw one.
           Every CSS rule that hides the rail keys on this, so the exclusion is
           true in the stylesheet as well as in the tree. */
        data-sidebar={wghOpen ? "closed" : sidebarState}
      >
        {/*
          **LAY-4 / LAY-3 — the rail and its floaters are ONE fixed column.**

          The author's annotated capture `11-55-29` draws two arrows: one from
          the rail's bottom edge straight DOWN into the region below it, one
          from the meetings/venues chip LEFT into that same region. That region
          is `.rail-floaters`, and this wrapper is what makes it exist.

          Flex children of one column cannot be laid out on top of each other.
          That is LAY-3 answered BY CONSTRUCTION — no measured bound, nothing
          to drift when the who-governs card grows from 12 bodies to 174. Both
          children shrink and scroll inside themselves rather than overflowing,
          and the rail shrinks FIRST (`flex-shrink: 2` against 1) because the
          floaters carry the answer the reader came for.
        */}
        <div className="rail-column">
          <Sidebar
            onReset={onReset}
            onChangeLocation={() => {
              takeForeground(); // MTG-11
              setWelcomeRequested(true);
            }}
            showDistricts={showDistricts}
            districtsFailed={districtsFailed}
            onToggleDistricts={setShowDistricts}
            mobileOpen={sidebarState === "open"}
            onMobileClose={() => setSidebarState("closed")}
            onNearMePoint={onNearMePoint}
            /* 4e: the sidebar slot. `clusterElsewhere` tells the rail whether a
               cluster painted anywhere, so its fallback ballot link can never
               become a second door onto the same surface. */
            pillCluster={clusterAt === "sidebar" ? cluster : null}
            clusterElsewhere={clusterRendered}
          />

          {/* Where the rail is a COLUMN, the floaters live under it. Where it
              is a full-width drawer they keep their place over the map, in
              `.map-bottom-stack` below — one boolean, no second breakpoint. */}
          {railRegionIsAColumn && (
            <div className="rail-floaters">{floaters}</div>
          )}
        </div>

        {/* F01 9.4 (2026-08-19, the author): *"I don't like that I have to open
            the sidebar to reset. A very, very, very small reset button or
            widget should be available if I'm just looking around the map."*

            Reset was reachable only from inside the rail, so a reader who had
            panned somewhere strange had to open a panel to get home — a hidden
            entry point, which the friction rule counts as a defect with the
            same standing as a wrong number.

            Deliberately governed by the SAME CSS rule as the hamburger it sits
            under: visible exactly when the rail is not. The rail has its own
            reset, and two reset buttons on one screen is worse than one in the
            wrong place — the reader would have to work out whether they do the
            same thing. 32px against the hamburger's 44 because it is the
            secondary control of the pair, and it is what "very, very, very
            small" translates to inside the committed scale. */}
        <button
          type="button"
          className="map-reset-btn"
          title="Reset view"
          aria-label="Reset view"
          onClick={onReset}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>

        {/* The hamburger (2f) — rendered always, shown by CSS whenever the
            sidebar is effectively hidden, at any width. The backdrop is
            phone-only: it sits under the sidebar's z-1000 so tapping the map
            closes the drawer instead of dropping a pin through it. */}
        <button
          type="button"
          className="sidebar-toggle"
          aria-label="Open menu"
          /* 4c: opening the rail closes the who-governs card and any
             battlecard — mutual and symmetric with both. */
          onClick={() => openSurface("sidebar")}
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

        {/* F01 10.3 (2026-08-19, the author): *"the main sidebar is floating
            over essentially empty gray space... the floater should be over the
            map."*

            The map used to START where the rail ended (`sm:left-[364px]`).
            The rail is content-height and floats, so the 364px column BELOW it
            was reserved for a map that was not allowed to be there — the empty
            gray block he drew a red box around.

            The canvas is full-bleed now and the rail floats over it. Framing is
            preserved by handing the rail's width to the camera as PADDING
            (`leftInset` below), so a centroid still lands in the middle of what
            the reader can SEE rather than sliding half a rail to the left.

            The OVERLAY containers below keep their offset on purpose: the
            who-governs card, the pill cluster and the meeting panel are things
            a reader reads, and moving them under the rail to fix a background
            would be trading a cosmetic gap for a covered card. Only the
            district picker follows the canvas, because its coordinates come
            from a click on the canvas and the two must share one space. */}
        <div className="absolute inset-0">
          <MapCanvas
            venues={allVenues}
            visibleVenueKeys={visibleVenueKeys}
            camera={camera}
            focus={focus}
            selectedVenueKey={ui.selectedVenueKey}
            /* g5 item 2: while a full-screen overlay covers the map, the
               state scrim is suspended. The reader cannot see the map through
               it, and leaving it composited under a second backdrop-filter
               surface is what stopped the meetings panel painting. The
               welcome overlay and the account modal carry the same
               `backdrop-filter` over the same canvas, so all three count. */
            overlayOpen={
              ui.listOverlayOpen ||
              ui.door !== null ||
              !location ||
              welcomeRequested
            }
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
            /* F01 10.3: what the rail covers, so the camera can frame around it.
               Zero when the rail is hidden — then nothing is covered. The
               breakpoint matches the `sm:` the overlays still use. */
            leftInset={railIsAColumn ? 364 : 0}
            onDistrictError={onDistrictError}
            onDrawnDistricts={setDrawnDistricts}
            onSelectVenue={onSelectVenue}
            onTileError={onTileError}
            onTilesRecovered={onTilesRecovered}
            onViewportSettle={onViewportSettle}
            allowAutoFrame={view?.kind !== "settled"}
            focusStateOcdId={focusState.activeOcdId}
            votingSites={votingPins}
            votingAddressPoint={votingAddressPoint}
            onSelectVotingSite={setSelectedVotingSiteId}
            selectedVotingSiteId={selectedVotingSiteId}
          />
          {/* e's 6b2, built in g3 item 10: quiet within a state, explicit
              between states. Once per ordered border pair per session. */}
          {focusState.crossing && (
            <StateCrossingPrompt
              fromName={focusState.crossing.fromName}
              toName={focusState.crossing.toName}
              onSee={focusState.acceptCrossing}
              onStay={focusState.dismissCrossing}
            />
          )}
        </div>

        <div
          className={`pointer-events-none absolute inset-y-0 right-0 left-0 ${
            sidebarState === "closed" ? "" : "sm:left-[364px]"
          } flex flex-col`}
        >
          {/* pr clears MapLibre's zoom control in the top-right corner. The
              ballot bubble (2b) leads the row so it stays visible left of the
              meeting panel when one is open.

              `map-top-row` (item 2, the tester's mobile pass 2026-08-14)
              puts this band above the bottom stack explicitly. It used to
              rely on DOM order and lost: the bottom stack is a later
              sibling, so a tall who-governs card painted straight over the
              ballot entry. Ordering this load-bearing is written down, not
              inferred. */}
          <div className="map-top-row flex items-start justify-end gap-3 p-3 pr-14 sm:p-5 sm:pr-16">
            {/* 4e: the map slot. Occupied only when neither the sidebar nor
                the who-governs card is on screen. */}
            {clusterAt === "map" && (
              <div className="pointer-events-auto">{cluster}</div>
            )}
            {/* B19's entry point, in the top band beside the ballot cluster.
                One tap, no menu to hunt through — a hidden entry point is
                reader friction and friction is a defect. Playful register on
                the button, because it is an INTERACTION surface; every word
                inside the panel it opens is level. */}
            <div className="pointer-events-auto">
              {votingOpen ? (
                <VotingSitesPanel
                  onSites={setVotingPins}
                  onAddressPoint={setVotingAddressPoint}
                  selectedSiteId={selectedVotingSiteId}
                  onSelectSite={setSelectedVotingSiteId}
                  onClose={closeVoting}
                />
              ) : (
                <button
                  type="button"
                  className="voting-open-button"
                  onClick={() => {
                    takeForeground(); // MTG-11
                    setVotingOpen(true);
                  }}
                >
                  Where can I vote?
                </button>
              )}
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
              pushing this whole group below the fold.

              Items 2 and 3 (the tester's mobile pass, 2026-08-14) share one
              cause, measured at 390×844 before it was touched: this stack
              was bottom-anchored with NO upper bound, so the who-governs
              card grew to 893px against an 844px viewport and its top
              landed at y = −113. Everything above the fold went with it —
              the ballot bubble (rendered at y=12, painted over, untappable:
              "the floater never appears on her phone"), the count badge at
              y = −166, and the card's own minimize control at y = −104.
              What DID stay on top were the fixed controls — the hamburger
              at (12,12) and MapLibre's zoom column at (349,0) — sitting
              over card text, which is item 3.

              `map-bottom-stack` bounds it: at phone width the stack starts
              below the control band, so no fixed control ever sits over
              readable content, and the card shrinks to the space left and
              scrolls inside itself rather than off the screen. */}
          <div className="map-bottom-stack absolute inset-x-0 bottom-0 flex flex-col items-start justify-end gap-3 p-3 pb-9 sm:p-5 sm:pb-10">
            {/* LAY-4: where the rail is a COLUMN these render under it, in
                `.rail-floaters`. This is the drawer placement — the same node,
                so the two can never drift into two different cards. */}
            {!railRegionIsAColumn && floaters}

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
            click that produced it — which is why this one followed the canvas
            to full-bleed in F01 10.3 while the reader-facing overlays did not.
            A picker offset 364px from the click it belongs to is worse than
            any gap it could have been protecting against. */}
        <div className="pointer-events-none absolute inset-0">
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
              representation={districtRepresentation.holders}
              representationNoteState={noteStateFor(districtRepresentation.status)}
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
              /* BC-8: minimize the card, scope the list to this body, open it.
                 Three dispatches rather than a new action, because each one
                 already exists and already means exactly this. */
              onShowMeetings={() => {
                dispatch({ type: "scope/body", ocdId: districtPopup.ocdId });
                dispatch({ type: "select/district", ocdId: null, districtType: null });
                dispatch({ type: "list/open", open: true });
              }}
              onClose={() =>
                dispatch({ type: "select/district", ocdId: null, districtType: null })
              }
              onExpand={() =>
                openLarge({
                  kind: "entity",
                  subject: districtSubject(
                    districtPopup,
                    current?.meetings ?? [],
                    current?.coverage ?? null,
                    districtRepresentation,
                  ),
                })
              }
            />
          )}

          {popupMeeting && !large && (
            <MeetingPopup
              meeting={popupMeeting}
              body={bodyForMeeting(popupMeeting)}
              // Tier-3 (5a): who sits on this body, curated with citations.
              //
              // The division fallback that used to sit here was removed on
              // 2026-08-27 (Red Controls 2 and 3). Its stated purpose was
              // real — a Sunnyside pin seen from downtown 85701 should still
              // name its board — but it bought that by answering the body
              // question with the division's government, which put the wrong
              // five people on the CAWCD card and the Mayor and Council on 58
              // appointed Tucson commissions. `membersOfBody` keeps the
              // Sunnyside case working (that board HAS its own roster, keyed
              // by body id, and a body id does not care which point was
              // searched) without the claim.
              representation={
                membersOfBody(bodyForMeeting(popupMeeting)?.bodyId ?? null).members
              }
              onClose={() => setPopupMeeting(null)}
              onExpand={() =>
                openLarge({
                  kind: "entity",
                  subject: meetingSubject(
                    popupMeeting,
                    bodyForMeeting(popupMeeting),
                  ),
                })
              }
            />
          )}
        </div>

        {large?.kind === "entity" && (
          <EntityModal
            subject={
              // M112: the subject is a snapshot taken when the reader tapped
              // "More", and the division-keyed officeholder lookup may still
              // have been in flight. Re-derive it for the division that is
              // still selected so the card FILLS IN rather than freezing on
              // the looking line — and only for that division, so a
              // meeting's card is never rebuilt as a district's.
              large.subject.divisionOcdId &&
              districtPopup &&
              large.subject.divisionOcdId === districtPopup.ocdId
                ? districtSubject(
                    districtPopup,
                    current?.meetings ?? [],
                    current?.coverage ?? null,
                    districtRepresentation,
                  )
                : large.subject
            }
            onClose={closeLarge}
            /* F01 2.4: a roster name opens the person's full card ON TOP of this
               one, so closing theirs returns here rather than to the map. This
               is the author's Dr. Ravi Shah case exactly. */
            onOpenHolder={(holder) =>
              pushLarge({
                kind: "official",
                holder,
                seatLabel: null,
                tier: "local",
              })
            }
            /*
             * A place card's body row opens that body's battlecard — the same
             * `bodySubject` every other door onto a body uses, so the reader
             * never meets two cards for one body (g18, ruling A).
             *
             * Matched on `bodyId`, which is unique per body, NOT on the OCD-ID
             * the place row carries: several bodies share one division, and an
             * ocdId match would open one body's card from another's row. That
             * is M135's other open case and this row does not repeat it. A key
             * that resolves to nothing opens nothing rather than opening the
             * first match — no card is worse than the wrong card only when the
             * wrong card is impossible.
             */
            onOpenPlaceBody={(key) => {
              const body = (current?.coverage?.bodies ?? []).find(
                (b) => b.bodyId === key,
              );
              if (body) {
                // F01 2.4: opened from inside the place card, so it stacks —
                // closing the body card returns to the place it was listed on.
                pushLarge({
                  kind: "entity",
                  subject: bodySubject(body, current?.meetings ?? []),
                });
              }
            }}
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
            /* F01 2.4: pops one level. A person opened from a body card returns
               to that body card; a person opened from the map returns to the
               map, because their frame is the only one on the stack. */
            onClose={closeLarge}
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
            atAddress={data.atAddress}
            onShowDistricts={() => setShowDistricts(true)}
            onOpenOfficial={(holder, seatLabel, tier) =>
              openLarge({ kind: "official", holder, seatLabel, tier })
            }
            onOpenMeeting={(meeting) =>
              openLarge({
                kind: "entity",
                subject: meetingSubject(meeting, bodyForMeeting(meeting)),
              })
            }
            // g4 item 9: the same card the who-governs list opens, built by
            // the same subject builder — two doors onto one card, never two
            // different cards for one body.
            onOpenBody={(body) =>
              openLarge({
                kind: "entity",
                subject: bodySubject(body, current?.meetings ?? []),
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
      </AddressResolutionProvider>
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
/**
 * **MTG-3 (2026-08-23) — the address is a place you have to get to, not a
 * string.**
 *
 * The venue panel behind a pin has had a Directions link since 2026-08-16 and
 * the large battlecard never did: the author opened the Township Council card,
 * found the address inert, and could not get from *where is this* to *how do I
 * get there* without leaving the product. Same helper as the venue panel, and
 * the same derived-not-cited framing — it is built from coordinates we hold
 * rather than a page anyone opened, so it is offered as a convenience and
 * never as a citation.
 *
 * A NAMED function rather than an inline IIFE inside the facts array, because
 * `tests/server-client-boundary.test.ts` reads `value: (…) =>` as a client
 * component declaring a function prop — a false positive there, and a guard
 * that has to be taught about a shape is a guard weakened. The named form
 * costs nothing and reads better.
 */
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
  /*
   * The body holding this sitting, resolved EXPLICITLY (2026-08-27).
   *
   * The division fallback here made the same membership claim the body card
   * made: a meeting on a county division showed the county board as the
   * meeting body's members, whoever actually sits on it. A meeting popup is a
   * reader-facing surface like any other, so it obeys the same rule.
   */
  const roster = membersOfBody(body?.bodyId ?? null).members;
  return {
    // What it is FIRST (3, tightened 3a 2026-08-16): the jurisdiction-
    // qualified body and sitting are the headline ("Vail Unified School
    // District — Governing Board Meeting"); when, then where ONCE — some
    // sources publish the address as the venue name, and rendering the same
    // string as Location and again as Address was the author's Vail defect.
    /* MTG-8 (2026-08-24): the body alone. The jurisdiction is the SUBTITLE on
       the very next line, so the em-dash prefix was printing it twice — which
       is the "Tucson, AZ — " the author struck through in `12-01-44`. */
    // BC-11: what this card is ABOUT, keyed rather than titled.
    subjectId: meeting.id,
    subjectKind: "MEETING" as const,
    title: meetingEntryTitle(meeting, { bodyShown: true }),
    /*
     * DATA-2 (2026-08-28): THE IDENTITY LINE COMES FROM THE REGISTRY.
     *
     * The title is the SITTING, worded as the source words it — and a source
     * words it however it likes. CivicClerk files all seven of CAWCD's
     * meeting kinds under one body: "Board Meeting" and "Public Policy
     * Committee", but also "Briefings and Roundtables" and "CAP University",
     * which are event series rather than governments. A reader met a card
     * headed "CAP University" and had nothing on it to say which government
     * they were looking at.
     *
     * So the line beneath the sitting names the BODY, from the canonical
     * registry record, and falls back to the jurisdiction when the registry
     * holds no name for it. A source's page title, brand or event label is
     * provenance; it is never the name of a government.
     */
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
            // D18. MTG-14 (2026-08-28): the sentence is no longer written out
            // here — it stood in two places, this and meeting-popup.tsx, for
            // one claim about a government's meeting.
            label: "Where",
            value: ONLINE_ONLY_LINE,
          },
      ...(() => {
        const access = onlineAccessFor(meeting);
        return access
          ? [{ label: "How to join", value: access.joinUrl ?? joinLine(access) }]
          : [];
      })(),
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
    // Item 1 (2026-08-16): the shared assembler, so this card and the
    // district card cannot answer "says who?" from two different joins.
    sources: meetingCardSources(meeting, roster),
  };
}

/**
 * A GOVERNING BODY'S LARGE BATTLECARD (item 3, 2026-08-16, the author's
 * ruling).
 *
 * The who-governs list used to send a reader straight out to the body's own
 * website from the row — Pima and Tucson both — which threw them out of the
 * product before it had told them anything. The click grammar is two moves
 * now: a person's name opens their small card, a body's row opens this. Every
 * external door lives inside, beside the roster, the sittings and the records
 * behind them.
 *
 * Nothing here is invented. The name is the body's own or the division's
 * Census label; the site is the sourced homepage or nothing at all.
 */
function bodySubject(
  body: CoveredBody,
  allMeetings: Meeting[] = [],
): ModalSubject {
  /*
   * **NO DIVISION FALLBACK** (2026-08-27, Red Controls 2 and 3).
   *
   * This used to be `own roster, else the DIVISION's governing roster`, and
   * that fallback put the five Pima County Supervisors on the Central Arizona
   * Water Conservation District card — a popularly elected 15-member board —
   * and the Mayor and Council on 58 appointed Tucson commissions. 74 bodies
   * rendered named members that way and through nothing else.
   *
   * `membersOfBody` resolves an EXPLICIT composition or returns nobody. A body
   * that legally IS another government sitting as a board still renders their
   * names, through a recorded and cited authority; a body whose membership is
   * unsourced renders the named gap. See lib/registry/body-composition.ts.
   */
  const composition = membersOfBody(body.bodyId);
  const roster = composition.members;
  /*
   * **THIS BODY'S SITTINGS, NOT THIS DIVISION'S** (2026-08-27, Red Control 4).
   *
   * The filter was `m.ocdId === body.ocdId`, which is a join only where a
   * division holds one body. It does not: 364 of 460 meetings in the
   * 2026-08-27 snapshot sat on a division with more than one body, so every
   * one of Tucson's 58 appointed commissions showed all 80 City sittings and
   * the Pima County Board of Supervisors' agenda appeared on the Central
   * Arizona Water Conservation District's card.
   *
   * A meeting with no `bodyId` is shown here on NO card. That is deliberate:
   * the map and the meeting list are division-scoped and still carry it, and a
   * card that showed it would be claiming this body met.
   */
  const meetings = allMeetings
    .filter((m) => m.bodyId !== undefined && m.bodyId === body.bodyId)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  /*
   * F01 1.2 (2026-08-19): the superintendent is HIRED by the board and does
   * not sit on it, so they belong in exactly one place on this card — “Runs
   * the district day to day” — and never in “Who sits on it”. They live in the
   * roster array because that is where this slot resolves from; pulling them
   * out of the seated list is the other half of the same decision.
   */
  const superintendent =
    body.divisionType === "school_district"
      ? (roster.find((h) => /superintendent/i.test(h.officeTitle ?? "")) ?? null)
      : null;
  const seated = superintendent
    ? roster.filter((h) => h.id !== superintendent.id)
    : roster;

  return {
    // BC-11: the body id, never the display title — nine Morris County
    // governments answer to "Township Council".
    subjectId: body.bodyId,
    subjectKind: "BODY" as const,
    title: body.name ?? body.divisionLabel,
    subtitle: body.divisionLabel,
    tier: body.tier,
    // LBL-1 (2026-08-22): decides whether this card carries a Who runs it
    // heading at all. A county board runs a county; a district does not run.
    divisionKind: body.divisionType,
    divisionOcdId: null,
    facts: [
      { label: "Type", value: BODY_TYPE_LABEL(body) },
      { label: "Tier", value: TIER_LABEL[body.tier] },
      // The external door, INSIDE the card. Absent where no hunt found one —
      // never a guessed URL, and never a row claiming there is a site.
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
    ],
    representation: seated,
    representationNote:
      "We know this body governs here because its division exists. We haven't sourced who sits on it.",
    meetings,
    sources: districtCardSources(roster, meetings),
    // M136 (2026-08-18): the seven sections. Every one renders for every
    // body — content where the product holds it, the section's own honest
    // absence line where it does not, and never a hidden section.
    bodyCard: {
      /*
       * NH94: a body with NO division gets no class definition, and now it
       * cannot even be ASKED for one — `divisionType` is null rather than the
       * placeholder `"place"` that used to be handed in here. The guard inside
       * `definitionsForBody` (null `ocdId` returns nothing) stays; this is the
       * cause rather than the symptom.
       */
      whatItDoes:
        body.divisionType === null
          ? { classDefinition: null, formDefinition: null, classKey: null, unreadNote: null }
          : definitionsForBody({
              // DATA-4 (2026-08-28): the definition is keyed on the BODY. Five of
              // the six bodies on county:pima were handed the county's powers
              // because they share its division -- and it was 248 bodies
              // repo-wide, 100 of them live and reader-reachable.
              bodyId: body.bodyId,
              ocdId: body.ocdId,
              divisionType: body.divisionType,
              lsad: body.lsad,
              schoolDependency: schoolDependency(body.ocdId),
            }),
      isSchoolDistrict: body.divisionType === "school_district",
      // The superintendent is HIRED by the board, so they are not in the
      // elected roster and have to be asked for separately. Null renders as
      // the named gap, never as an absent row.
      superintendent: superintendent,
      contact: bodyContactRows(body),
      /*
       * JUR-1 (2026-08-22): this row used to be built unconditionally from the
       * division label, which is how Morris County came to render "Governs your
       * area" and "Boundary not published" on the same card. The claim is now
       * made in ONE place — lib/meetings/jurisdiction-badge.ts — and a body with
       * no published boundary cannot produce a Governs row at all.
       */
      jurisdiction: [
        (() => {
          const claim = jurisdictionClaim(body);
          return { label: claim.label, value: claim.value };
        })(),
        { label: "Level", value: TIER_LABEL[body.tier] },
      ],
    },
  };
}

/**
 * A body's published contact routes (M136 section 5).
 *
 * Only what the registry actually holds. No pattern-built addresses, no
 * "info@" guessed from a domain — a contact route we invented is a claim
 * about how to reach a government, and a reader who writes to it and hears
 * nothing has been failed more thoroughly than one who was told we don't
 * know.
 */
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
  // The registry holds no phone or email for a BODY today — those live on the
  // people, on their own cards. Stated here rather than left as an empty
  // branch somebody later reads as "we checked and there is none".
  return rows;
}

/**
 * A PLACE'S CARD (g18, 2026-08-18, the author's ruling A).
 *
 * M135's last unconverted row. A place row — "Pima County, AZ" in the ask
 * panel's autocomplete — flew the camera and opened nothing, because a place
 * is a division several bodies sit in and this product had no card for one.
 *
 * NOBODY IS ELECTED TO STAND FOR THE PLACE. The card names the place and its
 * type and then lists every body we hold in it, each row opening that body's
 * own battlecard. Choosing the largest body, or the first, or the one with
 * the most sittings, would be this product answering "who speaks for Pima
 * County?" out of its own convenience — an invented claim about a government,
 * which is the thing it exists not to do.
 *
 * A place we hold NO bodies for renders the stated absence, never an empty
 * list: "we hold no bodies here" is a fact about us, and it may not wear the
 * shape of a fact about the place.
 */
function placeSubject(
  ocdId: string,
  label: string,
  rowTier: Tier | null,
  bodies: CoveredBody[],
  meetings: Meeting[],
): ModalSubject {
  const mine = bodies.filter((b) => b.ocdId === ocdId);
  const divisionType = mine[0]?.divisionType ?? typeFromOcdId(ocdId);

  /*
   * THE TIER IS NEVER GUESSED, AND NULL IS A REAL ANSWER.
   *
   * `tierForOcdId` returns null when it does not recognise a division's
   * deepest segment, and its own note says callers must handle that rather
   * than walk up to an ancestor — a `water_district` inheriting the state
   * tier would be filed wrong with nothing on screen to show it had been
   * guessed at. So: the row's tier, else the tier of a body we actually hold
   * in this place (a sourced division, not an inference), else null.
   *
   * Null reaches the card as a named gap in the Tier row. The header still
   * paints an accent, because a modal has to paint something and there is no
   * fourth palette; the accent is the only part of this that falls back, and
   * the part that makes a claim IN WORDS renders the gap.
   */
  const tier: Tier | null = rowTier ?? mine[0]?.tier ?? null;

  return {
    // BC-11: a PLACE is not a body and not a person; the ocd-id is what it is.
    subjectId: ocdId,
    subjectKind: "BODY" as const,
    title: label,
    subtitle: divisionTypeLabel(divisionType),
    tier: tier ?? "local",
    /*
     * NULL, deliberately, exactly as `bodySubject` sets it. `divisionOcdId` is
     * M112's re-derive key: a card carrying one is rebuilt as a DISTRICT card
     * whenever the selected district shares that OCD-ID. A place and a
     * district can share one — `county:pima` is both — so carrying it here
     * would let a place card silently become a district card under the
     * reader. The re-derive exists to fill in a roster that arrived late, and
     * a place card has no roster to fill in.
     */
    divisionOcdId: null,
    facts: [],
    placeCard: {
      typeLabel: divisionTypeLabel(divisionType),
      tierLabel: tier ? TIER_LABEL[tier] : null,
      bodies: mine
        .map((b) => {
          /*
           * PU02's class sweep (NJ Hunt 4 item 3, 2026-08-22) — the third
           * instance of the exact-string join between the snapshot's published
           * `bodyName` and the registry's hunted `name`. Undercounts a body's
           * sittings whenever the two spell the name differently, and prints
           * NOTHING at zero, so the undercount rendered as "sits never".
           */
          const count = meetings.filter(
            (m) => m.ocdId === ocdId && sameName(m.bodyName, b.name ?? b.divisionLabel),
          ).length;
          return {
            key: b.bodyId,
            name: b.name ?? b.divisionLabel,
            tier: b.tier,
            // A count of sittings we hold, never a judgement. Omitted at zero
            // rather than rendered as "0", which reads as "sits never".
            meta: count > 0 ? `${count}` : undefined,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      absence:
        /* BAL-7 (2026-08-24): the attribution stays, the self-assessment goes.
           A reader needs to know this absence is OURS and that it is not a
           finding about the place — neither of which requires the app to grade
           its own coverage in the middle of the sentence. */
        "We haven't recorded any governing body in this place yet — which is not a statement that it has none.",
    },
    // A place has no roster of its own — the people are on the bodies' cards,
    // one level down, and saying so is better than an empty tab.
    representation: [],
    representationNote:
      "A place isn't governed by one body. Open a body above to see who sits on it.",
    meetings: meetings.filter((m) => m.ocdId === ocdId),
    sources: [],
  };
}

/**
 * The division kind an OCD-ID's last segment names.
 *
 * Only reached when we hold no body in the place, so `divisionType` cannot be
 * read off one. `divisionTypeLabel` falls back to "District" for a key it has
 * no word for, which is the plain-language rule doing its job: an unrecognised
 * segment must never leak `school_district` onto a reader's card.
 */
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
  // One source for these labels — RULING 118 / RULING 119, 2026-08-24.
  const CLASS = (bodyClass: CoveredBody["bodyClass"]): string => bodyClassLong(bodyClass);
  // NH94: no division means no division noun. "Municipal" was a placeholder
  // claiming a kind of government nobody had established.
  return body.name === null && body.divisionType !== null
    ? DIVISION[body.divisionType]
    : CLASS(body.bodyClass);
}

function districtSubject(
  district: DistrictHit,
  allMeetings: Meeting[] = [],
  coverage: CoverageSummary | null = null,
  /**
   * The division-keyed answer (M112, 2026-08-16), when the caller has one.
   * Omitted, the card falls back to the point-scoped resolver — which is
   * correct for the divisions containing the reader and empty for every
   * other one, which is exactly why the caller normally passes this.
   */
  resolved: DivisionRepresentation | null = null,
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
  // The SAME resolver the small popup and the who-governs card read. This
  // called the roster store directly until 2026-08-15, which is why every
  // congressional, state-house and state-senate division card denied its own
  // officeholder: rosters hold no legislative seats, and the seats were never
  // asked for. A parallel join always drifts; there is one now.
  //
  // M112 (2026-08-16): the resolver above is POINT-SCOPED — `coverage.seats`
  // carries only the divisions containing the reader — so every district card
  // opened for anywhere else got an empty array and rendered it as our gap.
  // State House District 21 denied Consuelo Hernandez and Stephanie Stahl
  // Hamilton to any reader not living in it. `resolved` is the same question
  // asked by the division's own key.
  const roster =
    resolved?.holders.length
      ? resolved.holders
      : representationForDivision(coverage, district.ocdId);
  return {
    // BC-11: the division's own ocd-id. A district card is about a government,
    // so a reader speaking here is speaking to it.
    subjectId: district.ocdId,
    subjectKind: "BODY" as const,
    title: district.label,
    subtitle: `${district.typeLabel} · ${district.state}`,
    tier: district.tier,
    // LBL-1: the map vocabulary — congressional / state-senate / state-house
    // all answer false, which is the whole point of the field.
    divisionKind: district.type,
    facts: [
      // No OCD-ID row: internal identifiers never render to readers (4a).
      { label: "Type", value: district.typeLabel },
      { label: "Tier", value: TIER_LABEL[district.tier] },
      { label: "State", value: district.state, mono: true },
      /*
       * F01 2.1 (2026-08-19, the author): *"When looking at the large
       * battlecard in Overview, the district's website should be present in
       * Overview."* His instance was Tucson Unified District, whose Overview
       * was three identifiers — Type, Tier, State — and no door to the
       * district itself.
       *
       * The BODY card already had this row; the DIVISION card never did, and
       * a division card is what a who-governs row and a district click both
       * open. `bodyHomepageRows` is shared with `bodySubject` so the two
       * cards cannot render a body’s own site two different ways.
       *
       * A division can be governed by more than one body — a county board and
       * a library district sit in the same division — so this lists each
       * distinct site rather than electing one, which would be inventing an
       * answer about who speaks for a jurisdiction (the same reason the place
       * card elects nobody).
       */
      ...bodyHomepageFacts(coverage, district.ocdId),
    ],
    /*
     * 6f2 (2026-08-15): the enrichment. The overview was three identifiers
     * and nothing a stranger could use.
     *
     * The office title is taken from the DIVISION's own type, not from
     * whoever currently holds the seat — so an unfilled or unsourced seat
     * still gets its explainer, and a district with two representatives
     * (Arizona's state house districts elect two) does not have to pick one.
     * A type with no office to name renders no explainer at all.
     */
    divisionOcdId: district.ocdId,
    representedByOfficeTitle: officeTitleForDivision(district.ocdId),
    representation: roster,
    representationNote: representationNoteFor(
      district.tier,
      resolved ? noteStateFor(resolved.status) : "gap",
    ),
    meetings,
    /*
     * Item 1 (2026-08-16) — THE FALSE SENTENCE.
     *
     * This was `[]`. Not "empty because we checked" — never wired at all, so
     * the Sources tab said "Nothing on this card came from an external
     * record" on the Tucson Unified District card, whose boundary is Census
     * TIGER/Line, whose governing board is the district's own roster page,
     * and whose sittings are the district's own agenda vendor. Every fact on
     * it came from an external record and the tab denied all three.
     *
     * A tab that reports absence has to have looked. This one now reads the
     * same rows the card renders.
     */
    sources: districtCardSources(roster, meetings),
  };
}

/**
 * **The body's own website, as an Overview row** — F01 2.1, 2026-08-19.
 *
 * Shared by `bodySubject` and `districtSubject` so a body's site cannot render
 * two different ways on the two cards that can show it. The label and the
 * host-only display are the body card's, unchanged.
 *
 * **Nothing is invented.** A body with no `homepageUrl` contributes no row —
 * never a guessed domain, and never a row claiming a site exists. Measured on
 * the shipped registry (2026-08-19): 95 of 347 bodies carry one, and every
 * body without is `NOT_ATTEMPTED` — nobody has hunted it yet. So this is not a
 * render suppressing data; every body the product actually covers has its site
 * and now shows it on both cards.
 */
function bodyHomepageFacts(
  coverage: CoverageSummary | null,
  ocdId: string,
): { label: string; value: React.ReactNode }[] {
  /*
   * **BC-24 (2026-08-25) — DEDUPE ON WHAT THE READER SEES, NOT ON THE STORED
   * STRING.**
   *
   * The author's `09-18-31`: Rockaway township's Overview renders
   * `OFFICIAL SITE  rockawaytownship.org →` **five times**.
   *
   * The dedupe was here and it was working exactly as written — it just
   * measured the wrong thing. It keyed on the raw `homepageUrl`, and a
   * township's five bodies each carry a URL that differs by a `www.`, a
   * trailing slash, or a path. Five DISTINCT keys, one identical rendered
   * value, five rows a reader cannot tell apart.
   *
   * That is the distinctness rule pointed the other way. `CLAUDE.md` says
   * identical payloads across distinct keys are presumed broken; here the keys
   * were distinct and the PAYLOAD was identical, and nothing was asking. The
   * only key that can be right is the one the reader can actually
   * discriminate on — which is the rendered host, because the host is all this
   * row renders.
   *
   * **A path is deliberately NOT part of the key.** Two bodies pointing at
   * `/council` and `/planning-board` on one host still produce two rows
   * reading `rockawaytownship.org`, which is the defect wearing a
   * justification. Where a body's own page matters, it is on that body's own
   * card, which its row opens.
   */
  const seen = new Set<string>();
  const rows: { label: string; value: React.ReactNode }[] = [];
  for (const body of coverage?.bodies ?? []) {
    if (body.ocdId !== ocdId || !body.homepageUrl) continue;
    let host: string;
    try {
      host = new URL(body.homepageUrl).hostname.replace(/^www\./, "");
    } catch {
      // A malformed stored URL renders no row rather than a broken link.
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    rows.push({
      label: "Official site",
      value: (
        <a
          href={body.homepageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {host} →
        </a>
      ),
    });
  }
  return rows;
}

/**
 * The office that represents a division, from the division's OWN identifier
 * segment (6f2, 2026-08-15).
 *
 * Read off the OCD-ID rather than off a label or a current officeholder: the
 * identifier is the join key this whole product is built on, a label is a
 * display string that varies by state, and a seat can be vacant. A segment
 * with no office to name returns null and the card renders no explainer,
 * which is the correct answer for a county or a place — those are governments
 * with bodies, not constituencies with a representative, and they have their
 * own surfaces.
 */
function officeTitleForDivision(ocdId: string): string | null {
  if (/\/cd:[^/]+$/.test(ocdId)) return "U.S. Representative";
  if (/\/sldu:[^/]+$/.test(ocdId)) return "State Senator";
  if (/\/sldl:[^/]+$/.test(ocdId)) return "State Representative";
  if (/\/school_district:[^/]+$/.test(ocdId)) return "School Board Member";
  return null;
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
      <p className="font-mono text-[0.625rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-danger">
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
      <p className="font-mono text-[0.625rem] uppercase trailing-space-trimmed-20 tracking-[0.2em] text-danger">
        Basemap unavailable
      </p>
      {/*
        **A READER IS NOT AN OPERATOR** (`VF02`, NJ Hunt 6).

        This told a reader in Rockaway to set `NEXT_PUBLIC_MAPTILER_KEY` in
        `.env.local`. The plain-language rule is explicit that identifiers and
        internal keys never render outside a technical-details disclosure, and
        an environment variable name on a civic map is about as far outside one
        as a string can get. It also said nothing a reader could use.

        What replaces it says what they can see, what still works, and what to
        do — which is the whole of what a reader needs from a notice about our
        own infrastructure.
      */}
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-text-dim">
        The map&apos;s background image isn&apos;t loading right now. Everything else
        works — the pins are in the right places, and meeting details still open.
        Reloading often fixes it.
      </p>
    </div>
  );
}
