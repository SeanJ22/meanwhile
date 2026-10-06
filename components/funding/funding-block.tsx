"use client";

import { WorkingOnIt } from "@/components/demand/working-on-it";
import { useEffect, useState } from "react";

import type { CampaignMoneyApiResponse } from "@/lib/funding/campaign-money";
import { fundingFreshnessNote } from "@/lib/funding/freshness";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { ReactionViewContext } from "@/lib/reactions/client";

import {
  FundingAbsence,
  FundingDisplay,
} from "./funding-section";
import { StateMoneySection } from "./state-money-section";

/**
 * The official-modal half of the Funding surface (D34): fetches the funding
 * answer for any officeholder from /api/funding, using the same canonical
 * candidacy projection as the ballot and grounded Ask.
 * A fetch failure renders nothing rather than an error a reader can't act
 * on; the section simply isn't there, the same as before it existed.
 */



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
  const [answer, setAnswer] = useState<CampaignMoneyApiResponse | null>(null);
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
        setAnswer((await response.json()) as CampaignMoneyApiResponse);
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true);
      }
    })();
    return () => controller.abort();
  }, [holder.id]);

  if (loadFailed) return <WorkingOnIt subject={{ type: "CANDIDATE", id: holder.id }} />;
  // A visible loading line (approved design): an empty open section reads as
  // "nothing here", which is a claim, while the records are still on the way.
  if (!answer) return <p className="mw-loading-inline" role="status">Loading campaign money…</p>;
  // The disclosure sentence is computed by the one shared helper so the map
  // popup and the ballot battlecard render byte-identical text for the same
  // holding (the render proof asserts map === ballot funding text).
  const freshness = fundingFreshnessNote(answer);
  let content: React.ReactNode = null;
  if (answer.kind === "combined") content = <>
    {answer.federal.kind === "funding"
      ? <FundingDisplay data={answer.federal.data} context={reactionContext} bare={bare} />
      : <FundingAbsence data={answer.federal.data} />}
    <StateMoneySection records={answer.state.records} bare={bare} context={reactionContext} />
  </>;
  else if (answer.kind === "state") content = <StateMoneySection records={answer.data.records} bare={bare} context={reactionContext} />;
  else if (answer.kind === "identity-unresolved") content = <WorkingOnIt subject={{ type: "CANDIDATE", id: holder.id }} />;
  else if (answer.kind === "none") content = <WorkingOnIt />;
  else if (answer.kind === "absence") content = <FundingAbsence data={answer.data} />;
  else content = <FundingDisplay data={answer.data} context={reactionContext} bare={bare} />;
  if (!freshness && content === null) return <WorkingOnIt />;
  return <>
    {freshness && <p className="funding-data-freshness">{freshness}</p>}
    {content}
  </>;
}
