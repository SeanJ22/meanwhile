"use client";

import { useShellData, useMeetingListingIdentity } from "@/lib/state/data";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierSetVars } from "../shell/tier-style";

/**
 * The floating count, which opens the list overlay.
 *
 * Ports Edia's `.count-badge`, including the `.active` state while the overlay
 * it opens is showing, and the tier-coloured numeral.
 */
export function CountBadge() {
  const { meetings, venues, searchFailed } = useShellData();
  const listingCount = readerMeetingCount(meetings, useMeetingListingIdentity());
  const ui = useUi();
  const dispatch = useUiDispatch();

  // "0 meetings" beside a failed fetch is a false claim — the badge says
  // couldn't-check instead (2a: a failed operation may not render as an
  // empty success).
  if (searchFailed) {
    return (
      <button
        type="button"
        className="count-badge"
        data-active={ui.listOverlayOpen}
        aria-expanded={ui.listOverlayOpen}
        onClick={() => dispatch({ type: "list/toggle" })}
        style={tierSetVars(ui.tiers)}
      >
        meetings — couldn&apos;t check
      </button>
    );
  }

  return (
    <button
      type="button"
      className="count-badge"
      data-active={ui.listOverlayOpen}
      aria-expanded={ui.listOverlayOpen}
      onClick={() => dispatch({ type: "list/toggle" })}
      style={{ ...tierSetVars(ui.tiers), ...(listingCount.unresolved ? { flexWrap: "wrap", whiteSpace: "normal", maxWidth: "100%" } : {}) }}
    >
      <span className="cb-num">{meetings.length}</span>{" "}
      {listingCount.unit}
      {venues.length > 0 && (
        <>
          {" · "}
          <span className="cb-num">{venues.length}</span>{" "}
          {venues.length === 1 ? "venue" : "venues"}
        </>
      )}
      {listingCount.countNote && <span className="basis-full text-left t-caption font-normal">{listingCount.countNote}</span>}
    </button>
  );
}
