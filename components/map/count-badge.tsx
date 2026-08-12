"use client";

import { useShellData } from "@/lib/state/data";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierSetVars } from "../shell/tier-style";

/**
 * The floating count, which opens the list overlay.
 *
 * Ports Edia's `.count-badge`, including the `.active` state while the overlay
 * it opens is showing, and the tier-coloured numeral.
 */
export function CountBadge() {
  const { meetings, venues } = useShellData();
  const ui = useUi();
  const dispatch = useUiDispatch();

  return (
    <button
      type="button"
      className="count-badge"
      data-active={ui.listOverlayOpen}
      aria-expanded={ui.listOverlayOpen}
      onClick={() => dispatch({ type: "list/toggle" })}
      style={tierSetVars(ui.tiers)}
    >
      <span className="cb-num">{meetings.length}</span>{" "}
      {meetings.length === 1 ? "meeting" : "meetings"}
      {venues.length > 0 && (
        <>
          {" · "}
          <span className="cb-num">{venues.length}</span>{" "}
          {venues.length === 1 ? "venue" : "venues"}
        </>
      )}
    </button>
  );
}
