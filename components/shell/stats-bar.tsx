"use client";

import { useMemo } from "react";

import { formatMiles } from "@/lib/map/format";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { useShellData, useMeetingListingIdentity } from "@/lib/state/data";
import { computeStats, deriveStatsView } from "@/lib/state/derive";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierSetVars } from "./tier-style";

/**
 * The four stat cards, plus the two things that must never be silent:
 * how many records were dropped, and which rung of the cascade answered.
 */

const COVERAGE_LABEL = {
  exact: "Showing meetings near you",
  widened: "Nothing closer, so showing meetings from farther out",
  concluded: "Nothing upcoming; showing recent meetings",
  none: "No meetings collected for this area yet",
} as const;

export function StatsBar() {
  const { meetings, venues, location, drawnDistricts, dropped, result, searchFailed, atAddress, governing } =
    useShellData();
  const ui = useUi();
  const dispatch = useUiDispatch();

  // Every counter gets the collection its own door renders; no card re-derives its number.
  const stats = useMemo(
    () =>
      computeStats({
        meetings,
        coverage: result?.coverage ?? null,
        /* The real list always; `deriveStatsView` decides what it means. */
        drawnDistricts,
        atAddress,
        addressDivisionIds: atAddress ? governing : null,
      }),
    [meetings, drawnDistricts, result, atAddress, governing],
  );

  // A failed operation never renders as an empty success.
  const view = useMemo(
    () => deriveStatsView(stats, ui.showDistricts, searchFailed),
    [stats, ui.showDistricts, searchFailed],
  );

  // No answer for this ZIP yet: a count of 0 would read as "nothing here".
  const awaitingAnswer = result === null && !searchFailed;
  const accent = tierSetVars(ui.tiers);
  const listingCount = readerMeetingCount(meetings, useMeetingListingIdentity());

  const coverage = result?.tier ?? null;
  const widened =
    result && result.radiusKm !== result.requestedRadiusKm
      ? `${formatMiles(result.requestedRadiusKm)} → ${formatMiles(result.radiusKm)} mi`
      : null;

  return (
    <div className="stats-bar">
      {/* Each count opens the list it counts. */}
      <Card
        statKey="meetings"
        label={listingCount.heading}
        value={awaitingAnswer ? "—" : view.meetings}
        loading={awaitingAnswer}
        sub={
          listingCount.countNote ??
          (searchFailed || awaitingAnswer
            ? null
            : `${venues.length} ${venues.length === 1 ? "venue" : "venues"}`)
        }
        style={accent}
        open={ui.listOverlayOpen}
        onOpen={() => dispatch({ type: "list/open", open: true })}
      />
      {/* "Bodies here" matches the door; the second line splits governing bodies from boards and committees. */}
      <Card
        label="Bodies here"
        value={view.bodies}
        loading={awaitingAnswer}
        sub={view.bodiesSecondary}
        open={ui.door === "bodies"}
        onOpen={() => dispatch({ type: "door/open", door: "bodies" })}
      />
      {/* The number always travels with what it counts. */}
      <Card
        label={`Districts ${view.districtsLabel.toLowerCase()}`}
        value={view.districts}
        sub={view.districtsSecondary}
        open={ui.door === "districts"}
        onOpen={() => dispatch({ type: "door/open", door: "districts" })}
      />
      <Card
        label="Officials"
        value={view.officials}
        loading={awaitingAnswer}
        sub={location ? `Near ${location.zip}` : null}
        open={ui.door === "officials"}
        onOpen={() => dispatch({ type: "door/open", door: "officials" })}
      />

      {view.failedNote && (
        <p className="stat-missing">{view.failedNote}</p>
      )}

      {/* Meetings the adapter could not place are counted, so the map never reads as complete. */}
      {dropped > 0 && (
        <p className="stat-missing">
          {dropped} {dropped === 1 ? "calendar listing" : "calendar listings"} not shown — no
          resolvable location
        </p>
      )}

      {/* A widened search stays on screen as the rung that answered. */}
      {coverage && !searchFailed && (
        <p className="stat-missing" style={{ color: "var(--text-muted)" }}>
          {COVERAGE_LABEL[coverage]}
          {widened ? ` (${widened})` : ""}
        </p>
      )}
    </div>
  );
}

/** One counter, which is also the door to what it counts; it is highlighted only while its door is open. */
function Card({
  statKey,
  label,
  value,
  sub = null,
  style,
  open = false,
  loading = false,
  onOpen,
}: {
  statKey?: string;
  label: string;
  value: number | string;
  /** A second number, kept rather than thrown away. */
  sub?: string | null;
  style?: React.CSSProperties;
  /** This tile's list or door is the one currently on screen. */
  open?: boolean;
  /** The answer for this ZIP is still on its way, so a missing value is a wait, not a gap. */
  loading?: boolean;
  onOpen?: () => void;
}) {
  // `derive.ts` keeps "—" as its internal sentinel; only held counts render.
  const missing = value === "—";
  const note = sub;
  return (
    <button
      type="button"
      className="stat-card cursor-pointer text-left"
      /* Named for walk checks that compare this number with the map chip and panel. */
      data-stat={statKey ?? label.toLowerCase()}
      data-open={open || undefined}
      aria-expanded={open}
      style={style}
      onClick={onOpen}
      aria-label={`Open the ${label.toLowerCase()} list`}
    >
      {(!missing || loading) && <div className="num">{loading && missing ? "…" : value}</div>}
      <div className="label">{label}</div>
      {note && (
        <div className="label" style={{ color: "var(--text-muted)" }}>
          {note}
        </div>
      )}
    </button>
  );
}
