"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ReaderCard } from "./reader-card";

/**
 * The reader's large card for a whole ROUTE — today the Ballot, intercepted
 * over the map (`app/@modal/(.)ballot`). Same frame as every other card:
 * scrim, ✕ Close, Escape, focus trap, inert background. Closing is a browser
 * Back, because opening it was a navigation; the map underneath never left.
 */
export function RouteCard({ kicker, children }: { kicker: string; children: ReactNode }) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);
  const openVote = useCallback(() => {
    // The design: "Where can I vote?" inside the Ballot closes the card and
    // opens the small popup on the map. The map is mounted under this card
    // and listens for the request (components/map/map-entry.tsx).
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
