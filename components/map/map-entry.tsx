"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useDistrictLayer } from "@/hooks/use-district-layer";
import { useStoredTheme } from "@/hooks/use-stored-theme";
import { useStoredZip } from "@/hooks/use-stored-zip";
import type { MeetingSearchResult } from "@/lib/meetings/query";
import { groupByVenue, type Venue } from "@/lib/meetings/venues";

import { CoverageNotice } from "./coverage-notice";
import { DistrictToggle } from "./district-toggle";
import { EntryNotice } from "./entry-notice";
import { LocationBar } from "./location-bar";
import { MapCanvas, type CameraTarget } from "./map-canvas";
import { MeetingPanel } from "./meeting-panel";

/**
 * The entry screen.
 *
 * Holds the state the map and the panels share — where we're looking, what came
 * back, which pin is open — and nothing about where meetings come from. It asks
 * /api/meetings and renders what it gets.
 *
 * The stored zip is the single source of truth for the search: entering one and
 * returning to a remembered one take exactly the same path.
 */

/** A result, tagged with the zip that produced it. */
interface TaggedResult extends MeetingSearchResult {
  zip: string;
}

export function MapEntry() {
  const { location, restored, remember } = useStoredZip();
  const { theme } = useStoredTheme();

  const [result, setResult] = useState<TaggedResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [districtsFailed, setDistrictsFailed] = useState(false);

  const {
    enabled: showDistricts,
    restored: districtsRestored,
    setEnabled: setShowDistricts,
  } = useDistrictLayer();

  // Fetch whenever the location changes, and abandon in-flight work when it
  // changes again — a slow earlier search must not overwrite a newer one.
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

  // Entering a zip is just remembering it; the effect above does the rest.
  const search = useCallback(
    (zip: string, lat: number, lng: number) => {
      setSelectedKey(null);
      setFailed(false);
      remember({ zip, lat, lng });
    },
    [remember],
  );

  const camera = useMemo<CameraTarget | null>(
    () =>
      location
        ? { zip: location.zip, lat: location.lat, lng: location.lng }
        : null,
    [location],
  );

  // A result for a zip we've since moved on from isn't this view's answer.
  const current = result && location && result.zip === location.zip ? result : null;

  const venues = useMemo(
    () => (current ? groupByVenue(current.meetings) : []),
    [current],
  );

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.key === selectedKey) ?? null,
    [venues, selectedKey],
  );

  const onTileError = useCallback(() => setTilesFailed(true), []);
  const onDistrictError = useCallback(() => setDistrictsFailed(true), []);
  const onSelectVenue = useCallback((venue: Venue) => setSelectedKey(venue.key), []);

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <MapCanvas
        venues={venues}
        camera={camera}
        selectedVenueKey={selectedKey}
        frameAllVenues={current !== null && current.tier !== "exact"}
        showDistricts={showDistricts && !districtsFailed}
        theme={theme}
        onDistrictError={onDistrictError}
        onSelectVenue={onSelectVenue}
        onTileError={onTileError}
      />

      {/* Chrome floats over the map; only the panels themselves take pointer
          events, so the map stays draggable everywhere between them. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="flex items-start justify-between gap-3 p-3 sm:p-5">
          {location ? (
            <LocationBar
              zip={location.zip}
              meetingCount={current?.meetings.length ?? 0}
              onChange={search}
            />
          ) : (
            <Wordmark />
          )}

          <div className="flex items-start gap-3">
            {selectedVenue && (
              <div className="hidden sm:block">
                <MeetingPanel
                  venue={selectedVenue}
                  onClose={() => setSelectedKey(null)}
                />
              </div>
            )}

            {/* Phase 1 home. Phase 2 moves this into the sidebar header,
                absolute at right: 36px with the reset button at right: 0. */}
            <div className="pointer-events-auto">
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* Nothing renders until the stored zip resolves, so a returning
            reader never sees the notice they already answered. */}
        {restored && !location && (
          <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
            <EntryNotice onResolved={search} />
          </div>
        )}

        <div className="mt-auto flex flex-col gap-3 p-3 sm:p-5">
          <div className="flex">
            <DistrictToggle
              enabled={showDistricts}
              restored={districtsRestored}
              failed={districtsFailed}
              onChange={setShowDistricts}
            />
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

          {/* On phones the detail panel is a sheet rather than a rail. */}
          {selectedVenue && (
            <div className="sm:hidden">
              <MeetingPanel
                venue={selectedVenue}
                onClose={() => setSelectedKey(null)}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}


function Wordmark() {
  return (
    <div className="pointer-events-none px-1 py-1">
      <p className="font-display text-sm font-semibold uppercase tracking-[0.24em] text-paper-dim">
        We the People
      </p>
    </div>
  );
}

function SearchFailedNotice() {
  return (
    <div className="panel pointer-events-auto max-w-md px-4 py-3.5">
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-signal">
        Search failed
      </p>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
        Couldn&apos;t reach the meetings service. Change the zip to try again.
      </p>
    </div>
  );
}

function TileNotice() {
  return (
    <div className="panel pointer-events-auto max-w-md px-4 py-3.5">
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-signal">
        Basemap unavailable
      </p>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-paper-dim">
        Map tiles didn&apos;t load. Pins and meeting details still work. Set{" "}
        <code className="font-mono text-paper">NEXT_PUBLIC_MAPTILER_KEY</code> in{" "}
        <code className="font-mono text-paper">.env.local</code> to use MapTiler.
      </p>
    </div>
  );
}

