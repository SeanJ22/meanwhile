"use client";

import { useEffect, useRef, useState } from "react";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { FEDERAL_MONEY_SOURCES } from "@/lib/federal-money/model";
import { federalMoneyRows, federalMoneySources } from "@/lib/federal-money/view";
import type { FederalMoneyPlaceRead } from "@/lib/federal-money/reader";

const requests = new Map<string, Promise<FederalMoneyPlaceRead>>();
const labels = {
  usaspending: "Federal grants, contracts and loans",
  "federal-audit-clearinghouse": "Federal audit findings",
  "sam-gov-entities": "Federal registration",
  openfema: "Disaster declarations",
};
function load(divisionId: string, bodyId?: string, cursor?: string | null) {
  const key = `${divisionId}|${bodyId ?? ""}|${cursor ?? ""}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const query = new URLSearchParams({ division: divisionId, ...(bodyId ? { body: bodyId } : {}), ...(cursor ? { cursor } : {}) });
  const pending = fetch(`/api/federal-money?${query}`).then(async response => {
    if (!response.ok) throw new Error("Federal records unavailable");
    const result = await response.json() as FederalMoneyPlaceRead;
    if (result.division !== divisionId || result.bodyId !== (bodyId ?? null) || !(result.nextCursor === null || typeof result.nextCursor === "string") || !Array.isArray(result.sources) || result.sources.length !== FEDERAL_MONEY_SOURCES.length || result.sources.some((source, index) => source.source !== FEDERAL_MONEY_SOURCES[index] || !["HELD", "NOT_HELD", "UNAVAILABLE"].includes(source.status) || !Array.isArray(source.records))) throw new Error("Federal records unavailable");
    return result;
  }).finally(() => { requests.delete(key); });
  requests.set(key, pending);
  return pending;
}

export function FederalMoneySection({ divisionId, bodyId, data }: { divisionId: string; bodyId?: string; data?: FederalMoneyPlaceRead }) {
  const [read, setRead] = useState<FederalMoneyPlaceRead | null>(null);
  const identity = `${divisionId}|${bodyId ?? ""}`;
  const [pageState, setPageState] = useState<{ identity: string; request: number; loading: boolean; failed: boolean } | null>(null);
  const loadingMore = pageState?.identity === identity && pageState.loading;
  const pageFailed = pageState?.identity === identity && pageState.failed;
  const request = useRef(0);
  useEffect(() => {
    const current = ++request.current;
    if (data) return;
    void load(divisionId, bodyId).then(result => { if (current === request.current) setRead(result); }).catch(() => {
      if (current === request.current) setRead({ division: divisionId, bodyId: bodyId ?? null, nextCursor: null, sources: FEDERAL_MONEY_SOURCES.map(source => ({ source, status: "UNAVAILABLE", records: [], versionId: null, checkedAt: null })) });
    });
    return () => { request.current += 1; };
  }, [divisionId, bodyId, data]);
  const value = read?.division === divisionId && read.bodyId === (bodyId ?? null) ? read : data;
  async function loadMore() {
    if (!value?.nextCursor || loadingMore) return;
    const current = ++request.current;
    setPageState({ identity, request: current, loading: true, failed: false });
    try {
      const page = await load(divisionId, bodyId, value.nextCursor);
      if (current !== request.current) return;
      if (page.sources.some(source => source.status === "UNAVAILABLE" && value.sources.find(prior => prior.source === source.source)?.moreRecords)) throw new Error("More federal records are unavailable.");
      setRead({ ...page, sources: page.sources.map(source => {
        const prior = value.sources.find(row => row.source === source.source);
        const records = prior?.versionId === source.versionId ? [...new Map([...prior.records, ...source.records].map(fact => [fact.id, fact])).values()] : source.records;
        return { ...source, records };
      }) });
      setPageState({ identity, request: current, loading: false, failed: false });
    } catch { if (current === request.current) setPageState({ identity, request: current, loading: false, failed: true }); }
    finally { setPageState(previous => previous?.request === current ? { ...previous, loading: false } : previous); }
  }
  if (!value || value.division !== divisionId || value.bodyId !== (bodyId ?? null)) return <CardGapContribution id={`federal-money:${identity}:loading`} label="federal money and records" />;
  const visible = value.sources.map(source => ({ ...source, rows: federalMoneyRows(source.records, { divisionId, bodyId }) }));
  const sources = federalMoneySources(visible.flatMap(source => source.rows));
  return <section aria-label="Federal money and records" className="space-y-5">
    {visible.map(source => source.rows.length ? <div key={source.source} data-federal-source={source.source}>
      <h4 className="t-detail font-medium text-paper">{labels[source.source]}</h4>
      <dl className="mt-2 space-y-3">{source.rows.map(row => <div key={row.fact.id} data-federal-record={row.fact.id}>
        <dt className="t-body font-medium text-paper">{row.label}</dt>
        <dd className="mt-1 t-body leading-relaxed text-paper-dim">{row.text}</dd>
      </div>)}</dl>
      {source.coverageComplete === false && <CardGapContribution id={`federal-money:${identity}:${source.source}:more`} label="more records for this place" />}
    </div> : <CardGapContribution key={source.source} id={`federal-money:${identity}:${source.source}`} label={labels[source.source].toLowerCase()} />)}
    {value.nextCursor && <button type="button" className="t-caption text-link" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading records…" : pageFailed ? "Try loading more records again" : "Load more records"}</button>}
    <CardSourcesContribution id={`federal-money:${divisionId}:${bodyId ?? "place"}`} sources={sources} />
  </section>;
}
