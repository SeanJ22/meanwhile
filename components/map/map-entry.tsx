"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import { UiProvider, useUi, useUiDispatch } from "@/lib/state/provider";
import type { MeetingSearchResult } from "@/lib/meetings/query";
import { groupByVenue, type Venue } from "@/lib/meetings/venues";
import type { Meeting } from "@/lib/sources/types";

import type { DistrictHit } from "@/lib/map/districts";
import type { DistrictType } from "@/lib/state/types";

import { CoverageNotice } from "./coverage-notice";
import { DistrictPicker } from "./district-picker";
import { MapCanvas, type CameraTarget, type MapFocus } from "./map-canvas";
import { MeetingPanel } from "./meeting-panel";
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

  useEffect(() => {
    if (!location) return;

    const controller = new AbortController();
    const { zip, lat, lng } = location;

    void (async () => {
      try {
        const response = await fetch(`/api/meetings?lat=${lat}&lng=${lng}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Search failed: ${response.status}`);

        const payload: MeetingSearchResult = await response.json();
        setResult({ ...payload, zip });
        setFailed(false);
      } catch {
        if (controller.signal.aborted) return;
        setResult(null);
        setFailed(true);
      }
    })();

    return () => controller.abort();
  }, [location]);

  const search = useCallback(
    (zip: string, lat: number, lng: number) => {
      dispatch({ type: "select/venue", key: null });
      setFailed(false);
      setWelcomeRequested(false);
      remember({ zip, lat, lng });
    },
    [remember, dispatch],
  );

  const camera = useMemo<CameraTarget | null>(
    () =>
      location
        ? { zip: location.zip, lat: location.lat, lng: location.lng }
        : null,
    [location],
  );

  const current = result && location && result.zip === location.zip ? result : null;

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
            // widened search just found.
            center: ui.radiusOverridden ? (ui.nearMe ?? location) : null,
          })
        : [],
    [current, ui, location],
  );

  const venues = useMemo<Venue[]>(() => groupByVenue(meetings), [meetings]);

  const selectedVenue = useMemo(
    () => venues.find((v) => v.key === ui.selectedVenueKey) ?? null,
    [venues, ui.selectedVenueKey],
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
  }, [dispatch]);

  const onPickMeeting = useCallback(
    (meeting: Meeting) => {
      const venue = venues.find((v) =>
        v.meetings.some((m) => m.id === meeting.id),
      );
      if (venue) dispatch({ type: "select/venue", key: venue.key });
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
  // master toggle. Empty when the toggle is off.
  const activeDistrictTypes = useMemo(
    () =>
      showDistricts && !districtsFailed
        ? (ui.filters.districtTypes as DistrictType[])
        : [],
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
    (venue: Venue) => dispatch({ type: "select/venue", key: venue.key }),
    [dispatch],
  );

  return (
    <DataProvider value={data}>
      <main className="relative h-dvh w-full overflow-hidden">
        <Sidebar
          onSearchPick={onSearchPick}
          onReset={onReset}
          onChangeLocation={() => setWelcomeRequested(true)}
          showDistricts={showDistricts}
          districtsFailed={districtsFailed}
          onToggleDistricts={setShowDistricts}
        />

        {/* The map starts where the sidebar ends. */}
        <div className="absolute inset-y-0 right-0 left-[340px]">
          <MapCanvas
            venues={venues}
            camera={camera}
            focus={focus}
            selectedVenueKey={ui.selectedVenueKey}
            frameAllVenues={current !== null && current.tier !== "exact"}
            districtTypes={activeDistrictTypes}
            selectedDistrict={selectedDistrict}
            onDistrictClick={onDistrictClick}
            theme={theme}
            onDistrictError={onDistrictError}
            onDistrictCount={setDistrictCount}
            onSelectVenue={onSelectVenue}
            onTileError={onTileError}
          />
        </div>

        <div className="pointer-events-none absolute inset-y-0 right-0 left-[340px] flex flex-col">
          <div className="flex items-start justify-end gap-3 p-3 sm:p-5">
            {selectedVenue && (
              <div className="pointer-events-auto hidden sm:block">
                <MeetingPanel
                  venue={selectedVenue}
                  onClose={() => dispatch({ type: "select/venue", key: null })}
                />
              </div>
            )}
          </div>

          {/* Extra bottom padding clears the attribution, which now sits in
              the bottom-left corner. */}
          <div className="mt-auto flex flex-col items-start gap-3 p-3 pb-9 sm:p-5 sm:pb-10">
            <div className="pointer-events-auto">
              <CountBadge />
            </div>

            {tilesFailed && <TileNotice />}
            {failed && <SearchFailedNotice />}

            {current && (
              <CoverageNotice
                tier={current.tier}
                zip={current.zip}
                radiusKm={current.radiusKm}
                requestedRadiusKm={current.requestedRadiusKm}
                count={current.meetings.length}
              />
            )}

            {selectedVenue && (
              <div className="pointer-events-auto sm:hidden">
                <MeetingPanel
                  venue={selectedVenue}
                  onClose={() => dispatch({ type: "select/venue", key: null })}
                />
              </div>
            )}
          </div>
        </div>

        {/* Positioned against the map area, so its coordinates match the
            click that produced it. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 left-[340px]">
          <DistrictPicker />
        </div>

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
