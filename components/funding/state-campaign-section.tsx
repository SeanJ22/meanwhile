"use client";

import { useEffect, useRef, useState } from "react";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { campaignFinanceRecordSources, campaignFinanceRecordText } from "@/lib/funding/state-view";
import type { CampaignFinancePlaceRead } from "@/lib/funding/state-reader";

async function load(division: string, cursor?: string | null) {
  const response = await fetch(`/api/campaign-finance?${new URLSearchParams({ division, ...(cursor ? { cursor } : {}) })}`);
  if (!response.ok) throw new Error("Campaign records unavailable");
  const value = await response.json() as CampaignFinancePlaceRead;
  if (value.division !== division || !["HELD", "NOT_HELD", "UNAVAILABLE"].includes(value.status) || !Array.isArray(value.records) || value.records.length > 100 || !(value.nextCursor === null || typeof value.nextCursor === "string")) throw new Error("Campaign records unavailable");
  return value;
}
export function StateCampaignSection({ divisionId, data }: { divisionId: string; data?: CampaignFinancePlaceRead }) {
  const [read, setRead] = useState<CampaignFinancePlaceRead | null>(null), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const current = ++request.current;
    if (!data) void load(divisionId).then(value => { if (request.current === current) setRead(value); }).catch(() => { if (request.current === current) setFailed(true); });
    return () => { request.current++; };
  }, [divisionId, data]);
  const value = read?.division === divisionId ? read : data;
  async function next() {
    if (!value?.nextCursor || loading) return;
    const current = ++request.current;
    setLoading(true); setFailed(false);
    try { const page = await load(divisionId, value.nextCursor); if (request.current === current) setRead(page); }
    catch { if (request.current === current) setFailed(true); }
    finally { if (request.current === current) setLoading(false); }
  }
  if (!value || value.division !== divisionId || !value.records.length) return <CardGapContribution id={`campaign-finance:${divisionId}`} label="campaign money for this place" />;
  return <section aria-label="Campaign money" className="space-y-3">
    <h4 className="t-detail font-medium text-paper">Campaign money</h4>
    <dl className="space-y-3">{value.records.map(row => <div key={row.id} data-campaign-record={row.id}>
      <dt className="t-body text-paper">{campaignFinanceRecordText(row)}</dt>
      <dd className="mt-1 t-detail"><a href={row.filingUrl} target="_blank" rel="noopener noreferrer" className="text-link">Official filing source</a></dd>
    </div>)}</dl>
    {value.nextCursor && <button type="button" disabled={loading} onClick={() => void next()} className="t-caption text-link">{loading ? "Loading filings…" : failed ? "Try loading the next filings again" : "Next filings"}</button>}
    <CardSourcesContribution id={`campaign-finance:${divisionId}`} sources={value.records.flatMap(campaignFinanceRecordSources)} />
  </section>;
}
