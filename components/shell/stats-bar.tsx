"use client";

import { useMemo } from "react";

import { formatMiles } from "@/lib/map/format";
import { useShellData } from "@/lib/state/data";
import { computeStats, deriveStatsView } from "@/lib/state/derive";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierSetVars } from "./tier-style";

/**
 * The four stat cards, plus the two things that must never be silent:
 * how many records were dropped, and which rung of the cascade answered.
 */

const COVERAGE_LABEL = {
  exact: "Exact",
  widened: "Widened",
  concluded: "Concluded",
  none: "No coverage",
} as const;

export function StatsBar() {
  const { meetings, drawnDistricts, dropped, result, searchFailed, atAddress } =
    useShellData();
  const ui = useUi();
  const dispatch = useUiDispatch();

  // M57: every counter is handed the collection its own door renders — the
  // filtered meetings, the coverage summary the bodies and officials doors
  // read, and the drawn districts (null while the overlay is off). No card
  // re-derives its number, which is how OFFICIALS came to say 6 beside a
  // door listing 24 and BODIES 13 beside a door listing 60.
  const stats = useMemo(
    () =>
      computeStats({
        meetings,
        coverage: result?.coverage ?? null,
        drawnDistricts: ui.showDistricts ? drawnDistricts : null,
        atAddress,
      }),
    [meetings, drawnDistricts, ui.showDistricts, result, atAddress],
  );

  // The failed-fetch rule (2a): a failed operation may not render as an
  // empty success. The pure derivation is what the guard test holds.
  const view = useMemo(
    () => deriveStatsView(stats, ui.showDistricts, searchFailed),
    [stats, ui.showDistricts, searchFailed],
  );

  const accent = tierSetVars(ui.tiers);

  const coverage = result?.tier ?? null;
  const widened =
    result && result.radiusKm !== result.requestedRadiusKm
      ? `${formatMiles(result.requestedRadiusKm)} → ${formatMiles(result.radiusKm)} mi`
      : null;

  return (
    <div className="stats-bar">
      {/* 8a (2026-08-17): the numbers are doors. Each count opens the list
          it counts — twice carried, ships now. */}
      <Card
        label="Meetings"
        value={view.meetings}
        style={accent}
        accent
        onOpen={() => dispatch({ type: "list/open", open: true })}
      />
      <Card
        label="Bodies"
        value={view.bodies}
        onOpen={() => dispatch({ type: "door/open", door: "bodies" })}
      />
      {/* The number never travels without what it counts. "179 DISTRICTS"
          read as a claim the reader is governed by 179; the door said "in
          view" and the tile said nothing. */}
      <Card
        label={`Districts ${view.districtsLabel.toLowerCase()}`}
        value={view.districts}
        sub={view.districtsSecondary}
        onOpen={() => dispatch({ type: "door/open", door: "districts" })}
      />
      <Card
        label="Officials"
        value={view.officials}
        onOpen={() => dispatch({ type: "door/open", door: "officials" })}
      />

      {view.failedNote && (
        <p className="stat-missing">{view.failedNote}</p>
      )}

      {/* Edia's `.stat-missing`. A meeting the adapter could not place is
          missing from the map, and a reader who cannot see the count reads
          the map as complete. */}
      {dropped > 0 && (
        <p className="stat-missing">
          {dropped} {dropped === 1 ? "meeting" : "meetings"} not shown — no
          resolvable location
        </p>
      )}

      {/* docs/state.md §2: a silently widened search is a wrong answer, so the
          rung stays on screen rather than appearing only as a transient
          notice. */}
      {coverage && !searchFailed && (
        <p className="stat-missing" style={{ color: "var(--text-muted)" }}>
          Coverage: {COVERAGE_LABEL[coverage]}
          {widened ? ` (${widened})` : ""}
        </p>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  sub = null,
  style,
  accent = false,
  onOpen,
}: {
  label: string;
  value: number | string;
  /** A second honest number, kept rather than thrown away. */
  sub?: string | null;
  style?: React.CSSProperties;
  accent?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className="stat-card cursor-pointer text-left"
      style={style}
      onClick={onOpen}
      aria-label={`Open the ${label.toLowerCase()} list`}
    >
      <div
        className="num"
        style={accent ? { color: "var(--tier-accent, var(--text))" } : undefined}
      >
        {value}
      </div>
      <div className="label">{label}</div>
      {sub && (
        <div className="label" style={{ color: "var(--text-muted)" }}>
          {sub}
        </div>
      )}
    </button>
  );
}
