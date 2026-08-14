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
 * The map legend.
 *
 * Ports Edia's `updateLegend`: entries reflect what is *actually rendered*, not
 * a fixed key. A legend listing a colour that is not on the map teaches a
 * reader a mapping they will then misapply.
 *
 * Entries key on government *level* (2g) — school, local, state, federal —
 * matching the dot colors, so a school-board meeting and a congressional town
 * hall at the same address read apart without a click.
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

export function Legend() {
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

  const entries = LEVEL_ORDER.filter((level) => present.levels.has(level));

  // Nothing rendered means nothing to explain.
  if (entries.length === 0 && !ui.showDistricts) return null;

  return (
    <div className="legend">
      {entries.map((level) => (
        <span className="legend-item" key={level}>
          <span className="legend-dot" style={LEVEL_ACCENT[level]} />
          {LEVEL_LABEL[level]}
        </span>
      ))}

      {present.concluded && (
        <span className="legend-item">
          <span
            className="legend-dot"
            data-hollow="true"
            style={{ "--tier-accent": "var(--concluded)" } as React.CSSProperties}
          />
          Concluded
        </span>
      )}

      {ui.showDistricts && (
        <span className="legend-item">
          <span className="legend-rule" />
          District boundary
        </span>
      )}
    </div>
  );
}
