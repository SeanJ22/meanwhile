"use client";

import { useEffect, useState } from "react";
import { ScorecardView } from "@/components/ballot/scorecard";
import { scorecardsFromFacts } from "@/lib/ballot/scorecard-view";
import { setResultsScope, showResultsState, useResultsScope } from "@/lib/map/results-scope";

type Facts = Readonly<Record<string, unknown>>;
const loads = new Map<string, Promise<Facts>>();

/** A state's published summaries (its chambers, governor, statewide offices, and the national ones), without any contest's result. */
function summariesFor(abbr: string): Promise<Facts> {
  let load = loads.get(abbr);
  if (!load) {
    load = fetch(`/api/election-results?${new URLSearchParams({ state: abbr, contests: "" })}`).then(async response => {
      const body = response.ok ? await response.json() as { state?: unknown; facts?: unknown } : null;
      return body && body.state === abbr && body.facts && typeof body.facts === "object" ? body.facts as Facts : {};
    }).catch(() => ({}));
    loads.set(abbr, load);
  }
  return load;
}

function useSummaries(abbr: string | null): Facts | undefined {
  const [held, setHeld] = useState<{ abbr: string; facts: Facts } | null>(null);
  useEffect(() => {
    if (!abbr) return;
    let live = true;
    void summariesFor(abbr).then(facts => { if (live) setHeld({ abbr, facts }); });
    return () => { live = false; };
  }, [abbr]);
  return held && held.abbr === abbr ? held.facts : undefined;
}

/** The ballot's party scorecard on the results map. Its tabs are the map's own: the reader's state, the last other state visited, and the country. */
export function MapScorecard() {
  const { scope, state, home, visited } = useResultsScope();
  const homeFacts = useSummaries(home.abbr), visitedFacts = useSummaries(visited?.abbr ?? null);
  const homeCards = homeFacts && scorecardsFromFacts(homeFacts, home.abbr, home.name);
  const visitedCard = visited && visitedFacts ? scorecardsFromFacts(visitedFacts, visited.abbr, visited.name)?.[visited.abbr] : undefined;
  const code = scope === "nation" ? "US" : state.abbr;
  const tabs = [home, ...visited ? [visited] : []].map(area => ({ code: area.abbr, label: area.name })).concat({ code: "US", label: "United States" });
  const card = code === "US" ? homeCards?.US : code === home.abbr ? homeCards?.[home.abbr] : visitedCard;
  return <ScorecardView tabs={tabs} scope={code} startOpen settled={homeFacts !== undefined && (!visited || visitedFacts !== undefined)} card={card}
    onScope={next => next === "US" ? setResultsScope("nation") : showResultsState(next === home.abbr ? home : visited ?? home)} />;
}
