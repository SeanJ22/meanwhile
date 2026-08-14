"use client";

import { useMemo } from "react";

import { formatMiles } from "@/lib/map/format";
import { useShellData } from "@/lib/state/data";
import { computeStats, deriveStatsView } from "@/lib/state/derive";
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
  const { meetings, districtCount, dropped, result, searchFailed } =
    useShellData();
  const ui = useUi();

  // Distinct people we can actually name at this point — the seats' holders
  // plus the state's senators, deduplicated because a person can hold one seat
  // and appear in both lists. The card read a flat 0 while three names were
  // rendered beside it, which is the same class of quiet lie as a silently
  // widened radius: the number said we had nothing and the screen said we did.
  const officialCount = useMemo(() => {
    const coverage = result?.coverage;
    if (!coverage) return 0;
    const ids = new Set<string>();
    for (const seat of coverage.seats) {
      for (const holder of seat.representatives) ids.add(holder.id);
    }
    for (const senator of coverage.senators) ids.add(senator.id);
    return ids.size;
  }, [result]);

  const stats = useMemo(
    () => computeStats(meetings, ui.showDistricts ? districtCount : 0, officialCount),
    [meetings, districtCount, ui.showDistricts, officialCount],
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
      <Card label="Meetings" value={view.meetings} style={accent} accent />
      <Card label="Bodies" value={view.bodies} />
      <Card label="Districts" value={view.districts} />
      <Card label="Officials" value={view.officials} />

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
