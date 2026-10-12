"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ReaderCard } from "./reader-card";

/**
 * The large card for a whole route (the Ballot, intercepted over the map at
 * `app/@modal/(.)ballot`). Closing is a browser Back; the map never left.
 */
export function RouteCard({ kicker, zip, children }: { kicker: string; zip?: string; children: ReactNode }) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);
  const openVote = useCallback(() => {
    // "Where can I vote?" closes the card and asks the map (components/map/map-entry.tsx) for its popup.
    router.back();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("mw:open-pop", { detail: "vote" }));
    }, 0);
  }, [router]);

  return (
    <RouteCardContext.Provider value={{ openVote }}>
      <ReaderCard
        viewKey={`route:${kicker}`}
        kicker={kicker}
        zip={zip}
        backLabel={null}
        onBack={close}
        onClose={close}
        fixed
      >
        <div className="mw-route-body">{children}</div>
      </ReaderCard>
    </RouteCardContext.Provider>
  );
}

const RouteCardContext = createContext<{ openVote: () => void } | null>(null);

/** Inside a route card: how "Where can I vote?" hands off to the map. */
export function useRouteCard(): { openVote: () => void } | null {
  return useContext(RouteCardContext);
}
