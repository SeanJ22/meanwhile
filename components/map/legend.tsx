"use client";

import { useMemo } from "react";

import {
  LEVEL_LABEL,
  LEVEL_ORDER,
  levelForMeeting,
  type GovernmentLevel,
} from "@/lib/state/derive";
import { useShellData } from "@/lib/state/data";
import { useUi } from "@/lib/state/provider";

/**
 * The map legend — fixed (6e).
 *
 * Every category renders always; a category with nothing currently on the
 * map is visually muted, never removed. A legend that mutates with the
 * view is not a legend — the reader can't learn a mapping from a key that
 * keeps changing. (This reverses the earlier present-only port of Edia's
 * `updateLegend`, deliberately.)
 *
 * Entries key on government *level* (2g) — school, local, state, federal —
 * matching the dot colors, so a school-board meeting and a congressional
 * town hall at the same address read apart without a click.
 */

const LEVEL_ACCENT: Record<GovernmentLevel, React.CSSProperties> = {
  school: {
    "--tier-accent": "var(--accent-school)",
    "--tier-glow": "var(--accent-school-glow)",
  } as React.CSSProperties,
  local: {
    "--tier-accent": "var(--accent-local)",
    "--tier-glow": "var(--accent-local-glow)",
  } as React.CSSProperties,
  state: {
    "--tier-accent": "var(--accent-state)",
    "--tier-glow": "var(--accent-state-glow)",
  } as React.CSSProperties,
  federal: {
    "--tier-accent": "var(--accent-national)",
    "--tier-glow": "var(--accent-national-glow)",
  } as React.CSSProperties,
};

/** The tier toggle each legend level follows. Schools follow Local. */
const LEVEL_TIER: Record<GovernmentLevel, "local" | "state" | "national"> = {
  school: "local",
  local: "local",
  state: "state",
  federal: "national",
};

/**
 * `inline` renders the same key inside the phone sheet (the design moves the
 * floating legend into the sidebar below 640px). A level whose tier toggle is
 * off is struck through with a faded dot, so the key and the map agree.
 */
export function Legend({ inline = false }: { inline?: boolean } = {}) {
  const { meetings } = useShellData();
  const ui = useUi();

  const present = useMemo(() => {
    const levels = new Set<GovernmentLevel>();
    let concluded = false;

    for (const meeting of meetings) {
      const level = levelForMeeting(meeting);
      if (level) levels.add(level);
      if (meeting.status === "CONCLUDED") concluded = true;
    }

    return { levels, concluded };
  }, [meetings]);

  return (
    <div className={inline ? "legend legend-inline" : "legend"}>
      {LEVEL_ORDER.map((level) => (
        <span
          className="legend-item"
          key={level}
          data-muted={!present.levels.has(level)}
          data-off={!ui.tiers.includes(LEVEL_TIER[level]) || undefined}
          title={
            present.levels.has(level)
              ? undefined
              : "Nothing of this kind on the map right now"
          }
        >
          <span className="legend-dot" style={LEVEL_ACCENT[level]} />
          {LEVEL_LABEL[level]}
        </span>
      ))}

      <span className="legend-item" data-muted={!present.concluded}>
        <span
          className="legend-dot"
          data-hollow="true"
          style={{ "--tier-accent": "var(--concluded)" } as React.CSSProperties}
        />
        Concluded
      </span>

      <span className="legend-item" data-muted={!ui.showDistricts}>
        <span className="legend-rule" />
        District boundary
      </span>
    </div>
  );
}
