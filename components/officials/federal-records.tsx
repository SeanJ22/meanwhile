"use client";

import { useEffect, useState } from "react";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CheckedLink } from "@/components/ui/checked-link";
import { CardSection } from "./card-section";
import type { FederalMemberRead } from "@/lib/sources/congress/reader";

/** Additional facts contribute to the existing single Sources list at the foot of the member card. */
export function FederalMemberRecords({ memberId }: { memberId: string }) {
  const [page, setPage] = useState<{ memberId: string; value: FederalMemberRead } | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!/^congress:[A-Z]\d{6}$/.test(memberId)) return;
    const controller = new AbortController();
    void fetch(`/api/federal-civic?member=${encodeURIComponent(memberId)}&offset=${offset}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Federal records unavailable"); return response.json() as Promise<FederalMemberRead>; })
      .then(value => { if (!controller.signal.aborted) setPage({ memberId, value }); })
      .catch(() => { /* The coverage gap stays visible; a failed request cannot show another member's facts. */ });
    return () => controller.abort();
  }, [memberId, offset]);
  if (!/^congress:[A-Z]\d{6}$/.test(memberId)) return null;
  const record = page?.memberId === memberId ? page.value : null;
  return <>
    <CardSection title="Sponsored bills" meta={record ? String(record.totalBills) : null}>
      {!record?.bills.length ? <CardGapContribution id={`federal-bills:${memberId}`} label="sponsored bills" /> : <>
        <ul className="space-y-3">{record.bills.map(bill => <li key={bill.id}>
          <CheckedLink href={bill.sourceUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">{bill.title}</CheckedLink>
          <p className="t-caption text-muted">Introduced {bill.publishedAt?.slice(0, 10) ?? "date not supplied"}</p>
          {bill.action && <p className="t-detail">{bill.actionDate?.slice(0, 10)} {bill.action}</p>}
          {record.referrals.filter(row => row.billId === bill.billId).map(row => <p key={row.id} className="t-detail text-muted">Referred to {row.title} · {row.publishedAt?.slice(0, 10) ?? "date not supplied"}</p>)}
          <div className="flex flex-wrap gap-3">{record.texts.filter(row => row.billId === bill.billId).map(row => <CheckedLink key={row.id} href={row.sourceUrl} target="_blank" rel="noreferrer" className="t-caption text-link hover:underline">Bill text · {row.publishedAt?.slice(0, 10) ?? row.title}</CheckedLink>)}</div>
        </li>)}</ul>
        <div className="mt-3 flex gap-4">
          {offset > 0 && <button type="button" className="text-link" onClick={() => setOffset(Math.max(0, offset - 20))}>Previous bills</button>}
          {offset + record.bills.length < record.totalBills && <button type="button" className="text-link" onClick={() => setOffset(offset + 20)}>More sponsored bills</button>}
        </div>
      </>}
    </CardSection>
    <CardSection title="Lobbying contributions">
      {!record?.contributions.length ? <CardGapContribution id={`federal-contributions:${memberId}`} label="lobbying contributions" /> : <ul className="space-y-2">{record.contributions.map(row => <li key={row.id} className="t-detail">
        {row.organization ?? "Lobbying contributions"}: ${row.amount} · {row.contributionDate}
      </li>)}</ul>}
    </CardSection>
    <CardSourcesContribution id={`federal-records:${memberId}`} sources={record?.sources ?? []} />
  </>;
}
