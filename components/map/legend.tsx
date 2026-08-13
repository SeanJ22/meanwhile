"use client";

import { useMemo } from "react";

import { TIERS, TIER_LABEL } from "@/lib/ocd/tiers";
import { tierForMeeting } from "@/lib/state/derive";
import { useShellData } from "@/lib/state/data";
import { useUi } from "@/lib/state/provider";

import { tierVars } from "../shell/tier-style";

/**
 * The map legend.
 *
 * Ports Edia's `updateLegend`: entries reflect what is *actually rendered*, not
 * a fixed key. A legend listing a colour that is not on the map teaches a
 * reader a mapping they will then misapply.
 */
export function Legend() {
  const { meetings } = useShellData();
  const ui = useUi();

  const present = useMemo(() => {
    const tiers = new Set<string>();
    let concluded = false;

    for (const meeting of meetings) {
      const tier = tierForMeeting(meeting);
      if (tier) tiers.add(tier);
      if (meeting.status === "CONCLUDED") concluded = true;
    }

    return { tiers, concluded };
  }, [meetings]);

  const entries = TIERS.filter((t) => present.tiers.has(t));

  // Nothing rendered means nothing to explain.
  if (entries.length === 0 && !ui.showDistricts) return null;

  return (
    <div className="legend">
      {entries.map((tier) => (
        <span className="legend-item" key={tier}>
          <span className="legend-dot" style={tierVars(tier)} />
          {TIER_LABEL[tier]}
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
