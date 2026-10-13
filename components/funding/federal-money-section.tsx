"use client";

import { useEffect, useState } from "react";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { FEDERAL_MONEY_SOURCES } from "@/lib/federal-money/model";
import { federalMoneyRows, federalMoneySources, FEDERAL_MONEY_SOURCE_LABELS } from "@/lib/federal-money/view";
import type { FederalMoneyPlaceRead } from "@/lib/federal-money/reader";

const requests = new Map<string, Promise<FederalMoneyPlaceRead>>();
function load(divisionId: string, bodyId?: string) {
  const key = `${divisionId}|${bodyId ?? ""}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const query = new URLSearchParams({ division: divisionId, ...(bodyId ? { body: bodyId } : {}) });
  const pending = fetch(`/api/federal-money?${query}`).then(async response => {
    if (!response.ok) throw new Error("Federal records unavailable");
    const result = await response.json() as FederalMoneyPlaceRead;
    if (result.division !== divisionId || result.bodyId !== (bodyId ?? null) || !Array.isArray(result.sources) || result.sources.length !== FEDERAL_MONEY_SOURCES.length || result.sources.some((source, index) => source.source !== FEDERAL_MONEY_SOURCES[index] || !["HELD", "NOT_HELD", "UNAVAILABLE"].includes(source.status) || !Array.isArray(source.records))) throw new Error("Federal records unavailable");
    return result;
  }).finally(() => { requests.delete(key); });
  requests.set(key, pending);
  return pending;
}

/** The exact selected place survives late fetches; every source keeps its own
 * coverage line, even when the other three already hold facts. */
export function FederalMoneySection({ divisionId, bodyId, data }: { divisionId: string; bodyId?: string; data?: FederalMoneyPlaceRead }) {
  const [read, setRead] = useState<FederalMoneyPlaceRead | null>(null);
  useEffect(() => {
    if (data) return;
    let active = true;
    void load(divisionId, bodyId).then(result => { if (active) setRead(result); }).catch(() => { if (active) setRead({ division: divisionId, bodyId: bodyId ?? null, sources: FEDERAL_MONEY_SOURCES.map(source => ({ source, status: "UNAVAILABLE", records: [], versionId: null, checkedAt: null })) }); });
    return () => { active = false; };
  }, [divisionId, bodyId, data]);
  const value = data ?? read;
  if (!value || value.division !== divisionId || value.bodyId !== (bodyId ?? null)) return <WorkingOnIt />;
  const visible = value.sources.map(source => ({ ...source, rows: federalMoneyRows(source.records, { divisionId, bodyId }) }));
  const sources = federalMoneySources(visible.flatMap(source => source.rows));
  return <section aria-label="Federal money and records" className="space-y-5">
    {visible.map(source => <div key={source.source} data-federal-source={source.source}>
      <h4 className="t-detail font-medium text-paper">{FEDERAL_MONEY_SOURCE_LABELS[source.source]}</h4>
      {source.rows.length ? <dl className="mt-2 space-y-3">{source.rows.map(row => <div key={row.fact.id} data-federal-record={row.fact.id}>
        <dt className="t-body font-medium text-paper">{row.label}</dt>
        <dd className="mt-1 t-body leading-relaxed text-paper-dim">{row.text}</dd>
      </div>)}</dl> : <WorkingOnIt about={source.source === "usaspending" ? "federal grants, contracts and loans" : source.source === "federal-audit-clearinghouse" ? "federal audit findings" : source.source === "sam-gov-entities" ? "federal registration" : "disaster declarations"} />}
      {source.rows.length > 0 && source.coverageComplete === false && <WorkingOnIt about="more records for this place" />}
      {source.checkedAt && <p className="mt-1 t-caption text-muted">Last checked {source.checkedAt.slice(0, 10)}</p>}
    </div>)}
    <CardSourcesContribution id={`federal-money:${divisionId}:${bodyId ?? "place"}`} sources={sources} />
  </section>;
}
