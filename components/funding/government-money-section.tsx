"use client";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { governmentMoneyView } from "@/lib/funding/government-money";
import type { GovernmentBudgetFact } from "@/lib/civic-data/government-budget-contract";
import { readerText } from "@/lib/text/reader-names";
import { useReaderNames } from "@/components/ui/reader-names-context";

/** A body's budget facts with their sources; the gap line when none are held. */
export function GovernmentMoneySection({bodyId,divisionId,records}:{bodyId:string;divisionId:string;records:readonly GovernmentBudgetFact[]}) {
  const inheritedNames=useReaderNames();
  const knownNames=[...inheritedNames,...records.map(row=>row.government)];
  const view=governmentMoneyView(records,bodyId,divisionId);
  if(!view.rows.length)return <CardGapContribution id={`government-money:${bodyId}`} label="government money" />;
  return <><dl className="space-y-3">{view.rows.map(row=><div key={row.id}>
    <dt className="t-detail font-medium">{readerText(row.label,"title")}{row.period ? ` · ${readerText(row.period,"sentence",knownNames)}` : ""}</dt>
    <dd className="mt-1 t-body text-paper-dim">{readerText(row.text,"sentence",knownNames)}</dd>
  </div>)}</dl><CardSourcesContribution id={`government-money:${bodyId}`} sources={view.sources} /></>;
}
