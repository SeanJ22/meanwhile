"use client";

import { useMemo } from "react";

import { formatMiles } from "@/lib/map/format";
import { useShellData } from "@/lib/state/data";
import { computeStats } from "@/lib/state/derive";
import { useUi } from "@/lib/state/provider";

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
  const { meetings, districtCount, dropped, result } = useShellData();
  const ui = useUi();

  const stats = useMemo(
    () => computeStats(meetings, ui.showDistricts ? districtCount : 0),
    [meetings, districtCount, ui.showDistricts],
  );

  const accent = tierSetVars(ui.tiers);

  const coverage = result?.tier ?? null;
  const widened =
    result && result.radiusKm !== result.requestedRadiusKm
      ? `${formatMiles(result.requestedRadiusKm)} → ${formatMiles(result.radiusKm)} mi`
      : null;

  return (
    <div className="stats-bar">
      <Card label="Meetings" value={stats.meetings} style={accent} accent />
      <Card label="Bodies" value={stats.bodies} />
      <Card
        label="Districts"
        value={ui.showDistricts ? stats.districts : "—"}
      />
      <Card label="Officials" value={stats.officials} />

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
      {coverage && (
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
  style,
  accent = false,
}: {
  label: string;
  value: number | string;
  style?: React.CSSProperties;
  accent?: boolean;
}) {
  return (
    <div className="stat-card" style={style}>
      <div
        className="num"
        style={accent ? { color: "var(--tier-accent, var(--text))" } : undefined}
      >
        {value}
      </div>
      <div className="label">{label}</div>
    </div>
  );
}
