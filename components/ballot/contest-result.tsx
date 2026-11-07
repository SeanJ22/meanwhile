import type { ReactNode } from "react";
import type { Candidacy, Contest, Measure } from "@/lib/ballot/types";
import type { ContestResult } from "@/lib/ballot/election-results";
import { barWidth, flippedParty, formatPercent, joinNames, leadersOf, shortDate, winnersOf } from "@/lib/ballot/results";
import { stateZone } from "@/lib/ballot/vote-phase";
import { ocdStateCode } from "@/lib/ocd/state-of";
import { NoResultsLine } from "./no-results-line";

const FLIP_LEFT = "M10 6H3M5.5 3l-3 3 3 3";
const FLIP_RIGHT = "M2 6h7M6.5 3l3 3-3 3";

function FlipPill({ to, seats }: { to: "D" | "R"; seats: number }) {
  const arrow = <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={to === "D" ? FLIP_LEFT : FLIP_RIGHT} /></svg>;
  const label = seats > 1 ? "1 seat flipped" : "Flipped";
  return <span className="rr-flip" data-flip-to={to}>{to === "D" && arrow}{label}{to === "R" && arrow}</span>;
}

const hasResult = (result: ContestResult | undefined): result is ContestResult => result !== undefined && result.status !== "pending";
const zoneOf = (contest: Contest) => stateZone(ocdStateCode(contest.ocdId) ?? "");

function StatusRow({ contest, about }: { contest: Contest; about: string }) {
  const result = contest.result;
  if (!hasResult(result)) return <div className="rr-status"><NoResultsLine about={about} /></div>;
  const zone = zoneOf(contest);
  const counted = typeof result.percentCounted === "number" ? result.percentCounted : null;
  const when = shortDate(result.statusChangedAt, { zone });
  const counts = counted !== null ? `about ${Math.round(counted)}% of expected votes counted` : null;
  switch (result.status) {
    case "counting":
      return <div className="rr-status">
        {counted !== null && <span className="rr-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, counted))}%` }} /></span>}
        <b>Still counting</b>{counted !== null && <span> about {Math.round(counted)}% counted</span>}
      </div>;
    case "called":
      return <div className="rr-status"><b>Called</b>{(when || counts) && <span> {[when, counts].filter(Boolean).join(" · ")}</span>}</div>;
    case "certified":
      return <div className="rr-status"><b>Certified by the state</b>{shortDate(result.statusChangedAt, { withYear: true, zone }) && <span> {shortDate(result.statusChangedAt, { withYear: true, zone })}</span>}</div>;
    case "runoff":
      return <div className="rr-status"><b>Runoff</b><span> no one passed half the votes, so the top two meet again</span></div>;
    case "unopposed":
      return <div className="rr-status"><b>One candidate ran</b>{when && <span> Called {when}</span>}</div>;
    default:
      return <div className="rr-status"><NoResultsLine about={about} /></div>;
  }
}

/** What sits under a race's title when collapsed: who won or leads, the flip, and where the count stands. */
export function RaceSummary({ contest, candidates, names }: { contest: Contest; candidates: readonly Candidacy[]; names: ReadonlyMap<string, string> }): ReactNode {
  const result = contest.result;
  const about = `results for ${contest.title}`;
  if (!hasResult(result)) return <div className="rr-rows"><StatusRow contest={contest} about={about} /></div>;
  const name = (candidate: Candidacy) => names.get(candidate.id) ?? candidate.familyName;
  const winners = winnersOf(candidates);
  const runoff = candidates.filter(candidate => candidate.result?.runoff === true);
  const seats = result.seatsToFill ?? contest.voteFor ?? 1;
  const gained = flippedParty(result);
  let outcome: ReactNode = null;
  if (result.status === "runoff" && runoff.length) {
    outcome = <><span className="rr-pill rr-pill--outline">Runoff</span><span className="rr-lead">{joinNames(runoff.map(name))}</span></>;
  } else if (winners.length) {
    const percent = winners.length === 1 ? winners[0].result?.percent : undefined;
    outcome = <><span className="rr-pill">Won</span><span className="rr-lead">{joinNames(winners.map(name))}{typeof percent === "number" ? ` ${formatPercent(percent)}` : ""}</span></>;
  } else {
    const leaders = leadersOf(candidates, seats);
    if (leaders.length) outcome = <span className="rr-lead">Leading so far: {joinNames(leaders.map(name))}</span>;
  }
  return <div className="rr-rows">
    {(outcome || gained) && <div className="rr-outcome">
      {outcome}
      {gained && <FlipPill to={gained} seats={seats} />}
    </div>}
    <StatusRow contest={contest} about={about} />
  </div>;
}

/** The result under one candidate's name: Won pill, percent, votes, bar, and the lost-incumbent chip. */
export function CandidateResultLine({ candidate, incumbent, lost }: { candidate: Candidacy; incumbent: boolean; lost: boolean }): ReactNode {
  const result = candidate.result;
  const outcome = result?.won ? "won" : result?.runoff ? "runoff" : null;
  const shows = result && (typeof result.votes === "number" || typeof result.percent === "number");
  return <>
    {incumbent && <span className="rr-chips"><span className="rr-chip">{lost ? "Incumbent · lost" : "Incumbent"}</span></span>}
    {result && shows && <div className="rr-candidate" data-outcome={outcome ?? undefined}>
      <div className="rr-candidate-line">
        {outcome === "won" && <span className="rr-pill">Won</span>}
        {outcome === "runoff" && <span className="rr-pill rr-pill--outline">Runoff</span>}
        {typeof result.percent === "number" && <span className="rr-percent">{formatPercent(result.percent)}</span>}
        {typeof result.votes === "number" && <span className="rr-votes">{result.votes.toLocaleString("en-US")} votes</span>}
      </div>
      {typeof result.percent === "number" && <div className="rr-bar" aria-hidden="true"><span data-strong={outcome ? "true" : undefined} style={{ width: barWidth(result.percent) }} /></div>}
    </div>}
  </>;
}

/** Yes and No rows with their votes and bars. */
export function MeasureResultBody({ measure, contest }: { measure: Measure | null; contest: Contest }): ReactNode {
  const result = measure?.result;
  if (!result || (result.yesVotes == null && result.noVotes == null && result.yesPercent == null)) return null;
  const yes = result.yesPercent ?? null, no = yes === null ? null : 100 - yes;
  const row = (label: string, percent: number | null, votes: number | null | undefined, strong: boolean) => <div className="rr-yesno" data-label={label}>
    <span className="rr-yesno-label">{label}</span>
    <div className="rr-yesno-main">
      <div className="rr-candidate-line">
        {percent !== null && <span className="rr-percent">{percent.toFixed(2)}%</span>}
        {typeof votes === "number" && <span className="rr-votes">{votes.toLocaleString("en-US")} votes</span>}
      </div>
      {percent !== null && <div className="rr-bar rr-bar--tall" aria-hidden="true"><span data-strong={strong ? "true" : undefined} style={{ width: barWidth(percent) }} /></div>}
    </div>
  </div>;
  return <div className="rr-measure" data-measure-result={contest.id}>
    {row("Yes", yes, result.yesVotes, result.outcome === "passed")}
    {row("No", no, result.noVotes, result.outcome === "failed")}
  </div>;
}

/** The pill and percent shown under a measure's title when collapsed. */
export function MeasureSummary({ contest, measure }: { contest: Contest; measure: Measure | null }): ReactNode {
  const result = measure?.result;
  const about = `results for ${contest.title}`;
  if (!result || (!hasResult(contest.result) && result.outcome === "counting")) return <div className="rr-rows"><StatusRow contest={contest} about={about} /></div>;
  return <div className="rr-rows">
    <div className="rr-outcome">
      {result.outcome !== "counting" && <span className="rr-pill">{result.outcome === "passed" ? "Passed" : "Failed"}</span>}
      {typeof result.yesPercent === "number" && <span className="rr-lead">{result.yesPercent.toFixed(2)}% yes</span>}
    </div>
    <StatusRow contest={contest} about={about} />
  </div>;
}

/** The measure's one explainer, as "What happens now": what each vote meant, the winning side marked. */
export function WhatHappensNow({ yes, no, outcome, closed }: { yes: string | null; no: string | null; outcome: "passed" | "failed" | "counting" | null; closed: boolean }): ReactNode {
  const column = (label: string, text: string | null, won: boolean) => text && <div data-won={won ? "true" : undefined}>
    <b>{label}{won && " · won"}</b><p>{text}</p>
  </div>;
  return <section className="rr-now" data-what-happens-now="">
    <h3>{closed ? "What happens now" : "What a vote means"}</h3>
    <div className="rr-now-cols">
      {column(closed ? "A yes vote meant" : "A yes vote means", yes, outcome === "passed")}
      {column(closed ? "A no vote meant" : "A no vote means", no, outcome === "failed")}
    </div>
  </section>;
}
