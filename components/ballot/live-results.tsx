"use client";

import type { CandidateResult, ContestResult, MeasureResult } from "@/lib/ballot/election-results";
import type { ResultSource } from "@/lib/election-results/types";
import type { CardSource } from "@/lib/officials/card-sources";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CandidateResultLine, MeasureResultBody, MeasureSummary, RaceSummary, WhatHappensNow } from "./contest-result";
import { ocdStateCode } from "@/lib/ocd/state-of";
import { resultFor, useResultsFeed, type ResultsFeed } from "./results-feed";

const clockOf = (feed: ResultsFeed, ocdId: string) => feed.status === "settled" && ocdStateCode(ocdId) ? feed.clockZone : null;

type Sourced = { checkedAt?: string; sources?: readonly ResultSource[] };
const sourcesOf = (result: Sourced | undefined): CardSource[] => {
  const [read, ...credited] = result?.sources ?? [];
  return read ? [{ what: "Vote counts and the race call",
    provenance: { sourceUrl: read.url ?? "", sourceOrg: credited.length ? `${read.name}, which credits ${credited.map(source => source.name).join(" and ")}` : read.name,
      collectedAt: result?.checkedAt ?? "", verifiedAt: null } }] : [];
};

interface Identity { id: string; aliases?: readonly string[] }
interface Choice extends Identity { name: string }
interface ContestIdentity extends Identity { title: string; ocdId: string; voteFor: number | null }

/** A race's outcome and count under its title. Nothing shows until the feed settles. */
export function LiveRaceSummary({ contest, choices }: { contest: ContestIdentity; choices: readonly Choice[] }) {
  const feed = useResultsFeed();
  if (feed.status === "loading") return null;
  const result = resultFor<ContestResult>(feed, [contest.id, ...contest.aliases ?? []]);
  const candidates = choices.map(choice => ({ id: choice.id, familyName: choice.name, result: resultFor<CandidateResult>(feed, [choice.id, ...choice.aliases ?? []]) }));
  return <>
    <RaceSummary contest={{ ...contest, result, clockZone: clockOf(feed, contest.ocdId) }} candidates={candidates} names={new Map(choices.map(choice => [choice.id, choice.name]))} />
    <CardSourcesContribution id={`election-result:${contest.id}`} sources={sourcesOf(result)} />
  </>;
}

/** One candidate's votes, percent and bar. */
export function LiveCandidateResult({ candidate, contestId, incumbent }: { candidate: Identity; contestId: string; incumbent: boolean }) {
  const feed = useResultsFeed();
  const result = resultFor<CandidateResult>(feed, [candidate.id, ...candidate.aliases ?? []]);
  const contest = resultFor<ContestResult>(feed, [contestId]);
  if (feed.status === "loading" && !incumbent) return null;
  return <CandidateResultLine candidate={{ result }} incumbent={incumbent} lost={incumbent && contest?.incumbentLost === true && result?.won === false} />;
}

interface MeasureIdentity extends ContestIdentity { measureId?: string; measureAliases?: readonly string[] }

function useMeasure(measure: MeasureIdentity) {
  const feed = useResultsFeed();
  const result = resultFor<ContestResult>(feed, [measure.id, ...measure.aliases ?? []]);
  const held = resultFor<MeasureResult>(feed, [measure.measureId, ...measure.measureAliases ?? []]) ?? (result?.outcome ? result as MeasureResult : undefined);
  return { feed, result, held, contest: { id: measure.id, title: measure.title, ocdId: measure.ocdId, voteFor: 1, result, clockZone: clockOf(feed, measure.ocdId) } };
}

/** Passed or failed, and the yes share, under a measure's title. */
export function LiveMeasureSummary({ measure }: { measure: MeasureIdentity }) {
  const { feed, held, contest, result } = useMeasure(measure);
  if (feed.status === "loading") return null;
  return <>
    <MeasureSummary contest={contest} measure={held ? { result: held } : null} />
    <CardSourcesContribution id={`election-result:${measure.id}`} sources={sourcesOf(held ?? result)} />
  </>;
}

/** Yes and No rows, and what a vote meant, from the measure's one explainer. */
export function LiveMeasureBody({ measure, yes, no }: { measure: MeasureIdentity; yes: string | null; no: string | null }) {
  const { feed, held, contest, result } = useMeasure(measure);
  const closed = held !== undefined && held.outcome !== "counting" || result !== undefined && result.status !== "pending" && result.status !== "counting";
  return <>
    {feed.status === "settled" && <MeasureResultBody contest={contest} measure={held ? { result: held } : null} />}
    {(yes || no) && <WhatHappensNow yes={yes} no={no} outcome={held?.outcome ?? null} closed={closed} />}
  </>;
}
