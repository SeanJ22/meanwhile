"use client";

import { Card } from "@/components/ui/card";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import type { CardSource } from "@/lib/officials/card-sources";
import type { BallotElectionSummary, CandidateResult, ContestResult, MeasureResult } from "@/lib/ballot/election-results";
import type { ResultSource } from "@/lib/election-results/types";
import type { ResultViewProps } from "./deferred-results";
import { CandidateResultLine, MeasureResultBody, MeasureSummary, RaceSummary } from "./contest-result";
import { deferredResultStyles } from "./deferred-result-styles";

type SourcedResult = { checkedAt?: string; sources?: readonly ResultSource[]; source?: ResultSource; creditedSources?: readonly ResultSource[] };
function sourcesFor(result: SourcedResult | undefined): CardSource[] {
  if (!result) return [];
  const sources = [...result.sources ?? [], ...result.source ? [result.source] : [], ...result.creditedSources ?? []];
  return [...new Map(sources.map(source => [JSON.stringify(source), source])).values()].map((source, index) => ({
    what: index === 0 ? "Election result" : `Election result: source credited by ${sources[0]?.name ?? "the publisher"}`,
    provenance: { sourceOrg: source.name, sourceUrl: source.url ?? "", collectedAt: result.checkedAt ?? "", verifiedAt: result.checkedAt ?? null },
    dataAttrs: { "data-result-source": source.name, "data-result-checked-at": result.checkedAt },
  }));
}

function Summary({ title, values }: { title: string; values: readonly BallotElectionSummary[] }) {
  if (!values.length) return null;
  const chambers = [...new Map(values.flatMap(summary => summary.chambers.map(chamber => [chamber.name, chamber] as const))).values()];
  return <Card title={title} sources={values.flatMap(sourcesFor)} attrs={{ "data-election-summary": title }} className="mt-6">
    {chambers.map(chamber => <section key={chamber.name} className="er-chamber">
      <h3 className="t-heading font-semibold">{chamber.name}</h3>
      <table className="er-seats t-detail"><caption className="sr-only">{chamber.name}: seats by party before and now</caption>
        <thead><tr><th scope="col">Party</th><th scope="col">Before</th><th scope="col">Now</th></tr></thead>
        <tbody>{[...new Set([...Object.keys(chamber.seatsBefore), ...Object.keys(chamber.seatsNow)])].sort().map(party =>
          <tr key={party}><th scope="row">{party}</th><td>{chamber.seatsBefore[party] ?? "—"}</td><td>{chamber.seatsNow[party] ?? "—"}</td></tr>)}
          <tr><th scope="row">Still counting</th><td>—</td><td>{chamber.stillCounting}</td></tr></tbody>
      </table>
      <p className="t-detail text-paper-dim">Control: {chamber.controlBefore ?? "not yet reported"} before; {chamber.controlNow ?? "still counting"} now.</p>
    </section>)}
    {values.filter(summary => summary.governor?.before || summary.governor?.now).map((summary, index) => <p key={`governor:${index}`} className="mt-3 t-body">
      Governor: {summary.governor.before ?? "not yet reported"} before; {summary.governor.now ?? "still counting"} now.
    </p>)}
    {values.flatMap(summary => summary.statewideOfficesFlipped ?? []).map((office, index) => <p key={`${office.office}:${index}`} className="mt-2 t-detail">
      {office.office} flipped: {office.from} to {office.to}.
    </p>)}
  </Card>;
}

/** Presentation only: the feed already matched and published every identity through the Slide. */
export function ResultView(props: ResultViewProps) {
  const { facts } = props.feed;
  const resultFor = <T,>(ids: readonly (string | undefined)[]): T | undefined => ids.flatMap(id => id && facts[id] !== undefined ? [facts[id]] : [])[0] as T | undefined;
  if (props.kind === "summary") {
    const area = props.feed.state === "DC" ? "district" : ["AS", "GU", "MP", "PR", "VI"].includes(props.feed.state) ? "territory" : "state";
    const state = resultFor<BallotElectionSummary>([`ocd-division/country:us/${area}:${props.feed.state.toLowerCase()}`]);
    const nation = ["ocd-division/country:us", "ocd-division/country:us#election_summary:us_senate", "ocd-division/country:us#election_summary:us_house"]
      .flatMap(id => facts[id] ? [facts[id] as BallotElectionSummary] : []);
    return <><style data-election-result-styles>{deferredResultStyles}</style><Summary title="State election results" values={state ? [state] : []} /><Summary title="U.S. Congress election results" values={nation} /></>;
  }
  const result = resultFor<ContestResult>([props.id, ...props.aliases ?? []]);
  if (props.kind === "candidate") {
    const candidate = resultFor<CandidateResult>([props.id, ...props.aliases ?? []]);
    if (!candidate) return null;
    const contest = resultFor<ContestResult>([props.contestId]);
    return <div data-election-result="candidate" data-result-id={props.id} data-result-checked-at={candidate.checkedAt}>
      <CandidateResultLine candidate={{ result: candidate }} incumbent={props.incumbent} lost={props.incumbent && contest?.incumbentLost === true && candidate.won === false} />
      <CardSourcesContribution id={`election-result:${props.id}`} sources={sourcesFor(candidate)} />
    </div>;
  }
  const contest = { id: props.id, title: props.title, ocdId: props.ocdId, voteFor: props.kind === "contest" ? props.voteFor : 1, result };
  if (props.kind === "measure") {
    const measure = resultFor<MeasureResult>([props.measureId, ...props.measureAliases ?? []]) ?? (result?.outcome ? result as MeasureResult : undefined);
    return <section className="er-result" data-election-result="measure" data-result-id={props.id} data-result-checked-at={measure?.checkedAt ?? result?.checkedAt}>
      <MeasureSummary contest={contest} measure={measure ? { result: measure } : null} />
      <MeasureResultBody contest={contest} measure={measure ? { result: measure } : null} />
      <CardSourcesContribution id={`election-result:${props.id}`} sources={[...sourcesFor(result), ...sourcesFor(measure)]} />
    </section>;
  }
  const candidates = props.choices.map(choice => ({ id: choice.id, familyName: choice.name, result: resultFor<CandidateResult>([choice.id, ...choice.aliases ?? []]) }));
  return <section className="er-result" data-election-result="contest" data-result-id={props.id} data-result-checked-at={result?.checkedAt}>
    <RaceSummary contest={contest} candidates={candidates} names={new Map(props.choices.map(choice => [choice.id, choice.name]))} />
    <CardSourcesContribution id={`election-result:${props.id}`} sources={sourcesFor(result)} />
  </section>;
}
