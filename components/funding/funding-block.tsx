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
import { StateCampaignSection } from "./state-campaign-section";
import { officeIdentity } from "@/lib/officials/office-identity";

export function FundingBlock(props: {
  holder: SeatHolder;
  reactionContext: ReactionViewContext | null;
  /** Inside a CardSection that already names the block. */
  bare?: boolean;
}) {
  const office=officeIdentity(props.holder.officeTitle),division=props.holder.officeJurisdictionOcdId;
  if(division && office!=="us_senator" && office!=="us_representative" && office!=="president")return <StateCampaignSection divisionId={division} personId={props.holder.personId??props.holder.id} bare={props.bare} context={props.reactionContext}/>;
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
  const query = new URLSearchParams([
    ...(holder.officeJurisdictionOcdId ? [["division", holder.officeJurisdictionOcdId]] : []),
    ...(reactionContext?.zip ? [["zip", reactionContext.zip]] : []),
    ...(reactionContext ? [["lat", String(reactionContext.lat)], ["lng", String(reactionContext.lng)]] : []),
  ]).toString();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        // The target rides in the path, never a query string, so shared caches key on it.
        const response = await fetch(
          `/api/funding/${encodeURIComponent(holder.id)}?${query}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        setAnswer((await response.json()) as CampaignMoneyApiResponse);
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true);
      }
    })();
    return () => controller.abort();
  }, [holder.id, query]);

  if (loadFailed) return <CardGapContribution id={`funding:${holder.id}`} label="campaign money" subject={{ type: "CANDIDATE", id: holder.id }} />;
  if (!answer) return <p className="mw-loading-inline" role="status">Loading campaign money…</p>;
  let content: React.ReactNode = null;
  if(answer.kind==="state-cycle")content=<StateCampaignSection divisionId={answer.data.division} personId={holder.personId??holder.id} data={answer.data} bare={bare} context={reactionContext}/>;
  else if (answer.kind === "identity-unresolved") content = <CardGapContribution id={`funding:${holder.id}`} label="campaign money" subject={{ type: "CANDIDATE", id: holder.id }} />;
  else if (answer.kind === "none") content = <CardGapContribution id={`funding:${holder.id}`} label="campaign money" subject={{ type: "CANDIDATE", id: holder.id }} />;
  else if (answer.kind === "absence") content = <FundingAbsence data={answer.data} />;
  else content = <FundingDisplay data={answer.data} context={reactionContext} bare={bare} />;
  return <>
    {answer.holdingStatus === "PARTIAL" && <CardGapContribution id={`funding-holdings:${holder.id}`} label="campaign money records" subject={{ type: "CANDIDATE", id: holder.id }} />}
    {content}
  </>;
}
