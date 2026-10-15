"use client";

import { CardGapContribution } from "@/components/ui/card-gap-context";
import { useEffect, useState } from "react";

import type { CampaignMoneyApiResponse } from "@/lib/funding/campaign-money";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";

import {
  FundingAbsence,
  FundingDisplay,
} from "./funding-section";
import { StateMoneySection } from "./state-money-section";

/**
 * Fetches the funding answer for any officeholder from /api/funding. A fetch
 * failure renders nothing.
 */



export function FundingBlock(props: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
  /** Inside a CardSection that already names the block. */
  bare?: boolean;
}) {
  // Keyed on the holder so a new holder never shows the previous one's answer.
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
  const [answer, setAnswer] = useState<CampaignMoneyApiResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        // The target rides in the path, never a query string, so shared caches key on it.
        const response = await fetch(
          `/api/funding/${encodeURIComponent(holder.id)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        setAnswer((await response.json()) as CampaignMoneyApiResponse);
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true);
      }
    })();
    return () => controller.abort();
  }, [holder.id]);

  if (loadFailed) return <CardGapContribution id={`funding:${holder.id}`} label="campaign money" subject={{ type: "CANDIDATE", id: holder.id }} />;
  if (!answer) return <p className="mw-loading-inline" role="status">Loading campaign money…</p>;
  let content: React.ReactNode = null;
  if (answer.kind === "combined") content = <>
    {answer.federal.kind === "funding"
      ? <FundingDisplay data={answer.federal.data} context={reactionContext} bare={bare} />
      : <FundingAbsence data={answer.federal.data} />}
    <StateMoneySection records={answer.state.records} bare={bare} context={reactionContext} />
  </>;
  else if (answer.kind === "state") content = <StateMoneySection records={answer.data.records} bare={bare} context={reactionContext} />;
  else if (answer.kind === "identity-unresolved") content = <CardGapContribution id={`funding:${holder.id}`} label="campaign money" subject={{ type: "CANDIDATE", id: holder.id }} />;
  else if (answer.kind === "none") content = <CardGapContribution id={`funding:${holder.id}`} label="campaign money" subject={{ type: "CANDIDATE", id: holder.id }} />;
  else if (answer.kind === "absence") content = <FundingAbsence data={answer.data} />;
  else content = <FundingDisplay data={answer.data} context={reactionContext} bare={bare} />;
  return <>
    {answer.holdingStatus === "PARTIAL" && <CardGapContribution id={`funding-holdings:${holder.id}`} label="campaign money records" subject={{ type: "CANDIDATE", id: holder.id }} />}
    {content}
  </>;
}
