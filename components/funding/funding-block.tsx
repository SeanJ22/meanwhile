"use client";

import { useEffect, useState } from "react";

import type { CampaignMoneyApiAnswer } from "@/lib/funding/campaign-money";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";

import {
  FundingAbsence,
  FundingDisplay,
  StateFundingNote,
} from "./funding-section";
import { StateMoneySection } from "./state-money-section";

/**
 * The official-modal half of the Funding surface (D34): fetches the funding
 * answer for any officeholder from /api/funding, using the same canonical
 * candidacy projection as the ballot and grounded Ask.
 * A fetch failure renders nothing rather than an error a reader can't act
 * on; the section simply isn't there, the same as before it existed.
 */

const STATE_OFFICIAL_NOTE =
  "Campaign money for state offices is filed with state campaign-finance systems, not the FEC. This is not a statement that no money was raised.";

export function FundingBlock(props: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
  /** Inside a CardSection that already names the block (6b4). */
  bare?: boolean;
}) {
  // Keyed on the holder so a holder change discards the fetched state
  // structurally — a new holder never wears the previous one's answer,
  // not even for the frames before (or if) the new fetch lands (D40).
  return <FundingBlockInner key={props.holder.id} {...props} />;
}

function FundingBlockInner({
  holder,
  reactionContext,
  bare = false,
}: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
  bare?: boolean;
}) {
  const isFederal = holder.id.startsWith("congress:");
  const [answer, setAnswer] = useState<CampaignMoneyApiAnswer | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        // The target rides in the PATH, never a query string — a publicly
        // cacheable response must carry its cache key where every shared
        // cache honours it (D40).
        const response = await fetch(
          `/api/funding/${encodeURIComponent(holder.id)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        setAnswer((await response.json()) as CampaignMoneyApiAnswer);
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true);
      }
    })();
    return () => controller.abort();
  }, [holder.id]);

  if (loadFailed) return <StateFundingNote note="We couldn’t load our campaign-finance records just now." />;
  if (!answer) return null;
  if (answer.kind === "combined") return <>
    {answer.federal.kind === "funding"
      ? <FundingDisplay data={answer.federal.data} context={reactionContext} bare={bare} />
      : <FundingAbsence data={answer.federal.data} />}
    <StateMoneySection records={answer.state.records} bare={bare} />
  </>;
  if (answer.kind === "state") return <StateMoneySection records={answer.data.records} bare={bare} />;
  if (answer.kind === "identity-unresolved") return <StateFundingNote note={answer.statement} />;
  if (answer.kind === "none") return isFederal ? null : <StateFundingNote note={STATE_OFFICIAL_NOTE} />;
  if (answer.kind === "absence") return <FundingAbsence data={answer.data} />;
  return (
    <FundingDisplay data={answer.data} context={reactionContext} bare={bare} />
  );
}
