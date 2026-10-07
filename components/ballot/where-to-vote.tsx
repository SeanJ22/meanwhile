"use client";

import { useCallback, useState } from "react";

import { VotingSitesPanel } from "@/components/map/voting-sites-panel";
import { useRouteCard } from "@/components/shell/route-card";

/**
 * The same `VotingSitesPanel` the map pill uses. Inside a route card the
 * button opens the map's popup instead of expanding here.
 */
export function WhereToVote() {
  const [open, setOpen] = useState(false);
  // No map here; the shared panel still takes the callback.
  const onSites = useCallback(() => {}, []);
  const routeCard = useRouteCard();

  return (
    <div data-where-to-vote>
      {open ? (
        <VotingSitesPanel
          onSites={onSites}
          selectedSiteId={null}
          onSelectSite={() => {}}
          onClose={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          className="voting-open-button"
          data-where-to-vote-pill
          onClick={() => (routeCard ? routeCard.openVote() : setOpen(true))}
        >
          Where can I vote?
        </button>
      )}
    </div>
  );
}
