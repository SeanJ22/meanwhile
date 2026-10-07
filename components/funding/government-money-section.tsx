"use client";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import { governmentMoneyView } from "@/lib/funding/government-money";
import type { GovernmentBudgetFact } from "@/lib/civic-data/government-budget-contract";

/** A body's budget facts with their sources; the gap line when none are held. */
export function GovernmentMoneySection({bodyId,divisionId,records}:{bodyId:string;divisionId:string;records:readonly GovernmentBudgetFact[]}) {
  const view=governmentMoneyView(records,bodyId,divisionId);
  if(!view.rows.length)return <WorkingOnIt />;
  return <><dl className="space-y-3">{view.rows.map(row=><div key={row.id}>
    <dt className="t-detail font-medium">{row.label}{row.period ? ` · ${row.period}` : ""}</dt>
    <dd className="mt-1 t-body text-paper-dim">{row.text}</dd>
  </div>)}</dl><CardSourcesContribution id={`government-money:${bodyId}`} sources={view.sources} /></>;
}
