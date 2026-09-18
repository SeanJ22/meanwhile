"use client";

/**
 * Blind spots tab (BUILD.md §G): the page documents its own gaps. A doc goes
 * stale silently; a tab next to the numbers it describes goes stale visibly,
 * and whoever fixes an item deletes its card in the same commit. The badge
 * count is derived from the array length so it cannot drift. Copy reports both
 * success and failure in a visible line — never a silent failure, never a fake
 * success.
 */

import { useState } from "react";

import { FLEET_BLIND_SPOTS, FLEET_BLIND_SPOT_ORDER, type BlindSpot } from "@/lib/admin/fleet-blind-spots";

function Card({ spot }: { readonly spot: BlindSpot }) {
  const [result, setResult] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(spot.brief);
      setResult("Copied — paste it into Claude Code or Codex.");
    } catch {
      setResult("Could not reach the clipboard. Select the text instead.");
    }
  };
  return (
    <div className={`ft-blindspot ft-blindspot-${spot.severity}`}>
      <div className="ft-blindspot-head">
        <span className="ft-blindspot-title"><span className="ft-mono">{spot.n}</span> · {spot.title}</span>
        <button type="button" className="ft-copy" onClick={() => void copy()}>Copy brief</button>
      </div>
      {result && <p className="ft-copy-result note" aria-live="polite">{result}</p>}
      <p className="note ft-blindspot-summary">{spot.summary}</p>
      <p className="ft-blindspot-paths">{spot.paths.join(" · ")}</p>
    </div>
  );
}

export function FleetBlindSpotsTab() {
  return (
    <section className="fleet-tab" aria-label="Blind spots">
      <div className="fleet-tab-head">
        <div>
          <h2>{FLEET_BLIND_SPOTS.length} things this page cannot see or do</h2>
          <p className="note">
            Each was found by reading the repository, not inferred from the screen. Copy a brief into
            Claude Code as it stands; verify the paths against HEAD first.
          </p>
        </div>
      </div>
      <div className="ft-blindspots">
        {FLEET_BLIND_SPOTS.map((s) => <Card key={s.n} spot={s} />)}
      </div>
      <p className="note ft-blindspot-order">{FLEET_BLIND_SPOT_ORDER}</p>
    </section>
  );
}
