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
 * The map legend. Every category always renders; one with nothing on the map
 * is muted, never removed. Entries key on government level, matching the dot
 * colours.
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
  const { meetings, officePins = 0 } = useShellData();
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
      )).flatMap((item, i) => (LEVEL_ORDER[i] === "local" ? [item, (
        /* Neutral on purpose: the tier swatches already teach the ring colours. */
        <span className="legend-item" key="office" data-muted={officePins === 0}
          title={officePins === 0 ? "Nothing of this kind on the map right now" : undefined}>
          <span className="legend-office" />
          Office
        </span>
      )] : [item]))}

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
