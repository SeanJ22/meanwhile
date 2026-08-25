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
        /* F01 9.2 (2026-08-19): the real list, always. This used to be
           nulled whenever the mirrored switch read false, which is what
           turned "the map is drawing seven districts" into "Off" while
           seven were on screen. `deriveStatsView` decides what the value
           means; this hands it the evidence rather than pre-judging it. */
        drawnDistricts,
        atAddress,
      }),
    [meetings, drawnDistricts, result, atAddress],
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
        open={ui.listOverlayOpen}
        onOpen={() => dispatch({ type: "list/open", open: true })}
      />
      {/* **The unit is NAMED, and the pair reconciles on the tile.**
          (Item 6, 2026-08-23.) At 07866 this read `12 Bodies` beside a panel
          saying "4 of the 8 bodies that govern the area" — both true, neither
          saying which unit it counted. `Bodies here` matches the door this
          tile opens, and the second line splits the 12 into the 8 that govern
          and the 4 boards and committees, so the two numbers on screen state
          their relationship instead of contradicting each other. This is the
          same fix the Districts tile already carries. */}
      <Card
        label="Bodies here"
        value={view.bodies}
        sub={view.bodiesSecondary}
        open={ui.door === "bodies"}
        onOpen={() => dispatch({ type: "door/open", door: "bodies" })}
      />
      {/* The number never travels without what it counts. "179 DISTRICTS"
          read as a claim the reader is governed by 179; the door said "in
          view" and the tile said nothing. */}
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
        open={ui.door === "officials"}
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

/**
 * One counter, which is also the door to what it counts.
 *
 * **The highlight means one thing now: this door is OPEN** (6f, 2026-08-15).
 * The author: MEETINGS was coloured while the other three were not, and it
 * did not move when any of them was tapped. It was decoration wearing the
 * clothes of a selection state — the reader learns that a coloured tile means
 * something, tests the theory by tapping, and is taught that the app's
 * signals are noise. His instruction was "make selection state consistent and
 * meaningful, or remove the highlight", and meaningful is strictly better
 * here because these four tiles genuinely have a state worth showing.
 *
 * So the accent moves with the reader: whichever list or door is on screen is
 * the tile that lights, all four behave identically, and nothing is lit when
 * nothing is open.
 */
function Card({
  label,
  value,
  sub = null,
  style,
  open = false,
  onOpen,
}: {
  label: string;
  value: number | string;
  /** A second honest number, kept rather than thrown away. */
  sub?: string | null;
  style?: React.CSSProperties;
  /** This tile's list or door is the one currently on screen. */
  open?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className="stat-card cursor-pointer text-left"
      /* ITEM 1d (2026-08-17): the sidebar counter names itself, so the
         permanent walk check that asserts this number equals the map chip's
         and the panel's does not have to find it by its visible label. */
      data-stat={label.toLowerCase()}
      data-open={open || undefined}
      aria-expanded={open}
      style={style}
      onClick={onOpen}
      aria-label={`Open the ${label.toLowerCase()} list`}
    >
      <div className="num">{value}</div>
      <div className="label">{label}</div>
      {sub && (
        <div className="label" style={{ color: "var(--text-muted)" }}>
          {sub}
        </div>
      )}
    </button>
  );
}
