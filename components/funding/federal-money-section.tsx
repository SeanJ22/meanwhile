"use client";

import { useEffect, useRef, useState } from "react";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { FEDERAL_MONEY_SOURCES } from "@/lib/federal-money/model";
import { federalMoneyRows, federalMoneySources } from "@/lib/federal-money/view";
import type { FederalMoneyPlaceRead } from "@/lib/federal-money/reader";
import { readerText } from "@/lib/text/reader-names";
import { useReaderNames } from "@/components/ui/reader-names-context";

const requests = new Map<string, Promise<FederalMoneyPlaceRead>>();
const labels = {
  usaspending: "Federal grants, contracts and loans",
  "federal-audit-clearinghouse": "Federal audit findings",
  "sam-gov-entities": "Federal registration",
  openfema: "Disaster declarations",
};
function load(divisionId: string, bodyId?: string, cursor?: string | null, recipientIds: readonly string[] = [], recipientNames: readonly string[] = [], recipientState?: string) {
  const ids = [...new Set(recipientIds)].sort();
  const key = JSON.stringify([divisionId, bodyId, cursor, ids, recipientNames, recipientState]);
  const existing = requests.get(key);
  if (existing) return existing;
  const query = new URLSearchParams({ division: divisionId, ...(bodyId ? { body: bodyId } : {}), ...(cursor ? { cursor } : {}) });
  for (const id of ids) query.append("recipient", id);
  for (const name of recipientNames) query.append("recipientName", name);
  if (recipientState) query.set("recipientState", recipientState);
  const pending = fetch(`/api/federal-money?${query}`).then(async response => {
    if (!response.ok) throw new Error("Federal records unavailable");
    const result = await response.json() as FederalMoneyPlaceRead;
    if (result.division !== divisionId || result.bodyId !== (bodyId ?? null) || !(result.nextCursor === null || typeof result.nextCursor === "string") || !Array.isArray(result.sources) || result.sources.length !== FEDERAL_MONEY_SOURCES.length || result.sources.some((source, index) => source.source !== FEDERAL_MONEY_SOURCES[index] || !["HELD", "NOT_HELD", "UNAVAILABLE"].includes(source.status) || !Array.isArray(source.records))) throw new Error("Federal records unavailable");
    return result;
  }).finally(() => { requests.delete(key); });
  requests.set(key, pending);
  return pending;
}

export function FederalMoneySection({ divisionId, bodyId, recipientIds = [], recipientNames = [], recipientState, data }: { divisionId: string; bodyId?: string; recipientIds?: readonly string[]; recipientNames?: readonly string[]; recipientState?: string; data?: FederalMoneyPlaceRead }) {
  const knownNames = useReaderNames();
  const [read, setRead] = useState<{ identity: string; value: FederalMoneyPlaceRead } | null>(null);
  const recipients = [...new Set(recipientIds)].sort().join("|");
  const names = JSON.stringify([...new Set(recipientNames)].sort());
  const identity = `${divisionId}|${bodyId ?? ""}|${recipients}|${names}|${recipientState ?? ""}`;
  const [pageState, setPageState] = useState<{ identity: string; request: number; loading: boolean; failed: boolean } | null>(null);
  const loadingMore = pageState?.identity === identity && pageState.loading;
  const pageFailed = pageState?.identity === identity && pageState.failed;
  const request = useRef(0);
  useEffect(() => {
    const current = ++request.current;
    if (data) return;
    void load(divisionId, bodyId, undefined, recipients ? recipients.split("|") : [], JSON.parse(names), recipientState).then(result => { if (current === request.current) setRead({ identity, value: result }); }).catch(() => {
      if (current === request.current) setRead({ identity, value: { division: divisionId, bodyId: bodyId ?? null, nextCursor: null, sources: FEDERAL_MONEY_SOURCES.map(source => ({ source, status: "UNAVAILABLE", records: [], versionId: null, checkedAt: null })) } });
    });
    return () => { request.current += 1; };
  }, [divisionId, bodyId, data, recipients, names, recipientState, identity]);
  const value = read?.identity === identity ? read.value : data;
  async function loadMore() {
    if (!value?.nextCursor || loadingMore) return;
    const current = ++request.current;
    setPageState({ identity, request: current, loading: true, failed: false });
    try {
      const page = await load(divisionId, bodyId, value.nextCursor, recipientIds, recipientNames, recipientState);
      if (current !== request.current) return;
      if (page.sources.some(source => source.status === "UNAVAILABLE" && value.sources.find(prior => prior.source === source.source)?.moreRecords)) throw new Error("More federal records are unavailable.");
      setRead({ identity, value: { ...page, sources: page.sources.map(source => {
        const prior = value.sources.find(row => row.source === source.source);
        const records = prior?.versionId === source.versionId ? [...new Map([...prior.records, ...source.records].map(fact => [fact.id, fact])).values()] : source.records;
        return { ...source, records };
      }) } });
      setPageState({ identity, request: current, loading: false, failed: false });
    } catch { if (current === request.current) setPageState({ identity, request: current, loading: false, failed: true }); }
    finally { setPageState(previous => previous?.request === current ? { ...previous, loading: false } : previous); }
  }
  if (!value || value.division !== divisionId || value.bodyId !== (bodyId ?? null)) return <CardGapContribution id={`federal-money:${identity}:loading`} label="federal money and records" />;
  const rows = federalMoneyRows([...new Map(value.sources.flatMap(source => source.records).map(fact => [fact.id, fact])).values()], { divisionId, bodyId, bodyIds: value.recipientIds ?? recipientIds, recipientNames, recipientState });
  const sources = federalMoneySources(rows);
  const award = (row: typeof rows[number]) => ["GRANT", "CONTRACT", "LOAN"].includes(row.fact.kind);
  const groups = [
    { label: "Federal money received by this government", rows: rows.filter(row => award(row) && row.relationship !== "GEOGRAPHY") },
    { label: "Federal money spent in this area", rows: rows.filter(row => award(row) && row.relationship === "GEOGRAPHY") },
    { label: "Federal audits and registration", rows: rows.filter(row => row.fact.kind === "AUDIT" || row.fact.kind === "ENTITY") },
    { label: "Disaster declarations", rows: rows.filter(row => row.fact.kind === "DISASTER") },
  ];
  return <section aria-label="Federal money and records" className="space-y-5">
    {groups.filter(group => group.rows.length).map(group => <div key={group.label} aria-label={group.label}>
      <h4 className="t-detail font-medium text-paper">{group.label}</h4>
      <ul className="mt-2 space-y-3">{group.rows.map(row => <li key={row.fact.id} data-federal-source={row.fact.source} data-federal-record={row.fact.id} className="t-body leading-relaxed text-paper-dim">{readerText(row.text, "sentence", knownNames)}</li>)}</ul>
    </div>)}
    {value.sources.map(source => !rows.some(row => row.fact.source === source.source)
      ? <CardGapContribution key={source.source} id={`federal-money:${identity}:${source.source}`} label={labels[source.source].toLowerCase()} />
      : source.coverageComplete === false && <CardGapContribution key={source.source} id={`federal-money:${identity}:${source.source}:more`} label="more records for this place" />)}
    {value.nextCursor && <button type="button" className="t-caption text-link" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading records…" : pageFailed ? "Try loading more records again" : "Load more records"}</button>}
    <CardSourcesContribution id={`federal-money:${divisionId}:${bodyId ?? "place"}`} sources={sources} />
  </section>;
}
