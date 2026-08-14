"use client";

import { useEffect, useState } from "react";

import type { FundingAnswer } from "@/lib/funding/display";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";

import {
  FundingAbsence,
  FundingDisplay,
  StateFundingNote,
} from "./funding-section";

/**
 * The official-modal half of the Funding surface (D34): fetches the funding
 * answer for a federal officeholder from /api/funding (which reads the
 * committed snapshot — never the FEC live) and renders the shared section.
 *
 * State and local officials get the honest state-systems note without a
 * fetch — the FEC does not cover their races, and saying so beats silence.
 * A fetch failure renders nothing rather than an error a reader can't act
 * on; the section simply isn't there, the same as before it existed.
 */

const STATE_OFFICIAL_NOTE =
  "Campaign money for state offices is filed with state campaign-finance systems, not the FEC. We haven't wired those yet — this is a gap in our data, not a statement that no money was raised.";

export function FundingBlock({
  holder,
  reactionContext,
}: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
}) {
  const isFederal = holder.id.startsWith("congress:");
  const [answer, setAnswer] = useState<FundingAnswer | null>(null);

  useEffect(() => {
    if (!isFederal) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/funding?target=${encodeURIComponent(holder.id)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        setAnswer((await response.json()) as FundingAnswer);
      } catch {
        // Nothing renders — never an error card in a reader surface.
      }
    })();
    return () => controller.abort();
  }, [holder.id, isFederal]);

  if (!isFederal) return <StateFundingNote note={STATE_OFFICIAL_NOTE} />;
  if (!answer || answer.kind === "none") return null;
  if (answer.kind === "absence") return <FundingAbsence data={answer.data} />;
  return <FundingDisplay data={answer.data} context={reactionContext} />;
}
