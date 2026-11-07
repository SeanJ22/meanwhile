"use client";

import { useRouter } from "next/navigation";
import { openResults } from "@/lib/map/results-scope";
import { useRouteCard } from "@/components/shell/route-card";

/** "See the map →": opens the results map on the reader's own state. Nothing of the map's results loads before this tap. */
export function SeeTheMap({ abbr, name }: { abbr: string; name: string }) {
  const router = useRouter();
  const route = useRouteCard();
  return (
    <button
      type="button"
      data-see-the-map=""
      onClick={() => {
        openResults({ abbr, name });
        // Over the map the ballot is a card: closing it is a browser Back. On its own page, go to the map.
        if (route) router.back(); else router.push("/");
      }}
      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-action px-3.5 text-[0.8125rem] font-semibold text-action-on"
    >
      See the map
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h7M6.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}
